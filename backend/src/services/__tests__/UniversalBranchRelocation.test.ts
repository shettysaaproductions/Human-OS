import { universalBranchRelocationService } from '../UniversalBranchRelocationService';
import { supabaseAdmin } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn()
  }
}));

jest.mock('../../routes/analytics', () => ({
  invalidateAnalyticsCache: jest.fn()
}));

describe('Universal Branch Relocation Service & Confirmation Protocol Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Relocation Intent Detection & Pattern Recognition', () => {
    it('detects user exact short film character revelation with antecedent', async () => {
      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({
                  data: [{ id: 'mem-1', key: 'friend_ramesh', value: 'Ramesh is a friend', memory_type: 'family' }]
                })
              })
            })
          };
        }
        if (table === 'reminders') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                neq: jest.fn().mockReturnValue({
                  neq: jest.fn().mockResolvedValue({ data: [] })
                })
              })
            })
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const input = 'the one i was talking about was not my friend he was my character of a project on which I am working on to create a short film';
      const recentMessages = [
        { role: 'user', content: 'Ramesh ke baare mein baat kar raha tha' },
        { role: 'assistant', content: 'Acha, Ramesh tumhara dost hai?' }
      ];

      const detected = await universalBranchRelocationService.detectRelocationIntent('user-1', input, recentMessages);

      expect(detected).not.toBeNull();
      expect(detected?.entityName).toBe('Ramesh');
      expect(detected?.oldDomain).toBe('family');
      expect(detected?.newDomain).toBe('work');
      expect(detected?.newRelation).toContain('Short Film');
      expect(detected?.isFictionalOrCharacter).toBe(true);
    });

    it('detects named character revelation ("Ramesh is not my friend, he is a character in my short film project")', () => {
      const input = 'Ramesh was not my friend, he is my character of a project on which I am working on to create a short film';
      const detected = universalBranchRelocationService.detectRelocationIntentSync(input);

      expect(detected).not.toBeNull();
      expect(detected?.entityName).toBe('Ramesh');
      expect(detected?.oldDomain).toBe('family');
      expect(detected?.newDomain).toBe('work');
      expect(detected?.isFictionalOrCharacter).toBe(true);
    });

    it('detects pet revelation ("Simba is not a person, he is my pet dog")', () => {
      const input = 'Simba is not a person, he is my pet dog';
      const detected = universalBranchRelocationService.detectRelocationIntentSync(input);

      expect(detected).not.toBeNull();
      expect(detected?.entityName).toBe('Simba');
      expect(detected?.newDomain).toBe('family');
      expect(detected?.newRelation).toBe('Pet Dog');
      expect(detected?.isPetRevelation).toBe(true);
    });

    it('detects explicit move command ("move Ramesh from family to work and career")', () => {
      const input = 'move Ramesh from family to work and career';
      const detected = universalBranchRelocationService.detectRelocationIntentSync(input);

      expect(detected).not.toBeNull();
      expect(detected?.entityName).toBe('Ramesh');
      expect(detected?.oldDomain).toBe('family');
      expect(detected?.newDomain).toBe('work');
    });

    it('detects Hinglish shift command ("Ramesh bubble ko family se work me shift kar do")', () => {
      const input = 'Ramesh bubble ko family se work me shift kar do';
      const detected = universalBranchRelocationService.detectRelocationIntentSync(input);

      expect(detected).not.toBeNull();
      expect(detected?.entityName).toBe('Ramesh');
      expect(detected?.oldDomain).toBe('family');
      expect(detected?.newDomain).toBe('work');
    });

    it('returns null for unrelated chat messages', () => {
      expect(universalBranchRelocationService.detectRelocationIntentSync('Kal subah 9 baje gym jaana hai')).toBeNull();
      expect(universalBranchRelocationService.detectRelocationIntentSync('What is the weather today?')).toBeNull();
    });
  });

  describe('2. Confirmation Protocol Formulation & Doubt Explanation', () => {
    it('builds a proposal explaining doubt and asking confirmation for fictional character', async () => {
      // Mock Supabase memories query
      const mockMemories = [
        { id: 'mem-1', key: 'friend_ramesh', value: 'Ramesh is a friend', memory_type: 'family' },
        { id: 'mem-2', key: 'ramesh_role', value: 'Protagonist in draft', memory_type: 'family' },
        { id: 'mem-3', key: 'friend_ramesh_coffee', value: 'Likes black coffee', memory_type: 'family' }
      ];

      const mockReminders = [
        { id: 'rem-1', text: 'Call Ramesh regarding scene 3 dialogue', status: 'active', notes: null }
      ];

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: mockMemories })
              })
            })
          };
        }
        if (table === 'reminders') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                neq: jest.fn().mockReturnValue({
                  neq: jest.fn().mockResolvedValue({ data: mockReminders })
                })
              })
            })
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const detected = {
        entityName: 'Ramesh',
        oldDomain: 'family' as const,
        oldRelation: 'Friend',
        newDomain: 'work' as const,
        newRelation: 'Short Film Character (Project)',
        rawText: 'Ramesh is not my friend he is my character of short film project',
        isFictionalOrCharacter: true
      };

      const proposal = await universalBranchRelocationService.buildProposal('user-1', detected);

      expect(proposal.entityName).toBe('Ramesh');
      expect(proposal.stemsCount).toBe(2); // mem-2, mem-3 are stems
      expect(proposal.remindersCount).toBe(1);
      expect(proposal.doubtExplanation).toContain('Wait');
      expect(proposal.doubtExplanation).toContain('earlier I thought Ramesh was under Family & Relationships as a Friend');
      expect(proposal.doubtExplanation).toContain('fictional character for your project');
      expect(proposal.doubtExplanation).toContain('Career & Professional');
      expect(proposal.doubtExplanation).toContain('Are you sure?');
    });
  });

  describe('3. Affirmative & Negative Response Evaluator', () => {
    it('correctly identifies affirmative user confirmations', () => {
      expect(universalBranchRelocationService.isAffirmativeResponse('haan')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('yes')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('ha')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('sure')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('pakka')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('kardo')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('kar do')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('sahi hai')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('bilkul')).toBe(true);
      expect(universalBranchRelocationService.isAffirmativeResponse('yup, shift kar do')).toBe(true);
    });

    it('correctly identifies rejections and cancellations', () => {
      expect(universalBranchRelocationService.isNegativeResponse('nahi')).toBe(true);
      expect(universalBranchRelocationService.isNegativeResponse('no')).toBe(true);
      expect(universalBranchRelocationService.isNegativeResponse('rehne do')).toBe(true);
      expect(universalBranchRelocationService.isNegativeResponse('mat karo')).toBe(true);
      expect(universalBranchRelocationService.isNegativeResponse('cancel')).toBe(true);
    });
  });

  describe('4. Execution of Branch Relocation', () => {
    it('moves root memory, reparents stems, updates reminders, and invalidates cache', async () => {
      const mockOldMemories = [
        { id: 'mem-root', key: 'friend_ramesh', memory_type: 'family' },
        { id: 'mem-stem-1', key: 'ramesh_role', memory_type: 'family' },
        { id: 'mem-stem-2', key: 'ramesh_scene', memory_type: 'family' }
      ];

      const updateMemoriesMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ error: null })
        })
      });

      const updateRemindersMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: null })
        })
      });

      const deleteWorkingMemoryMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          or: jest.fn().mockResolvedValue({ error: null }),
          eq: jest.fn().mockResolvedValue({ error: null })
        })
      });

      const createQueryBuilder = (resolvedData: any = []) => {
        const builder: any = {};
        builder.select = jest.fn().mockReturnValue(builder);
        builder.eq = jest.fn().mockReturnValue(builder);
        builder.neq = jest.fn().mockReturnValue(builder);
        builder.or = jest.fn().mockReturnValue(builder);
        builder.ilike = jest.fn().mockReturnValue(builder);
        builder.in = jest.fn().mockReturnValue(builder);
        builder.single = jest.fn().mockResolvedValue({ data: resolvedData[0] || null, error: null });
        builder.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        builder.update = updateMemoriesMock;
        builder.delete = deleteWorkingMemoryMock;
        builder.insert = jest.fn().mockResolvedValue({ error: null });
        builder.then = (resolve: any) => Promise.resolve({ data: resolvedData, error: null }).then(resolve);
        return builder;
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') {
          return createQueryBuilder(mockOldMemories);
        }
        if (table === 'reminders') {
          const remBuilder = createQueryBuilder([]);
          remBuilder.update = updateRemindersMock;
          return remBuilder;
        }
        if (table === 'working_memory') {
          const wmBuilder = createQueryBuilder([]);
          wmBuilder.delete = deleteWorkingMemoryMock;
          return wmBuilder;
        }
        return createQueryBuilder([]);
      });

      const proposal = {
        entityName: 'Ramesh',
        entitySlug: 'ramesh',
        oldDomain: 'family' as const,
        oldRelation: 'Friend',
        newDomain: 'work' as const,
        newRelation: 'Short Film Character (Project)',
        targetKey: 'character_ramesh',
        stemsCount: 2,
        stems: [
          { id: 'mem-stem-1', key: 'ramesh_role', value: 'Protagonist' },
          { id: 'mem-stem-2', key: 'ramesh_scene', value: 'Scene 3' }
        ],
        remindersCount: 1,
        reminders: [{ id: 'rem-1', text: 'Call Ramesh' }],
        doubtExplanation: 'Wait...',
        rawText: 'Ramesh is character of my project',
        createdAt: new Date().toISOString(),
        isFictionalOrCharacter: true
      };

      (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
        data: { moved_memory_count: 3, moved_reminder_count: 1, descendant_bubble_count: 0 },
        error: null,
      });

      const result = await universalBranchRelocationService.executeBranchRelocation('user-1', proposal);

      expect(result.success).toBe(true);
      expect(result.entityName).toBe('Ramesh');
      expect(result.oldDomain).toBe('family');
      expect(result.newDomain).toBe('work');
      expect(result.movedStemsCount).toBe(2);
      expect(result.movedRemindersCount).toBe(1);
    });
  });

  describe('5. Phantom Eradication', () => {
    it('eradicates phantom friend memory when user clarifies father is the only real entity', async () => {
      const mockMemories = [
        { id: 'mem-phantom', key: 'friend_suresh', value: 'Suresh is friend' },
        { id: 'mem-father', key: 'father_suresh', value: 'Suresh is father' }
      ];

      const updateMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockResolvedValue({ error: null })
        })
      });

      const deleteWorkingMemoryMock = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          ilike: jest.fn().mockResolvedValue({ error: null })
        })
      });

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ data: mockMemories })
              })
            }),
            update: updateMock
          };
        }
        if (table === 'working_memory') {
          return {
            delete: deleteWorkingMemoryMock
          };
        }
        return { select: jest.fn().mockReturnThis() };
      });

      const result = await universalBranchRelocationService.eradicatePhantomEntity('user-1', 'Suresh', 'friend', 'father');

      expect(result.eradicated).toBe(true);
      expect(result.count).toBe(1);
      expect(updateMock).toHaveBeenCalled();
    });
  });
});
