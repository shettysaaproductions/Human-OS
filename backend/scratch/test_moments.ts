import { supabaseAdmin } from '../src/lib/supabase';
import { onboardingService } from '../src/services/onboardingService';
import { momentEngineService, MomentType } from '../src/services/MomentEngineService';
import crypto from 'crypto';

async function runTests() {
  const userId = crypto.randomUUID();
  console.log('--- STARTING MOMENT ENGINE MVP E2E TESTS ---');
  console.log(`Simulated User ID: ${userId}`);

  try {
    // 1. Onboard user to seed goals and create profile
    console.log('\nStep 1: Onboarding user to seed profile and goals...');
    await onboardingService.processOnboarding(userId, {
      preferred_name: 'Alex',
      passions: 'Running, Cooking',
      goals: 'I want to run a marathon by September 2026',
      family: 'Daughter Emily age 3, wife Sarah',
      important_facts: 'Loves dark chocolate',
      companion_personality: 'supportive',
      timezone: 'UTC' // lock timezone for quiet hours testing
    });
    console.log('[PASS] Onboarding seeded successfully.');

    // 2. Test shouldNotify initial state
    console.log('\nStep 2: Testing shouldNotify initial state...');
    let canNotify = await momentEngineService.shouldNotify(userId);
    console.log(`Initial shouldNotify check: ${canNotify}`);
    if (!canNotify) {
      // It might be quiet hours depending on when this runs.
      // Let's force preferences to ensure we can notify
      await momentEngineService.updatePreferences(userId, {
        quiet_hours: '04:00-05:00' // Make quiet hours very narrow and away from now
      });
      // Try again
      canNotify = await momentEngineService.shouldNotify(userId);
      console.log(`After forcing quiet hours, shouldNotify: ${canNotify}`);
    }
    if (!canNotify) throw new Error('shouldNotify failed to return true under ideal conditions');
    console.log('[PASS] shouldNotify check passed.');

    // 3. Test checkGoalFollowups
    console.log('\nStep 3: Checking goal follow-ups generation...');
    const goalMoment = await momentEngineService.checkGoalFollowups(userId);
    if (!goalMoment) {
      throw new Error('Expected goal follow-up moment to be generated, but got null');
    }
    console.log('Generated Goal Moment Payload:');
    console.log(JSON.stringify(goalMoment, null, 2));
    if (!goalMoment.body.toLowerCase().includes('marathon') && !goalMoment.body.toLowerCase().includes('run')) {
      throw new Error('Safety check failed: Generated moment does not seem grounded in the user goal memory');
    }
    console.log('[PASS] Goal follow-up moment generated and validated.');

    // 4. Test User Preferences Disable category
    console.log('\nStep 4: Disabling goal follow-ups preference...');
    await momentEngineService.updatePreferences(userId, {
      goal_followups_enabled: false
    });
    const disabledGoalMoment = await momentEngineService.checkGoalFollowups(userId);
    if (disabledGoalMoment !== null) {
      throw new Error('Expected goal follow-up to return null when goal_followups_enabled is false');
    }
    console.log('[PASS] Preference settings correctly respected (returned null when disabled).');

    // Restore goal follow-up preference
    await momentEngineService.updatePreferences(userId, {
      goal_followups_enabled: true
    });

    // 5. Test Child Milestones Check-in
    console.log('\nStep 5: Testing child milestone checks...');
    // Seed child KG relationships
    console.log('Seeding child nodes in Knowledge Graph...');
    const { data: userNode } = await supabaseAdmin
      .from('kg_nodes')
      .insert({ user_id: userId, name: 'Alex (User)', entity_type: 'person', attributes: {} })
      .select('id').single();

    const { data: childNode } = await supabaseAdmin
      .from('kg_nodes')
      .insert({ user_id: userId, name: 'Emily', entity_type: 'person', attributes: { age: 3, relation: 'daughter' } })
      .select('id').single();

    if (userNode && childNode) {
      await supabaseAdmin.from('kg_edges').insert({
        user_id: userId,
        source_node_id: userNode.id,
        target_node_id: childNode.id,
        relation_type: 'PARENT_OF',
        weight: 10
      });
      console.log('Seeded child node and edge successfully.');
    }

    const childMoment = await momentEngineService.checkChildMilestones(userId);
    if (!childMoment) {
      throw new Error('Expected child milestone moment to be generated, but got null');
    }
    console.log('Generated Child Milestone Moment Payload:');
    console.log(JSON.stringify(childMoment, null, 2));
    if (!childMoment.body.toLowerCase().includes('emily')) {
      throw new Error('Safety check failed: Generated moment does not seem grounded in child KG memories');
    }
    console.log('[PASS] Child milestone moment generated and validated.');

    // 6. Test Daily Frequency Limits (1 per day)
    console.log('\nStep 6: Testing daily rate limiting (max 1 notification/day)...');
    // Save the goal moment to db
    const savedMoment = await momentEngineService.saveMoment(goalMoment);
    console.log(`Saved goal moment to database with ID: ${savedMoment.id}`);

    // Check shouldNotify again. It should be false since one was generated today
    const canNotifyAgain = await momentEngineService.shouldNotify(userId);
    console.log(`shouldNotify check after saving moment: ${canNotifyAgain}`);
    if (canNotifyAgain === true) {
      throw new Error('Daily rate limiting failed: shouldNotify returned true despite moment sent today');
    }
    console.log('[PASS] Daily frequency cap correctly enforced.');

    // 7. Test Telemetry Tracking
    console.log('\nStep 7: Testing telemetry tracking...');
    // Currently we have 1 generated moment
    let metrics = await momentEngineService.getTelemetryMetrics();
    console.log('Initial metrics count:', metrics);

    // Track "opened"
    console.log('Simulating user opening the moment...');
    await momentEngineService.trackMomentStatus(savedMoment.id, 'opened');

    // Save a second temporary moment for dismissal testing
    const secondMoment = await momentEngineService.saveMoment({
      user_id: userId,
      moment_type: MomentType.CHILD_MILESTONE,
      title: 'Dismiss Test',
      body: 'Testing dismissal'
    });
    console.log('Simulating user dismissing another moment...');
    await momentEngineService.trackMomentStatus(secondMoment.id, 'dismissed');

    metrics = await momentEngineService.getTelemetryMetrics();
    console.log('Updated metrics count:', metrics);
    
    // We should see that we have generated/opened/dismissed metrics logged
    if (metrics.moments_generated < 2) {
      throw new Error(`Expected at least 2 moments generated in telemetry, got ${metrics.moments_generated}`);
    }
    if (metrics.moments_opened < 1) {
      throw new Error(`Expected at least 1 opened moment in telemetry, got ${metrics.moments_opened}`);
    }
    if (metrics.moments_dismissed < 1) {
      throw new Error(`Expected at least 1 dismissed moment in telemetry, got ${metrics.moments_dismissed}`);
    }
    console.log('[PASS] Telemetry counts correctly updated and verified.');

    // 8. Clean up test data
    console.log('\nStep 8: Cleaning up test data from DB...');
    await supabaseAdmin.from('user_moments').delete().eq('user_id', userId);
    await supabaseAdmin.from('user_moment_preferences').delete().eq('user_id', userId);
    await supabaseAdmin.from('kg_edges').delete().eq('user_id', userId);
    await supabaseAdmin.from('kg_nodes').delete().eq('user_id', userId);
    await supabaseAdmin.from('memories').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
    console.log('[PASS] Test database cleaned successfully.');

    console.log('\n*** ALL MOMENT ENGINE MVP TESTS PASSED SUCCESSFULLY! ***');
  } catch (err: any) {
    console.error('\n[FAIL] Test suite failed with error:', err.message);
    console.error(err.stack);
    
    // Attempt cleanup
    try {
      await supabaseAdmin.from('user_moments').delete().eq('user_id', userId);
      await supabaseAdmin.from('user_moment_preferences').delete().eq('user_id', userId);
      await supabaseAdmin.from('kg_edges').delete().eq('user_id', userId);
      await supabaseAdmin.from('kg_nodes').delete().eq('user_id', userId);
      await supabaseAdmin.from('memories').delete().eq('user_id', userId);
      await supabaseAdmin.from('profiles').delete().eq('id', userId);
    } catch (_) {}
    
    process.exit(1);
  }
}

runTests().then(() => process.exit(0));
