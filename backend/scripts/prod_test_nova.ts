/**
 * PRODUCTION TEST — Nova end-to-end smoke test (v3).
 *
 * Runs against the LIVE Render backend + production Supabase using a throwaway
 * user, with the MINIMUM number of NVIDIA calls:
 *   - 3 user messages (3 main chat calls + background extraction jobs)
 *   - spaced so background memory extraction completes first.
 *
 * Coverage per message:
 *   Msg 1 "interview tomorrow + remind call mom in 2 min" → chat reply, memory
 *         save, reminder scheduling.
 *   Msg 2 "do you remember my interview?"                  → memory recall +
 *         situation brief with ONLINE presence + unread READ STATE.
 *   Then POST /chat/read marks Nova's messages seen (read receipts).
 *   Msg 3 "good night"                                     → sleep/busy lock
 *         written to working_memory (NACE + follow-up suppression).
 *   Wait for the "call mom" reminder to FIRE → status 'completed' + a
 *         user_moments REMINDER entry (reminder engine precision).
 *
 * Verifies DB effects directly (chat_history, memories, reminders,
 * user_presence, working_memory, user_moments, situationBrief meta), then
 * ALWAYS DELETES the test user + data (try/finally) — plus any leftover
 * novatest_* users from earlier runs.
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
    'nudges', 'goals', 'habits', 'proactive_triggers', 'user_moments', 'nova_followups',
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
  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (delErr) console.error(`  ⚠️ deleteUser(${userId}): ${delErr.message || JSON.stringify(delErr)}`);
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
  console.log('=== NOVA PRODUCTION TEST v3 ===');
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

    const fetchAssistantRows = async () => {
      const { data, error } = await supabaseAdmin
        .from('chat_history').select('role, content, is_read, meta')
        .eq('user_id', userId!).order('created_at', { ascending: true });
      if (error) throw new Error(`chat_history: ${error.message}`);
      return data.filter((r: any) => r.role === 'assistant');
    };

    // ── 4. Msg 1 — memory save + reminder + basic chat ───────────────────
    console.log('\n── MSG 1: "interview tomorrow + remind call mom in 2 min" ──');
    await sendChat('Hey Nova! I have a job interview tomorrow at 4pm. Also please remind me to call mom in 2 minutes.');

    console.log('⏳ Waiting 90s for memory/reminder tool execution + extraction jobs...');
    await sleep(90_000);

    // ── 5. Msg 2 — memory recall + presence + read state in brief ────────
    console.log('\n── MSG 2: "do you remember my interview?" ──');
    const r2 = await sendChat('Do you remember what I told you about my job interview?');
    await sleep(15_000);

    const recalled = /interview/i.test(String(r2.reply || ''));
    console.log(`  memory recall in reply: ${recalled ? '✅' : '❌'}`);

    // situationBrief on Msg 2's assistant bubble (both Msg 1 & 2 replies unread)
    const aRows = await fetchAssistantRows();
    const msg2Assistant = aRows[aRows.length - 1];
    let brief: string | null = msg2Assistant?.meta?.situationBrief || null;

    // Msg 2 may have been a FALLBACK reply (NVIDIA rate-limit). If so, check Msg 1's
    // brief instead — it always runs before the 90s extraction wait.
    if (!brief && aRows.length >= 1) {
      brief = aRows[0]?.meta?.situationBrief || null;
      if (brief) console.log('  (using Msg 1 situationBrief since Msg 2 was a fallback reply)');
    }
    if (brief) {
      const hasPresence = brief.includes('USER PRESENCE');
      const hasReadState = brief.includes('READ STATE') || brief.includes('has NOT yet seen');
      const presLine = (brief.match(/👁️ USER PRESENCE:[^\n]*/) || [])[0] || '(no presence line)';
      const readLine = (brief.match(/📬 READ STATE:[^\n]*/) || [])[0] || '(no read-state)';
      console.log(`  situationBrief: presence block ${hasPresence ? '✅' : '❌'} | read-state block ${hasReadState ? '✅' : '❌'}`);
      console.log(`    ${presLine}`);
      console.log(`    ${readLine}`);
    } else {
      console.log('  ⚠️ no situationBrief in Msg 2 assistant meta');
    }

    // ── 6. Mark Nova's messages as read via the new endpoint ─────────────
    const readRes = await fetch(`${BASE_URL}/chat/read`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`✅ POST /chat/read -> HTTP ${readRes.status}`);

    const afterRead = await fetchAssistantRows();
    const allRead = afterRead.length > 0 && afterRead.every((r: any) => r.is_read === true);
    console.log(`  is_read after POST /chat/read → all assistant messages read: ${allRead}`);

    // ── 7. Msg 3 — sleep/unavailability lock ─────────────────────────────
    console.log('\n── MSG 3: "going to sleep, good night" (sleep-respect) ──');
    await sendChat('ok I am going to sleep now, good night');
    await sleep(8_000);
    // Note: Nova may return an empty bubble (no text) if she processes the sleep
    // intent subconsciously without sending a reply — that's valid behavior.

    const { data: wm, error: wmErr } = await supabaseAdmin
      .from('working_memory').select('key, value, expires_at')
      .eq('user_id', userId!).eq('key', 'followup_suppressed_until').maybeSingle();
    if (wmErr) throw new Error(`working_memory: ${wmErr.message}`);
    const lockFuture = wm && new Date(wm.expires_at).getTime() > Date.now();
    console.log(`  followup_suppressed_until lock: ${wm ? `✅ written (expires ${wm.expires_at}) future=${lockFuture}` : '❌ MISSING'}`);

    // ── 8. Wait for the "call mom" reminder to fire ──────────────────────
    console.log('\n⏳ Waiting ~3.5 min for the "call mom" reminder to FIRE...');
    await sleep(210_000);

    const { data: reminders, error: remErr } = await supabaseAdmin
      .from('reminders').select('text, trigger_at, status').eq('user_id', userId!);
    if (remErr) throw new Error(`reminders: ${remErr.message}`);
    const momReminder = (reminders || []).find((r: any) => /mom/i.test(r.text || ''));
    console.log(`reminders: ${reminders?.length ?? 0} rows`);
    (reminders || []).forEach((r: any) =>
      console.log(`  • [${r.status}] ${String(r.text).slice(0, 60)} @ ${r.trigger_at}`));
    const reminderFired = momReminder?.status === 'completed';
    console.log(`  "call mom" reminder fired (status=completed): ${reminderFired ? '✅' : '❌'}`);

    const { data: moments, error: momErr } = await supabaseAdmin
      .from('user_moments').select('moment_type, title').eq('user_id', userId!);
    if (momErr) console.warn('  ⚠️ user_moments fetch (non-fatal):', momErr.message);
    const hasReminderMoment = (moments || []).some((m: any) => m.moment_type === 'REMINDER');
    console.log(`  user_moments REMINDER entry: ${hasReminderMoment ? '✅' : '❌'}`);

    // ── 9. Final memory check ─────────────────────────────────────────────
    const { data: memories, error: memErr } = await supabaseAdmin
      .from('memories').select('key, value, importance').eq('user_id', userId!)
      .order('created_at', { ascending: false }).limit(5);
    if (memErr) throw new Error(`memories: ${memErr.message}`);
    console.log(`\nmemories: ${memories?.length ?? 0} rows`);
    (memories ?? []).forEach((m: any) =>
      console.log(`  • [imp ${m.importance}] ${String(m.key).slice(0, 40)}: ${String(m.value).slice(0, 80)}`));
    const hasInterview = (memories ?? []).some((m: any) => /interview/i.test(`${m.key} ${m.value}`));
    console.log(`  interview memory saved: ${hasInterview ? '✅' : '❌'}`);

    // Presence row
    const { data: presence, error: presErr } = await supabaseAdmin
      .from('user_presence').select('status, last_active_at').eq('user_id', userId!).maybeSingle();
    if (presErr) throw new Error(`presence: ${presErr.message}`);
    console.log(`\nuser_presence: ${presence ? `${presence.status} (last active ${presence.last_active_at})` : 'NO ROW'}`);

    // Summary
    const checks = { recalled, hasPresence: !!brief?.includes('USER PRESENCE'), hasReadState: !!brief?.includes('READ STATE'), allRead, lockFuture, reminderFired, hasReminderMoment, hasInterview };
    console.log('\n── SUMMARY ──');
    (Object.entries(checks) as any[]).forEach(([k, v]) => console.log(`  ${v === true ? '✅' : v === false ? '❌' : '⚠️'} ${k} = ${String(v)}`));
  } finally {
    // ── 10. ALWAYS clean up ──────────────────────────────────────────────
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
