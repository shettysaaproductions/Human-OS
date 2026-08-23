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
    // Default: no existing memory found (new insert path)
    (supabaseAdmin.from('memories').maybeSingle as jest.Mock).mockResolvedValue({ data: null, error: null });
    // Default: select (for fallback) returns empty
    (supabaseAdmin.from('memories').select as jest.Mock).mockReturnThis();
    (supabaseAdmin.from('memories').order as jest.Mock).mockReturnThis();
    (supabaseAdmin.from('memories').limit as jest.Mock).mockResolvedValue({ data: [], error: null });
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

    it('should not include last_accessed_at in UPDATE payload', async () => {
      // Simulate existing memory (update path)
      (supabaseAdmin.from('memories').maybeSingle as jest.Mock).mockResolvedValue({
        data: { id: 'mem-1', importance: 50, frequency: 2, emotional_weight: 3 },
        error: null,
      });
      (supabaseAdmin.from('memories').update as jest.Mock).mockResolvedValue({ error: null }).mockReturnThis();

      await repository.upsertMemory(userId, mockMemory, 'source');

      // Should NOT have called .insert()
      expect(supabaseAdmin.from('memories').insert).not.toHaveBeenCalled();
      // Should have called .update()
      expect(supabaseAdmin.from('memories').update).toHaveBeenCalledTimes(1);
      const updatePayload = (supabaseAdmin.from('memories').update as jest.Mock).mock.calls[0][0];
      // UPDATE does not set last_accessed_at (the RPC or searchMemories does that)
      expect(updatePayload.last_accessed_at).toBeUndefined();
    });
  });
});
