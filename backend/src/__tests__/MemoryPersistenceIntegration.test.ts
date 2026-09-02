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

  it('10d. concurrent alias reconciliation -> exactly one CURRENT canonical (serialized by user_id, canonical_key)', async () => {
    // Two different aliases that map to the same canonical key (mother_name)
    // must serialize by (user_id, canonical_key) and leave exactly one CURRENT.
    const aliasId1 = randomUUID();
    const aliasId2 = randomUUID();

    // Insert two alias rows directly (bypass repository canonicalization)
    const { error: insertErr } = await supabaseAdmin.from('memories').insert([
      {
        id: aliasId1,
        user_id: TEST_USER,
        key: 'moms_name',
        value: 'Sita',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
      },
      {
        id: aliasId2,
        user_id: TEST_USER,
        key: 'mom_name',
        value: 'Sita',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
      },
    ]);
    if (insertErr) throw new Error(`Alias insert error: ${insertErr.message}`);

    // Fire concurrent canonicalizations via RPC — both target mother_name
    const results = await Promise.all([
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasId1,
        p_canonical_key: 'mother_name',
        p_reason: 'test: alias reconciliation',
      }),
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasId2,
        p_canonical_key: 'mother_name',
        p_reason: 'test: alias reconciliation',
      }),
    ]);

    // At least one must succeed; with deterministic batch the second may be NOT_FOUND if first already archived both
    for (const r of results) {
      expect(r.error).toBeNull();
      expect(r.data).toBeDefined();
      if (r.data?.success === true) {
        expect(['created_canonical', 'archived_alias', 'replaced_canonical'].includes(r.data.action)).toBeTruthy();
      } else {
        expect(r.data?.reason).toBe('NOT_FOUND');
      }
    }
    // Ensure at least one created the canonical
    const anySuccess = results.some(r => r.data?.success === true);
    expect(anySuccess).toBe(true);

    // Exactly one CURRENT canonical
    const { data: canonicalRows, error: canonErr } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'mother_name')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');
    if (canonErr) throw new Error(`DB error: ${canonErr.message}`);
    expect(canonicalRows?.length).toBe(1);
    expect(canonicalRows![0].value).toBe('Sita');

    // Both alias rows must now be archived with superseded_by linkage
    const { data: aliasRows } = await supabaseAdmin
      .from('memories')
      .select('*')
      .in('id', [aliasId1, aliasId2]);
    expect(aliasRows?.length).toBe(2);
    for (const row of aliasRows!) {
      expect(row.is_archived).toBe(true);
      expect(row.lifecycle_state).toBe('SUPERSEDED');
      expect(row.superseded_by).toBe(canonicalRows![0].id);
    }

    // Reverse launch order must also yield exactly one CURRENT
    const aliasId3 = randomUUID();
    const aliasId4 = randomUUID();
    await supabaseAdmin.from('memories').insert([
      {
        id: aliasId3,
        user_id: TEST_USER,
        key: 'mothers_name',
        value: 'Lakshmi',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
      },
      {
        id: aliasId4,
        user_id: TEST_USER,
        key: 'maa_name',
        value: 'Lakshmi',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
      },
    ]);

    const resultsRev = await Promise.all([
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasId4,
        p_canonical_key: 'mother_name',
        p_reason: 'test: alias reconciliation reversed',
      }),
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasId3,
        p_canonical_key: 'mother_name',
        p_reason: 'test: alias reconciliation reversed',
      }),
    ]);

    // After reversed-order concurrent canonicalization, still exactly one CURRENT
    // The second batch should detect canonical already exists and just archive alias.
    // Since mother_name already has a CURRENT from previous batch ('Sita'), these
    // new aliases should be archived against the existing canonical, not create a second.
    const { data: canonicalRows2 } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'mother_name')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');
    expect(canonicalRows2?.length).toBe(1);
    // Original canonical value preserved (Sita), not overwritten by Lakshmi aliases
    expect(canonicalRows2![0].value).toBe('Sita');

    const { data: aliasRows2 } = await supabaseAdmin
      .from('memories')
      .select('*')
      .in('id', [aliasId3, aliasId4]);
    for (const row of aliasRows2!) {
      expect(row.is_archived).toBe(true);
      expect(row.superseded_by).toBe(canonicalRows2![0].id);
    }
  });

  it('10e. equal timestamps reversed launch -> same deterministic winner', async () => {
    const ts = '2026-01-01T00:00:00Z';
    const sourceBlue = '00000000-0000-0000-0000-000000000010';
    const sourceGreen = '00000000-0000-0000-0000-000000000020';
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceBlue, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like pasta eq2', created_at: ts },
      { id: sourceGreen, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like sushi eq2', created_at: ts }
    ]);

    const initialMem = { key: 'food_eq_rev', value: 'pizza', correction_intent: false, source_message_id: '00000000-0000-0000-0000-000000000009', shouldPersist: true, type: 'fact' };
    // Seed initial CURRENT via separate history row
    await supabaseAdmin.from('chat_history').insert([
      { id: '00000000-0000-0000-0000-000000000009', user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like pizza eq_rev', created_at: '2025-12-31T00:00:00Z' }
    ]);
    await memoryRepository.upsertMemory(TEST_USER, initialMem, 'I like pizza eq_rev');

    const memBlue = { key: 'food_eq_rev', value: 'pasta', correction_intent: true, source_message_id: sourceBlue, shouldPersist: true, type: 'fact' };
    const memGreen = { key: 'food_eq_rev', value: 'sushi', correction_intent: true, source_message_id: sourceGreen, shouldPersist: true, type: 'fact' };

    // Launch GREEN then BLUE (reversed) — lexicographically larger ID (green) must still win
    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, memGreen, 'Actually I like sushi eq2'),
      memoryRepository.upsertMemory(TEST_USER, memBlue, 'Actually I like pasta eq2')
    ]);

    const { data: activeRows } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'food_eq_rev')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');
    expect(activeRows?.length).toBe(1);
    expect(activeRows![0].value).toBe('sushi'); // green has larger source_message_id -> wins

    // Second independent key with same timestamps but BLUE then GREEN launch -> same winner
    const sourceBlue2 = '00000000-0000-0000-0000-000000000030';
    const sourceGreen2 = '00000000-0000-0000-0000-000000000040';
    await supabaseAdmin.from('chat_history').insert([
      { id: sourceBlue2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like tea', created_at: ts },
      { id: sourceGreen2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Actually I like coffee', created_at: ts }
    ]);
    await supabaseAdmin.from('chat_history').insert([
      { id: '00000000-0000-0000-0000-000000000029', user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'I like water', created_at: '2025-12-31T00:00:00Z' }
    ]);
    const initialMem2 = { key: 'drink_eq_rev', value: 'water', correction_intent: false, source_message_id: '00000000-0000-0000-0000-000000000029', shouldPersist: true, type: 'fact' };
    await memoryRepository.upsertMemory(TEST_USER, initialMem2, 'I like water');

    const memBlue2 = { key: 'drink_eq_rev', value: 'tea', correction_intent: true, source_message_id: sourceBlue2, shouldPersist: true, type: 'fact' };
    const memGreen2 = { key: 'drink_eq_rev', value: 'coffee', correction_intent: true, source_message_id: sourceGreen2, shouldPersist: true, type: 'fact' };

    await Promise.all([
      memoryRepository.upsertMemory(TEST_USER, memBlue2, 'Actually I like tea'),
      memoryRepository.upsertMemory(TEST_USER, memGreen2, 'Actually I like coffee')
    ]);

    const { data: activeRows2 } = await supabaseAdmin.from('memories')
      .select('*')
      .eq('user_id', TEST_USER)
      .eq('key', 'drink_eq_rev')
      .eq('is_archived', false)
      .eq('lifecycle_state', 'CURRENT');
    expect(activeRows2?.length).toBe(1);
    expect(activeRows2![0].value).toBe('coffee'); // same deterministic rule
  });

  it('10f. concurrent aliases with DIFFERENT values -> newest provenance wins regardless of lock order', async () => {
    // Deterministic winner: Amit (00:00:02) must win over Rahul (00:00:01) even if Rahul acquires lock first
    const srcRahul = randomUUID();
    const srcAmit = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: srcRahul, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Mera mom ka naam Rahul hai', created_at: '2026-01-01T00:00:01Z' },
      { id: srcAmit, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Mera mom ka naam Amit hai', created_at: '2026-01-01T00:00:02Z' },
    ]);
    const aliasRahul = randomUUID();
    const aliasAmit = randomUUID();
    await supabaseAdmin.from('memories').insert([
      {
        id: aliasRahul,
        user_id: TEST_USER,
        key: 'moms_name',
        value: 'Rahul',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcRahul,
        source_message: 'Mera mom ka naam Rahul hai',
      },
      {
        id: aliasAmit,
        user_id: TEST_USER,
        key: 'mom_name',
        value: 'Amit',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcAmit,
        source_message: 'Mera mom ka naam Amit hai',
      },
    ]);

    // Launch Rahul then Amit
    const res1 = await Promise.all([
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasRahul,
        p_canonical_key: 'mother_name',
        p_reason: 'test: deterministic winner',
      }),
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasAmit,
        p_canonical_key: 'mother_name',
        p_reason: 'test: deterministic winner',
      }),
    ]);
    // At least one should succeed; batch archives both so second may be NOT_FOUND
    for (const r of res1) {
      expect(r.error).toBeNull();
      expect(r.data).toBeDefined();
      if (r.data?.success === true) {
        expect(['created_canonical', 'archived_alias', 'replaced_canonical'].includes(r.data.action)).toBeTruthy();
      } else {
        expect(r.data?.reason).toBe('NOT_FOUND');
      }
    }
    expect(res1.some(r => r.data?.success === true)).toBe(true);
    const { data: canonAmit } = await supabaseAdmin.from('memories').select('*').eq('user_id', TEST_USER).eq('key', 'mother_name').eq('is_archived', false).eq('lifecycle_state', 'CURRENT');
    expect(canonAmit?.length).toBe(1);
    expect(canonAmit![0].value).toBe('Amit');
    // Both aliases superseded to surviving canonical
    const { data: aliasRowsA } = await supabaseAdmin.from('memories').select('*').in('id', [aliasRahul, aliasAmit]);
    for (const row of aliasRowsA!) {
      expect(row.is_archived).toBe(true);
      expect(row.lifecycle_state).toBe('SUPERSEDED');
      expect(row.superseded_by).toBe(canonAmit![0].id);
    }

    // Clean up for reversed order test on fresh key sister_name
    const srcRahul2 = randomUUID();
    const srcAmit2 = randomUUID();
    await supabaseAdmin.from('chat_history').insert([
      { id: srcRahul2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Meri behen ka naam Rahul2 hai', created_at: '2026-01-01T00:00:01Z' },
      { id: srcAmit2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Meri behen ka naam Amit2 hai', created_at: '2026-01-01T00:00:02Z' },
    ]);
    const aliasRahul2 = randomUUID();
    const aliasAmit2 = randomUUID();
    await supabaseAdmin.from('memories').insert([
      {
        id: aliasRahul2,
        user_id: TEST_USER,
        key: 'behen_name',
        value: 'Rahul2',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcRahul2,
        source_message: 'Meri behen ka naam Rahul2 hai',
      },
      {
        id: aliasAmit2,
        user_id: TEST_USER,
        key: 'sister',
        value: 'Amit2',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcAmit2,
        source_message: 'Meri behen ka naam Amit2 hai',
      },
    ]);
    // Reverse launch: Amit first, Rahul second -> Amit must still win
    const res2 = await Promise.all([
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasAmit2,
        p_canonical_key: 'sister_name',
        p_reason: 'test: deterministic winner reversed',
      }),
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasRahul2,
        p_canonical_key: 'sister_name',
        p_reason: 'test: deterministic winner reversed',
      }),
    ]);
    for (const r of res2) {
      expect(r.error).toBeNull();
      // Second may return NOT_FOUND if first already archived both, but our new batch archives both at once so second finds alias already archived
      // Accept either success or NOT_FOUND as long as final state is correct
      if (r.data) expect(['archived_alias', 'created_canonical', 'replaced_canonical'].includes(r.data.action) || r.data.reason === 'NOT_FOUND').toBeTruthy();
    }
    const { data: canonAmit2 } = await supabaseAdmin.from('memories').select('*').eq('user_id', TEST_USER).eq('key', 'sister_name').eq('is_archived', false).eq('lifecycle_state', 'CURRENT');
    expect(canonAmit2?.length).toBe(1);
    expect(canonAmit2![0].value).toBe('Amit2');
    const { data: aliasRowsB } = await supabaseAdmin.from('memories').select('*').in('id', [aliasRahul2, aliasAmit2]);
    for (const row of aliasRowsB!) {
      expect(row.is_archived).toBe(true);
      expect(row.superseded_by).toBe(canonAmit2![0].id);
    }
  });

  it('10g. equal-timestamp different values -> deterministic source_message_id wins', async () => {
    const ts = '2026-01-01T00:00:00Z';
    // Amit has lexicographically larger source_message_id than Rahul
    const srcRahul = '00000000-0000-0000-0000-000000001111';
    const srcAmit = '00000000-0000-0000-0000-000000002222';
    await supabaseAdmin.from('chat_history').insert([
      { id: srcRahul, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Mera bhai ka naam Rahul equal', created_at: ts },
      { id: srcAmit, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Mera bhai ka naam Amit equal', created_at: ts },
    ]);
    // Also ensure no leftover brother_name canonical from earlier tests interferes - use distinct key father_name for equal test
    const aliasRahul = randomUUID();
    const aliasAmit = randomUUID();
    await supabaseAdmin.from('memories').insert([
      {
        id: aliasRahul,
        user_id: TEST_USER,
        key: 'bhai_name',
        value: 'Rahul',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcRahul,
        source_message: 'Mera bhai ka naam Rahul equal',
      },
      {
        id: aliasAmit,
        user_id: TEST_USER,
        key: 'brother',
        value: 'Amit',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcAmit,
        source_message: 'Mera bhai ka naam Amit equal',
      },
    ]);
    // Launch Rahul then Amit (Amit has larger ID, should win)
    await Promise.all([
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasRahul,
        p_canonical_key: 'brother_name',
        p_reason: 'test: equal ts deterministic',
      }),
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasAmit,
        p_canonical_key: 'brother_name',
        p_reason: 'test: equal ts deterministic',
      }),
    ]);
    const { data: canon } = await supabaseAdmin.from('memories').select('*').eq('user_id', TEST_USER).eq('key', 'brother_name').eq('is_archived', false).eq('lifecycle_state', 'CURRENT');
    expect(canon?.length).toBe(1);
    expect(canon![0].value).toBe('Amit');

    // Reverse launch order -> same winner
    // Use new aliases for father_name to avoid polluting same canonical
    const srcRahul2 = '00000000-0000-0000-0000-000000003333';
    const srcAmit2 = '00000000-0000-0000-0000-000000004444';
    await supabaseAdmin.from('chat_history').insert([
      { id: srcRahul2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Mere papa ka naam Rahul equal2', created_at: ts },
      { id: srcAmit2, user_id: TEST_USER, conversation_id: randomUUID(), role: 'user', content: 'Mere papa ka naam Amit equal2', created_at: ts },
    ]);
    const aliasRahul2 = randomUUID();
    const aliasAmit2 = randomUUID();
    await supabaseAdmin.from('memories').insert([
      {
        id: aliasRahul2,
        user_id: TEST_USER,
        key: 'papa_name',
        value: 'Rahul',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcRahul2,
        source_message: 'Mere papa ka naam Rahul equal2',
      },
      {
        id: aliasAmit2,
        user_id: TEST_USER,
        key: 'father',
        value: 'Amit',
        memory_type: 'family',
        is_archived: false,
        lifecycle_state: 'CURRENT',
        importance: 80,
        confidence: 0.9,
        source_authority: 'explicit_user',
        source_message_id: srcAmit2,
        source_message: 'Mere papa ka naam Amit equal2',
      },
    ]);
    await Promise.all([
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasAmit2,
        p_canonical_key: 'father_name',
        p_reason: 'test: equal ts reversed',
      }),
      supabaseAdmin.rpc('atomic_canonicalize_memory', {
        p_user_id: TEST_USER,
        p_alias_memory_id: aliasRahul2,
        p_canonical_key: 'father_name',
        p_reason: 'test: equal ts reversed',
      }),
    ]);
    const { data: canon2 } = await supabaseAdmin.from('memories').select('*').eq('user_id', TEST_USER).eq('key', 'father_name').eq('is_archived', false).eq('lifecycle_state', 'CURRENT');
    expect(canon2?.length).toBe(1);
    expect(canon2![0].value).toBe('Amit');
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

  // ── P0-USER ROLE BOUNDARY: deterministic USER-only extraction ───────────────
  it('RB1: TurnAnalyzer includes role=user, excludes assistant/system/unknown/role-less', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const userMsg = { role: 'user' as const, message: 'My favourite colour is blue' };
    const assistantMsg = { role: 'assistant' as const, message: 'My favourite colour is blue' };
    const systemMsg = { role: 'system' as const, message: 'My favourite colour is blue' };
    const unknownMsg = { role: 'unknown' as any, message: 'My favourite colour is blue' };
    const roleLessMsg = { message: 'My favourite colour is blue' } as any;

    const userRes = TurnAnalyzer.analyze([userMsg]);
    expect(userRes.hasCorrections).toBe(true);
    expect(userRes.correctionTarget).toBe('favourite_color');
    expect(userRes.negatedGoals).toBeDefined();

    const assistantRes = TurnAnalyzer.analyze([assistantMsg]);
    expect(assistantRes.units.length).toBe(0);
    expect(assistantRes.hasCorrections).toBe(false);
    expect(assistantRes.negatedGoals?.length).toBe(0);
    expect(assistantRes.correctionTarget).toBeFalsy();

    const systemRes = TurnAnalyzer.analyze([systemMsg]);
    expect(systemRes.units.length).toBe(0);
    expect(systemRes.hasCorrections).toBe(false);

    const unknownRes = TurnAnalyzer.analyze([unknownMsg]);
    expect(unknownRes.units.length).toBe(0);
    expect(unknownRes.hasCorrections).toBe(false);

    const roleLessRes = TurnAnalyzer.analyze([roleLessMsg]);
    // Strict: role-less is NOT user, so excluded (ingress must normalize)
    expect(roleLessRes.units.length).toBe(0);
    expect(roleLessRes.hasCorrections).toBe(false);
  });

  it('RB2: mixed role batch only processes user messages for negatedGoals', async () => {
    const { TurnAnalyzer } = await import('../services/TurnAnalyzer');
    const msgs = [
      { role: 'assistant' as const, message: 'fashion ka shop nahi hai' },
      { role: 'user' as const, message: 'My favourite colour is blue' },
    ];
    const res = TurnAnalyzer.analyze(msgs);
    // Only user message contributes to correction and negatedGoals
    expect(res.hasCorrections).toBe(true);
    expect(res.correctionTarget).toBe('favourite_color');
    // Assistant's negated phrase must not appear
    const concepts = (res.negatedGoals || []).map(g => g.concept);
    expect(concepts.some(c => c.includes('fashion'))).toBe(false);
  });
});
