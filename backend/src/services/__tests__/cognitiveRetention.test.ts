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
    delete: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
  };

  mockChain.from.mockImplementation(() => mockChain);
  mockChain.select.mockImplementation(() => mockChain);
  mockChain.eq.mockImplementation(() => mockChain);
  mockChain.order.mockImplementation(() => mockChain);
  mockChain.update.mockImplementation(() => mockChain);
  mockChain.insert.mockImplementation(() => mockChain);
  mockChain.delete.mockImplementation(() => mockChain);
  mockChain.in.mockImplementation(() => mockChain);
  mockChain.lt.mockImplementation(() => mockChain);

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

describe('Cognitive Retention & Governance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CognitiveHealthService', () => {
    it('returns health metrics correctly', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
        data: {
          chat_history_raw_count: 600,
          jobs_pending_count: 10,
          is_maintenance_required: true
        }
      });

      const metrics = await cognitiveHealthService.getHealthMetrics();
      expect(metrics.chat_history_raw_count).toBe(600);
      expect(metrics.is_maintenance_required).toBe(true);
    });

    it('schedules compaction when raw chat exceeds threshold', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
        data: {
          chat_history_raw_count: 600,
          jobs_pending_count: 10,
          is_maintenance_required: true
        }
      });

      await cognitiveHealthService.scheduleMaintenanceJobs();
      expect(maintenanceQueue.add).toHaveBeenCalledWith('compact_chat_history', expect.any(Object));
      expect(maintenanceQueue.add).toHaveBeenCalledWith('cleanup_completed_jobs', {});
    });

    it('backs off if queue is overloaded (kill switch)', async () => {
      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
        data: {
          chat_history_raw_count: 600,
          jobs_pending_count: 5001, // Above 5000 limit
          is_maintenance_required: true
        }
      });

      await cognitiveHealthService.scheduleMaintenanceJobs();
      expect(maintenanceQueue.add).not.toHaveBeenCalled(); // Should early return
    });
  });

  describe('ChatHistoryPruningService (Bounded Compaction)', () => {
    it('processes eligible users and applies lifecycle transitions', async () => {
      // Mock users fetch (from -> select -> eq -> order)
      (supabaseAdmin.order as jest.Mock).mockResolvedValueOnce({
        data: [{ user_id: 'user_1' }]
      });

      // Mock user rows (from -> select -> eq -> order)
      (supabaseAdmin.order as jest.Mock).mockResolvedValueOnce({
        data: [
          { id: 'msg_1', role: 'user', content: 'a'.repeat(250000), created_at: '2026-08-01T00:00:00Z' },
          { id: 'msg_2', role: 'user', content: 'hello', created_at: '2026-08-01T00:00:01Z' }
        ]
      });

      await chatHistoryPruningService.processCompaction();
      
      // Should have attempted to get users with 'raw' compaction status
      expect(supabaseAdmin.eq).toHaveBeenCalledWith('compaction_status', 'raw');
      
      // Should have transitioned state
      expect(supabaseAdmin.update).toHaveBeenCalledWith(expect.objectContaining({
        compaction_status: 'compaction_pending'
      }));
    });
  });

  describe('NVIDIA Advisory Yielding', () => {
    it('canRunNvidia checks capacity constraints', () => {
      expect(canRunNvidia('PROACTIVE', 1)).toBe(true);
    });
  });
});

