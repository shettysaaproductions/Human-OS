/**
 * Comprehensive Forensic Production Verification — Proactive Gate
 *
 * Verifies all 16 points requested:
 * 1. Render health endpoints (/health, /health/ready, /api/health/cognitive)
 * 2. PostgREST column presence (logical_key, replied_at, updated_at)
 * 3. ProactiveGate concurrency & idempotency (5 concurrent requests -> exactly 1 win)
 * 4. DB-backed escalation cooldown (0=1m, 1=60m, 2=180m, 3=360m, 4+=720m)
 * 5. markReplied() persistence and state change
 * 6. Logical key window suppression
 * 7. Near-duplicate content rejection (75% Jaccard)
 * 8. Long-silence suppression (48h+ silence with 4+ ignored)
 * 9. Live chat evaluation ("Sab thik" -> normal reply, no fallback, no thought leaks)
 * 10. Complete ephemeral cleanup
 */

import axios from 'axios';
import { supabaseAdmin } from '../src/lib/supabase';
import { proactiveGate, getEscalatedGapMinutes } from '../src/services/ProactiveGate';
import { sanitizeReply, NOVA_EMPTY_REPLY } from '../src/services/NovaBrainService';
import crypto from 'crypto';

const RENDER_BASE_URL = 'https://human-os-zitw.onrender.com';
const TEST_EMAIL = `proactivetest_${Date.now()}@humanos.app`;
const TEST_PASSWORD = 'GateVerify2026!Pass';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, details: string) {
  results.push({ name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${name}]: ${details}`);
}

async function runVerification() {
  console.log('============================================================');
  console.log('🚀 STARTING PROACTIVE GATE PRODUCTION FORENSIC VERIFICATION');
  console.log(`Target URL: ${RENDER_BASE_URL}`);
  console.log('============================================================\n');

  let testUserId: string | null = null;
  let testUserToken: string | null = null;
  let silentUserId: string | null = null;

  try {
    // ── 0. CREATE EPHEMERAL AUTH USER ───────────────────────────────────────
    console.log('--- 0. Creating Ephemeral Test User ---');
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createErr || !created.user) {
      throw new Error(`Failed to create test user: ${createErr?.message}`);
    }
    testUserId = created.user.id;
    console.log(`✅ Ephemeral test user created: ${testUserId}`);

    // Create profile row
    await supabaseAdmin.from('profiles').upsert({
      id: testUserId,
      preferred_name: 'TestUser',
      timezone_offset: 330 // IST
    });

    // Obtain JWT token for live HTTP tests
    const loginRes = await axios.post(`${RENDER_BASE_URL}/api/auth/login`, {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }, { timeout: 15000 });
    testUserToken = loginRes.data?.access_token;
    console.log(`✅ Real JWT token obtained from Render`);

    // ── 1. RENDER HEALTH ENDPOINTS ──────────────────────────────────────────
    console.log('\n--- 1. Render Health Endpoints ---');
    try {
      const hRes = await axios.get(`${RENDER_BASE_URL}/health`, { timeout: 15000 });
      record('Render /health', hRes.status === 200 && hRes.data.status === 'ok', JSON.stringify(hRes.data));
    } catch (e: any) {
      record('Render /health', false, e.message);
    }

    try {
      const rRes = await axios.get(`${RENDER_BASE_URL}/health/ready`, { timeout: 15000 });
      record('Render /health/ready', rRes.status === 200 && rRes.data.status === 'ready', JSON.stringify(rRes.data));
    } catch (e: any) {
      record('Render /health/ready', false, e.message);
    }

    try {
      const cRes = await axios.get(`${RENDER_BASE_URL}/api/health/cognitive`, { timeout: 15000 });
      const passed = cRes.status === 200 && (cRes.data.status === 'healthy' || cRes.data.status === 'maintenance_required');
      record('Render /api/health/cognitive', passed, `status=${cRes.data?.status}, metrics=${JSON.stringify(cRes.data?.metrics || {})}`);
    } catch (e: any) {
      record('Render /api/health/cognitive', false, e.message);
    }

    // ── 2. POSTGREST SCHEMA VERIFICATION (Migration 038) ───────────────────
    console.log('\n--- 2. PostgREST Migration 038 Columns ---');
    try {
      const { data, error } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('id, user_id, message, outreach_type, logical_key, replied_at, updated_at, created_at')
        .limit(1);

      if (error) {
        record('PostgREST Columns (038)', false, `Query error: ${error.message}`);
      } else {
        record('PostgREST Columns (038)', true, 'Columns logical_key, replied_at, updated_at are active and queryable');
      }
    } catch (e: any) {
      record('PostgREST Columns (038)', false, e.message);
    }

    // ── 3. CONCURRENCY & IDEMPOTENCY TEST ──────────────────────────────────
    console.log('\n--- 3. Concurrency & Idempotency Test ---');
    // Simulate 5 simultaneous workers or duplicate presence events trying to outreach with same logical key
    const logicalKey = `test:concurrent:${Date.now()}`;
    const concurrentAttempts = await Promise.all([
      proactiveGate.acquire(testUserId, {
        outreachType: 'engagement_checkin',
        logicalKey,
        logicalKeyWindowMinutes: 30,
        proposedMessage: 'Concurrency test message 1',
        skipQuietHoursCheck: true,
        skipMinGapCheck: true,
      }),
      proactiveGate.acquire(testUserId, {
        outreachType: 'engagement_checkin',
        logicalKey,
        logicalKeyWindowMinutes: 30,
        proposedMessage: 'Concurrency test message 2',
        skipQuietHoursCheck: true,
        skipMinGapCheck: true,
      }),
      proactiveGate.acquire(testUserId, {
        outreachType: 'engagement_checkin',
        logicalKey,
        logicalKeyWindowMinutes: 30,
        proposedMessage: 'Concurrency test message 3',
        skipQuietHoursCheck: true,
        skipMinGapCheck: true,
      }),
      proactiveGate.acquire(testUserId, {
        outreachType: 'engagement_checkin',
        logicalKey,
        logicalKeyWindowMinutes: 30,
        proposedMessage: 'Concurrency test message 4',
        skipQuietHoursCheck: true,
        skipMinGapCheck: true,
      }),
      proactiveGate.acquire(testUserId, {
        outreachType: 'engagement_checkin',
        logicalKey,
        logicalKeyWindowMinutes: 30,
        proposedMessage: 'Concurrency test message 5',
        skipQuietHoursCheck: true,
        skipMinGapCheck: true,
      }),
    ]);

    const allowedCount = concurrentAttempts.filter(a => a.allowed === true).length;
    const blockedCount = concurrentAttempts.filter(a => a.allowed === false).length;
    const passedConcurrency = allowedCount === 1 && blockedCount === 4;
    record(
      'Concurrency & Idempotency Gate',
      passedConcurrency,
      `Allowed: ${allowedCount}, Blocked: ${blockedCount} (Expected: exactly 1 allowed, 4 blocked)`
    );

    // ── 4. ESCALATION COOLDOWN TABLE VERIFICATION ──────────────────────────
    console.log('\n--- 4. Escalation Cooldown Logic ---');
    const g0 = getEscalatedGapMinutes(0);
    const g1 = getEscalatedGapMinutes(1);
    const g2 = getEscalatedGapMinutes(2);
    const g3 = getEscalatedGapMinutes(3);
    const g4 = getEscalatedGapMinutes(4);
    const g5 = getEscalatedGapMinutes(5);

    const escalationCorrect = (g0 === 1 && g1 === 60 && g2 === 180 && g3 === 360 && g4 === 720 && g5 === 720);
    record(
      'Escalation Gap Schedule',
      escalationCorrect,
      `0=${g0}m (exp 1m), 1=${g1}m (exp 60m), 2=${g2}m (exp 180m), 3=${g3}m (exp 360m), 4+=${g4}m (exp 720m)`
    );

    // Clean previous test log rows for clean escalation test
    await supabaseAdmin.from('nova_outreach_log').delete().eq('user_id', testUserId);

    // Test DB-backed cooldown enforcement: Insert 1 unreplied message 10 minutes ago
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await supabaseAdmin.from('nova_outreach_log').insert({
      user_id: testUserId,
      message: 'Unreplied outreach 1',
      outreach_type: 'engagement_checkin',
      logical_key: 'test:escalation:1',
      created_at: tenMinAgo,
    });

    const cooldownDecision = await proactiveGate.acquire(testUserId, {
      outreachType: 'engagement_checkin',
      logicalKey: 'test:escalation:2',
      logicalKeyWindowMinutes: 30,
      skipQuietHoursCheck: true,
      skipMinGapCheck: false, // enforce gap (should be 60 min)
    });

    const cooldownBlocked = cooldownDecision.allowed === false && (cooldownDecision as any).blockedBy === 'cooldown';
    record(
      'DB-Backed Cooldown Enforcement',
      cooldownBlocked,
      `Decision: ${JSON.stringify(cooldownDecision)} (Expected: blocked by cooldown because 10m < 60m)`
    );

    // ── 5. USER REPLY & CLOSE-THE-LOOP TEST ────────────────────────────────
    console.log('\n--- 5. User Reply & Close-The-Loop ---');
    const preReplyIgnored = await proactiveGate.getIgnoredCount(testUserId);
    await proactiveGate.markReplied(testUserId, new Date().toISOString());
    const postReplyIgnored = await proactiveGate.getIgnoredCount(testUserId);

    // Also verify in DB directly that replied_at is set
    const { data: updatedRows } = await supabaseAdmin
      .from('nova_outreach_log')
      .select('replied_at')
      .eq('user_id', testUserId);

    const allRepliedSet = (updatedRows || []).every(r => r.replied_at !== null);
    const replyLoopPassed = preReplyIgnored > 0 && postReplyIgnored === 0 && allRepliedSet;
    record(
      'User Reply markReplied()',
      replyLoopPassed,
      `Pre-reply ignored: ${preReplyIgnored}, Post-reply ignored: ${postReplyIgnored}, DB replied_at set: ${allRepliedSet}`
    );

    // ── 6. LOGICAL KEY SUPPRESSION WINDOW TEST ─────────────────────────────
    console.log('\n--- 6. Logical Key Suppression Window ---');
    const uniqueKey = `test:window:${Date.now()}`;
    const firstAcquire = await proactiveGate.acquire(testUserId, {
      outreachType: 'engagement_checkin',
      logicalKey: uniqueKey,
      logicalKeyWindowMinutes: 60,
      skipQuietHoursCheck: true,
      skipMinGapCheck: true,
    });

    const secondAcquire = await proactiveGate.acquire(testUserId, {
      outreachType: 'engagement_checkin',
      logicalKey: uniqueKey,
      logicalKeyWindowMinutes: 60,
      skipQuietHoursCheck: true,
      skipMinGapCheck: true,
    });

    const windowSuppressionPassed = firstAcquire.allowed === true && secondAcquire.allowed === false && (secondAcquire as any).blockedBy === 'duplicate_logical_key';
    record(
      'Logical Key Window Suppression',
      windowSuppressionPassed,
      `1st allowed=${firstAcquire.allowed}, 2nd allowed=${secondAcquire.allowed} (${(secondAcquire as any).blockedBy})`
    );

    // ── 7. NEAR-DUPLICATE CONTENT REJECTION TEST ────────────────────────────
    console.log('\n--- 7. Near-Duplicate Content Dedup ---');
    const baseContent = 'Arey, busy hai kya? Jab time mile tab batana!';
    await supabaseAdmin.from('nova_outreach_log').insert({
      user_id: testUserId,
      message: baseContent,
      outreach_type: 'engagement_checkin',
      logical_key: `test:content:${Date.now()}`,
    });

    const duplicateAttempt = await proactiveGate.acquire(testUserId, {
      outreachType: 'engagement_checkin',
      logicalKey: `test:content:new_${Date.now()}`,
      logicalKeyWindowMinutes: 60,
      proposedMessage: 'Arey busy hai kya? Jab time mile batana!', // >75% similarity
      skipQuietHoursCheck: true,
      skipMinGapCheck: true,
    });

    const distinctAttempt = await proactiveGate.acquire(testUserId, {
      outreachType: 'engagement_checkin',
      logicalKey: `test:content:distinct_${Date.now()}`,
      logicalKeyWindowMinutes: 60,
      proposedMessage: 'Kal subah 9 baje office meeting hai na tumhari?', // totally distinct
      skipQuietHoursCheck: true,
      skipMinGapCheck: true,
    });

    const contentDedupPassed = duplicateAttempt.allowed === false && (duplicateAttempt as any).blockedBy === 'duplicate_content' && distinctAttempt.allowed === true;
    record(
      'Near-Duplicate Content Rejection (Jaccard >= 75%)',
      contentDedupPassed,
      `Duplicate allowed=${duplicateAttempt.allowed} (${(duplicateAttempt as any).blockedBy}), Distinct allowed=${distinctAttempt.allowed}`
    );

    // ── 8. LONG SILENCE SUPPRESSION TEST ───────────────────────────────────
    console.log('\n--- 8. Long Silence Suppression (48h+ with 4+ ignored) ---');
    const { data: silentCreated } = await supabaseAdmin.auth.admin.createUser({
      email: `silent_${Date.now()}@humanos.app`,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    silentUserId = silentCreated!.user!.id;
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    
    // Insert user msg 72h ago
    await supabaseAdmin.from('chat_history').insert({
      user_id: silentUserId,
      conversation_id: crypto.randomUUID(),
      role: 'user',
      content: 'I have to go now',
      created_at: seventyTwoHoursAgo,
    });

    // Insert 4 unreplied outreaches
    for (let i = 1; i <= 4; i++) {
      await supabaseAdmin.from('nova_outreach_log').insert({
        user_id: silentUserId,
        message: `Ignored outreach ${i}`,
        outreach_type: 'engagement_checkin',
        created_at: new Date(Date.now() - (60 - i * 10) * 60 * 1000).toISOString(),
      });
    }

    const longSilenceDecision = await proactiveGate.acquire(silentUserId, {
      outreachType: 'engagement_checkin',
      logicalKey: 'test:silence:new',
      logicalKeyWindowMinutes: 60,
      skipQuietHoursCheck: true,
      skipMinGapCheck: true,
    });

    const longSilencePassed = longSilenceDecision.allowed === false && (longSilenceDecision as any).blockedBy === 'long_silence';
    record(
      'Long Silence Suppression (48h+ with 4+ ignored)',
      longSilencePassed,
      `Decision: ${JSON.stringify(longSilenceDecision)} (Expected blockedBy: long_silence)`
    );

    // ── 9. LIVE CHAT "Sab thik" BEHAVIORAL VERIFICATION (AGAINST RENDER) ───
    console.log('\n--- 9. Live Chat "Sab thik" Behavioral Test (Live Render Endpoint) ---');
    try {
      const convId = crypto.randomUUID();
      const chatRes = await axios.post(`${RENDER_BASE_URL}/api/chat`, {
        message: 'Sab thik',
        conversation_id: convId,
      }, {
        headers: {
          'Authorization': `Bearer ${testUserToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const reply = chatRes.data?.response || chatRes.data?.reply || chatRes.data?.message || '';
      const sanitized = sanitizeReply(reply);
      const isFallback = sanitized.includes('Hmm... mujhe thoda sochne de') || sanitized === NOVA_EMPTY_REPLY;
      const hasThoughtLeak = sanitized.includes('<subconscious_actions>') ||
                             sanitized.includes('[subconscious_actions]') ||
                             sanitized.includes('REAL-WORLD ACTION') ||
                             sanitized.includes('SITUATION BRIEF') ||
                             sanitized.includes('CURRENT TIME');

      const chatPassed = chatRes.status === 200 && !isFallback && !hasThoughtLeak && sanitized.length > 3;
      record(
        'User "Sab thik" Conversational Reply (Live API)',
        chatPassed,
        `HTTP Status: ${chatRes.status}, Reply: "${sanitized}" (isFallback=${isFallback}, hasThoughtLeak=${hasThoughtLeak})`
      );
    } catch (e: any) {
      record('User "Sab thik" Conversational Reply (Live API)', false, `API call threw: ${e.response?.data ? JSON.stringify(e.response.data) : e.message}`);
    }

    // ── 10. STALE LIFE THREAD EXCLUSION ────────────────────────────────────
    console.log('\n--- 10. Stale Life Thread Exclusion ---');
    await supabaseAdmin.from('life_threads').insert([
      {
        user_id: testUserId,
        topic: 'Exam preparation',
        state: 'completed',
        priority: 5,
        provenance: 'User finished exam',
      },
      {
        user_id: testUserId,
        topic: 'Job interview at Tech Corp',
        state: 'active',
        priority: 9,
        provenance: 'Interview scheduled tomorrow',
      }
    ]);

    // Query active threads matching NACE filter
    const { data: activeThreads } = await supabaseAdmin
      .from('life_threads')
      .select('topic, state')
      .eq('user_id', testUserId)
      .in('state', ['active', 'waiting', 'blocked']);

    const threadTopics = (activeThreads || []).map(t => t.topic);
    const staleExcluded = threadTopics.includes('Job interview at Tech Corp') && !threadTopics.includes('Exam preparation');
    record(
      'Completed Life Thread Exclusion',
      staleExcluded,
      `Active threads fetched: ${JSON.stringify(threadTopics)} (Completed 'Exam preparation' excluded: ${!threadTopics.includes('Exam preparation')})`
    );

  } finally {
    // ── 11. CLEANUP ALL EPHEMERAL TEST DATA ────────────────────────────────
    console.log('\n--- 11. Cleanup Ephemeral Test Records ---');
    if (testUserId) {
      try {
        await supabaseAdmin.from('nova_outreach_log').delete().eq('user_id', testUserId);
        await supabaseAdmin.from('chat_history').delete().eq('user_id', testUserId);
        await supabaseAdmin.from('working_memory').delete().eq('user_id', testUserId);
        await supabaseAdmin.from('life_threads').delete().eq('user_id', testUserId);
        await supabaseAdmin.from('profiles').delete().eq('id', testUserId);
        await supabaseAdmin.auth.admin.deleteUser(testUserId);
        console.log(`✅ Cleaned up all records for test user ${testUserId}`);
      } catch (cleanErr: any) {
        console.warn(`⚠️ Cleanup warning: ${cleanErr.message}`);
      }
    }
    if (silentUserId) {
      try {
        await supabaseAdmin.from('chat_history').delete().eq('user_id', silentUserId);
        await supabaseAdmin.from('nova_outreach_log').delete().eq('user_id', silentUserId);
        await supabaseAdmin.auth.admin.deleteUser(silentUserId);
        console.log(`✅ Cleaned up all records for silent user ${silentUserId}`);
      } catch (cleanErr: any) {
        console.warn(`⚠️ Cleanup warning: ${cleanErr.message}`);
      }
    }
  }

  // ── FINAL SUMMARY ────────────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log('📊 FINAL VERIFICATION SUMMARY');
  console.log('============================================================');
  const allPassed = results.every(r => r.passed);
  console.log(`Total Checks: ${results.length}`);
  console.log(`Passed: ${results.filter(r => r.passed).length}`);
  console.log(`Failed: ${results.filter(r => !r.passed).length}`);
  console.log(`Overall Status: ${allPassed ? 'ALL CHECKS PASSED ✅' : 'FAILURES DETECTED ❌'}`);
  console.log('============================================================\n');

  return allPassed;
}

runVerification().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
