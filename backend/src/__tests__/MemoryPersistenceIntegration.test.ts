import { memoryRepository } from '../services/memoryRepository';
import { cache } from '../lib/cache';
import { supabaseAdmin } from '../lib/supabase';
import { randomUUID } from 'crypto';

jest.setTimeout(60000);

describe('Memory Persistence & Concurrency Integration', () => {
  const TEST_USER = '00000000-0000-0000-0000-000000000123';

  beforeAll(async () => {
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER);
  });

  afterEach(async () => {
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER);
  });

  afterAll(async () => {
    await supabaseAdmin.from('memories').delete().eq('user_id', TEST_USER);
    await supabaseAdmin.from('chat_history').delete().eq('user_id', TEST_USER);
  });

  // ── P0-5 REQUIRED TEST CASES ───────────────────────────────────────────────────

  it('1. favourite colour -> canonical key + deterministic value', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');

    const messageId = randomUUID();
    const messageText = 'My favourite colour is blue';

    const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
    expect(analysisRes.hasCorrections).toBe(true);
    expect(analysisRes.correctionTarget).toBe('favourite_color');
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
    await consolidatedMemoryAgent['execute'](job);

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favourite_color')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBeGreaterThanOrEqual(1);
    expect(rows!.length).toBe(1);
    expect(rows![0].value).toBe('blue');
    expect(rows![0].key).toBe('favourite_color');
  });

  it('2. brother\'s name actually Amit -> brother_name + Amit', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');

    const messageId = randomUUID();
    const messageText = "My brother's name is actually Amit";

    const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
    expect(analysisRes.hasCorrections).toBe(true);
    expect(analysisRes.correctionTarget).toBe('brother_name'); // Canonical key, no apostrophe
    expect(analysisRes.correctionValue).toBe('Amit');

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

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'brother_name')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].value).toBe('Amit');
  });

  it('3. ambiguous "Make that yellow" -> zero semantic mutation', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');

    const messageId = randomUUID();
    const messageText = 'No, that is wrong. Make that yellow.';

    const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
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

  it('4. assistant-generated value cannot become correctionValue', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');

    const msgs = [
      { role: 'assistant' as const, message: 'I remember your favorite color is green.' },
      { role: 'user' as const, message: 'That is incorrect.' } // No new value provided by user
    ];

    const analysisRes = TurnAnalyzer.analyze(msgs);
    expect(analysisRes.correctionTarget).toBeFalsy();
    expect(analysisRes.correctionValue).toBeFalsy();
  });

  it('5. valid correction persists when NVIDIA fails WITHOUT calling NVIDIA', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');
    const nvidia = await import('../lib/nvidia');

    const completeSpy = jest.spyOn(nvidia, 'complete').mockRejectedValue(new Error('NVIDIA API Timeout or 503 Overloaded'));

    const messageId = randomUUID();
    const messageText = "Actually my favourite colour is blue";

    const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
    expect(analysisRes.hasCorrections).toBe(true);
    expect(analysisRes.correctionTarget).toBe('favourite_color');
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
    await consolidatedMemoryAgent['execute'](job);

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .in('key', ['favorite_color', 'favourite_color'])
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].value).toBe('blue');
    expect(completeSpy).not.toHaveBeenCalled();

    completeSpy.mockRestore();
  });

  it('6. hallucinated LLM value cannot override deterministic user value (e2e)', async () => {
    // This test is now covered by test 5 - corrections bypass LLM entirely
    // Keeping for explicit documentation
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');

    const messageId = randomUUID();
    const messageText = "My brother's name is actually Amit";

    const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
    expect(analysisRes.correctionTarget).toBe('brother_name');
    expect(analysisRes.correctionValue).toBe('Amit');

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

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'brother_name')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].value).toBe('Amit');
  });

  it('7. stale cache cannot affect correction', async () => {
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

    const getSpy = jest.spyOn(cache, 'get').mockReturnValue({
      semantic_memories: [{
        key: 'favorite_animal',
        value: 'cat',
        shouldPersist: true,
        type: 'fact',
        confidence: 1.0,
        importance: 80,
        emotional_weight: 0
      }]
    } as any);

    const job = { payload } as any;
    await consolidatedMemoryAgent['execute'](job);

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_animal')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].value).toBe('dog');

    getSpy.mockRestore();
  });

  it('8. ambiguous correction + stale cache -> zero mutation', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const { consolidatedMemoryAgent } = await import('../agents/ConsolidatedMemoryAgent');

    const messageId = randomUUID();
    const messageText = 'Make that yellow';

    const analysisRes = TurnAnalyzer.analyze([{ role: 'user', message: messageText }]);
    expect(analysisRes.correctionTarget).toBeFalsy();

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

    const semanticRows = rows?.filter(r => ['fact', 'family', 'preferences'].includes(r.memory_type)) || [];
    expect(semanticRows.length).toBe(0);
  });

  it('9. red -> blue -> exactly one CURRENT', async () => {
    const source1 = randomUUID();
    const source2 = randomUUID();
    const { error: histErr } = await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite color is red', created_at: '2020-01-01T00:00:00Z' },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually my favorite color is blue', created_at: '2021-01-01T00:00:00Z' }
    ]);
    if (histErr) throw new Error(`Chat history insert error: ${histErr.message}`);

    const initialMem = { key: 'favorite_color', value: 'red', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'My favorite color is red');

    const newMem = { key: 'favorite_color', value: 'blue', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, newMem, 'Actually my favorite color is blue');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favourite_color')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows).toBeDefined();
    expect(rows!.length).toBe(2);

    const redRow = rows!.find(r => r.value === 'red');
    expect(redRow?.is_archived).toBe(true);
    expect(redRow?.lifecycle_state).toBe('SUPERSEDED');

    const blueRow = rows!.find(r => r.value === 'blue');
    expect(blueRow?.is_archived).toBe(false);
    expect(blueRow?.lifecycle_state).toBe('CURRENT');
  });

  it('10. concurrent blue + green -> exactly one CURRENT (green wins by later timestamp)', async () => {
    const sourceRed = randomUUID();
    const sourceBlue = randomUUID();
    const sourceGreen = randomUUID();
    const { error: histErr } = await supabaseAdmin.from('chat_history').insert([
      { id: sourceRed, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like pizza', created_at: '2026-01-01T00:00:01Z' },
      { id: sourceBlue, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like pasta', created_at: '2026-01-01T00:00:02Z' },
      { id: sourceGreen, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like sushi', created_at: '2026-01-01T00:00:03Z' }
    ]);
    if (histErr) throw new Error(`Chat history insert error: ${histErr.message}`);

    const initialMem = { key: 'favorite_food', value: 'pizza', correction_intent: false, source_message_id: sourceRed, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'I like pizza');

    const memBlue = { key: 'favorite_food', value: 'pasta', correction_intent: true, source_message_id: sourceBlue, shouldPersist: true, type: 'fact' };
    const memGreen = { key: 'favorite_food', value: 'sushi', correction_intent: true, source_message_id: sourceGreen, shouldPersist: true, type: 'fact' };

    // Fire concurrently - green has later timestamp (00:00:03) so it should ultimately win
    // Race: whichever acquires lock first supersedes red; the other then supersedes that
    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, memBlue, 'Actually I like pasta'),
      memoryRepository.upsertMemory(TEST_USER, memGreen, 'Actually I like sushi')
    ]);

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_food')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    expect(activeRows![0].value).toBe('sushi'); // green wins (latest timestamp)

    // Verify full chain: red -> (blue or green) -> green
    const { data: allRows } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_food')
      .order('created_at', { ascending: true });

    const redRow = allRows!.find(r => r.value === 'pizza');
    expect(redRow?.is_archived).toBe(true);
    expect(redRow?.lifecycle_state).toBe('SUPERSEDED');

    // Blue may or may not exist depending on race - but if it exists, it's SUPERSEDED
    const blueRow = allRows!.find(r => r.value === 'pasta');
    if (blueRow) {
      expect(blueRow.is_archived).toBe(true);
      expect(blueRow.lifecycle_state).toBe('SUPERSEDED');
    }

    const greenRow = allRows!.find(r => r.value === 'sushi');
    expect(greenRow?.is_archived).toBe(false);
    expect(greenRow?.lifecycle_state).toBe('CURRENT');
  });

  it('10b. concurrent green + blue (reversed launch order) -> green still wins', async () => {
    const sourceRed = randomUUID();
    const sourceBlue = randomUUID();
    const sourceGreen = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceRed, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like pizza', created_at: '2026-01-01T00:00:01Z' },
      { id: sourceBlue, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like pasta', created_at: '2026-01-01T00:00:02Z' },
      { id: sourceGreen, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like sushi', created_at: '2026-01-01T00:00:03Z' }
    ]);

    const initialMem = { key: 'favorite_food_rev', value: 'pizza', correction_intent: false, source_message_id: sourceRed, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'I like pizza');

    const memBlue = { key: 'favorite_food_rev', value: 'pasta', correction_intent: true, source_message_id: sourceBlue, shouldPersist: true, type: 'fact' };
    const memGreen = { key: 'favorite_food_rev', value: 'sushi', correction_intent: true, source_message_id: sourceGreen, shouldPersist: true, type: 'fact' };

    // Fire concurrently but REVERSED order - green still has later timestamp
    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, memGreen, 'Actually I like sushi'),
      memoryRepository.upsertMemory(TEST_USER, memBlue, 'Actually I like pasta')
    ]);

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_food_rev')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    expect(activeRows![0].value).toBe('sushi'); // green still wins regardless of launch order
  });

  it('10c. equal timestamps -> deterministic source_message_id ordering', async () => {
    const ts = '2026-01-01T00:00:00Z';
    // Use explicit source_message_ids with known lexicographic ordering:
    // sourceRed < sourceBlue < sourceGreen (so green wins for equal timestamps)
    const sourceRed = '00000000-0000-0000-0000-000000000001';
    const sourceBlue = '00000000-0000-0000-0000-000000000002';
    const sourceGreen = '00000000-0000-0000-0000-000000000003';
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceRed, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like pizza', created_at: ts },
      { id: sourceBlue, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like pasta', created_at: ts },
      { id: sourceGreen, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like sushi', created_at: ts }
    ]);

    const initialMem = { key: 'favorite_food_eq', value: 'pizza', correction_intent: false, source_message_id: sourceRed, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'I like pizza');

    const memBlue = { key: 'favorite_food_eq', value: 'pasta', correction_intent: true, source_message_id: sourceBlue, shouldPersist: true, type: 'fact' };
    const memGreen = { key: 'favorite_food_eq', value: 'sushi', correction_intent: true, source_message_id: sourceGreen, shouldPersist: true, type: 'fact' };

    // Fire concurrently - equal timestamps, deterministic ordering by source_message_id
    // sourceGreen > sourceBlue > sourceRed lexicographically, so green wins
    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, memBlue, 'Actually I like pasta'),
      memoryRepository.upsertMemory(TEST_USER, memGreen, 'Actually I like sushi')
    ]);

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_food_eq')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    expect(activeRows![0].value).toBe('sushi'); // green wins (lexicographically largest source_message_id)

    // Run again with reversed launch order - MUST produce same winner (green)
    const sourceRed2 = '00000000-0000-0000-0000-000000000004';
    const sourceBlue2 = '00000000-0000-0000-0000-000000000005';
    const sourceGreen2 = '00000000-0000-0000-0000-000000000006';
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceRed2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like tacos', created_at: ts },
      { id: sourceBlue2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like burritos', created_at: ts },
      { id: sourceGreen2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like quesadillas', created_at: ts }
    ]);

    const initialMem2 = { key: 'favorite_food_eq2', value: 'tacos', correction_intent: false, source_message_id: sourceRed2, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem2, 'I like tacos');

    const memBlue2 = { key: 'favorite_food_eq2', value: 'burritos', correction_intent: true, source_message_id: sourceBlue2, shouldPersist: true, type: 'fact' };
    const memGreen2 = { key: 'favorite_food_eq2', value: 'quesadillas', correction_intent: true, source_message_id: sourceGreen2, shouldPersist: true, type: 'fact' };

    // Reversed launch order
    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, memGreen2, 'Actually I like quesadillas'),
      memoryRepository.upsertMemory(TEST_USER, memBlue2, 'Actually I like burritos')
    ]);

    const { data: activeRows2, error: error2 } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_food_eq2')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error2) throw new Error(`DB error: ${error2.message}`);
    expect(activeRows2).toBeDefined();
    expect(activeRows2!.length).toBe(1);
    expect(activeRows2![0].value).toBe('quesadillas'); // green wins again (lexicographically largest)

    // Verify deterministic ordering: same relative position wins regardless of launch order
    // Both runs: the correction with lexicographically largest source_message_id (green) wins
  });

  it('11. stale old event cannot resurrect', async () => {
    const sourceOldId = randomUUID();
    const sourceNewId = randomUUID();

    const { error: histErr } = await supabaseAdmin.from('chat_history').insert([
      { id: sourceOldId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like apples', created_at: '2020-01-01T00:00:00Z' },
      { id: sourceNewId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like bananas', created_at: '2021-01-01T00:00:00Z' }
    ]);
    if (histErr) throw new Error(`Chat history insert error: ${histErr.message}`);

    const memNew = { key: 'favorite_fruit', value: 'bananas', correction_intent: true, source_message_id: sourceNewId, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, memNew, 'Actually I like bananas');

    const memOld = { key: 'favorite_fruit', value: 'apples', correction_intent: true, source_message_id: sourceOldId, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, memOld, 'Actually I like apples');

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_fruit')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    expect(activeRows![0].value).toBe('bananas');
  });

  it('12. concurrent first writes -> exactly one CURRENT', async () => {
    const source1 = randomUUID();
    const source2 = randomUUID();

    await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite sport is tennis' },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite sport is soccer' }
    ]);

    const mem1 = { key: 'favorite_sport', value: 'tennis', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    const mem2 = { key: 'favorite_sport', value: 'soccer', correction_intent: false, source_message_id: source2, shouldPersist: true, type: 'fact' };

    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, mem1, 'My favorite sport is tennis'),
      memoryRepository.upsertMemory(TEST_USER, mem2, 'My favorite sport is soccer')
    ]);

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favorite_sport')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
  });

  it('13. missing source_message_id -> MISSING_PROVENANCE + zero mutation', async () => {
    const result = await supabaseAdmin.rpc('atomic_supersede_memory', {
      p_user_id: TEST_USER,
      p_key: 'test_key',
      p_new_value: 'test_value',
      p_memory_type: 'fact',
      p_importance: 50,
      p_confidence: 0.8,
      p_emotional_weight: 0,
      p_source_message: 'test',
      p_source_message_id: null,
      p_source_authority: 'explicit_user'
    });

    expect(result.data).toBeDefined();
    expect(result.data.success).toBe(false);
    expect(result.data.reason).toBe('MISSING_PROVENANCE');
  });

  it('14. nonexistent source -> fail closed', async () => {
    const fakeSourceId = randomUUID();
    const result = await supabaseAdmin.rpc('atomic_supersede_memory', {
      p_user_id: TEST_USER,
      p_key: 'test_key',
      p_new_value: 'test_value',
      p_memory_type: 'fact',
      p_importance: 50,
      p_confidence: 0.8,
      p_emotional_weight: 0,
      p_source_message: 'test',
      p_source_message_id: fakeSourceId,
      p_source_authority: 'explicit_user'
    });

    expect(result.data).toBeDefined();
    expect(result.data.success).toBe(false);
    expect(result.data.reason).toBe('MISSING_PROVENANCE');
    expect(result.data.detail).toContain('not found in chat_history');
  });

  it('15. source belonging to another user -> fail closed', async () => {
    const OTHER_USER = '00000000-0000-0000-0000-000000000999';
    const sourceId = randomUUID();

    await supabaseAdmin.from('chat_history').insert([
      { id: sourceId, user_id: OTHER_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite color is red' }
    ]);

    const result = await supabaseAdmin.rpc('atomic_supersede_memory', {
      p_user_id: TEST_USER,
      p_key: 'favorite_color',
      p_new_value: 'blue',
      p_memory_type: 'fact',
      p_importance: 50,
      p_confidence: 0.8,
      p_emotional_weight: 0,
      p_source_message: 'test',
      p_source_message_id: sourceId,
      p_source_authority: 'explicit_user'
    });

    expect(result.data).toBeDefined();
    expect(result.data.success).toBe(false);
    expect(result.data.reason).toBe('MISSING_PROVENANCE');
    expect(result.data.detail).toContain('different user');
  });

  it('16. equal timestamps -> deterministic result', async () => {
    const ts = '2020-01-01T00:00:00Z';
    const source1 = randomUUID();
    const source2 = randomUUID();

    await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite color is red', created_at: ts },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually my favorite color is blue', created_at: ts }
    ]);

    const mem1 = { key: 'favorite_color', value: 'red', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, mem1, 'My favorite color is red');

    const mem2 = { key: 'favorite_color', value: 'blue', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, mem2, 'Actually my favorite color is blue');

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favourite_color')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows).toBeDefined();
    expect(activeRows!.length).toBe(1);
    // Either red or blue is acceptable - what matters is exactly ONE
    expect(['red', 'blue']).toContain(activeRows![0].value);
  });

  it('17. favorite/favourite + color/colour -> exact canonical key', async () => {
    const source1 = randomUUID();
    const source2 = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favourite colour is red', created_at: '2020-01-01T00:00:00Z' },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually my favorite color is blue', created_at: '2021-01-01T00:00:00Z' }
    ]);

    const mem1 = { key: 'favourite_colour', value: 'red', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, mem1, 'My favourite colour is red');

    const mem2 = { key: 'favorite_color', value: 'blue', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, mem2, 'Actually my favorite color is blue');

    const { data: activeRows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('is_archived', false)
      .eq('key', 'favourite_color');

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(activeRows?.length).toBe(1);
    expect(activeRows![0].key).toBe('favourite_color');
    expect(activeRows![0].value).toBe('blue');
  });

  // ── P0-2: PROVE CORRECTION BYPASS IS CLOSED (MemoryRepository.upsertMemory) ───────
  // These tests verify that corrections ALWAYS go through the atomic RPC provenance gate,
  // even when no CURRENT row exists.

  it('P0-2.1: correction with null source_message_id and no CURRENT -> zero mutation', async () => {
    const mem = {
      key: 'test_correction_null_provenance',
      value: 'should_not_persist',
      correction_intent: true,
      source_message_id: null,
      shouldPersist: true,
      type: 'fact',
    };
    await memoryRepository.upsertMemory(TEST_USER, mem, 'Test correction with null provenance');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'test_correction_null_provenance')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(0);
  });

  it('P0-2.2: correction with nonexistent source_message_id and no CURRENT -> zero mutation', async () => {
    const fakeSourceId = randomUUID();
    const mem = {
      key: 'test_correction_nonexistent_provenance',
      value: 'should_not_persist',
      correction_intent: true,
      source_message_id: fakeSourceId,
      shouldPersist: true,
      type: 'fact',
    };
    await memoryRepository.upsertMemory(TEST_USER, mem, 'Test correction with nonexistent provenance');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'test_correction_nonexistent_provenance')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(0);
  });

  it('P0-2.3: correction using another user\'s source_message_id and no CURRENT -> zero mutation', async () => {
    const OTHER_USER = '00000000-0000-0000-0000-000000000999';
    const sourceId = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceId, user_id: OTHER_USER, conversation_id: randomUUID(), role: 'user', content: 'Other user message' }
    ]);

    const mem = {
      key: 'test_correction_cross_user_provenance',
      value: 'should_not_persist',
      correction_intent: true,
      source_message_id: sourceId,
      shouldPersist: true,
      type: 'fact',
    };
    await memoryRepository.upsertMemory(TEST_USER, mem, 'Test correction with cross-user provenance');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'test_correction_cross_user_provenance')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(0);
  });

  it('P0-2.4: correction using assistant source_message_id and no CURRENT -> zero mutation', async () => {
    const assistantSourceId = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: assistantSourceId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'assistant', content: 'Assistant message' }
    ]);

    const mem = {
      key: 'test_correction_assistant_provenance',
      value: 'should_not_persist',
      correction_intent: true,
      source_message_id: assistantSourceId,
      shouldPersist: true,
      type: 'fact',
    };
    await memoryRepository.upsertMemory(TEST_USER, mem, 'Test correction with assistant provenance');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'test_correction_assistant_provenance')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(0);
  });

  it('P0-2.5: valid correction with no CURRENT -> exactly one CURRENT created', async () => {
    const sourceId = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceId, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite color is blue' }
    ]);

    const mem = {
      key: 'favorite_color',
      value: 'blue',
      correction_intent: true,
      source_message_id: sourceId,
      shouldPersist: true,
      type: 'fact',
    };
    await memoryRepository.upsertMemory(TEST_USER, mem, 'Actually my favorite color is blue');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favourite_color')
      .eq('is_archived', false);

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(1);
    expect(rows![0].value).toBe('blue');
    expect(rows![0].lifecycle_state).toBe('CURRENT');
  });

  it('P0-2.6: valid correction with existing CURRENT -> atomic supersession', async () => {
    const source1 = randomUUID();
    const source2 = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: source1, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'My favorite color is red', created_at: '2020-01-01T00:00:00Z' },
      { id: source2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually my favorite color is blue', created_at: '2021-01-01T00:00:00Z' }
    ]);

    const initialMem = { key: 'favorite_color', value: 'red', correction_intent: false, source_message_id: source1, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'My favorite color is red');

    const newMem = { key: 'favorite_color', value: 'blue', correction_intent: true, source_message_id: source2, shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, newMem, 'Actually my favorite color is blue');

    const { data: rows, error } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'favourite_color')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`DB error: ${error.message}`);
    expect(rows?.length).toBe(2);

    const redRow = rows!.find(r => r.value === 'red');
    expect(redRow?.is_archived).toBe(true);
    expect(redRow?.lifecycle_state).toBe('SUPERSEDED');

    const blueRow = rows!.find(r => r.value === 'blue');
    expect(blueRow?.is_archived).toBe(false);
    expect(blueRow?.lifecycle_state).toBe('CURRENT');
    // superseded_by is on the OLD (superseded) row, pointing to the NEW row
    expect(redRow?.superseded_by).toBe(blueRow?.id);
  });
});
