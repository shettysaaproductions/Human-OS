import { NovaConsciousnessEngine } from '../NovaConsciousnessEngine';
import { supabaseAdmin } from '../../lib/supabase';
import { logger } from '../../lib/logger';
import { temporalAwarenessService } from '../TemporalAwarenessService';

jest.mock('../../lib/supabase', () => {
  const chainable = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null })
  };
  return { supabaseAdmin: { from: jest.fn(() => chainable) } };
});

jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

jest.mock('../TemporalAwarenessService', () => ({
  temporalAwarenessService: { getContext: jest.fn() }
}));

jest.mock('../NovaBrainService', () => ({
  novaBrain: { evaluateConsciousnessTier2: jest.fn() }
}));

describe('NovaConsciousnessEngine â€” sleep/busy lock respect', () => {
  let engine: NovaConsciousnessEngine;
  let mockChain: any;
  const realNow = Date.now();

  beforeEach(() => {
    jest.clearAllMocks();
    // Fresh chainable per test (see NovaFollowupService.test.ts â€” same pattern).
    (supabaseAdmin.from as jest.Mock).mockReset();
    mockChain = {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null })
    };
    (supabaseAdmin.from as jest.Mock).mockImplementation(() => mockChain);
    // Advance Date.now past the 30s server-boot cooldown so outreach is not
    // blocked by it (serverBootTime is captured at module load with real time).
    jest.spyOn(Date, 'now').mockReturnValue(realNow + 100000);
    engine = new NovaConsciousnessEngine();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aborts proactive outreach when the sleep/busy lock is active and no urgent agenda is due', async () => {
    // profiles.fetch â†’ has push_token
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { push_token: 'tok-123', preferred_name: 'x', timezone_offset: 330 } });
    // followup_suppressed_until â†’ in the future (user said good night)
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { value: new Date(realNow + 100000 + 8 * 3600 * 1000).toISOString() } });
    // nova_agenda high-urgency due check â†’ none due
    mockChain.limit.mockResolvedValueOnce({ data: [] });

    await (engine as any)._processUser('u1');

    // Reached the suppression guard and aborted BEFORE temporal context / outreach.
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('suppressed (sleep/busy lock)'), expect.any(Object));
    expect(temporalAwarenessService.getContext).not.toHaveBeenCalled();
  });

  it('does not abort when the lock is expired', async () => {
    // profiles.fetch â†’ has push_token
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { push_token: 'tok-123', preferred_name: 'x', timezone_offset: 330 } });
    // followup_suppressed_until â†’ in the PAST (lock expired)
    mockChain.maybeSingle.mockResolvedValueOnce({ data: { value: new Date(realNow + 100000 - 3600 * 1000).toISOString() } });

    // With no active lock the engine proceeds into the normal pipeline. Make the
    // temporal context resolve so it gets past the guard; the pipeline then hits
    // more queries, which return nulls and it returns cleanly.
    (temporalAwarenessService.getContext as jest.Mock).mockResolvedValue({
      isSleepWindow: false,
      timeOfDayLabel: 'evening',
      country: 'IN'
    });

    await (engine as any)._processUser('u1');

    // It must NOT have aborted at the suppression guard.
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('suppressed (sleep/busy lock)'), expect.any(Object));
  });
});

