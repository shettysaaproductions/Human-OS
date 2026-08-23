import { ReminderEngine } from '../ReminderEngine';
import { supabaseAdmin } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null })
  };
  return { supabaseAdmin: { from: jest.fn(() => chainable) } };
});

jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

describe('ReminderEngine â€” event triggers, purpose/urgency/end_condition, delete', () => {
  let engine: ReminderEngine;
  let mockChain: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    (supabaseAdmin.from as jest.Mock).mockReset();
    mockChain = {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null })
    };
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => mockChain);
    engine = new ReminderEngine(5.5);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('parse â€” event_trigger', () => {
    it('event-triggered reminder â†’ trigger_at null (no fixed time) + fields carried', () => {
      const parsed = engine.parse({
        title: 'Take medicine',
        event_trigger: 'wake_up',
        urgency: 'high',
        purpose: 'Health'
      });
      expect(parsed).toHaveLength(1);
      expect(parsed[0].trigger_at).toBeNull();
      expect(parsed[0].event_trigger).toBe('wake_up');
      expect(parsed[0].urgency).toBe('high');
      expect(parsed[0].purpose).toBe('Health');
    });

    it('time-based reminder keeps trigger_at and the new fields', () => {
      const parsed = engine.parse({
        title: 'Pay bills',
        date: '2026-08-28',
        time_of_day: '09:00',
        purpose: 'Financial responsibility',
        urgency: 'high',
        end_condition: 'until_date'
      });
      expect(parsed[0].trigger_at).not.toBeNull();
      expect(parsed[0].purpose).toBe('Financial responsibility');
      expect(parsed[0].urgency).toBe('high');
      expect(parsed[0].end_condition).toBe('until_date');
    });

    it('recurring time-based reminder still computes recurrence', () => {
      const parsed = engine.parse({
        title: 'Stand up',
        relative_value: 30,
        relative_unit: 'minutes',
        recurrence_interval_value: 30,
        recurrence_interval_unit: 'minutes',
        end_condition: 'until_cancelled'
      });
      expect(parsed[0].recurrence_type).toBe('minutes');
      expect(parsed[0].recurrence_interval).toBe(30);
      expect(parsed[0].end_condition).toBe('until_cancelled');
    });
  });

  describe('scheduleAll', () => {
    it('inserts an event-triggered reminder with trigger_at null + new columns', async () => {
      const parsed = engine.parse({ title: 'Drink water', event_trigger: 'wake_up' });
      await engine.scheduleAll('u1', parsed);
      const row = mockChain.insert.mock.calls[0][0][0];
      expect(row.trigger_at).toBeNull();
      expect(row.event_trigger).toBe('wake_up');
      expect(row.urgency).toBe('medium');          // default
      expect(row.end_condition).toBe('until_cancelled'); // default
      expect(row.status).toBe('active');
      expect(row.user_id).toBe('u1');
    });

    it('inserts a time-based reminder with provided urgency', async () => {
      const parsed = engine.parse({
        title: 'Pay bill',
        relative_value: 60,
        relative_unit: 'minutes',
        urgency: 'high',
        end_condition: 'until_cancelled'
      });
      await engine.scheduleAll('u1', parsed);
      const row = mockChain.insert.mock.calls[0][0][0];
      expect(row.trigger_at).toBeTruthy();
      expect(row.urgency).toBe('high');
    });
  });

  describe('delete', () => {
    it('cancels an active reminder scoped to the user and returns true', async () => {
      mockChain.select.mockResolvedValue({ data: [{ id: 'rem-1' }], error: null });
      const ok = await engine.delete('u1', 'rem-1');
      expect(ok).toBe(true);
      expect(mockChain.update).toHaveBeenCalledWith({ status: 'cancelled', updated_at: expect.any(String) });
      expect(mockChain.eq).toHaveBeenCalledWith('id', 'rem-1');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'u1');
      expect(mockChain.eq).toHaveBeenCalledWith('status', 'active');
    });

    it('returns false when no active reminder matched', async () => {
      mockChain.select.mockResolvedValue({ data: [], error: null });
      const ok = await engine.delete('u1', 'rem-999');
      expect(ok).toBe(false);
    });
  });

  describe('formatConfirmation', () => {
    it('event-triggered reminder â†’ friendly event message, no crash on null trigger_at', () => {
      const parsed = engine.parse({ title: 'Take meds', event_trigger: 'wake_up' });
      const msg = engine.formatConfirmation(parsed);
      expect(msg).toContain('wake_up');
      expect(msg).not.toContain('NaN');
    });

    it('time-based reminder â†’ normal confirmation', () => {
      const parsed = engine.parse({ title: 'Call mom', relative_value: 30, relative_unit: 'minutes' });
      const msg = engine.formatConfirmation(parsed);
      expect(msg).toContain('Call mom');
      expect(msg).not.toContain('NaN');
    });
  });
});

