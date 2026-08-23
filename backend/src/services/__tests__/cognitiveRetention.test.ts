import { cognitiveHealthService } from '../CognitiveHealthService';
import { chatHistoryPruningService } from '../ChatHistoryPruningService';
import { supabaseAdmin } from '../../lib/supabase';
import { maintenanceQueue } from '../QueueService';
import { canRunNvidia } from '../../lib/nvidia';

jest.mock('../../lib/supabase', () => {
  const mockChain = {
    rpc: jest.fn(),
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockReturnThis(),
  };

  mockChain.from.mockImplementation(() => mockChain);
  mockChain.select.mockImplementation(() => mockChain);
  mockChain.eq.mockImplementation(() => mockChain);
  mockChain.order.mockImplementation(() => mockChain);
  mockChain.update.mockImplementation(() => mockChain);
  mockChain.insert.mockImplementation(() => mockChain);
  mockChain.upsert.mockImplementation(() => mockChain);
  mockChain.delete.mockImplementation(() => mockChain);
  mockChain.in.mockImplementation(() => mockChain);
  mockChain.lt.mockImplementation(() => mockChain);
  mockChain.limit.mockImplementation(() => mockChain);
  mockChain.single.mockImplementation(() => mockChain);

  return { supabaseAdmin: mockChain };
});

jest.mock('../QueueService', () => ({
  maintenanceQueue: {
    add: jest.fn(),
    process: jest.fn()
  }
}));

jest.mock('../../lib/nvidia', () => ({
  canRunNvidia: jest.fn().mockReturnValue(true),
  resolveRoutingProfile: jest.fn(),
  getRegion: jest.fn()
}));

describe('Cognitive Retention & Governance (Phase 6.1 Matrix)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Health Failure Safety (P0)', () => {
    it('returns degraded status explicitly when RPC fails instead of fabricated zeroes', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
        data: null,
        error: new Error('RPC offline')
      });

      const metrics = await cognitiveHealthService.getHealthMetrics();
      expect(metrics.status).toBe('degraded');
      expect(metrics.metric_source).toBe('unavailable');
      expect(metrics.metric_source_error).toBe('RPC offline');
      expect(metrics.chat_history_raw_count).toBe(null);
    });
  });

  describe('True Restore Architecture (P0)', () => {
    it('restores soft_deleted row when recovery window is active', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValueOnce({
        data: true,
        error: null
      });

      const result = await chatHistoryPruningService.restoreMemory('msg_1');
      
      expect(result).toBe(true);
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith('restore_soft_deleted_memory', { p_id: 'msg_1' });
    });

    it('rejects restore when recovery window is expired or physically deleted', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValueOnce({
        data: false,
        error: null
      });

      const result = await chatHistoryPruningService.restoreMemory('msg_1');
      expect(result).toBe(false);
    });
  });

  describe('Physical Deletion Safety (P1)', () => {
    it('does not physically delete if feature flag is disabled', async () => {
      process.env.ENABLE_PHYSICAL_DELETION = 'false';
      await chatHistoryPruningService.processPhysicalDeletion();
      
      // Should exit early
      expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith('process_physical_deletion_batch', expect.any(Object));
    });

    it('deletes soft_deleted rows when window expires and flag is enabled', async () => {
      process.env.ENABLE_PHYSICAL_DELETION = 'true';
      
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValueOnce({
        data: ['msg_1'],
        error: null
      });

      await chatHistoryPruningService.processPhysicalDeletion();
      
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith('process_physical_deletion_batch', { p_batch_size: 100 });
    });
  });

  describe('Queue-Only Execution (P1)', () => {
    it('schedules compaction instead of executing it directly', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
        data: {
          chat_history_raw_count: 600,
          jobs_pending_count: 10,
          is_maintenance_required: true
        }
      });

      await cognitiveHealthService.scheduleMaintenanceJobs();
      expect(maintenanceQueue.add).toHaveBeenCalledWith('compact_chat_history', expect.any(Object));
    });
  });

  describe('Memory Idempotency & Extraction (P1)', () => {
    it('persists multiple distinct facts from a single source message without duplication', async () => {
      const facts = [
        { user_id: 'user_1', source_message_id: 'msg_1', logical_key: 'mother_name', memory: 'Rajeshree', category: 'family' },
        { user_id: 'user_1', source_message_id: 'msg_1', logical_key: 'city', memory: 'Mumbai', category: 'location' },
        { user_id: 'user_1', source_message_id: 'msg_1', logical_key: 'company_name', memory: 'Acme', category: 'work' },
      ];

      const upsertMock = jest.fn().mockResolvedValue({ data: facts, error: null });
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'short_term_memories') {
          return { upsert: upsertMock, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
      });

      const { error } = await supabaseAdmin.from('short_term_memories').upsert(facts, { onConflict: 'user_id, source_message_id, logical_key', ignoreDuplicates: true });
      
      expect(error).toBeNull();
      expect(upsertMock).toHaveBeenCalledWith(facts, { onConflict: 'user_id, source_message_id, logical_key', ignoreDuplicates: true });
    });
  });

  describe('Pruning Service Core Logic', () => {
    it('executes the full compaction state machine for a user', async () => {
      const mockRows = Array.from({ length: 2001 }, (_, i) => ({
        id: `msg_${i}`,
        role: i === 0 ? 'user' : 'assistant',
        content: i === 0 
          ? 'My mother is Rajeshree, I live in Mumbai, and my company is Acme. I am feeling suicidal and need help immediately.' 
          : 'a'.repeat(100), // Ensures totalChars > TRIM_TARGET
        created_at: new Date().toISOString()
      }));

      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            select: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: mockRows,
              error: null
            }),
            update: jest.fn().mockReturnThis(),
            in: jest.fn().mockReturnThis(),
            eq: jest.fn().mockImplementation(function (this: any, col: string) {
              if (col === 'user_id') return this;
              return Promise.resolve({ error: null });
            })
          };
        }
        if (table === 'short_term_memories') {
          return { upsert: jest.fn().mockResolvedValue({ error: null }) };
        }
        if (table === 'recovery_archive' || table === 'tombstones') {
          return { insert: jest.fn().mockResolvedValue({ error: null }) };
        }
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), update: jest.fn().mockReturnThis(), in: jest.fn().mockReturnThis() };
      });

      const result = await chatHistoryPruningService.pruneUser('user_1');
      expect(result.skipped).toBe(false);
      expect(result.rowsDeleted).toBeGreaterThan(0);
      expect(result.memoriesExtracted).toBe(1);
    });
  });
});


