import { memoryRepository } from '../services/memoryRepository';
import { supabaseAdmin } from '../lib/supabase';
import { randomUUID } from 'crypto';

jest.setTimeout(15000);

describe('Memory Persistence & Concurrency Integration', () => {
  const TEST_USER = '00000000-0000-0000-0000-000000000123';
  
  beforeAll(async () => {
    // Clear any previous test data
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER);
  });
  
  afterEach(async () => {
    // Clear test data after each test
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER);
  });

  afterAll(async () => {
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER);
  });

  it('red -> blue: should atomically supersede an existing memory', async () => {
    const source1 = randomUUID();
    const source2 = randomUUID();
    const { error: histErr } = await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite color is red' },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually my favorite color is blue' }
    ]);
    if (histErr) console.error('Chat history insert error:', histErr);
    // Insert initial memory (red)
    const initialMem = { key: 'favorite_color', value: 'red', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    try {
      await memoryRepository.upsertMemory(TEST_USER, initialMem, 'My favorite color is red');
    } catch(e) { console.error('Insert 1 error:', e); }
    
    // Supersede with (blue)
    const newMem = { key: 'favorite_color', value: 'blue', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
    try {
      await memoryRepository.upsertMemory(TEST_USER, newMem, 'Actually my favorite color is blue');
    } catch(e) { console.error('Insert 2 error:', e); }
    
    // Verify
    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favourite_color')
      .order('created_at', { ascending: true });
      
    if (error) console.error('Supabase error:', error);
    
    expect(rows).toBeDefined();
    expect(rows!.length).toBe(2);
    
    // The old one should be SUPERSEDED
    const redRow = rows!.find(r => r.value === 'red');
    expect(redRow?.is_archived).toBe(true);
    expect(redRow?.lifecycle_state).toBe('SUPERSEDED');
    
    // The new one should be CURRENT
    const blueRow = rows!.find(r => r.value === 'blue');
    expect(blueRow?.is_archived).toBe(false);
    expect(blueRow?.lifecycle_state).toBe('CURRENT');
  });

  it('concurrent corrections: should safely resolve race conditions', async () => {
    const source1 = randomUUID();
    const source2 = randomUUID();
    const source3 = randomUUID();
    const { error: histErr } = await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like pizza' },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like pasta' },
      { id: source3, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like sushi' }
    ]);
    if (histErr) console.error('Chat history insert error:', histErr);
    // Setup initial
    const initialMem = { key: 'favorite_food', value: 'pizza', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'I like pizza');
    
    // Simulate concurrent workers trying to supersede with different values
    const mem2 = { key: 'favorite_food', value: 'pasta', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
    const mem3 = { key: 'favorite_food', value: 'sushi', correction_intent: true, source_message_id: source3, shouldPersist: true, type: 'fact' };
    
    // Fire concurrently
    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, mem2, 'Actually I like pasta'),
      memoryRepository.upsertMemory(TEST_USER, mem3, 'Actually I like sushi')
    ]);
    
    // Because of the atomic RPC, exactly ONE should end up CURRENT.
    // The other will either have superseded it, or if timestamps matched (they don't in DB usually), one wins.
    const { data: activeRows } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_food')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');
      
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    
    const finalValue = activeRows![0].value;
    expect(['pasta', 'sushi']).toContain(finalValue);
  });

  it('stale write cannot resurrect old value', async () => {
    // We simulate this by having an older source_message_timestamp.
    // Wait, memoryRepository doesn't let us inject source_message_timestamp directly from the test easily unless we mock chat_history.
    // We will insert mock chat_history rows!
    const sourceOldId = randomUUID();
    const sourceNewId = randomUUID();
    
    // Insert into chat_history
    const { error: histErr } = await supabaseAdmin.from('chat_history').insert([
      { id: sourceOldId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like apples', created_at: '2020-01-01T00:00:00Z' },
      { id: sourceNewId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like bananas', created_at: '2021-01-01T00:00:00Z' }
    ]);
    if (histErr) console.error('Chat history insert error:', histErr);
    // First, process the NEW message
    const memNew = { key: 'favorite_fruit', value: 'bananas', correction_intent: true, source_message_id: sourceNewId, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, memNew, 'Actually I like bananas');
    
    // Now, a stale worker for the OLD message arrives late and tries to supersede
    const memOld = { key: 'favorite_fruit', value: 'apples', correction_intent: true, source_message_id: sourceOldId, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, memOld, 'Actually I like apples');
    
    // Verify bananas is STILL current
    const { data: activeRows } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_fruit')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');
      
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    expect(activeRows![0].value).toBe('bananas');
  });
});
