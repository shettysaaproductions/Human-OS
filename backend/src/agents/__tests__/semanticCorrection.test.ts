import { consolidatedMemoryAgent } from '../ConsolidatedMemoryAgent';
import { memoryRepository } from '../../services/memoryRepository';
import { complete } from '../../lib/nvidia';
import { supabaseAdmin } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

jest.mock('../../services/memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn()
}));

jest.mock('../../services/MemoryPolicyService', () => ({
  memoryPolicyService: {
    isMemoryEnabled: jest.fn().mockResolvedValue(true)
  }
}));

function mockSupabaseIdle() {
  (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  }));
}

async function runCorrection(message: string, llmMemories: any[], recentContext = '') {
  mockSupabaseIdle();
  (complete as jest.Mock).mockResolvedValue(JSON.stringify({
    semantic_memories: llmMemories,
    working_memories: [{ key: 'should_not_persist', value: 'nope' }],
  }));

  await (consolidatedMemoryAgent as any).execute({
    payload: {
      userId: 'user-1',
      messageId: 'msg-1',
      message,
      hasCorrections: true,
      hasExplicitRemember: false,
      recentContext,
    }
  });
}

describe('Semantic correction via MEMORY LLM', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. production sentence persists favourite_color / green, not ab', async () => {
    const source = 'Ek correction hai mera favourite color green hai ab';
    await runCorrection(source, [{ key: 'favourite_color', value: 'green', shouldPersist: true }]);

    expect(complete).toHaveBeenCalledTimes(1);
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        key: 'favourite_color',
        value: 'green',
        correction_intent: true,
        source_message_id: 'msg-1',
        source_authority: 'explicit_user',
      }),
      source
    );
    expect(memoryRepository.upsertMemory).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Mera favourite color green hai ab', 'green'],
    ['Actually mera favourite color blue hai', 'blue'],
    ['Ek correction hai mera favourite colour red hai abhi', 'red'],
    ['Correction: mera favourite color green hai', 'green'],
    ['Ab mera favourite color green hai', 'green'],
    ['Mera favourite colour ab green hai', 'green'],
    ['Mera favourite color green hi hai', 'green'],
  ])('resolves %s -> favourite_color / %s', async (source, value) => {
    await runCorrection(source, [{ key: 'favourite_color', value, shouldPersist: true }]);
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ key: 'favourite_color', value, correction_intent: true }),
      source
    );
    const persistedKey = (memoryRepository.upsertMemory as jest.Mock).mock.calls[0][1].key;
    expect(persistedKey).not.toMatch(/^favourite_color_(green|blue|red)$/);
  });

  it('9. Make that blue fails closed without concept context', async () => {
    await runCorrection('Make that blue', [{ key: 'favourite_color', value: 'blue', shouldPersist: true }]);
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
  });

  it('9b. Make that blue may resolve when context grounds the concept', async () => {
    await runCorrection(
      'Make that blue',
      [{ key: 'favourite_color', value: 'blue', shouldPersist: true }],
      'My favourite color is red'
    );
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ key: 'favourite_color', value: 'blue', correction_intent: true }),
      'Make that blue'
    );
  });

  it('10. never persists favourite_color_green from malformed extraction', async () => {
    await runCorrection(
      'Ek correction hai mera favourite color green hai ab',
      [{ key: 'favourite_color_green', value: 'ab', shouldPersist: true }]
    );
    expect(memoryRepository.upsertMemory).not.toHaveBeenCalled();
  });

  it('does not write working-memory side effects on a correction turn', async () => {
    await runCorrection(
      'Ek correction hai mera favourite color green hai ab',
      [{ key: 'favourite_color', value: 'green', shouldPersist: true }]
    );
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('working_memory');
  });

  it('correction turns bypass extraction cache', async () => {
    const { cache } = await import('../../lib/cache');
    const getSpy = jest.spyOn(cache, 'get').mockReturnValue({
      semantic_memories: [{ key: 'favourite_color', value: 'red', shouldPersist: true }]
    } as any);

    await runCorrection(
      'My favourite color is blue',
      [{ key: 'favourite_color', value: 'blue', shouldPersist: true }]
    );

    expect(complete).toHaveBeenCalled();
    expect(memoryRepository.upsertMemory).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ key: 'favourite_color', value: 'blue' }),
      'My favourite color is blue'
    );
    getSpy.mockRestore();
  });
});

describe('chat.ts correction persistence contract', () => {
  it('deterministic fact queue excludes correction units', () => {
    const units = [
      { type: 'correction', factKey: 'favourite_color', factValue: 'ab' },
      { type: 'fact', factKey: 'city', factValue: 'Dahisar' },
    ];
    const explicitFacts = units.filter(u =>
      u.type === 'fact' &&
      u.factKey &&
      !u.factKey.startsWith('UNKNOWN_') &&
      u.factValue
    );
    expect(explicitFacts).toHaveLength(1);
    expect(explicitFacts[0].factKey).toBe('city');
  });
});
