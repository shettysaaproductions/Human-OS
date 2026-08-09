/**
 * PRODUCTION TEST — Nova end-to-end smoke test (v2).
 *
 * Runs against the LIVE Render backend + production Supabase using a throwaway
 * user, with the MINIMUM number of NVIDIA calls:
 *   - 2 user messages (2 main chat calls + ~7 background extraction jobs on key4)
 *   - spaced ~90s apart so background memory extraction completes first.
 *
 * Coverage per message:
 *   Msg 1 "interview tomorrow + remind call mom" → chat reply, memory save,
 *         reminder scheduling, presence in brief.
 *   Msg 2 "do you remember my interview?"        → memory recall + situation
 *         brief with ONLINE presence + unread READ STATE.
 * Then POST /chat/read marks Nova's messages seen.
 *
 * Verifies DB effects directly (chat_history, memories, reminders,
 * user_presence, situationBrief meta), then ALWAYS DELETES the test user + data
 * (try/finally) — plus any leftover novatest_* users from earlier runs.
 *
 * Run: npm run boot:prodtest
 */
import { supabaseAdmin } from '../src/lib/supabase';

const BASE_URL = 'https://human-os-zitw.onrender.com/api';
const TEST_EMAIL = `novatest_${Date.now()}@humanos.app`;
const TEST_PASSWORD = 'NovaProdTest!2026';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

/** Wipe every table that references user_id for a user, then delete the auth user. */
async function cleanupUser(userId: string) {
  const tables = [
    'chat_history', 'memories', 'reminders', 'user_presence', 'short_term_memories',
    'working_memory', 'episodic_memories', 'emotional_states', 'reflections',
    'knowledge_graph', 'nova_agenda_items', 'nova_outreach_log', 'sleep_schedule',
    'nudges', 'goals', 'habits', 'proactive_triggers',
  ];
  for (const table of tables) {
    try {
      await supabaseAdmin.from(table).delete().eq('user_id', userId);
    } catch {
      /* table may not exist or lack user_id — best effort */
    }
  }
  try {
    await supabaseAdmin.from('background_jobs').delete().filter('payload->>user_id', 'eq', userId);
  } catch { /* best effort */ }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) console.error(`  ⚠️ deleteUser(${userId}): ${error.message}`);
  else console.log(`  🗑️  Deleted user ${userId}`);
}

/** Clean up any leftover novatest_* users from earlier interrupted runs. */
async function cleanupLeftovers() {
  const { data } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const leftovers = (data?.users || []).filter((u: any) => u.email?.startsWith('novatest_'));
  for (const u of leftovers) {
    console.log(`🧹 Cleaning leftover test user: ${u.email} (${u.id})`);
    await cleanupUser(u.id!);
  }
}

