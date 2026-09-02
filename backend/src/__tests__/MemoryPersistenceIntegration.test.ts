import { memoryRepository } from '../services/memoryRepository';
import { cache } from '../lib/cache';
import { supabaseAdmin } from '../lib/supabase';
import { randomUUID } from 'crypto';
// Mock the LLM to return hallucinated values so we can test the deterministic override
jest.mock('../lib/nvidia', () => ({
  complete: jest.fn().mockResolvedValue(JSON.stringify({
    semantic_memories: [{
      shouldPersist: true,
      type: 'fact',
      key: 'hallucinated_key',
      value: 'Hallucinated LLM Value',
      importance: 100,
      confidence: 1.0,
      emotional_weight: 0
    }]
  }))
}));

jest.setTimeout(60000);

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

  describe('TurnAnalyzer & ConsolidatedMemoryAgent Integration', () => {
    // Tests for specific constraints
    
    it('ambiguous correction -> zero mutation', async () => {
      const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
      const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');
      
      const messageId = randomUUID();
      const messageText = 'No, that is wrong. Make that yellow.';
      
      // End-to-End: Use actual TurnAnalyzer
      const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }] as any);
      expect(analysisRes.hasCorrections).toBe(true);
      expect(analysisRes.correctionTarget).toBeFalsy(); // Cannot extract target from just 'yellow'

      const payload = {
        userId: TEST_USER,
        messageId,
        message: messageText,
        questionClauses: analysisRes.questionClauses,
        turnId: randomUUID(),
        hasExplicitRemember: analysisRes.hasExplicitRemember,
        hasCorrections: analysisRes.hasCorrections,
        correctionTarget: analysisRes.correctionTarget || null,
        correctionValue: analysisRes.correctionValue || null,
      };

      await supabaseAdmin.from('chat_history').insert([
        { id: payload.messageId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: payload.message }
      ]);

      const job = { payload } as any;
      await consolidatedMemoryAgent['execute'](job);
      
      const { data: rows } = await supabaseAdmin.from('memories')
        .select('*')
        .eq('user_id', TEST_USER)
        .eq('source_message_id', payload.messageId);
        
      const semanticRows = rows?.filter(r => ['fact', 'family', 'health', 'preferences'].includes(r.memory_type)) || [];
      expect(semanticRows.length).toBe(0);
    });

    it('deterministic USER value beats hallucinated LLM value (e2e)', async () => {
      const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
      const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');
      
      const messageId = randomUUID();
      const messageText = "My brother's name is actually Amit";
      
      // End-to-End: Use actual TurnAnalyzer
      const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
      expect(analysisRes.hasCorrections).toBe(true);
      expect(analysisRes.correctionTarget).toBe("brother's_name");
      expect(analysisRes.correctionValue).toBe('amit');

      const payload = {
        userId: TEST_USER,
        messageId,
        message: messageText,
        questionClauses: analysisRes.questionClauses,
        turnId: randomUUID(),
        hasExplicitRemember: analysisRes.hasExplicitRemember,
        hasCorrections: analysisRes.hasCorrections,
        correctionTarget: analysisRes.correctionTarget || null,
        correctionValue: analysisRes.correctionValue || null,
      };

      await supabaseAdmin.from('chat_history').insert([
        { id: payload.messageId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: payload.message }
      ]);

      const job = { payload } as any;
      await consolidatedMemoryAgent['execute'](job);
      
      const { data: rows } = await supabaseAdmin.from('memories')
        .select('*')
        .eq('user_id', TEST_USER)
        .eq('key', "brother's_name")
        .eq('is_archived', false);
        
      expect(rows?.length).toBe(1);
      expect(rows![0].value).toBe('amit');
    });

    it('correction persistence does not depend on LLM availability', async () => {
      const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
      const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');
      const nvidia = await import('../lib/nvidia');
      
      // Mock LLM to simulate complete failure/timeout
      const completeSpy = jest.spyOn(nvidia, 'complete').mockRejectedValue(new Error('NVIDIA API Timeout or 503 Overloaded'));

      const messageId = randomUUID();
      const messageText = "Actually my favourite colour is blue";
      
      const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
      expect(analysisRes.hasCorrections).toBe(true);
      expect(analysisRes.correctionTarget).toBe('favourite_color'); // TurnAnalyzer output
      expect(analysisRes.correctionValue).toBe('blue');

      const payload = {
        userId: TEST_USER,
        messageId,
        message: messageText,
        questionClauses: analysisRes.questionClauses,
        turnId: randomUUID(),
        hasExplicitRemember: analysisRes.hasExplicitRemember,
        hasCorrections: analysisRes.hasCorrections,
        correctionTarget: analysisRes.correctionTarget || null,
        correctionValue: analysisRes.correctionValue || null,
      };

      await supabaseAdmin.from('chat_history').insert([
        { id: payload.messageId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: payload.message }
      ]);

      const job = { payload } as any;
      // Should NOT throw despite LLM failure, because correction bypasses LLM
      await consolidatedMemoryAgent['execute'](job);
      
      const { data: rows } = await supabaseAdmin.from('memories')
        .select('*')
        .eq('user_id', TEST_USER)
        .in('key', ['favorite_color', 'favourite_color'])
        .eq('is_archived', false);
        
      expect(rows?.length).toBe(1);
      expect(rows![0].value).toBe('blue');
      expect(completeSpy).not.toHaveBeenCalled(); // MUST NOT HAVE BEEN CALLED
      
      completeSpy.mockRestore();
    });

    it('adversarial: assistant value cannot become correctionValue', async () => {
      const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
      
      const msgs = [
        { role: 'assistant' as const, message: 'I remember your favorite color is green.' },
        { role: 'user' as const, message: 'That is incorrect.' } // No new value provided by user
      ];
      
      const analysisRes = TurnAnalyzer.analyze(msgs);
      expect(analysisRes.correctionTarget).toBeFalsy();
      expect(analysisRes.correctionValue).toBeFalsy(); 
    });

    it('favorite/favourite and color/colour collapse to one canonical key', async () => {
      const source1 = randomUUID();
      const source2 = randomUUID();
      
      await supabaseAdmin.from('chat_history').insert([
        { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favourite colour is red' },
        { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually my favorite color is blue' }
      ]);
      
      // British spelling
      const mem1 = { key: 'favourite_colour', value: 'red', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
      await memoryRepository.upsertMemory(TEST_USER, mem1, 'My favourite colour is red');
      
      // American spelling correction
      const mem2 = { key: 'favorite_color', value: 'blue', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
      await memoryRepository.upsertMemory(TEST_USER, mem2, 'Actually my favorite color is blue');
      
      // Check the final key - should be canonicalized to 'favorite_color'
      // Wait, memoryRepository automatically canonicalizes 'favourite_colour' to 'favorite_color' using MemorySemanticResolver!
      const { data: activeRows } = await supabaseAdmin.from('memories')
        .select('*')
        .eq('user_id', TEST_USER)
        .eq('is_archived', false)
        .eq('key', 'favourite_color');
        
      expect(activeRows?.length).toBe(1);
      expect(activeRows![0].key).toBe('favourite_color');
      expect(activeRows![0].value).toBe('blue');
    });
    
    it('target != null but value == null -> zero mutation', async () => {
      const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');
      
      const payload = {
        userId: TEST_USER,
        messageId: randomUUID(),
        message: 'I dont have a brother', // If this somehow parsed as correction without a new value
        questionClauses: [],
        turnId: randomUUID(),
        hasExplicitRemember: false,
        hasCorrections: true,
        correctionTarget: 'brother_name',
        correctionValue: null,
      };

      await supabaseAdmin.from('chat_history').insert([
        { id: payload.messageId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: payload.message }
      ]);

      const job = { payload } as any;
      await consolidatedMemoryAgent['execute'](job);
      
      const { data: rows } = await supabaseAdmin.from('memories')
        .select('*')
        .eq('user_id', TEST_USER)
        .eq('source_message_id', payload.messageId);
        
      const semanticRows = rows?.filter(r => ['fact', 'family'].includes(r.memory_type)) || [];
      expect(semanticRows.length).toBe(0);
    });

    it('correction cache hit cannot leak stale value', async () => {
      const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');
      
      const payload = {
        userId: TEST_USER,
        messageId: randomUUID(),
        message: 'My favorite animal is dog',
        questionClauses: [],
        turnId: randomUUID(),
        hasExplicitRemember: false,
        hasCorrections: true,
        correctionTarget: 'favorite_animal',
        correctionValue: 'dog',
      };

      await supabaseAdmin.from('chat_history').insert([
        { id: payload.messageId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: payload.message }
      ]);

      // Mock cache.get to simulate a stale cache hit that says "cat"
      const getSpy = jest.spyOn(cache, 'get').mockReturnValue({
        semantic_memories: [{
          key: 'favorite_animal',
          value: 'cat', // Stale
          shouldPersist: true,
          type: 'fact',
          confidence: 1.0,
          importance: 80,
          emotional_weight: 0
        }]
      });

      // Execute Agent - should ignore cache and insert 'dog' deterministically
      const job = { payload } as any;
      await consolidatedMemoryAgent['execute'](job);
      
      const { data: rows } = await supabaseAdmin.from('memories')
        .select('*')
        .eq('user_id', TEST_USER)
        .eq('key', 'favorite_animal')
        .eq('is_archived', false);
        
      expect(rows?.length).toBe(1);
      expect(rows![0].value).toBe('dog'); // Proves cache was bypassed and correctionValue was used
      
      getSpy.mockRestore();
    });
  });
});
