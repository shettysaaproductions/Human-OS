import { LifeThreadAgent } from './src/agents/LifeThreadAgent';
import { actionIntelligenceService } from './src/services/ActionIntelligenceService';
import { supabaseAdmin } from './src/lib/supabase';
import { v4 as uuidv4 } from 'uuid';

async function runTest() {
  const agent = new LifeThreadAgent();
  const userId = uuidv4();
  
  console.log('--- ACTION INTELLIGENCE SMOKE TEST ---');
  console.log(`Test User ID: ${userId}`);
  
  await supabaseAdmin.from('profiles').insert({ id: userId, email: userId + '@test.com', display_name: 'Test Actions' });
  
  try {
    // Scenario A: Launch Cloud Kitchen
    console.log('\n--- SCENARIO A: Extract Goals and Actions ---');
    await insertChat(userId, 'I need to launch my cloud kitchen next month. I still need to finalize the location, pricing and GST.', 'Understood! I will keep track of your cloud kitchen launch.');
    await agent.processJob({ payload: { user_id: userId, turn_context: { userMessage: 'test', novaReply: 'test' } } });
    
    let { data: actionsA } = await supabaseAdmin.from('nova_actions').select('title, logical_key, state, execution_class').eq('user_id', userId);
    let { data: threadsA } = await supabaseAdmin.from('life_threads').select('topic, state').eq('user_id', userId);
    console.log('Threads:', threadsA);
    console.log('Actions:', actionsA);
    
    let nextA = await actionIntelligenceService.getNextBestAction(userId);
    console.log('Next Best Action:', nextA);

    // Scenario B: Finalized location
    console.log('\n--- SCENARIO B: Complete an action ---');
    await insertChat(userId, 'I finalized the location.', 'Great job finalizing the location.');
    await agent.processJob({ payload: { user_id: userId, turn_context: { userMessage: 'test', novaReply: 'test' } } });
    
    let { data: actionsB } = await supabaseAdmin.from('nova_actions').select('title, logical_key, state').eq('user_id', userId);
    console.log('Actions:', actionsB);
    
    let nextB = await actionIntelligenceService.getNextBestAction(userId);
    console.log('Next Best Action:', nextB);

    // Scenario C: Already handled GST
    console.log('\n--- SCENARIO C: Complete another action ---');
    await insertChat(userId, 'I already handled GST.', 'Awesome.');
    await agent.processJob({ payload: { user_id: userId, turn_context: { userMessage: 'test', novaReply: 'test' } } });
    
    let { data: actionsC } = await supabaseAdmin.from('nova_actions').select('title, logical_key, state').eq('user_id', userId);
    console.log('Actions:', actionsC);

    // Scenario D: Cancel pricing reminders
    console.log('\n--- SCENARIO D: Cancel an action ---');
    await insertChat(userId, 'I don\'t want reminders about pricing anymore.', 'No problem, I will cancel the pricing reminders.');
    await agent.processJob({ payload: { user_id: userId, turn_context: { userMessage: 'test', novaReply: 'test' } } });
    
    let { data: actionsD } = await supabaseAdmin.from('nova_actions').select('title, logical_key, state').eq('user_id', userId);
    console.log('Actions:', actionsD);

    // Scenario E: Send Rahul the pricing (CONFIRMATION_REQUIRED)
    console.log('\n--- SCENARIO E: External Action (Confirmation Required) ---');
    await insertChat(userId, 'I need you to send Rahul the finalized pricing.', 'Do you want me to send it now?');
    await agent.processJob({ payload: { user_id: userId, turn_context: { userMessage: 'test', novaReply: 'test' } } });
    
    let { data: actionsE } = await supabaseAdmin.from('nova_actions').select('id, title, logical_key, state, execution_class').eq('user_id', userId);
    console.log('Actions:', actionsE);
    
    const rahulAction = actionsE?.find(a => a.execution_class === 'CONFIRMATION_REQUIRED');
    
    // Scenario F: Confirm the send
    console.log('\n--- SCENARIO F: Confirm and Execute Action ---');
    if (rahulAction) {
      console.log('Executing confirmed action:', rahulAction.id);
      await actionIntelligenceService.executeConfirmedAction(rahulAction.id, userId);
      let { data: actionsF } = await supabaseAdmin.from('nova_actions').select('title, state').eq('id', rahulAction.id);
      console.log('Rahul Action post-execution:', actionsF);
    } else {
      console.log('Rahul action not found!');
    }

  } finally {
    console.log('\nCleaning up...');
    await supabaseAdmin.from('chat_history').delete().eq('user_id', userId);
    await supabaseAdmin.from('nova_actions').delete().eq('user_id', userId);
    await supabaseAdmin.from('life_threads').delete().eq('user_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
  }
}

async function insertChat(userId: string, userText: string, assistantText: string) {
  const ts1 = new Date().toISOString();
  const ts2 = new Date(Date.now() + 1000).toISOString();
  await supabaseAdmin.from('chat_history').insert([
    { id: uuidv4(), user_id: userId, role: 'user', content: userText, created_at: ts1 },
    { id: uuidv4(), user_id: userId, role: 'assistant', content: assistantText, created_at: ts2 }
  ]);
}

runTest().catch(console.error);