async function main() {
  console.log('=== NOVA PRODUCTION TEST v2 ===');
  await cleanupLeftovers();

  // ── 1. Create throwaway user ────────────────────────────────────────────
  let userId: string | null = null;
  let token: string | null = null;
  try {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
    });
    if (createErr) throw new Error(`createUser: ${createErr.message}`);
    userId = created!.user!.id!;
    console.log('✅ User created:', userId);

    // Seed minimal profile (country optional — some cols may be schema-cache stale)
    try {
      await supabaseAdmin.from('profiles').upsert(
        { id: userId, preferred_name: 'Test' },
        { onConflict: 'id' },
      );
    } catch (e: any) {
      console.warn('  ⚠️ profile upsert (non-fatal):', e.message);
    }

    // ── 2. Sign in through REAL prod login flow for a JWT ─────────────────
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    const loginBody: any = await loginRes.json();
    if (!loginRes.ok || !loginBody.access_token) {
      throw new Error(`login failed: ${loginRes.status} ${JSON.stringify(loginBody)}`);
    }
    token = loginBody.access_token;
    console.log('✅ Signed in (real prod JWT)');

    // ── 3. Presence ONLINE so the brief can see it ────────────────────────
    try {
      await supabaseAdmin.from('user_presence').upsert(
        { user_id: userId, status: 'online', last_active_at: nowISO(), last_typing_at: nowISO() },
        { onConflict: 'user_id' },
      );
      console.log('✅ Presence set to ONLINE');
    } catch (e: any) {
      console.warn('  ⚠️ presence upsert (non-fatal):', e.message);
    }

    const sendChat = async (message: string) => {
      const t0 = Date.now();
      const res = await fetch(`${BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message }),
      });
      const elapsed = (Date.now() - t0) / 1000;
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`chat failed (HTTP ${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
      }
      console.log(`  → reply in ${elapsed.toFixed(1)}s: ${String(body.reply || '(no reply)').slice(0, 150).replace(/\n/g, ' ')}`);
      return body;
    };

    // ── 4. Msg 1 — memory save + reminder + basic chat ───────────────────
    console.log('\n── MSG 1: "interview tomorrow + remind call mom" ──');
    await sendChat('Hey Nova! I have a job interview tomorrow at 4pm. Also please remind me to call mom in 5 minutes.');

    console.log('⏳ Waiting 90s for memory/reminder extraction jobs...');
    await sleep(90_000);

    // ── 5. Msg 2 — memory recall + presence + read state in brief ────────
    console.log('\n── MSG 2: "do you remember my interview?" ──');
    await sendChat('Do you remember what I told you about my job interview?');
    await sleep(15_000);

    // ── 6. Mark Nova\'s messages as read via the new endpoint ─────────────
    const readRes = await fetch(`${BASE_URL}/chat/read`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`✅ POST /chat/read -> HTTP ${readRes.status}`);

    // ── 7. Verify DB effects ──────────────────────────────────────────────
    console.log('\n── DB VERIFICATION ──');
    const { data: chatRows, error: chatErr } = await supabaseAdmin
      .from('chat_history').select('role, content, is_read, meta')
      .eq('user_id', userId).order('created_at', { ascending: true });
    if (chatErr) throw new Error(`chat_history: ${chatErr.message}`);
    const userRows = chatRows.filter((r: any) => r.role === 'user');
    const assistantRows = chatRows.filter((r: any) => r.role === 'assistant');
    console.log(`chat_history: ${userRows.length} user rows, ${assistantRows.length} assistant rows`);
    if (assistantRows.length > 0) {
      const allRead = assistantRows.every((r: any) => r.is_read === true);
      console.log(`  is_read after POST /chat/read → all assistant messages read: ${allRead}`);
    }

    // situationBrief meta on the LAST assistant bubble
    const lastAssistant = assistantRows[assistantRows.length - 1];
    const brief: string | null = lastAssistant?.meta?.situationBrief || null;
    if (brief) {
      const hasPresence = brief.includes('USER PRESENCE');
      const hasReadState = brief.includes('READ STATE') || brief.includes('has NOT yet seen');
      const presLine = (brief.match(/👁️ USER PRESENCE:[^\n]*/) || [])[0] || '(no presence line)';
      const readLine = (brief.match(/📬 READ STATE:[^\n]*/) || [])[0] || '(no read-state)';
      console.log(`  situationBrief: presence block ${hasPresence ? '✅' : '❌'} | read-state block ${hasReadState ? '✅' : '❌'}`);
      console.log(`    ${presLine}`);
      console.log(`    ${readLine}`);
    } else {
      console.log('  ⚠️ no situationBrief in last assistant meta');
    }

    // Memories (key/value)
    const { data: memories, error: memErr } = await supabaseAdmin
      .from('memories').select('key, value, importance').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(5);
    if (memErr) throw new Error(`memories: ${memErr.message}`);
    console.log(`\nmemories: ${memories?.length ?? 0} rows`);
    (memories ?? []).forEach((m: any) =>
      console.log(`  • [imp ${m.importance}] ${String(m.key).slice(0, 40)}: ${String(m.value).slice(0, 80)}`));
    const hasInterview = (memories ?? []).some((m: any) => /interview/i.test(`${m.key} ${m.value}`));
    console.log(`  interview memory saved: ${hasInterview ? '✅' : '❌'}`);

    // Reminders (text column)
    const { data: reminders, error: remErr } = await supabaseAdmin
      .from('reminders').select('text, trigger_at, status').eq('user_id', userId);
    if (remErr) throw new Error(`reminders: ${remErr.message}`);
    console.log(`\nreminders: ${reminders?.length ?? 0} rows`);
    (reminders ?? []).forEach((r: any) =>
      console.log(`  • [${r.status}] ${String(r.text).slice(0, 60)} @ ${r.trigger_at}`));
    const hasMomReminder = (reminders ?? []).some((r: any) => /mom/i.test(r.text || ''));
    console.log(`  "call mom" reminder scheduled: ${hasMomReminder ? '✅' : '❌'}`);

    // Presence row
    const { data: presence, error: presErr } = await supabaseAdmin
      .from('user_presence').select('status, last_active_at').eq('user_id', userId).maybeSingle();
    if (presErr) throw new Error(`presence: ${presErr.message}`);
    console.log(`\nuser_presence: ${presence ? `${presence.status} (last active ${presence.last_active_at})` : 'NO ROW'}`);
  } finally {
    // ── 8. ALWAYS clean up ────────────────────────────────────────────────
    console.log('\n── CLEANUP ──');
    if (userId) await cleanupUser(userId);
    await cleanupLeftovers();
  }

  console.log('\n=== DONE ===');
}

main().catch((err) => {
  console.error('❌ TEST FAILED:', err.message);
  process.exit(1);
});
