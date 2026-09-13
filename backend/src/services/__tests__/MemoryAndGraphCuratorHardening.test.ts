import { autonomousMemoryGraphCurator } from '../AutonomousMemoryGraphCuratorService';
import { entityResolutionService } from '../EntityResolutionService';
import { cognitiveContextService } from '../CognitiveContextService';
import { supabaseAdmin } from '../../lib/supabase';
import { cache } from '../../lib/cache';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn().mockResolvedValue('{"removals":[],"merges":[],"updates":[],"additions":[]}')
}));

jest.mock('../../lib/cache', () => ({
  cache: {
    invalidate: jest.fn(),
    get: jest.fn(),
    set: jest.fn()
  },
  CACHE_NS: {
    PROFILE: 'profile',
    WORKING_MEMORY: 'working_memory',
    COGNITIVE_CONTEXT: 'cognitive_context'
  }
}));

jest.mock('../../routes/analytics', () => ({
  invalidateAnalyticsCache: jest.fn()
}));

function createQueryBuilder(resolvedData: any) {
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockImplementation(() => Promise.resolve({ data: resolvedData[0] || null })),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    then: (resolve: any) => resolve({ data: resolvedData, error: null })
  };
  return builder;
}

describe('MemoryAndGraphCuratorHardening — Comprehensive Robustness Suite', () => {
  const userId = 'tenant-user-alpha-404';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Tenant Isolation on KG Edges & Nodes Deletion', () => {
    it('strictly enforces .eq("user_id", userId) when deleting edges of pruned phantom nodes', async () => {
      const edgeDeleteBuilder: any = {
        select: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: [], error: null })
      };

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') return createQueryBuilder([]);
        if (table === 'working_memory') return createQueryBuilder([]);
        if (table === 'kg_nodes') {
          return createQueryBuilder([
            { id: 'node-phantom-attr-1', user_id: userId, name: 'Date of Birth', attributes: {} }
          ]);
        }
        if (table === 'kg_edges') return edgeDeleteBuilder;
        if (table === 'chat_history') return createQueryBuilder([]);
        if (table === 'nova_correction_ledger') return createQueryBuilder([]);
        return createQueryBuilder([]);
      });

      await autonomousMemoryGraphCurator.curateUserMemoryGraph(userId, { force: true });

      // Verify that kg_edges deletion strictly scoped by user_id
      expect(edgeDeleteBuilder.eq).toHaveBeenCalledWith('user_id', userId);
    });
  });

  describe('2. Modern Diverse Lifestyles & Pet Entity Resolution', () => {
    it('correctly resolves pet dog entity with breed and pet entityType', () => {
      const result = entityResolutionService.resolveTurn('My dog Bruno is a Golden retriever.');
      
      expect(result.primarySubjectId).toBe('entity:pet_bruno');
      const bruno = result.entities.find(e => e.name.toLowerCase() === 'bruno');
      expect(bruno).toBeDefined();
      expect(bruno?.entityType).toBe('pet');
      expect(bruno?.relationToUser).toBe('dog');
      expect(bruno?.isDirectUserRelation).toBe(true);

      const breedFact = result.facts.find(f => f.predicate === 'breed');
      expect(breedFact).toBeDefined();
      expect(breedFact?.value).toBe('Golden retriever');
      expect(breedFact?.canonicalKey).toBe('entity:pet_bruno:breed');
    });

    it('correctly resolves romantic partner/girlfriend with interests', () => {
      const result = entityResolutionService.resolveTurn('My girlfriend Priya loves photography.');
      
      const priya = result.entities.find(e => e.name.toLowerCase() === 'priya');
      expect(priya).toBeDefined();
      expect(priya?.relationToUser).toBe('girlfriend');
      expect(priya?.isDirectUserRelation).toBe(true);

      const interestFact = result.facts.find(f => f.predicate === 'interest');
      expect(interestFact).toBeDefined();
      expect(interestFact?.value).toBe('Photography');
    });

    it('correctly resolves flatmate/roommate relationship and workplace', () => {
      const result = entityResolutionService.resolveTurn('My flatmate Rohan works at Google.');
      
      const rohan = result.entities.find(e => e.name.toLowerCase() === 'rohan');
      expect(rohan).toBeDefined();
      expect(rohan?.relationToUser).toBe('roommate');
      expect(rohan?.isDirectUserRelation).toBe(true);

      const workFact = result.facts.find(f => f.predicate === 'employer' || f.predicate === 'occupation');
      expect(workFact).toBeDefined();
      expect(workFact?.value).toBe('Google');
    });
  });

  describe('3. Generalized Dynamic Curation (No Hardcoded Fallbacks)', () => {
    it('dynamically respects custom infant birth date and computes age without Shreshth fallback', async () => {
      const mems = [
        { id: 'm1', key: 'son_name', value: 'Aarav', memory_type: 'family', confidence: 1.0, is_archived: false },
        { id: 'm2', key: 'son_birth_date', value: '1988', memory_type: 'family', confidence: 0.7, is_archived: false }
      ];
      const wms: any[] = [];
      const chats = [
        { content: 'Aarav was born on 10/11/2025' }
      ];

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') return createQueryBuilder(mems);
        if (table === 'working_memory') return createQueryBuilder(wms);
        if (table === 'kg_nodes') return createQueryBuilder([]);
        if (table === 'kg_edges') return createQueryBuilder([]);
        if (table === 'chat_history') return createQueryBuilder(chats);
        if (table === 'nova_correction_ledger') return createQueryBuilder([]);
        return createQueryBuilder([]);
      });

      const result = await autonomousMemoryGraphCurator.curateUserMemoryGraph(userId, { force: true });

      // Must NOT hallucinate "17/02/2026" or "Shreshth"
      const updateValues = result.details.updates.map(u => u.newValue);
      expect(updateValues).not.toContain('17/02/2026');
      expect(updateValues).toContain('10/11/2025');
    });

    it('dynamically harmonizes real name and nickname without hardcoded Tiku/Shreshth', async () => {
      const mems = [
        { id: 'm1', key: 'son_name', value: 'Golu', memory_type: 'family', confidence: 0.8, is_archived: false },
        { id: 'm2', key: 'son_nickname', value: 'Kabir', memory_type: 'family', confidence: 0.8, is_archived: false }
      ];
      const chats = [
        { content: 'Kabir ko pyaar se ghar pe Golu bulate hai' }
      ];

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') return createQueryBuilder(mems);
        if (table === 'working_memory') return createQueryBuilder([]);
        if (table === 'kg_nodes') return createQueryBuilder([]);
        if (table === 'kg_edges') return createQueryBuilder([]);
        if (table === 'chat_history') return createQueryBuilder(chats);
        if (table === 'nova_correction_ledger') return createQueryBuilder([]);
        return createQueryBuilder([]);
      });

      const result = await autonomousMemoryGraphCurator.curateUserMemoryGraph(userId, { force: true });

      const sonNameUpdate = result.details.updates.find(u => u.key === 'son_name');
      expect(sonNameUpdate?.newValue).toBe('Kabir');

      const sonNickUpdate = result.details.updates.find(u => u.key === 'son_nickname');
      expect(sonNickUpdate?.newValue).toBe('Golu');
    });
  });

  describe('4. CognitiveContext Conversational Antecedents for Modern Lifestyles', () => {
    it('tracks pets and partners as conversational antecedents for pronoun resolution', async () => {
      const mockDurableMemories = [
        { id: 'd1', key: 'pet_name', value: 'Bruno', memory_type: 'personal', importance: 90, confidence: 1.0 },
        { id: 'd2', key: 'girlfriend_name', value: 'Priya', memory_type: 'family', importance: 95, confidence: 1.0 }
      ];

      (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'memories') return createQueryBuilder(mockDurableMemories);
        if (table === 'working_memory') return createQueryBuilder([]);
        if (table === 'chat_history') return createQueryBuilder([]);
        if (table === 'chat_episodes') return createQueryBuilder([]);
        if (table === 'reminders') return createQueryBuilder([]);
        if (table === 'user_profiles') return createQueryBuilder([{ id: userId, timezone: 'Asia/Kolkata' }]);
        return createQueryBuilder([]);
      });

      const ctx = await cognitiveContextService.assembleContext({
        userId,
        currentMessage: 'How is she doing today?',
        recentMessages: []
      });

      // Confirm memories are retrieved and durable facts populated
      expect(ctx.memories.durableFacts.length).toBeGreaterThanOrEqual(2);
      const keys = ctx.memories.durableFacts.map(f => f.key);
      expect(keys).toContain('pet_name');
      expect(keys).toContain('girlfriend_name');
    });
  });
});
