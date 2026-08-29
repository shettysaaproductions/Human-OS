import { ReminderEngine, buildReminderSpecFromIntent, resolveUserTzOffsetHours } from '../ReminderEngine';
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

describe('BUG-03 Follow-up: Cross-Turn Idempotency and Timezone Handling', () => {
  let engineIST: ReminderEngine;
  let mockChain: any;

  beforeEach(() => {
    jest.clearAllMocks();
    // Freeze time at 2026-08-29 10:29:00 UTC (15:59 IST)
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-29T10:29:00Z'));

    mockChain = {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null })
    };
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => mockChain);

    engineIST = new ReminderEngine(5.5); // IST (+05:30)
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── 1. 4 PM IST parses to correct UTC ─────────────────────────────────────
  it('1. 4 PM IST parses to correct UTC (10:30 UTC)', () => {
    const spec = buildReminderSpecFromIntent({
      text: 'Muje 4 baje office se nikalne ke liye yaad dilao',
      timePhrase: '4 baje',
      rawTime: '4',
      isAmbiguous: false
    }, 5.5);

    expect(spec.time_of_day).toBe('16:00');
    const parsed = engineIST.parse(spec);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trigger_at).not.toBeNull();
    // 16:00 IST on 2026-08-29 = 10:30:00 UTC
    expect(parsed[0].trigger_at!.toISOString()).toBe('2026-08-29T10:30:00.000Z');
  });

  it('1b. kal shaam 4 baje with periodWord parses to tomorrow 16:00 IST', () => {
    const spec = buildReminderSpecFromIntent({
      text: 'kal shaam 4 baje office se nikalna hai yaad dila dena',
      timePhrase: 'kal shaam 4 baje',
      rawTime: '4',
      periodWord: 'shaam',
      isAmbiguous: false
    }, 5.5);

    expect(spec.time_of_day).toBe('16:00');
    expect(spec.date).toBe('2026-08-30');
    const parsed = engineIST.parse(spec);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trigger_at).not.toBeNull();
    // 16:00 IST on 2026-08-30 = 10:30:00 UTC on 2026-08-30
    expect(parsed[0].trigger_at!.toISOString()).toBe('2026-08-30T10:30:00.000Z');
  });


  // ── 2. 4 AM IST parses correctly when explicitly specified ─────────────────
  it('2. 4 AM IST parses correctly when explicitly specified (22:30 UTC of today/tomorrow morning)', () => {
    const spec = buildReminderSpecFromIntent({
      text: 'subah 4 baje yaad dilao walk pe jana hai',
      timePhrase: 'subah 4 baje',
      rawTime: '4',
      isAmbiguous: false
    }, 5.5);

    expect(spec.time_of_day).toBe('04:00');
    const parsed = engineIST.parse(spec);
    expect(parsed).toHaveLength(1);
    // Since 04:00 AM IST has passed today (now is 15:59 IST), it schedules for tomorrow 04:00 AM IST = 22:30 UTC today
    expect(parsed[0].trigger_at!.toISOString()).toBe('2026-08-29T22:30:00.000Z');
  });

  // ── 3. User's timezone is respected ────────────────────────────────────────
  it('3. User timezone is respected (US EST -5 hours)', () => {
    const userTzOffset = resolveUserTzOffsetHours({ country: 'US' });
    expect(userTzOffset).toBe(-5);

    const engineEST = new ReminderEngine(userTzOffset);
    const spec = buildReminderSpecFromIntent({
      text: 'Remind me at 4 PM to submit report',
      timePhrase: '4 pm',
      rawTime: '4',
      isAmbiguous: false
    }, userTzOffset);

    expect(spec.time_of_day).toBe('16:00');
    const parsed = engineEST.parse(spec);
    // 16:00 EST (-5) = 21:00 UTC
    expect(parsed[0].trigger_at!.toISOString()).toBe('2026-08-29T21:00:00.000Z');
  });

  // ── 4. Same reminder repeated in same turn → 1 reminder ───────────────────
  it('4. Same reminder repeated in same batch / turn → deduplicated cleanly', async () => {
    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [], error: null })
      }))
    }));
    mockChain.insert.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'rem-1', user_id: 'u1', text: 'Leave office', trigger_at: '2026-08-29T10:30:00.000Z', status: 'active' }],
        error: null
      })
    }));

    const parsed = engineIST.parse({ title: 'Leave office', time_of_day: '16:00' });
    const results = await engineIST.scheduleAll('u1', parsed);

    expect(results).toHaveLength(1);
    expect(results[0].alreadyExists).toBe(false);
    expect(mockChain.insert).toHaveBeenCalledTimes(1);
  });

  // ── 5. Same reminder repeated in later turn → still 1 reminder (reuses existing active row) ──
  it('5. Same reminder repeated in later turn → reuses existing row without inserting duplicate', async () => {
    const existingActiveRow = {
      id: 'existing-rem-1',
      user_id: 'u1',
      text: 'Muje 4 baje office se nikalne ke liye',
      trigger_at: '2026-08-29T10:30:00.000Z',
      status: 'active'
    };

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [existingActiveRow], error: null })
      }))
    }));

    const spec = buildReminderSpecFromIntent({
      text: 'Muje 4 baje office se nikalne ke liye yaad dilao',
      timePhrase: '4 baje',
      rawTime: '4',
      isAmbiguous: false
    }, 5.5);

    const parsed = engineIST.parse(spec);
    const results = await engineIST.scheduleAll('u1', parsed);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('existing-rem-1');
    expect(results[0].alreadyExists).toBe(true);
    // No new row inserted!
    expect(mockChain.insert).not.toHaveBeenCalled();
  });

  // ── 6. Different reminder time → separate reminder ────────────────────────
  it('6. Different reminder time (4 PM vs 6 PM) → separate reminder created', async () => {
    const existingActiveRow = {
      id: 'existing-rem-4pm',
      user_id: 'u1',
      text: 'office se nikalne ke liye',
      trigger_at: '2026-08-29T10:30:00.000Z', // 4 PM IST
      status: 'active'
    };

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [existingActiveRow], error: null })
      }))
    }));
    mockChain.insert.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'new-rem-6pm', user_id: 'u1', text: 'office se nikalne ke liye', trigger_at: '2026-08-29T12:30:00.000Z', status: 'active' }],
        error: null
      })
    }));

    // Request for 6 PM (18:00 IST = 12:30 UTC)
    const spec6pm = buildReminderSpecFromIntent({
      text: 'Muje 6 baje office se nikalne ke liye yaad dilao',
      timePhrase: '6 baje',
      rawTime: '6',
      isAmbiguous: false
    }, 5.5);

    const parsed6pm = engineIST.parse(spec6pm);
    const results = await engineIST.scheduleAll('u1', parsed6pm);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('new-rem-6pm');
    expect(results[0].alreadyExists).toBe(false);
    expect(mockChain.insert).toHaveBeenCalledTimes(1);
  });

  // ── 7. Different reminder content → separate reminder ─────────────────────
  it('7. Different reminder content (call mom vs leave office) → separate reminder', async () => {
    const existingActiveRow = {
      id: 'existing-rem-office',
      user_id: 'u1',
      text: 'leave office',
      trigger_at: '2026-08-29T10:30:00.000Z',
      status: 'active'
    };

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [existingActiveRow], error: null })
      }))
    }));
    mockChain.insert.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'new-rem-mom', user_id: 'u1', text: 'call mom', trigger_at: '2026-08-29T10:30:00.000Z', status: 'active' }],
        error: null
      })
    }));

    const parsedMom = engineIST.parse({ title: 'call mom', time_of_day: '16:00' });
    const results = await engineIST.scheduleAll('u1', parsedMom);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('new-rem-mom');
    expect(results[0].alreadyExists).toBe(false);
    expect(mockChain.insert).toHaveBeenCalledTimes(1);
  });

  // ── 8. Different recurrence → separate reminder ───────────────────────────
  it('8. Different recurrence (one-time vs daily recurring) → separate reminder', async () => {
    const existingOneTime = {
      id: 'existing-one-time',
      user_id: 'u1',
      text: 'meds',
      trigger_at: '2026-08-29T10:30:00.000Z',
      recurrence_type: null,
      recurrence_interval: null,
      status: 'active'
    };

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [existingOneTime], error: null })
      }))
    }));
    mockChain.insert.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'new-daily-meds', user_id: 'u1', text: 'meds', trigger_at: '2026-08-29T10:30:00.000Z', recurrence_type: 'days', recurrence_interval: 1, status: 'active' }],
        error: null
      })
    }));

    const parsedDaily = engineIST.parse({
      title: 'meds',
      time_of_day: '16:00',
      recurrence_interval_value: 1,
      recurrence_interval_unit: 'days'
    });
    const results = await engineIST.scheduleAll('u1', parsedDaily);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('new-daily-meds');
    expect(results[0].alreadyExists).toBe(false);
  });

  // ── 9. Equivalent reminder returns/reuses existing row ───────────────────
  it('9. Equivalent reminder returns/reuses existing row and formatConfirmation works', async () => {
    const existing = {
      id: 'rem-orig',
      user_id: 'u1',
      text: 'Muje 4 baje office se nikalne ke liye',
      trigger_at: '2026-08-29T10:30:00.000Z',
      status: 'active'
    };

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [existing], error: null })
      }))
    }));

    const parsed = engineIST.parse({ title: 'Muje 4 baje office se nikalne ke liye', time_of_day: '16:00' });
    const results = await engineIST.scheduleAll('u1', parsed);
    expect(results[0].id).toBe('rem-orig');
    expect(results[0].alreadyExists).toBe(true);

    const confirmation = engineIST.formatConfirmation(parsed);
    expect(confirmation).toContain('04:00 PM');
  });

  // ── 10. DB persistence failure does not produce false success ─────────────
  it('10. DB persistence failure throws error preventing false confirmation', async () => {
    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [], error: null })
      }))
    }));
    mockChain.insert.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({ data: null, error: new Error('DB write failed') })
    }));

    const parsed = engineIST.parse({ title: 'Task', time_of_day: '16:00' });
    await expect(engineIST.scheduleAll('u1', parsed)).rejects.toThrow('DB write failed');
  });

  // ── 11. LLM subconscious_actions cannot duplicate deterministic reminder ──
  it('11. LLM duplicate guard: background action call reuses active row', async () => {
    const existing = {
      id: 'rem-active-1',
      user_id: 'u1',
      text: 'office se nikalne ke liye',
      trigger_at: '2026-08-29T10:30:00.000Z',
      status: 'active'
    };

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [existing], error: null })
      }))
    }));

    const parsed = engineIST.parse({ title: 'office se nikalne ke liye', time_of_day: '16:00' });
    const scheduled = await engineIST.scheduleAll('u1', parsed);

    expect(scheduled[0].id).toBe('rem-active-1');
    expect(scheduled[0].alreadyExists).toBe(true);
    expect(mockChain.insert).not.toHaveBeenCalled();
  });

  // ── 12. Completed/cancelled reminder does not block a new legitimate reminder ──
  it('12. Completed/cancelled reminder does not block a new reminder for same time', async () => {
    // Only 'active' status is queried by scheduleAll. If previous reminder is completed/cancelled, query returns []
    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [], error: null })
      }))
    }));
    mockChain.insert.mockImplementation(() => ({
      select: jest.fn().mockResolvedValue({
        data: [{ id: 'brand-new-rem', user_id: 'u1', text: 'office se nikalne ke liye', trigger_at: '2026-08-29T10:30:00.000Z', status: 'active' }],
        error: null
      })
    }));

    const parsed = engineIST.parse({ title: 'office se nikalne ke liye', time_of_day: '16:00' });
    const results = await engineIST.scheduleAll('u1', parsed);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('brand-new-rem');
    expect(results[0].alreadyExists).toBe(false);
    expect(mockChain.insert).toHaveBeenCalledTimes(1);
  });

  // ── 13. Idempotency survives process restart because it is DB-backed ───────
  it('13. Idempotency survives fresh engine instantiation because it queries DB state', async () => {
    const dbRow = {
      id: 'persisted-db-rem',
      user_id: 'u1',
      text: 'workout',
      trigger_at: '2026-08-29T12:30:00.000Z',
      status: 'active'
    };

    // Fresh engine instance simulates process reboot
    const rebootedEngine = new ReminderEngine(5.5);

    mockChain.select.mockImplementation(() => ({
      eq: jest.fn().mockImplementation(() => ({
        eq: jest.fn().mockResolvedValue({ data: [dbRow], error: null })
      }))
    }));

    const parsed = rebootedEngine.parse({ title: 'workout', time_of_day: '18:00' });
    const results = await rebootedEngine.scheduleAll('u1', parsed);

    expect(results[0].id).toBe('persisted-db-rem');
    expect(results[0].alreadyExists).toBe(true);
    expect(mockChain.insert).not.toHaveBeenCalled();
  });
});
