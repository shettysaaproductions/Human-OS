import { reminderSchedulerService } from '../ReminderSchedulerService';
import { reminderIntentDetector } from '../ReminderIntentDetector';
import { TurnAnalyzer } from '../TurnAnalyzer';
import { supabaseAdmin } from '../../lib/supabase';

// Mock supabaseAdmin for cancellation tests
jest.mock('../../lib/supabase', () => {
  const mockFrom = jest.fn();
  return {
    supabaseAdmin: {
      from: mockFrom
    }
  };
});

describe('Goals and Reminders Subsystem Hardening Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. ReminderSchedulerService: calculateNextTrigger & applyDayMonthFilters', () => {
    test('calculateNextTrigger advances past-dated triggers forward until future', () => {
      // Setup a date 3 days in the past
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3600 * 1000);
      
      const nextTrigger = reminderSchedulerService.calculateNextTrigger(
        threeDaysAgo,
        'days',
        1,
        true // ensureFuture
      );

      expect(nextTrigger.getTime()).toBeGreaterThan(Date.now());
      // Preserves hour and minute
      expect(nextTrigger.getHours()).toBe(threeDaysAgo.getHours());
      expect(nextTrigger.getMinutes()).toBe(threeDaysAgo.getMinutes());
    });

    test('calculateNextTrigger handles minute intervals advancing past now', () => {
      const pastTime = new Date(Date.now() - 45 * 60 * 1000); // 45 mins ago
      const next = reminderSchedulerService.calculateNextTrigger(
        pastTime,
        'minutes',
        15,
        true
      );
      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    test('applyDayMonthFilters matches day of week taking timezone offset into account', () => {
      // Base date: Wednesday
      const base = new Date('2026-07-01T10:00:00.000Z');
      const filtered = reminderSchedulerService.applyDayMonthFilters(
        base,
        ['friday'],
        null,
        null,
        330 // IST
      );

      // Check that the resulting date in IST is Friday
      const localTimeMs = filtered.getTime() + 330 * 60 * 1000;
      const localDay = new Date(localTimeMs).getUTCDay();
      expect(localDay).toBe(5); // 5 = Friday
    });

    test('applyDayMonthFilters matches both active_days and active_months without clobbering', () => {
      const base = new Date('2026-01-15T14:00:00.000Z');
      const filtered = reminderSchedulerService.applyDayMonthFilters(
        base,
        ['monday'],
        ['march'],
        null,
        330
      );

      const localTimeMs = filtered.getTime() + 330 * 60 * 1000;
      const localDate = new Date(localTimeMs);
      expect(localDate.getUTCMonth()).toBe(2); // 2 = March (0-indexed)
      expect(localDate.getUTCDay()).toBe(1); // 1 = Monday
    });
  });

  describe('2. ReminderIntentDetector: Cancellation Detection & Execution', () => {
    test('detects English direct cancellation: "cancel my gym reminder"', () => {
      const intent = reminderIntentDetector.detectCancellationIntent('Please cancel my gym reminder');
      expect(intent).not.toBeNull();
      expect(intent?.isCancellation).toBe(true);
      expect(intent?.deleteAll).toBe(false);
      expect(intent?.taskQuery?.toLowerCase()).toContain('gym');
    });

    test('detects English bulk cancellation: "cancel all my reminders"', () => {
      const intent = reminderIntentDetector.detectCancellationIntent('Cancel all my reminders');
      expect(intent).not.toBeNull();
      expect(intent?.isCancellation).toBe(true);
      expect(intent?.deleteAll).toBe(true);
    });

    test('detects Hinglish cancellation: "gym wala reminder cancel kar do"', () => {
      const intent = reminderIntentDetector.detectCancellationIntent('gym wala reminder cancel kar do');
      expect(intent).not.toBeNull();
      expect(intent?.isCancellation).toBe(true);
      expect(intent?.taskQuery?.toLowerCase()).toContain('gym');
    });

    test('detects Hinglish bulk cancellation: "sare reminders delete kar do"', () => {
      const intent = reminderIntentDetector.detectCancellationIntent('sare reminders delete kar do');
      expect(intent).not.toBeNull();
      expect(intent?.isCancellation).toBe(true);
      expect(intent?.deleteAll).toBe(true);
    });

    test('shield: complaints about missed reminders are NOT cancellations', () => {
      const intent = reminderIntentDetector.detectCancellationIntent('tune mujhe remind kyu nahi kiya');
      expect(intent).toBeNull();
    });

    test('detectAndCancelReminders executes database cancellation for matching reminders', async () => {
      const mockReminders = [
        { id: 'rem-1', text: 'Go to gym workout', status: 'active' },
        { id: 'rem-2', text: 'Drink water', status: 'active' }
      ];

      const mockSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: mockReminders, error: null })
        })
      });

      const mockUpdate = jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ error: null })
      });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'reminders') {
          return {
            select: mockSelect,
            update: mockUpdate
          };
        }
        return {};
      });

      const res = await reminderIntentDetector.detectAndCancelReminders('user-123', 'gym wala reminder cancel kar do');
      expect(res.cancelled).toBe(true);
      expect(res.count).toBe(1);
      expect(res.cancelledReminders[0].id).toBe('rem-1');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });
  });

  describe('3. TurnAnalyzer: Deterministic Goal Extraction', () => {
    test('extracts Hinglish goal: "Mera goal hai ki agle 6 months me 10kg weight lose karna hai"', () => {
      const turn = TurnAnalyzer.analyze([
        { message: 'Mera goal hai ki agle 6 months me 10kg weight lose karna hai' }
      ]);

      const goalFact = turn.units.find(u => u.factKey === 'goals');
      expect(goalFact).toBeDefined();
      expect(goalFact?.factValue?.toLowerCase()).toContain('weight lose');
      expect(goalFact?.isProtected).toBe(true);
      expect(goalFact?.factClass).toBe('PROTECTED_FACT');

      const dynamicGoal = turn.units.find(u => u.factKey?.startsWith('goal_'));
      expect(dynamicGoal).toBeDefined();
    });

    test('extracts English goal: "My primary goal is to launch my SaaS product by December"', () => {
      const turn = TurnAnalyzer.analyze([
        { message: 'My primary goal is to launch my SaaS product by December' }
      ]);

      const goalFact = turn.units.find(u => u.factKey === 'goals');
      expect(goalFact).toBeDefined();
      expect(goalFact?.factValue?.toLowerCase()).toContain('launch my saas');
    });

    test('extracts target ambition: "Target hai 50k monthly savings achieve karna"', () => {
      const turn = TurnAnalyzer.analyze([
        { message: 'Target hai 50k monthly savings achieve karna' }
      ]);

      const goalFact = turn.units.find(u => u.factKey === 'goals');
      expect(goalFact).toBeDefined();
      expect(goalFact?.factValue?.toLowerCase()).toContain('50k monthly savings');
    });

    test('extracts dream: "Mera dream hai ek cafe open karna"', () => {
      const turn = TurnAnalyzer.analyze([
        { message: 'Mera dream hai ek cafe open karna' }
      ]);

      const goalFact = turn.units.find(u => u.factKey === 'goals');
      expect(goalFact).toBeDefined();
      expect(goalFact?.factValue?.toLowerCase()).toContain('cafe open');
    });
  });
});
