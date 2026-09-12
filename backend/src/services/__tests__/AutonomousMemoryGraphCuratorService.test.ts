import { autonomousMemoryGraphCurator } from '../AutonomousMemoryGraphCuratorService';
import { supabaseAdmin } from '../../lib/supabase';
import { cache } from '../../lib/cache';
import { complete } from '../../lib/nvidia';
import { invalidateAnalyticsCache } from '../../routes/analytics';

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
    WORKING_MEMORY: 'working_memory'
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

describe('AutonomousMemoryGraphCuratorService — Tree & Graph Reconciliation Engine', () => {
  const userId = 'user-test-curator-999';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('prunes empty and placeholder nodes (e.g. shreshth date of birth with no data)', async () => {
    const mockMemories = [
      { id: 'mem-1', key: 'shreshth_date_of_birth', value: 'Not mentioned', memory_type: 'personal', lifecycle_state: 'CURRENT' },
      { id: 'mem-2', key: 'son_name', value: 'Shreshth', memory_type: 'family', lifecycle_state: 'CURRENT' },
      { id: 'mem-3', key: 'user_hobby', value: '   ', memory_type: 'personal', lifecycle_state: 'CURRENT' }
    ];

    const mockWorkingMem = [
      { id: 'wm-1', key: 'shreshth_date_of_birth', value: 'null' }
    ];

    const mockKgNodes = [
      { id: 'node-1', name: 'shreshth date of birth', attributes: {} }
    ];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') return createQueryBuilder(mockMemories);
      if (table === 'working_memory') return createQueryBuilder(mockWorkingMem);
      if (table === 'kg_nodes') return createQueryBuilder(mockKgNodes);
      if (table === 'chat_history') return createQueryBuilder([]);
      return createQueryBuilder([]);
    });

    const report = await autonomousMemoryGraphCurator.curateUserMemoryGraph(userId, { force: true });

    expect(report.removalsApplied).toBeGreaterThanOrEqual(2);
    expect(report.kgCleaned).toBeGreaterThanOrEqual(1);

    // Should invalidate analytics and wardrobe cache
    expect(invalidateAnalyticsCache).toHaveBeenCalledWith(userId);
    expect(cache.invalidate).toHaveBeenCalledWith(`wardrobes:${userId}`);
  });

  it('merges alias collisions into the canonical key and preserves the valid value', async () => {
    const mockMemories = [
      { id: 'mem-dob-alias', key: 'shreshth_date_of_birth', value: '17/02/2026', memory_type: 'family', lifecycle_state: 'CURRENT' },
      { id: 'mem-canonical', key: 'son_birth_date', value: '17/02/2026', memory_type: 'family', lifecycle_state: 'CURRENT' }
    ];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') return createQueryBuilder(mockMemories);
      if (table === 'working_memory') return createQueryBuilder([]);
      if (table === 'kg_nodes') return createQueryBuilder([]);
      if (table === 'chat_history') return createQueryBuilder([]);
      return createQueryBuilder([]);
    });

    const report = await autonomousMemoryGraphCurator.curateUserMemoryGraph(userId, { force: true });

    expect(report.mergesApplied).toBeGreaterThanOrEqual(1);
  });

  it('executes LLM-based semantic graph curation when conversation provides concrete proof', async () => {
    const mockMemories = [
      { id: 'mem-son', key: 'son_name', value: 'Shreshth', memory_type: 'family', lifecycle_state: 'CURRENT' },
      { id: 'mem-son-dob', key: 'son_birth_date', value: '15/04/1992', memory_type: 'family', lifecycle_state: 'CURRENT' }
    ];

    const mockChats = [
      { role: 'user', content: 'Mera bday 15/04/1992 hai aur mere bete shreshth ka bday 17/02/2026 hai', created_at: '2026-09-11T12:00:00Z' }
    ];

    (complete as jest.Mock).mockResolvedValueOnce(JSON.stringify({
      removals: [],
      merges: [],
      updates: [
        {
          key: 'son_birth_date',
          correctedValue: '17/02/2026',
          proofQuote: 'mere bete shreshth ka bday 17/02/2026 hai',
          rationale: 'Chat confirms 17/02/2026 is the true son birth date'
        }
      ],
      additions: [
        {
          key: 'birth_date',
          value: '15/04/1992',
          category: 'personal',
          proofQuote: 'Mera bday 15/04/1992 hai',
          rationale: 'User stated their own birth date'
        }
      ]
    }));

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') return createQueryBuilder(mockMemories);
      if (table === 'working_memory') return createQueryBuilder([]);
      if (table === 'kg_nodes') return createQueryBuilder([]);
      if (table === 'chat_history') return createQueryBuilder(mockChats);
      return createQueryBuilder([]);
    });

    const report = await autonomousMemoryGraphCurator.curateUserMemoryGraph(userId, { force: true });

    expect(report.updatesApplied).toBeGreaterThanOrEqual(1);
    expect(report.additionsApplied).toBeGreaterThanOrEqual(1);
    expect(report.details.updates.some(u => u.key === 'son_birth_date')).toBe(true);
    expect(report.details.additions.some(a => a.key === 'birth_date')).toBe(true);
  });
});
