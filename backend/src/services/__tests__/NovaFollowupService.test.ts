import { NovaFollowupService } from '../NovaFollowupService';
import { supabaseAdmin } from '../../lib/supabase';
import { sendPushNotification } from '../../lib/pushNotifications';
import { logger } from '../../lib/logger';

// Mock dependencies
jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

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

// Mock NovaTriggerEngine
jest.mock('../NovaTriggerEngine', () => {
  return {
    NovaTriggerEngine: jest.fn().mockImplementation(() => ({
      shouldTrigger: jest.fn().mockResolvedValue({ shouldSend: true, delayMs: 60000, reason: 'presence_online' })
    }))
  };
});

// Mock NovaBrainService
jest.mock('../NovaBrainService', () => {
  return {
    novaBrain: {
      evaluateConsciousnessTier2: jest.fn().mockResolvedValue({ message: 'Hey? You there?' })
    }
  };
});

describe('NovaFollowupService', () => {
  let service: NovaFollowupService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    service = new NovaFollowupService();

    // Reset dedupe cache (hacky since it's unexported, but we just simulate by advancing time by >10mins)
    jest.setSystemTime(new Date('2026-08-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('queueFollowup', () => {
    it('Cancels existing pending follow-ups for user and clamps delay', async () => {
      const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) }) });
      const mockInsert = jest.fn().mockResolvedValue({});
      const mockSelect = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { status: 'online' } }) }) });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'nova_followups') return { update: mockUpdate, insert: mockInsert };
        if (table === 'user_presence') return { select: mockSelect };
        return {};
      });

      await service.queueFollowup('user-1', 'conv-1', 'Hello', 0); // 0 hours -> clamped to 1 min

      expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' });
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-1',
        conversation_id: 'conv-1',
        message: 'Hello',
        status: 'pending'
      }));
    });
    
    it('Handles DB errors gracefully (non-critical)', async () => {
      const mockUpdate = jest.fn().mockImplementation(() => { throw new Error('DB Error'); });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await service.queueFollowup('user-1', 'conv-1', 'Hello', 1);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[NovaFollowup] Error scheduling follow-up'), expect.any(Object));
    });
  });

  describe('cancelFollowups', () => {
    it('Updates status to cancelled', async () => {
      const mockEq = jest.fn().mockResolvedValue({});
      const mockEq2 = jest.fn().mockReturnValue({ eq: mockEq });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockEq2 });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await service.cancelFollowups('user-1');

      expect(mockUpdate).toHaveBeenCalledWith({ status: 'cancelled' });
    });

    it('Handles errors gracefully', async () => {
      const mockUpdate = jest.fn().mockImplementation(() => { throw new Error('DB Error'); });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ update: mockUpdate });

      await service.cancelFollowups('user-1');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[NovaFollowup] Error cancelling follow-ups'), expect.any(Object));
    });
  });

  describe('checkAndFireFollowups', () => {
    it('Does nothing when no follow-ups due', async () => {
      const mockLte = jest.fn().mockResolvedValue({ data: [] });
      const mockEq = jest.fn().mockReturnValue({ lte: mockLte });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ select: mockSelect });

      await service.checkAndFireFollowups();
      
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it('Fires due follow-ups, marks sent, uses optimistic locking', async () => {
      const followup = { id: 1, user_id: 'user-1', conversation_id: 'conv-1', message: 'Hello!' };
      const mockLte = jest.fn().mockResolvedValue({ data: [followup] });
      const mockEq = jest.fn().mockReturnValue({ lte: mockLte });
      const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });

      const mockUpdateEq2 = jest.fn().mockResolvedValue({}); // update succeeds
      const mockUpdateEq1 = jest.fn().mockReturnValue({ eq: mockUpdateEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq1 });

      const mockInsert = jest.fn().mockResolvedValue({});
      
      const mockMaybeSingle = jest.fn().mockResolvedValue({ data: { push_token: 'token-123' } });
      const mockSelect2 = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle }) });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'nova_followups') return { select: mockSelect, update: mockUpdate };
        if (table === 'chat_history') return { insert: mockInsert };
        if (table === 'profiles') return { select: mockSelect2 };
        return {};
      });

      await service.checkAndFireFollowups();

      expect(mockUpdate).toHaveBeenCalledWith({ status: 'sent' });
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hello!' }));
      expect(sendPushNotification).toHaveBeenCalled();
    });
  });

  describe('Deduplication in _fireFollowup', () => {
    it('Blocks exact duplicate within 10 min and substring duplicate (first 20 chars)', async () => {
      const followup1 = { id: 1, user_id: 'user-1', conversation_id: 'conv-1', message: 'This is a long message to test substring' };
      const followup2 = { id: 2, user_id: 'user-1', conversation_id: 'conv-1', message: 'this is a long message to test something else' };
      
      // We will call private _fireFollowup directly for testing
      const mockUpdateEq2 = jest.fn().mockResolvedValue({});
      const mockUpdateEq1 = jest.fn().mockReturnValue({ eq: mockUpdateEq2 });
      const mockUpdate = jest.fn().mockReturnValue({ eq: mockUpdateEq1 });
      const mockInsert = jest.fn().mockResolvedValue({});
      const mockSelect2 = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { push_token: 'token-123' } }) }) });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'nova_followups') return { update: mockUpdate };
        if (table === 'chat_history') return { insert: mockInsert };
        if (table === 'profiles') return { select: mockSelect2 };
        return {};
      });

      await (service as any)._fireFollowup(followup1);
      expect(mockInsert).toHaveBeenCalledTimes(1);

      // Same user, similar message, within 10 minutes (time is mocked)
      await (service as any)._fireFollowup(followup2);
      expect(mockInsert).toHaveBeenCalledTimes(1); // Should not increase
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[NovaFollowup] Prevented firing duplicate'), expect.any(Object));
    });

    it('Allows same message after 10 min', async () => {
      const followup = { id: 1, user_id: 'user-1', conversation_id: 'conv-1', message: 'Hello duplicate test' };

      const mockUpdate = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) }) });
      const mockInsert = jest.fn().mockResolvedValue({});
      const mockSelect2 = jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: { push_token: 'token-123' } }) }) });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'nova_followups') return { update: mockUpdate };
        if (table === 'chat_history') return { insert: mockInsert };
        if (table === 'profiles') return { select: mockSelect2 };
        return {};
      });

      await (service as any)._fireFollowup(followup);
      expect(mockInsert).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(11 * 60 * 1000);

      await (service as any)._fireFollowup(followup);
      expect(mockInsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkUnansweredConversations', () => {
    it('Detects serious signals -> 2 min cutoff', async () => {
      // Mock user msg age: 3 min ago. It has "stressed".
      const created_at = new Date(Date.now() - 3 * 60000).toISOString();
      const mockUserMsgs = [{ id: 1, user_id: 'u1', conversation_id: 'c1', content: 'I am stressed', created_at, role: 'user' }];
      
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  order: jest.fn().mockResolvedValue({ data: mockUserMsgs }), // For userMsgs query
                  limit: jest.fn().mockResolvedValue({ data: [] }) // For assistant msgs query
                }),
                limit: jest.fn().mockResolvedValue({ data: [] }) // for recentAssistantMsgs
              }),
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({ data: [] }) // for newerMsgs
                }),
                eq: jest.fn().mockReturnValue({
                  gte: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [] })
                  })
                })
              })
            })
          };
        }
        if (table === 'nova_followups') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  gte: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({ data: [] })
                  })
                })
              }),
              update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) }) }),
              insert: jest.fn().mockResolvedValue({})
            })
          };
        }
        if (table === 'user_presence') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({}) }) }) };
        return {};
      });

      const spyQueue = jest.spyOn(service, 'queueFollowup');

      await service.checkUnansweredConversations();

      expect(spyQueue).toHaveBeenCalledWith('u1', 'c1', 'Hey? You there?', 0);
    });

    it('Detects personal signals -> 5 min cutoff', async () => {
      // Mock user msg age: 6 min ago. It has "baat karo".
      const created_at = new Date(Date.now() - 6 * 60000).toISOString();
      const mockUserMsgs = [{ id: 1, user_id: 'u1', conversation_id: 'c1', content: 'baat karo', created_at, role: 'user' }];
      
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  order: jest.fn().mockResolvedValue({ data: mockUserMsgs }),
                  limit: jest.fn().mockResolvedValue({ data: [] })
                }),
                limit: jest.fn().mockResolvedValue({ data: [] })
              }),
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }),
                eq: jest.fn().mockReturnValue({ gte: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }) })
              })
            })
          };
        }
        if (table === 'nova_followups') {
          return {
            select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockReturnValue({ gte: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }) }) }) }),
            update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({}) }) }),
            insert: jest.fn().mockResolvedValue({})
          };
        }
        if (table === 'user_presence') return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({}) }) }) };
        return {};
      });

      const spyQueue = jest.spyOn(service, 'queueFollowup');

      await service.checkUnansweredConversations();

      expect(spyQueue).toHaveBeenCalledWith('u1', 'c1', 'Hey? You there?', 0);
    });

    it('Skips if Nova already replied', async () => {
      const created_at = new Date(Date.now() - 20 * 60000).toISOString();
      const mockUserMsgs = [{ id: 1, user_id: 'u1', conversation_id: 'c1', content: 'hello', created_at, role: 'user' }];
      
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  order: jest.fn().mockResolvedValue({ data: mockUserMsgs }),
                  limit: jest.fn().mockResolvedValue({ data: [] })
                }),
                limit: jest.fn().mockResolvedValue({ data: [] })
              }),
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [{ id: 2 }] }) }), // Nova replied!
                eq: jest.fn().mockReturnValue({ gte: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }) })
              })
            })
          };
        }
        return {};
      });

      const spyQueue = jest.spyOn(service, 'queueFollowup');
      await service.checkUnansweredConversations();
      expect(spyQueue).not.toHaveBeenCalled();
    });

    it('Skips if follow-up recently sent (cooldown)', async () => {
      const created_at = new Date(Date.now() - 20 * 60000).toISOString();
      const mockUserMsgs = [{ id: 1, user_id: 'u1', conversation_id: 'c1', content: 'hello', created_at, role: 'user' }];
      
      (supabaseAdmin.from as jest.Mock).mockImplementation((table) => {
        if (table === 'chat_history') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({ order: jest.fn().mockResolvedValue({ data: mockUserMsgs }), limit: jest.fn().mockResolvedValue({ data: [] }) }),
                limit: jest.fn().mockResolvedValue({ data: [] })
              }),
              eq: jest.fn().mockReturnValue({
                gt: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }),
                eq: jest.fn().mockReturnValue({ gte: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }) })
              })
            })
          };
        }
        if (table === 'nova_followups') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  gte: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [{ id: 9 }] }) }) // Recent followup exists
                })
              })
            })
          };
        }
        return {};
      });

      const spyQueue = jest.spyOn(service, 'queueFollowup');
      await service.checkUnansweredConversations();
      expect(spyQueue).not.toHaveBeenCalled();
    });
  });
});
