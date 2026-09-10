import { proactiveGate } from '../ProactiveGate';
import { supabaseAdmin } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(),
    })),
  }
}));

jest.mock('../../lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

describe('Anti-Nagging Silence Respect & ProactiveGate Authorization', () => {
  const userId = 'u-test-silence';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. Strictly blocks non-reminder outreach when user has not replied to previous outreach (ignoredCount >= 1)', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }) // no suppression lock
        };
      }
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockImplementation((col) => {
            // Last user message 2 hours ago
            return Promise.resolve({ data: { created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() } });
          })
        };
      }
      if (table === 'nova_outreach_log') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          // 1 unreplied outreach sent 1 hour ago
          then: (resolve: any) => resolve({
            data: [{ id: 'out-1', created_at: new Date(Date.now() - 3600 * 1000).toISOString() }]
          })
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null })
      };
    });

    const result = await proactiveGate.acquire(userId, {
      outreachType: 'agenda_followup',
      logicalKey: 'nace:agenda:sakshi_hobby',
      skipQuietHoursCheck: true
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.blockedBy).toBe('unreplied_previous_outreach');
      expect(result.detail).toContain('Silence must be respected');
    }
  });

  it('2. Permits user-requested reminders even if previous message was unreplied', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'working_memory') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null })
        };
      }
      if (table === 'chat_history') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString() } })
        };
      }
      if (table === 'nova_outreach_log') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          not: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          then: (resolve: any) => resolve({
            data: [{ id: 'out-1', created_at: new Date(Date.now() - 3600 * 1000).toISOString() }]
          }),
          insert: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: 'rem-out-1' }, error: null })
        };
      }
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null })
      };
    });

    const result = await proactiveGate.acquire(userId, {
      outreachType: 'reminder',
      logicalKey: 'reminder:fire:rem-123',
      skipQuietHoursCheck: true,
      skipMinGapCheck: true
    });

    // Reminders are user-requested alarms, so they bypass unreplied_previous_outreach
    expect(result.allowed).toBe(true);
  });
});
