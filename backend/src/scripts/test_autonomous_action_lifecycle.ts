import 'dotenv/config';
import { autonomousActionService } from '../services/AutonomousActionService';
import { novaVoiceService } from '../services/NovaVoiceService';
import { supabaseAdmin } from '../lib/supabase';

async function runAutonomousActionTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING AUTONOMOUS ACTION LIFECYCLE & VOICE TOOL SUITE');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  // ── TEST 1: High-Precision Intent Differentiation ─────────────────────────
  console.log('[Test 1] Testing Intent Differentiation (REMINDER vs CALLBACK)...');
  try {
    const testCases: { input: string; expectedType: string }[] = [
      { input: 'Remind me to call Rahul at 6', expectedType: 'REMINDER' },
      { input: 'yaad dilana Rahul ko call karna hai', expectedType: 'REMINDER' },
      { input: 'Remind me to take my vitamins', expectedType: 'REMINDER' },
      { input: 'Nova, call me at 6', expectedType: 'CALLBACK' },
      { input: 'Mujhe call karna sham ko 7 baje', expectedType: 'CALLBACK' },
      { input: 'Call me in 10 minutes', expectedType: 'CALLBACK' },
      { input: 'Phone karna mujhe 8 baje', expectedType: 'CALLBACK' },
      { input: 'Give me a call when you are free', expectedType: 'CALLBACK' },
    ];

    for (const tc of testCases) {
      const res = autonomousActionService.classifyActionIntent(tc.input);
      if (res.type !== tc.expectedType) {
        throw new Error(`Expected "${tc.input}" to be ${tc.expectedType}, got ${res.type} (${res.reason})`);
      }
      console.log(`  ✓ "${tc.input}" → ${res.type} (confidence: ${res.confidence})`);
    }

    console.log('✓ [Test 1 PASSED] Intent differentiation accurate for all phrases.');
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 1 FAILED] ${err.message}`);
    failed++;
  }

  // ── TEST 2: Standardized Voice Tool Structured Return Contract ────────────
  console.log('\n[Test 2] Testing Standardized Structured Return Contract for Voice Tools...');
  try {
    // Get a real or dummy user id
    const { data: user } = await supabaseAdmin.from('profiles').select('id').limit(1).maybeSingle();
    const testUserId = user?.id || '00000000-0000-0000-0000-000000000001';

    // 1. memory_tree_read
    const resRead = await novaVoiceService.executeTool(testUserId, 'memory_tree_read', {});
    if (typeof resRead.success !== 'boolean' || !resRead.user_message) {
      throw new Error(`memory_tree_read failed structured contract: ${JSON.stringify(resRead)}`);
    }
    console.log('  ✓ memory_tree_read returned structured contract:', resRead.user_message);

    // 2. memory_tree_search
    const resSearch = await novaVoiceService.executeTool(testUserId, 'memory_tree_search', { query: 'test' });
    if (typeof resSearch.success !== 'boolean' || !resSearch.user_message) {
      throw new Error(`memory_tree_search failed structured contract: ${JSON.stringify(resSearch)}`);
    }
    console.log('  ✓ memory_tree_search returned structured contract:', resSearch.user_message);

    // 3. memory_entity_read
    const resEntity = await novaVoiceService.executeTool(testUserId, 'memory_entity_read', { entity_name: 'NonExistentPerson' });
    if (typeof resEntity.success !== 'boolean' || !resEntity.user_message) {
      throw new Error(`memory_entity_read failed structured contract: ${JSON.stringify(resEntity)}`);
    }
    console.log('  ✓ memory_entity_read returned structured contract:', resEntity.user_message);

    // 4. save_memory
    const resSaveMem = await novaVoiceService.executeTool(testUserId, 'save_memory', { key: 'favorite_tea', value: 'Masala Chai' });
    if (typeof resSaveMem.success !== 'boolean' || !resSaveMem.user_message) {
      throw new Error(`save_memory failed structured contract: ${JSON.stringify(resSaveMem)}`);
    }
    console.log('  ✓ save_memory returned structured contract:', resSaveMem.user_message);

    // 5. schedule_reminder
    const resReminder = await novaVoiceService.executeTool(testUserId, 'schedule_reminder', { title: 'Drink water', time_phrase: 'in 3 hours' });
    if (typeof resReminder.success !== 'boolean' || !resReminder.user_message) {
      throw new Error(`schedule_reminder failed structured contract: ${JSON.stringify(resReminder)}`);
    }
    console.log('  ✓ schedule_reminder returned structured contract:', resReminder.user_message);

    // 6. recall_memory
    const resRecall = await novaVoiceService.executeTool(testUserId, 'recall_memory', { query: 'tea' });
    if (typeof resRecall.success !== 'boolean' || !resRecall.user_message) {
      throw new Error(`recall_memory failed structured contract: ${JSON.stringify(resRecall)}`);
    }
    console.log('  ✓ recall_memory returned structured contract:', resRecall.user_message);

    // 7. web_search
    const resSearchWeb = await novaVoiceService.executeTool(testUserId, 'web_search', { query: 'weather in Mumbai' });
    if (typeof resSearchWeb.success !== 'boolean' || !resSearchWeb.user_message) {
      throw new Error(`web_search failed structured contract: ${JSON.stringify(resSearchWeb)}`);
    }
    console.log('  ✓ web_search returned structured contract:', resSearchWeb.user_message);

    console.log('✓ [Test 2 PASSED] All tested voice tools honor { success, user_message, state, ... } contract.');
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 2 FAILED] ${err.message}`);
    failed++;
  }

  // ── TEST 3: Callback Lifecycle State Machine & Invalid Transition Guard ──
  console.log('\n[Test 3] Testing Callback Lifecycle Transitions & Guardrails...');
  try {
    const { data: user } = await supabaseAdmin.from('profiles').select('id').limit(1).maybeSingle();
    const testUserId = user?.id || '00000000-0000-0000-0000-000000000001';

    // Set up a mock action record in nova_actions for state machine verification
    const mockKey = `test_cb_${Date.now()}`;
    const { data: mockAction, error: mockErr } = await supabaseAdmin
      .from('nova_actions')
      .insert({
        user_id: testUserId,
        logical_key: mockKey,
        title: 'Test Callback for Lifecycle',
        description: 'Testing state transitions',
        state: 'scheduled',
        priority: 'high',
        execution_class: 'CONFIRMATION_REQUIRED',
        due_at: new Date(Date.now() + 3600000).toISOString(),
        provenance: JSON.stringify({ actionType: 'CALLBACK', lifecycleState: 'scheduled' }),
      })
      .select('id, state')
      .single();

    if (mockErr || !mockAction) {
      throw new Error(`Failed to insert test nova_action: ${mockErr?.message}`);
    }

    const actionId = mockAction.id;

    // Test invalid skip transition: scheduled -> ringing (should fail)
    const invalidStep = await autonomousActionService.transitionCallbackState(actionId, testUserId, 'ringing');
    if (invalidStep.success) {
      throw new Error('State machine allowed illegal skip from scheduled to ringing!');
    }
    console.log('  ✓ Illegal transition (scheduled → ringing) correctly rejected');

    // Test legal sequence: scheduled -> due -> dispatching -> ringing -> answered -> completed
    const step1 = await autonomousActionService.transitionCallbackState(actionId, testUserId, 'due');
    if (!step1.success || step1.currentState !== 'due') throw new Error(`Step 1 failed: ${step1.error}`);
    console.log('  ✓ Transition: scheduled → due');

    const step2 = await autonomousActionService.transitionCallbackState(actionId, testUserId, 'dispatching');
    if (!step2.success || step2.currentState !== 'dispatching') throw new Error(`Step 2 failed: ${step2.error}`);
    console.log('  ✓ Transition: due → dispatching');

    const step3 = await autonomousActionService.transitionCallbackState(actionId, testUserId, 'ringing');
    if (!step3.success || step3.currentState !== 'ringing') throw new Error(`Step 3 failed: ${step3.error}`);
    console.log('  ✓ Transition: dispatching → ringing');

    const step4 = await autonomousActionService.transitionCallbackState(actionId, testUserId, 'answered');
    if (!step4.success || step4.currentState !== 'answered') throw new Error(`Step 4 failed: ${step4.error}`);
    console.log('  ✓ Transition: ringing → answered');

    const step5 = await autonomousActionService.transitionCallbackState(actionId, testUserId, 'completed');
    if (!step5.success || step5.currentState !== 'completed') throw new Error(`Step 5 failed: ${step5.error}`);
    console.log('  ✓ Transition: answered → completed');

    // Cleanup mock row
    await supabaseAdmin.from('nova_actions').delete().eq('id', actionId);

    console.log('✓ [Test 3 PASSED] Callback lifecycle state machine verified.');
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 3 FAILED] ${err.message}`);
    failed++;
  }

  // ── TEST 4: Bounded Escalation on Missed Call ──────────────────────────────
  console.log('\n[Test 4] Testing Bounded Escalation on Missed Callback...');
  try {
    const { data: user } = await supabaseAdmin.from('profiles').select('id').limit(1).maybeSingle();
    const testUserId = user?.id || '00000000-0000-0000-0000-000000000001';

    const mockKey = `test_miss_${Date.now()}`;
    const { data: mockAction } = await supabaseAdmin
      .from('nova_actions')
      .insert({
        user_id: testUserId,
        logical_key: mockKey,
        title: 'Missed Call Escalation Test',
        state: 'ringing',
        retry_count: 0,
        due_at: new Date().toISOString(),
        provenance: JSON.stringify({ actionType: 'CALLBACK', lifecycleState: 'ringing' }),
      })
      .select('id')
      .single();

    if (!mockAction) throw new Error('Failed to create mock action for missed call test');

    // Attempt 1: Missed -> should re-schedule with backoff
    const miss1 = await autonomousActionService.handleCallbackMissed(mockAction.id, testUserId);
    if (!miss1.retryScheduled || miss1.nextState !== 'scheduled') {
      throw new Error(`Attempt 1 did not reschedule: ${JSON.stringify(miss1)}`);
    }
    console.log(`  ✓ Attempt 1 missed: Rescheduled with backoff (${miss1.delayMinutes}m delay)`);

    // Attempt 2: Missed again -> should reach max attempts and complete/fallback
    const miss2 = await autonomousActionService.handleCallbackMissed(mockAction.id, testUserId);
    if (miss2.retryScheduled || miss2.nextState !== 'completed') {
      throw new Error(`Attempt 2 did not complete/fallback: ${JSON.stringify(miss2)}`);
    }
    console.log('  ✓ Attempt 2 missed: Max attempts reached, downgraded to fallback text message');

    // Cleanup mock row
    await supabaseAdmin.from('nova_actions').delete().eq('id', mockAction.id);

    console.log('✓ [Test 4 PASSED] Bounded escalation correctly terminates and falls back.');
    passed++;
  } catch (err: any) {
    console.error(`✗ [Test 4 FAILED] ${err.message}`);
    failed++;
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n===============================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAutonomousActionTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
