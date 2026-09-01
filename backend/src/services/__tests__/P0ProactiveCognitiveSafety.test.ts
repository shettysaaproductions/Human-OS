import { proactiveGate } from '../ProactiveGate';
import { novaFollowupService } from '../NovaFollowupService';
import { backgroundActions } from '../BackgroundActionService';
import { supabaseAdmin } from '../../lib/supabase';
import { sendNovaReplyNotification } from '../../lib/pushNotifications';
import { Request, Response } from 'express';
import { authRouter } from '../../routes/auth';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
    })),
  }
}));

jest.mock('../../lib/pushNotifications', () => ({
  sendNovaReplyNotification: jest.fn().mockResolvedValue(undefined),
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}));

describe('P0 Proactive Cognitive Safety Remediation (Constraints A-T)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('P0-1 & P0-2: ProactiveGate Authorization at Fire Time', () => {
    it('should acquire gate with skipQuietHoursCheck: false and skipMinGapCheck: false', async () => {
      const acquireSpy = jest.spyOn(proactiveGate, 'acquire').mockResolvedValue({
        allowed: false,
        blockedBy: 'quiet_hours',
        detail: 'In quiet hours',
        outreachId: 'mock-id'
      });
      
      const mockFollowup = {
        id: 'f-123',
        user_id: 'u-123',
        conversation_id: 'c-123',
        message: 'Hello',
        status: 'pending',
        created_at: new Date(Date.now() - 300000).toISOString()
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }), // No recent user msg, no tz offset
        };
      });

      // We access the private method via any
      await (novaFollowupService as any)._fireFollowup(mockFollowup);
      
      expect(acquireSpy).toHaveBeenCalledWith('u-123', expect.objectContaining({
        outreachType: 'proactive',
        logicalKey: 'followup:fired:f-123',
        skipQuietHoursCheck: false,
        skipMinGapCheck: false,
      }));
    });
  });

  describe('P0-3: Active Conversation Debounce', () => {
    it('should cancel followup if user sent a message after followup creation', async () => {
      const mockFollowup = {
        id: 'f-123',
        user_id: 'u-123',
        conversation_id: 'c-123',
        message: 'Hello',
        status: 'pending',
        created_at: new Date(Date.now() - 300000).toISOString()
      };

      const updateMock = jest.fn().mockReturnThis();

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'chat_history') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: {
                id: 'msg-2',
                created_at: new Date(Date.now() - 100000).toISOString() // Newer than followup
              }
            }),
          };
        }
        if (table === 'nova_followups') {
          return {
            update: updateMock,
            eq: jest.fn().mockReturnThis(),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        };
      });

      await (novaFollowupService as any)._fireFollowup(mockFollowup);
      
      expect(updateMock).toHaveBeenCalledWith({ status: 'cancelled' });
    });
  });

  describe('P0-5 & P0-10: Provenance Check (Source Authority)', () => {
    it('should reject background actions originating from assistant', async () => {
      const actions = [{
        tool: 'WorkingMemory',
        action: 'set',
        data: {
          key: 'test',
          value: 'value',
          source_role: 'assistant',
          source_message_id: 'm-123',
          conversation_id: 'c-123'
        }
      }];

      const upsertMock = jest.fn();
      (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
        upsert: upsertMock
      }));

      await backgroundActions.processActions('u-123', 'c-123', actions, 'IN');
      
      expect(upsertMock).not.toHaveBeenCalled();
    });

    it('should process background actions originating from user', async () => {
      const actions = [{
        tool: 'WorkingMemory',
        action: 'set',
        data: {
          key: 'test',
          value: 'value',
          source_role: 'user',
          source_message_id: 'm-123',
          conversation_id: 'c-123'
        }
      }];

      const upsertMock = jest.fn();
      (supabaseAdmin.from as jest.Mock).mockImplementation(() => ({
        upsert: upsertMock
      }));

      await backgroundActions.processActions('u-123', 'c-123', actions, 'IN');
      
      expect(upsertMock).toHaveBeenCalled();
    });
  });
});
