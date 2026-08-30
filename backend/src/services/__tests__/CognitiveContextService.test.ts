import { cognitiveContextService } from '../CognitiveContextService';
import { supabaseAdmin } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn()
  }
}));

describe('CognitiveContextService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function setupMocks(overrides: Record<string, any> = {}) {
    const defaultTables: Record<string, any> = {
      profiles: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            id: 'user-123',
            preferred_name: 'Sagar',
            country: 'IN',
            companion_personality: 'friendly',
            grammatical_gender: 'masculine'
          },
          error: null
        })
      },
      chat_history: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'm1', role: 'user', content: 'My sister is Neeta', created_at: new Date(Date.now() - 20000).toISOString() },
            { id: 'm2', role: 'assistant', content: 'Nice to know about Neeta!', created_at: new Date(Date.now() - 10000).toISOString() }
          ],
          error: null
        })
      },
      working_memory: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { key: 'schedule', value: 'Monday working 9am-6pm', updated_at: new Date().toISOString() }
          ],
          error: null
        })
      },
      memories: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'mem1', key: 'wife_name', value: 'Sakshi', memory_type: 'family', importance: 80, confidence: 0.95, updated_at: '2026-08-01T00:00:00Z', is_archived: false },
            { id: 'mem2', key: 'city', value: 'Dahisar', memory_type: 'location', importance: 70, confidence: 0.9, updated_at: '2026-08-10T00:00:00Z', is_archived: false },
            { id: 'mem3', key: 'guitar_goal', value: 'Learn fingerstyle guitar', memory_type: 'goals', importance: 90, confidence: 0.95, updated_at: '2026-08-15T00:00:00Z', is_archived: false }
          ],
          error: null
        })
      },
      short_term_memories: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'stm1', memory: 'Went to the grocery store', emotion: 'neutral', importance: 40, created_at: new Date().toISOString() }
          ],
          error: null
        })
      },
      user_presence: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { status: 'online', last_active_at: new Date().toISOString() },
          error: null
        })
      },
      life_threads: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'lt1', topic: 'Cloud Kitchen Launch', state: 'active', priority: 'high', provenance: 'User stated launch goal' }
          ],
          error: null
        })
      },
      nova_actions: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'act1', logical_key: 'finalize_location', title: 'Finalize Location', state: 'suggested', priority: 'high', execution_class: 'SAFE_AUTOMATIC', dependency_ids: [] },
            { id: 'act2', logical_key: 'finalize_pricing', title: 'Finalize Pricing', state: 'suggested', priority: 'medium', execution_class: 'SAFE_AUTOMATIC', dependency_ids: ['act1'] }
          ],
          error: null
        })
      },
      reminders: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'rem1', title: 'Call Rahul', trigger_at: new Date(Date.now() + 3600000).toISOString() }
          ],
          error: null
        })
      }
    };

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      const base = defaultTables[table] || {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
      };
      if (overrides[table]) return { ...base, ...overrides[table] };
      return base;
    });
  }

  test('A. Assembles Canonical Context with All Core Subsystems', async () => {
    setupMocks();
    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'I want to check on my cloud kitchen and wife Sakshi'
    });

    expect(ctx.user.id).toBe('user-123');
    expect(ctx.user.preferredName).toBe('Sagar');
    expect(ctx.temporal.tzLabel).toBe('IST');
    expect(ctx.presence.status).toBe('online');
    expect(ctx.memories.durableFacts.length).toBeGreaterThan(0);
    expect(ctx.memories.goals.length).toBe(1);
    expect(ctx.lifeThreads.active.length).toBe(1);
    expect(ctx.actions.active.length).toBe(2);
    expect(ctx.actions.nextBestAction?.logical_key).toBe('finalize_location');
    expect(ctx.metadata.degraded_sources.length).toBe(0);
  });

  test('B. Resolves Fact Conflict & Current vs Historical Semantics', async () => {
    const conflictMemories = [
      { id: 'mem1', key: 'wife_name', value: 'Sakshi', memory_type: 'family', importance: 80, confidence: 0.9, updated_at: '2026-08-01T00:00:00Z', is_archived: false },
      { id: 'mem2', key: 'wife_name', value: 'Priya', memory_type: 'family', importance: 85, confidence: 0.98, updated_at: '2026-08-20T00:00:00Z', is_archived: false },
    ];

    setupMocks({
      memories: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: conflictMemories, error: null })
      }
    });

    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'How is my wife doing?'
    });

    // Only Priya should be in active durable facts
    const activeWifeFact = ctx.memories.durableFacts.find(f => f.key === 'wife_name');
    expect(activeWifeFact).toBeDefined();
    expect(activeWifeFact?.value).toBe('Priya');
    expect(activeWifeFact?.is_current).toBe(true);

    // Sakshi should be segregated into historical facts
    expect(ctx.memories.historicalFacts.length).toBe(1);
    expect(ctx.memories.historicalFacts[0].value).toBe('Sakshi');
    expect(ctx.memories.historicalFacts[0].replaced_by).toBe('Priya');
    expect(ctx.metadata.conflicts_detected).toBe(1);
    expect(ctx.metadata.conflicts_resolved).toBe(1);
  });

  test('C. Explicit Turn Correction Takes Instant Precedence in Conflict Resolution', async () => {
    const conflictMemories = [
      { id: 'mem1', key: 'wife_name', value: 'Sakshi', memory_type: 'family', importance: 80, confidence: 0.9, updated_at: '2026-08-01T00:00:00Z', is_archived: false },
      { id: 'mem2', key: 'wife_name', value: 'Priya', memory_type: 'family', importance: 80, confidence: 0.9, updated_at: '2026-08-01T00:00:00Z', is_archived: false },
    ];

    setupMocks({
      memories: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: conflictMemories, error: null })
      }
    });

    // User says: "Actually meri wife ka naam Priya hai"
    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'Actually meri wife ka naam Priya hai'
    });

    const activeWife = ctx.memories.durableFacts.find(f => f.key === 'wife_name');
    expect(activeWife?.value).toBe('Priya');
    expect(ctx.turn?.corrections.length).toBe(1);
    expect(ctx.turn?.corrections[0].newValue).toBe('Priya');
  });

  test('D. Pronoun & Antecedent Continuity (Conversational referent takes precedence)', async () => {
    setupMocks({
      chat_history: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({
          data: [
            { id: 'm1', role: 'user', content: 'My sister is Neeta.', created_at: new Date().toISOString() }
          ],
          error: null
        })
      }
    });

    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'She handles all my finances.'
    });

    expect(ctx.conversation.activeAntecedents.length).toBe(1);
    expect(ctx.conversation.activeAntecedents[0].entity).toBe('Neeta');
    expect(ctx.conversation.activeAntecedents[0].relation).toBe('sister');
    expect(ctx.conversation.activeAntecedents[0].pronounCandidates).toContain('she');
  });

  test('E. Degraded Mode: Isolated query failure does not crash context assembly', async () => {
    setupMocks({
      working_memory: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error('Working memory DB connection timeout'))
      },
      life_threads: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockRejectedValue(new Error('Life threads table unavailable'))
      }
    });

    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'Hello'
    });

    expect(ctx.metadata.degraded_sources).toContain('working_memory');
    expect(ctx.metadata.degraded_sources).toContain('life_threads');
    // Remaining sources still populated cleanly
    expect(ctx.user.preferredName).toBe('Sagar');
    expect(ctx.memories.durableFacts.length).toBeGreaterThan(0);
  });

  test('F. Bounded Context Limits & Budgeting', async () => {
    const manyMemories = Array.from({ length: 30 }, (_, i) => ({
      id: `mem-${i}`,
      key: `fact_${i}`,
      value: `Value ${i}`,
      memory_type: 'misc',
      importance: 50 + (i % 10),
      confidence: 0.9,
      updated_at: new Date().toISOString(),
      is_archived: false
    }));

    setupMocks({
      memories: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: manyMemories, error: null })
      }
    });

    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'Testing bounds',
      maxDurableMemories: 5
    });

    expect(ctx.memories.durableFacts.length).toBeLessThanOrEqual(5);
  });

  test('G. Phase 2E-D Trust Boundary: Excludes proposed/rejected/invalidated memories and includes legacy NULL and trusted', async () => {
    const mixedMemories = [
      {
        id: 'mem-legacy',
        key: 'legacy_fact',
        value: 'Legacy factual memory',
        memory_type: 'personal',
        importance: 85,
        confidence: 0.9,
        updated_at: new Date().toISOString(),
        is_archived: false,
        compression_status: null, // Legacy NULL -> TRUSTED
      },
      {
        id: 'mem-trusted',
        key: 'trusted_fact',
        value: 'Explicitly verified and promoted fact',
        memory_type: 'personal',
        importance: 90,
        confidence: 0.95,
        updated_at: new Date().toISOString(),
        is_archived: false,
        compression_status: 'trusted', // Explicit 'trusted' -> TRUSTED
      },
      {
        id: 'mem-proposed',
        key: 'proposed_fact',
        value: 'Unpromoted compressed proposal',
        memory_type: 'personal',
        importance: 80,
        confidence: 0.85,
        updated_at: new Date().toISOString(),
        is_archived: false,
        compression_status: 'proposed', // PROPOSED -> MUST BE EXCLUDED
      },
      {
        id: 'mem-rejected',
        key: 'rejected_fact',
        value: 'Rejected compressed draft',
        memory_type: 'personal',
        importance: 70,
        confidence: 0.5,
        updated_at: new Date().toISOString(),
        is_archived: false,
        compression_status: 'rejected', // REJECTED -> MUST BE EXCLUDED
      },
      {
        id: 'mem-invalidated',
        key: 'invalidated_fact',
        value: 'Invalidated proposal',
        memory_type: 'personal',
        importance: 75,
        confidence: 0.6,
        updated_at: new Date().toISOString(),
        is_archived: false,
        compression_status: 'invalidated', // INVALIDATED -> MUST BE EXCLUDED
      },
      {
        id: 'mem-archived',
        key: 'archived_fact',
        value: 'Archived memory',
        memory_type: 'personal',
        importance: 80,
        confidence: 0.9,
        updated_at: new Date().toISOString(),
        is_archived: true, // ARCHIVED -> MUST BE EXCLUDED
        compression_status: null,
      },
    ];

    setupMocks({
      memories: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue({ data: mixedMemories, error: null })
      }
    });

    const ctx = await cognitiveContextService.assembleContext('user-123', {
      message: 'Hello Nova'
    });

    const factKeys = ctx.memories.durableFacts.map(f => f.key);

    // 1. Legacy NULL appears
    expect(factKeys).toContain('legacy_fact');
    // 2. Explicitly promoted 'trusted' appears
    expect(factKeys).toContain('trusted_fact');
    // 3. 'proposed' does NOT appear
    expect(factKeys).not.toContain('proposed_fact');
    // 4. 'rejected' does NOT appear
    expect(factKeys).not.toContain('rejected_fact');
    // 5. 'invalidated' does NOT appear
    expect(factKeys).not.toContain('invalidated_fact');
    // 6. 'is_archived: true' does NOT appear
    expect(factKeys).not.toContain('archived_fact');
  });
});
