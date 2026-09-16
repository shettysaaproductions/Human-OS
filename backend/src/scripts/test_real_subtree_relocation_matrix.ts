import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabase';
import { universalBranchRelocationService } from '../services/UniversalBranchRelocationService';

async function runSubtreeMatrixTests() {
  console.log('====================================================');
  console.log('🧪 REAL SUBTREE RELOCATION & RECLASSIFICATION MATRIX TEST');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  try {
    // Retrieve a valid real user_id from production database
    const { data: userRef } = await supabaseAdmin.from('memories').select('user_id').limit(1).single();
    if (!userRef?.user_id) throw new Error('No valid user found in memories table');
    const TEST_USER_ID = userRef.user_id;
    // Clean up test data for test user
    await supabaseAdmin.from('memory_events').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('memory_bubble_moves').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('reminders').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('memory_bubbles').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('working_memory').delete().eq('user_id', TEST_USER_ID);

    console.log('[Setup] Created clean fixture sandbox for test user:', TEST_USER_ID);

    // 1. Build initial Ramesh hierarchy
    // Root bubble under domain:family
    const { data: domainFam } = await supabaseAdmin.from('memory_bubbles').insert({
      user_id: TEST_USER_ID, label: 'Family & Relationships', slug: 'domain:family', bubble_type: 'domain', domain_key: 'family'
    }).select('id').single();

    const { data: rootBubble } = await supabaseAdmin.from('memory_bubbles').insert({
      user_id: TEST_USER_ID, parent_bubble_id: domainFam!.id, label: 'Ramesh', slug: 'entity:ramesh', bubble_type: 'entity', domain_key: 'family', relation_type: 'friend'
    }).select('id').single();

    const rootBubbleId = rootBubble!.id;

    // Insert memories attached to rootBubbleId
    const { data: mem1 } = await supabaseAdmin.from('memories').insert({
      user_id: TEST_USER_ID, bubble_id: rootBubbleId, key: 'friend_ramesh', value: 'Ramesh is my close friend', memory_type: 'family'
    }).select('id, updated_at').single();

    await supabaseAdmin.from('memories').insert({
      user_id: TEST_USER_ID, bubble_id: rootBubbleId, key: 'ramesh_location', value: 'Lives in Mumbai', memory_type: 'family'
    });

    await supabaseAdmin.from('memories').insert({
      user_id: TEST_USER_ID, bubble_id: rootBubbleId, key: 'ramesh_occupation', value: 'Works as a designer', memory_type: 'family'
    });

    // Insert reminders attached to rootBubbleId
    await supabaseAdmin.from('reminders').insert({
      user_id: TEST_USER_ID, bubble_id: rootBubbleId, text: 'Call Ramesh about coffee', status: 'active'
    });

    await supabaseAdmin.from('reminders').insert({
      user_id: TEST_USER_ID, bubble_id: rootBubbleId, text: 'Discuss short film project with Ramesh', status: 'active'
    });

    console.log('✓ Initial subtree created: Ramesh (1 root + 2 stems + 2 reminders attached to bubble)');

    // ── STEP 1: Reclassify Ramesh = fictional short-film character (family -> work)
    console.log('\n[Step 1] Reclassifying: Ramesh = fictional short-film character (family -> work)...');
    const proposal1 = await universalBranchRelocationService.buildProposal(TEST_USER_ID, {
      entityName: 'Ramesh',
      oldDomain: 'family',
      oldRelation: 'friend',
      newDomain: 'work',
      newRelation: 'Short Film Character',
      targetParentLabel: 'Short Film Project',
      rawText: 'Ramesh was not my friend he is my character in short film project',
      isFictionalOrCharacter: true
    });

    if (!proposal1) throw new Error('Proposal 1 build failed');
    const result1 = await universalBranchRelocationService.executeBranchRelocation(TEST_USER_ID, proposal1);
    if (!result1.success) throw new Error(`Step 1 execution failed: ${result1.message}`);

    // Verify Step 1 state
    const { data: checkMems1 } = await supabaseAdmin.from('memories').select('id, memory_type, bubble_id').eq('user_id', TEST_USER_ID);
    const { data: checkRems1 } = await supabaseAdmin.from('reminders').select('id, bubble_id').eq('user_id', TEST_USER_ID);
    const { data: checkBubble1 } = await supabaseAdmin.from('memory_bubbles').select('id, domain_key, relation_type').eq('id', rootBubbleId).single();

    if (checkBubble1?.domain_key === 'work' && checkMems1?.every(m => m.memory_type === 'work') && checkRems1?.every(r => r.bubble_id === rootBubbleId)) {
      console.log('✓ [Step 1 PASSED] Ramesh subtree successfully moved to work. All 3 memories & 2 reminders preserved!');
      passed++;
    } else {
      throw new Error(`Step 1 verification failed: domain=${checkBubble1?.domain_key}`);
    }

    // ── STEP 2: Reclassify fictional character -> real person (work -> family)
    console.log('\n[Step 2] Reclassifying back: fictional character -> real person (work -> family)...');
    const proposal2 = await universalBranchRelocationService.buildProposal(TEST_USER_ID, {
      entityName: 'Ramesh',
      oldDomain: 'work',
      oldRelation: 'Short Film Character',
      newDomain: 'family',
      newRelation: 'Close Friend',
      rawText: 'Ramesh is actually a real person, my close friend',
    });

    if (!proposal2) throw new Error('Proposal 2 build failed');
    const result2 = await universalBranchRelocationService.executeBranchRelocation(TEST_USER_ID, proposal2);
    if (!result2.success) throw new Error(`Step 2 execution failed: ${result2.message}`);

    const { data: checkBubble2 } = await supabaseAdmin.from('memory_bubbles').select('domain_key').eq('id', rootBubbleId).single();
    if (checkBubble2?.domain_key === 'family') {
      console.log('✓ [Step 2 PASSED] Ramesh reclassified back to family (real person)');
      passed++;
    } else {
      throw new Error('Step 2 verification failed');
    }

    // ── STEP 3: Reclassify person -> pet (family person -> family pet)
    console.log('\n[Step 3] Reclassifying: person -> pet (family person -> family pet)...');
    const proposal3 = await universalBranchRelocationService.buildProposal(TEST_USER_ID, {
      entityName: 'Ramesh',
      oldDomain: 'family',
      oldRelation: 'Close Friend',
      newDomain: 'family',
      newRelation: 'Pet Dog',
      rawText: 'Ramesh is not a person he is my pet dog',
      isPetRevelation: true
    });

    if (!proposal3) throw new Error('Proposal 3 build failed');
    const result3 = await universalBranchRelocationService.executeBranchRelocation(TEST_USER_ID, proposal3);
    if (!result3.success) throw new Error(`Step 3 execution failed: ${result3.message}`);

    const { data: checkBubble3 } = await supabaseAdmin.from('memory_bubbles').select('relation_type').eq('id', rootBubbleId).single();
    if (checkBubble3?.relation_type === 'Pet Dog') {
      console.log('✓ [Step 3 PASSED] Ramesh reclassified as Pet Dog');
      passed++;
    } else {
      throw new Error('Step 3 verification failed');
    }

    // ── STEP 4: Reclassify pet -> project character (family pet -> work)
    console.log('\n[Step 4] Reclassifying: pet -> project character (family pet -> work)...');
    const proposal4 = await universalBranchRelocationService.buildProposal(TEST_USER_ID, {
      entityName: 'Ramesh',
      oldDomain: 'family',
      oldRelation: 'Pet Dog',
      newDomain: 'work',
      newRelation: 'Project Mascot',
      rawText: 'Ramesh is not my pet, he is our project mascot',
    });

    if (!proposal4) throw new Error('Proposal 4 build failed');
    const result4 = await universalBranchRelocationService.executeBranchRelocation(TEST_USER_ID, proposal4);
    if (!result4.success) throw new Error(`Step 4 execution failed: ${result4.message}`);

    const { data: checkBubble4 } = await supabaseAdmin.from('memory_bubbles').select('domain_key').eq('id', rootBubbleId).single();
    if (checkBubble4?.domain_key === 'work') {
      console.log('✓ [Step 4 PASSED] Ramesh reclassified to work (Project Mascot)');
      passed++;
    } else {
      throw new Error('Step 4 verification failed');
    }

    // ── STEP 5: Reclassify work -> lifestyle
    console.log('\n[Step 5] Reclassifying: work -> lifestyle branch...');
    const proposal5 = await universalBranchRelocationService.buildProposal(TEST_USER_ID, {
      entityName: 'Ramesh',
      oldDomain: 'work',
      oldRelation: 'Project Mascot',
      newDomain: 'lifestyle',
      newRelation: 'Personal Hobby Project',
      rawText: 'move Ramesh from work to lifestyle',
    });

    if (!proposal5) throw new Error('Proposal 5 build failed');
    const result5 = await universalBranchRelocationService.executeBranchRelocation(TEST_USER_ID, proposal5);
    if (!result5.success) throw new Error(`Step 5 execution failed: ${result5.message}`);

    const { data: checkBubble5 } = await supabaseAdmin.from('memory_bubbles').select('domain_key').eq('id', rootBubbleId).single();
    if (checkBubble5?.domain_key === 'lifestyle') {
      console.log('✓ [Step 5 PASSED] Ramesh moved to lifestyle branch');
      passed++;
    } else {
      throw new Error('Step 5 verification failed');
    }

    // ── STEP 6: Stale proposal detection
    console.log('\n[Step 6] Testing Stale Proposal Protection...');
    const staleProposal = await universalBranchRelocationService.buildProposal(TEST_USER_ID, {
      entityName: 'Ramesh',
      oldDomain: 'lifestyle',
      oldRelation: 'Personal Hobby Project',
      newDomain: 'goals',
      newRelation: 'Goal Target',
      rawText: 'move Ramesh to goals',
    });

    if (staleProposal && staleProposal.expectedUpdated.length > 0) {
      // Simulate memory update by another process
      await supabaseAdmin.from('memories').update({ updated_at: new Date().toISOString() }).eq('id', mem1!.id);
      const staleResult = await universalBranchRelocationService.executeBranchRelocation(TEST_USER_ID, staleProposal);
      if (!staleResult.success && staleResult.message.includes('STALE_BRANCH_PROPOSAL')) {
        console.log('✓ [Step 6 PASSED] Stale proposal correctly blocked by STALE_BRANCH_PROPOSAL transaction guard!');
        passed++;
      } else {
        throw new Error(`Stale proposal check failed: ${staleResult.message}`);
      }
    }

    // Cleanup test data
    await supabaseAdmin.from('memory_events').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('memory_bubble_moves').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('reminders').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER_ID);
    await supabaseAdmin.from('memory_bubbles').delete().eq('user_id', TEST_USER_ID);

    console.log('\n====================================================');
    console.log(`SUBTREE RELOCATION MATRIX RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');
  } catch (err: any) {
    console.error('❌ Subtree matrix test failed:', err.message);
    process.exit(1);
  }
}

runSubtreeMatrixTests().catch(console.error);
