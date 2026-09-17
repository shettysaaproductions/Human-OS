import { autonomousGoalResolverService } from '../AutonomousGoalResolverService';
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

describe('AutonomousGoalResolverService Test Suite', () => {
  const userId = 'user-12345';
  const testUuid = '6458376a-67e3-4e2b-aff6-de6625f67d84';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Prefix Stripping & UUID Normalization', () => {
    test('correctly normalizes thread- prefixed identifiers', () => {
      const input = `thread-${testUuid}`;
      const normalized = autonomousGoalResolverService.normalizeIdentifier(input);
      expect(normalized.strippedId).toBe(testUuid);
      expect(normalized.isValidUuid).toBe(true);
      expect(normalized.prefixHint).toBe('life_threads');
    });

    test('correctly normalizes mem-goal- prefixed identifiers with trailing indices', () => {
      const input = `mem-goal-${testUuid}-3`;
      const normalized = autonomousGoalResolverService.normalizeIdentifier(input);
      expect(normalized.strippedId).toBe(testUuid);
      expect(normalized.isValidUuid).toBe(true);
      expect(normalized.prefixHint).toBe('memories');
    });

    test('correctly normalizes reminder- and kg- prefixes', () => {
      expect(autonomousGoalResolverService.normalizeIdentifier(`reminder-${testUuid}`).strippedId).toBe(testUuid);
      expect(autonomousGoalResolverService.normalizeIdentifier(`kg-${testUuid}`).strippedId).toBe(testUuid);
    });

    test('returns original string if not a prefixed UUID', () => {
      expect(autonomousGoalResolverService.normalizeIdentifier('hiring-top-engineers').strippedId).toBe('hiring-top-engineers');
    });
  });

  describe('2. Conversational Goal Action Intent Detection', () => {
    test('detects goal deletion requests in English and Hinglish', () => {
      const t1 = autonomousGoalResolverService.detectGoalActionIntent('Delete the hiring new office members goal');
      expect(t1.detected).toBe(true);
      expect(t1.action).toBe('delete');
      expect(t1.titleHint?.toLowerCase()).toContain('hiring new office members');

      const t2 = autonomousGoalResolverService.detectGoalActionIntent('Hiring goal ko delete kar do');
      expect(t2.detected).toBe(true);
      expect(t2.action).toBe('delete');
      expect(t2.titleHint?.toLowerCase()).toContain('hiring');
    });

    test('detects goal completion requests', () => {
      const res = autonomousGoalResolverService.detectGoalActionIntent('Mark my fitness goal as completed');
      expect(res.detected).toBe(true);
      expect(res.action).toBe('complete');
      expect(res.titleHint?.toLowerCase()).toContain('fitness');
    });

    test('detects goal archive requests', () => {
      const res = autonomousGoalResolverService.detectGoalActionIntent('Archive the wedding planning goal');
      expect(res.detected).toBe(true);
      expect(res.action).toBe('archive');
      expect(res.titleHint?.toLowerCase()).toContain('wedding planning');
    });

    test('ignores non-goal conversations', () => {
      const res = autonomousGoalResolverService.detectGoalActionIntent('Hey Nova, how is the weather today in Mumbai?');
      expect(res.detected).toBe(false);
    });
  });

  describe('3. Multi-Tier Resolution & Safe Deletion/Archiving', () => {
    test('deletes life_thread goal when raw ID has "thread-" prefix', async () => {
      const rawPrefixedId = `thread-${testUuid}`;

      // Mock life_threads query finding the row by normalized UUID
      const mockEqUserId = jest.fn().mockReturnThis();
      const mockEqId = jest.fn().mockResolvedValue({
        data: [{ id: testUuid, topic: 'Hiring New Office Members', state: 'active' }],
        error: null
      });

      const mockDeleteEqUserId = jest.fn().mockReturnThis();
      const mockDeleteEqId = jest.fn().mockResolvedValue({ error: null });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'life_threads') {
          return {
            select: jest.fn().mockReturnValue({
              eq: (field: string, val: any) => {
                if (field === 'user_id') return { eq: mockEqId };
                return { eq: mockEqId };
              }
            }),
            delete: jest.fn().mockReturnValue({
              eq: (field: string, val: any) => {
                if (field === 'user_id') return { eq: mockDeleteEqId };
                return { eq: mockDeleteEqId };
              }
            })
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        };
      });

      const result = await autonomousGoalResolverService.deleteOrArchiveGoal(userId, rawPrefixedId, 'Hiring New Office Members');
      expect(result.success).toBe(true);
      expect(result.targetTitle).toBe('Hiring New Office Members');
    });

    test('reconciles stale client state without throwing 404 when goal already removed', async () => {
      // Mock all tables returning empty data
      (supabaseAdmin.from as jest.Mock).mockImplementation(() => {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null }),
              ilike: jest.fn().mockResolvedValue({ data: [], error: null })
            }),
            ilike: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        };
      });

      const result = await autonomousGoalResolverService.deleteOrArchiveGoal(userId, 'stale-or-orphaned-id', 'Obsolete Project Goal');
      // Must not throw or return 404; must reconcile smoothly
      expect(result.success).toBe(true);
      expect(result.reconciled).toBe(true);
      expect(result.message).toContain('reconciled');
    });
  });
});
