import { NovaFollowupService } from '../NovaFollowupService';
import { supabaseAdmin } from '../../lib/supabase';
import { sendPushNotification } from '../../lib/pushNotifications';
import { logger } from '../../lib/logger';
// unused import removed
import { novaBrain } from '../NovaBrainService';

// Mock these EXACTLY
jest.mock('../../lib/supabase', () => {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null })
  };
  return {
    supabaseAdmin: {
      from: jest.fn(() => chainable)
    }
  };
});

jest.mock('../../lib/pushNotifications', () => ({
  sendPushNotification: jest.fn()
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

jest.mock('../NovaTriggerEngine', () => {
  const sharedTriggerEngine = {
    shouldTrigger: jest.fn().mockResolvedValue({ shouldSend: true, delayMs: 5000 }),
    scheduleMessage: jest.fn().mockResolvedValue(true)
  };
  return {
    NovaTriggerEngine: jest.fn().mockImplementation(() => ({
      shouldTrigger: jest.fn().mockResolvedValue({ shouldSend: true, delayMs: 5000 })
    })),
    novaTriggerEngine: sharedTriggerEngine
  };
});

jest.mock('../NovaBrainService', () => ({
  novaBrain: {
    evaluateConsciousnessTier2: jest.fn().mockResolvedValue({ message: 'Sab theek hai?' })
  }
}));

describe('NovaFollowupService', () => {
  let service: NovaFollowupService;
  let mockChain: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    service = new NovaFollowupService();
    mockChain = (supabaseAdmin.from as jest.Mock)();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('3.1 queueFollowup', () => {
    it('should cancel existing pending follow-ups for the user', async () => {
      await service.queueFollowup('u1', 'c1', 'Hello', 1);
      expect(supabaseAdmin.from).toHaveBeenCalledWith('nova_followups');
      expect(mockChain.update).toHaveBeenCalledWith({ status: 'cancelled' });
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('should insert a new pending follow-up with correct fire_at', async () => {
      await service.queueFollowup('u1', 'c1', 'Hello', 1); // 1 hour
      expect(mockChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        status: 'pending',
        user_id: 'u1',
        conversation_id: 'c1',
        message: 'Hello'
      }));
      // Assert fire_at approximately Date.now() + 1*3600000 + 5000
      const inserted = mockChain.insert.mock.calls[0][0];
      const fireAtTime = new Date(inserted.fire_at).getTime();
      expect(fireAtTime).toBeGreaterThanOrEqual(Date.now() + 3600000 + 4900);
      expect(fireAtTime).toBeLessThanOrEqual(Date.now() + 3600000 + 5100);
    });

    it('should clamp delay to minimum 15 seconds', async () => {
      // delay of 0
      await service.queueFollowup('u1', 'c1', 'Hello', 0);
      
      const inserted = mockChain.insert.mock.calls[0][0];
      const fireAtTime = new Date(inserted.fire_at).getTime();
      expect(fireAtTime).toBeGreaterThanOrEqual(Date.now() + 15000 - 5000);
    });

    it('should clamp delay to maximum 24 hours', async () => {
      await service.queueFollowup('u1', 'c1', 'Hello', 48);
      const inserted = mockChain.insert.mock.calls[0][0];
      const fireAtTime = new Date(inserted.fire_at).getTime();
      expect(fireAtTime).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000 + 5000);
    });

    it('should extend delay to 15 min when rate limited', async () => {
      // The service uses the shared singleton, so drive its shouldTrigger directly.
      const { novaTriggerEngine } = require('../NovaTriggerEngine');
      (novaTriggerEngine.shouldTrigger as jest.Mock).mockResolvedValueOnce({
        shouldSend: false, reason: 'rate_limited', delayMs: 0
      });
      await service.queueFollowup('u1', 'c1', 'Hello', 0.001);

      const inserted = mockChain.insert.mock.calls[0][0];
      const fireAtTime = new Date(inserted.fire_at).getTime();
      expect(fireAtTime).toBeGreaterThanOrEqual(Date.now() + 15 * 60 * 1000 - 5000);
    });

    it('should handle errors gracefully', async () => {
      mockChain.update.mockImplementationOnce(() => { throw new Error('DB down'); });
      await expect(service.queueFollowup('u1', 'c1', 'Hello', 1)).resolves.not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[NovaFollowup] Error scheduling follow-up'), expect.any(Object));
    });
  });

  describe('3.2 cancelFollowups', () => {
    it('should cancel all pending follow-ups for a user', async () => {
      await service.cancelFollowups('u1');
      expect(supabaseAdmin.from).toHaveBeenCalledWith('nova_followups');
      expect(mockChain.update).toHaveBeenCalledWith({ status: 'cancelled' });
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('should handle errors gracefully', async () => {
      mockChain.update.mockImplementationOnce(() => { throw new Error('DB down'); });
      await expect(service.cancelFollowups('u1')).resolves.not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[NovaFollowup] Error cancelling follow-ups'), expect.any(Object));
    });
  });

  describe('3.3 checkAndFireFollowups', () => {
    it('should fire due follow-ups and mark them sent', async () => {
      mockChain.lte.mockResolvedValueOnce({ data: [{ id: 'fup-1', user_id: 'u1', conversation_id: 'c1', message: 'Hey' }] });
      mockChain.update.mockReturnValueOnce({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) });
      mockChain.maybeSingle.mockResolvedValueOnce({ data: { push_token: 'token-123' } });
      mockChain.insert.mockResolvedValueOnce({});

      await service.checkAndFireFollowups();

      expect(mockChain.update).toHaveBeenCalledWith({ status: 'sent' });
      expect(mockChain.insert).toHaveBeenCalled();
      expect(sendPushNotification).toHaveBeenCalled();
    });

    it('should do nothing when no follow-ups are due', async () => {
      mockChain.lte.mockResolvedValueOnce({ data: [] });
      await service.checkAndFireFollowups();
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Firing'));
    });
  });

  describe('3.4 Deduplication in _fireFollowup', () => {
    const followup = { id: 'fup-1', user_id: 'u1', conversation_id: 'c1', message: 'hey yaar kya chal raha hai bata na' };

    it('should block exact duplicate within 10 minutes', async () => {
      // Direct access cache or simulate 
      const dedupCache = require('../NovaFollowupService').__get__?.('dedupCache');
      if (!dedupCache) {
        // Fallback testing strategy if unexported
        await (service as any)._fireFollowup(followup); // First time inserts
        mockChain.insert.mockClear();
        await (service as any)._fireFollowup(followup); // Second time blocked
        expect(mockChain.insert).not.toHaveBeenCalled();
      } else {
        dedupCache.set('u1', { lastContent: 'hey yaar kya chal raha hai bata na', lastSentAt: Date.now() });
        await (service as any)._fireFollowup(followup);
        expect(mockChain.insert).not.toHaveBeenCalled();
      }
    });

    it('should block substring duplicate (first 20 chars match)', async () => {
      await (service as any)._fireFollowup({ ...followup, message: 'hey yaar kya chal raha hai' }); // Set cache
      mockChain.insert.mockClear();
      
      await (service as any)._fireFollowup(followup); // Try sending longer message with same 20 char prefix
      expect(mockChain.insert).not.toHaveBeenCalled(); // Blocked by substring match
    });

    it('should allow same message after 10 minutes', async () => {
      await (service as any)._fireFollowup(followup);
      mockChain.insert.mockClear();

      jest.advanceTimersByTime(11 * 60 * 1000);
      
      await (service as any)._fireFollowup(followup);
      expect(mockChain.insert).toHaveBeenCalled();
    });

    it('should normalize messages to lowercase for dedupe', async () => {
      await (service as any)._fireFollowup(followup); // sets lowercase in cache
      mockChain.insert.mockClear();

      const uppercaseFollowup = { ...followup, message: 'HEY YAAR KYA CHAL RAHA HAI BATA NA' };
      await (service as any)._fireFollowup(uppercaseFollowup);
      
      // Should be blocked because it's normalized
      expect(mockChain.insert).not.toHaveBeenCalled();
    });
  });

  describe('3.5 checkUnansweredConversations', () => {
    it('should detect serious signals and schedule quick follow-up', async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
      
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            ...mockChain,
            order: jest.fn().mockResolvedValueOnce({ data: [{ id: 'msg1', user_id: 'u1', conversation_id: 'c1', content: 'I am so stressed about my exam', created_at: fiveMinAgo, role: 'user' }] }),
            limit: jest.fn().mockResolvedValue({ data: [] })
          };
        }
        if (table === 'nova_followups') {
          return {
             ...mockChain,
             limit: jest.fn().mockResolvedValue({ data: [] })
          }
        }
        return mockChain;
      });

      await service.checkUnansweredConversations();

      expect(novaBrain.evaluateConsciousnessTier2).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Detected stuck conversation'), expect.any(Object));
    });

    it('should skip conversations where Nova already replied', async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            ...mockChain,
            order: jest.fn().mockResolvedValueOnce({ data: [{ id: 'msg1', user_id: 'u1', conversation_id: 'c1', content: 'I am so stressed about my exam', created_at: fiveMinAgo, role: 'user' }] }),
            limit: jest.fn().mockResolvedValue({ data: [{ id: 'reply-1' }] }) // Nova replied!
          };
        }
        return mockChain;
      });

      await service.checkUnansweredConversations();
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Detected stuck conversation'), expect.any(Object));
    });

    it('should skip if a follow-up was recently sent', async () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            ...mockChain,
            order: jest.fn().mockResolvedValueOnce({ data: [{ id: 'msg1', user_id: 'u1', conversation_id: 'c1', content: 'I am so stressed about my exam', created_at: fiveMinAgo, role: 'user' }] }),
            limit: jest.fn().mockResolvedValue({ data: [] })
          };
        }
        if (table === 'nova_followups') {
          return {
            ...mockChain,
            limit: jest.fn().mockResolvedValue({ data: [{ id: 'recent-fup' }] })
          }
        }
        return mockChain;
      });

      await service.checkUnansweredConversations();
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Detected stuck conversation'), expect.any(Object));
    });
  });
});
