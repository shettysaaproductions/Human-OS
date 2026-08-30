import { MemoryRepository } from '../memoryRepository';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../lib/queryTracker', () => ({
  qt: {
    track: (_name: string, _table: string, fn: () => Promise<any>) => fn(),
    recordEgressSaved: jest.fn(),
  },
}));

describe('MemoryRepository', () => {
  let repository: MemoryRepository;
  const userId = 'test-user-id';
  const mockMemory = {
    shouldPersist: true,
    type: 'personal' as const,
    key: 'test-key',
    value: 'test value',
    importance: 50,
    confidence: 0.8,
    emotional_weight: 3,
  };

    beforeEach(() => {
    jest.clearAllMocks();
    repository = new MemoryRepository();
    // Default: select -> eq -> eq -> eq resolves to empty array (new insert path)
    const chain: any = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.order = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
    chain.single = jest.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null });
    chain.insert = jest.fn().mockReturnValue(chain);
    chain.update = jest.fn().mockReturnValue(chain);
    chain.then = (resolve: any) => resolve({ data: [], error: null });

    (supabaseAdmin.from as jest.Mock).mockReturnValue(chain);
  });

  describe('upsertMemory', () => {
    it('should skip if shouldPersist is false', async () => {
      await repository.upsertMemory(userId, { ...mockMemory, shouldPersist: false }, 'source');
      expect(supabaseAdmin.from('memories').insert).not.toHaveBeenCalled();
    });

    it('should include last_accessed_at in INSERT payload', async () => {
      await repository.upsertMemory(userId, mockMemory, 'source');

      expect(supabaseAdmin.from('memories').insert).toHaveBeenCalledTimes(1);
      const insertPayload = (supabaseAdmin.from('memories').insert as jest.Mock).mock.calls[0][0];

      expect(insertPayload.last_accessed_at).toBeDefined();
      expect(typeof insertPayload.last_accessed_at).toBe('string');
      // Should be a valid ISO timestamp
      expect(() => new Date(insertPayload.last_accessed_at)).not.toThrow();

      // Verify the rest of the payload is intact
      expect(insertPayload.user_id).toBe(userId);
      expect(insertPayload.key).toBe('test-key');
      expect(insertPayload.value).toBe('test value');
      expect(insertPayload.memory_type).toBe('personal');
      expect(insertPayload.source_message).toBe('source');
    });

    it('should update and reinforce existing memory when identical value is asserted', async () => {
      // Simulate existing memory with same value (reinforcement path)
      const existingMem = {
        id: 'mem-1',
        user_id: userId,
        key: 'test-key',
        value: 'test value',
        importance: 50,
        frequency: 2,
        emotional_weight: 3,
        source_authority: 'subconscious_inference',
        is_archived: false,
        lifecycle_state: 'CURRENT',
      };

      const chain: any = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockReturnValue(chain);
      chain.order = jest.fn().mockReturnValue(chain);
      chain.limit = jest.fn().mockReturnValue(chain);
      chain.insert = jest.fn().mockReturnValue(chain);
      chain.update = jest.fn().mockReturnValue(chain);
      chain.then = (resolve: any) => resolve({ data: [existingMem], error: null });

      (supabaseAdmin.from as jest.Mock).mockReturnValue(chain);

      await repository.upsertMemory(userId, mockMemory, 'source');

      // Should NOT have called .insert()
      expect(supabaseAdmin.from('memories').insert).not.toHaveBeenCalled();
      // Should have called .update() to reinforce
      expect(supabaseAdmin.from('memories').update).toHaveBeenCalledTimes(1);
      const updatePayload = (supabaseAdmin.from('memories').update as jest.Mock).mock.calls[0][0];
      expect(updatePayload.frequency).toBe(3);
    });
  });
});
