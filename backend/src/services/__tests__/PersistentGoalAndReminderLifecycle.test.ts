import { goalProcessEngine } from '../GoalProcessEngine';
import { supabaseAdmin } from '../../lib/supabase';

// Mock Supabase admin
jest.mock('../../lib/supabase', () => {
  const mockFrom = jest.fn();
  return {
    supabaseAdmin: {
      from: mockFrom
    }
  };
});

describe('Persistent Goal and Reminder Lifecycle Test Suite', () => {
  const userId = 'user-test-777';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Autonomous Communication Channel Decisions', () => {
    test('explicit call preference chooses "call"', () => {
      expect(goalProcessEngine.determineCommunicationChannel('Call me tomorrow at 8am to wake up').channel).toBe('call');
      expect(goalProcessEngine.determineCommunicationChannel('Mujhe call karke yaad dilana').channel).toBe('call');
      expect(goalProcessEngine.determineCommunicationChannel('Phone karke bolna').channel).toBe('call');
    });

    test('explicit message preference chooses "message"', () => {
      expect(goalProcessEngine.determineCommunicationChannel('Just message me at 5pm').channel).toBe('message');
      expect(goalProcessEngine.determineCommunicationChannel('Sirf text karna, call mat karna').channel).toBe('message');
      expect(goalProcessEngine.determineCommunicationChannel('WhatsApp message bhej dena').channel).toBe('message');
    });

    test('autonomous urgency decision chooses "call" for wake-up, flights, and strict medical commitments', () => {
      expect(goalProcessEngine.determineCommunicationChannel('Wake me up at 6am tomorrow').channel).toBe('call');
      expect(goalProcessEngine.determineCommunicationChannel('Utha dena subah 5 baje').channel).toBe('call');
      expect(goalProcessEngine.determineCommunicationChannel('Remind me about my flight boarding at 7pm').channel).toBe('call');
      expect(goalProcessEngine.determineCommunicationChannel('Emergency meeting with board at 10am').channel).toBe('call');
    });

    test('ordinary non-urgent reminders default to "message"', () => {
      expect(goalProcessEngine.determineCommunicationChannel('Remind me to buy groceries').channel).toBe('message');
      expect(goalProcessEngine.determineCommunicationChannel('Evening me book read karna hai').channel).toBe('message');
    });
  });

  describe('2. Semantic Deduplication & In-Place Modification', () => {
    test('updates existing reminder time in-place without creating a duplicate', async () => {
      const activeReminder = {
        id: 'rem-101',
        user_id: userId,
        text: 'Drink water and walk',
        trigger_at: '2026-09-17T08:00:00.000Z',
        status: 'active',
        notes: JSON.stringify({ lifecycleState: 'SCHEDULED', communicationMode: 'message' })
      };

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({
            data: [activeReminder],
            error: null
          })
        })
      });

      const mockUpdate = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { ...activeReminder, trigger_at: '2026-09-17T09:00:00.000Z' },
              error: null
            })
          })
        })
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        update: mockUpdate
      });

      const newTime = new Date('2026-09-17T09:00:00.000Z');
      const result = await goalProcessEngine.evaluateExistingReminder(
        userId,
        'Actually make that 9 to drink water and walk',
        newTime
      );

      expect(result.isModification).toBe(true);
      expect(result.action).toBe('time_updated');
      expect(mockUpdate).toHaveBeenCalled();
    });

    test('updates communication channel preference in-place when requested', async () => {
      const activeReminder = {
        id: 'rem-102',
        user_id: userId,
        text: 'Submit tax return',
        trigger_at: '2026-09-17T12:00:00.000Z',
        status: 'active',
        notes: JSON.stringify({ lifecycleState: 'SCHEDULED', communicationMode: 'message' })
      };

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({
            data: [activeReminder],
            error: null
          })
        })
      });

      const mockUpdate = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: activeReminder,
              error: null
            })
          })
        })
      });

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: mockSelect,
        update: mockUpdate
      });

      const result = await goalProcessEngine.evaluateExistingReminder(
        userId,
        'Actually call me instead for submit tax return',
        undefined,
        undefined,
        'call'
      );

      expect(result.isModification).toBe(true);
      expect(result.action).toBe('channel_updated');
    });

    test('detects exact duplicate within ±15 minutes and avoids duplicate scheduling', async () => {
      const activeReminder = {
        id: 'rem-103',
        user_id: userId,
        text: 'Dentist appointment',
        trigger_at: '2026-09-17T15:00:00.000Z',
        status: 'active',
        notes: JSON.stringify({ lifecycleState: 'SCHEDULED' })
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockResolvedValue({
              data: [activeReminder],
              error: null
            })
          })
        })
      });

      const targetTime = new Date('2026-09-17T15:05:00.000Z'); // 5 mins difference
      const result = await goalProcessEngine.evaluateExistingReminder(
        userId,
        'Dentist appointment reminder',
        targetTime
      );

      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe('reused');
    });
  });

  describe('3. Persistent State Machine Transitions', () => {
    test('DISPATCHED_MESSAGE advances lifecycle to AWAITING_ACKNOWLEDGEMENT', async () => {
      const reminder = {
        id: 'rem-201',
        user_id: userId,
        text: 'Review pull request',
        status: 'active',
        notes: JSON.stringify({ lifecycleState: 'SCHEDULED', followUpCount: 0 })
      };

      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: reminder, error: null })
          })
        }),
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: reminder, error: null })
            })
          })
        })
      });

      const res = await goalProcessEngine.advanceLifecycle('rem-201', 'DISPATCHED_MESSAGE');
      expect(res.success).toBe(true);
      expect(res.newState).toBe('AWAITING_ACKNOWLEDGEMENT');
    });

    test('ESCALATED switches communicationMode to call and records escalation timestamp', async () => {
      const reminder = {
        id: 'rem-202',
        user_id: userId,
        text: 'Wake up flight',
        status: 'active',
        notes: JSON.stringify({ lifecycleState: 'FOLLOW_UP', followUpCount: 1, communicationMode: 'message' })
      };

      let capturedNotes: any = null;
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: reminder, error: null })
          })
        }),
        update: jest.fn().mockImplementation((payload) => {
          capturedNotes = JSON.parse(payload.notes);
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: reminder, error: null })
              })
            })
          };
        })
      });

      const res = await goalProcessEngine.advanceLifecycle('rem-202', 'ESCALATED');
      expect(res.success).toBe(true);
      expect(res.newState).toBe('ESCALATED');
      expect(capturedNotes.communicationMode).toBe('call');
      expect(capturedNotes.followUpCount).toBe(2);
    });

    test('USER_ACKNOWLEDGED transitions to COMPLETED and records resolution', async () => {
      const reminder = {
        id: 'rem-203',
        user_id: userId,
        text: 'Drink morning water',
        status: 'active',
        notes: JSON.stringify({ lifecycleState: 'AWAITING_ACKNOWLEDGEMENT' })
      };

      let capturedStatus: string = '';
      (supabaseAdmin.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: reminder, error: null })
          })
        }),
        update: jest.fn().mockImplementation((payload) => {
          capturedStatus = payload.status;
          return {
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: reminder, error: null })
              })
            })
          };
        })
      });

      const res = await goalProcessEngine.advanceLifecycle('rem-203', 'USER_ACKNOWLEDGED');
      expect(res.success).toBe(true);
      expect(res.newState).toBe('COMPLETED');
      expect(capturedStatus).toBe('completed');
    });
  });
});
