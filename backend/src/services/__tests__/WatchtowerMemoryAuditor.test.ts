import { watchtowerMemoryAuditor } from '../WatchtowerMemoryAuditor';
import { supabaseAdmin } from '../../lib/supabase';
import { cache } from '../../lib/cache';

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn()
  }
}));

jest.mock('../../lib/nvidia', () => ({
  complete: jest.fn().mockResolvedValue('[]')
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

function createQueryBuilder(resolvedData: any) {
  const builder: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockImplementation(() => Promise.resolve({ data: resolvedData[0] || null })),
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null })
    }),
    insert: jest.fn().mockResolvedValue({ error: null }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    then: (resolve: any) => resolve({ data: resolvedData })
  };
  return builder;
}

describe('WatchtowerMemoryAuditor — Autonomous Memory & Wardrobe Truth Auditor', () => {
  const userId = 'mock-user-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detects and autonomously rectifies fatal AGE_DOB_CONTRADICTION when infant is assigned adult 1992 birth date', async () => {
    const mockMemories = [
      { id: 'mem-1', key: 'son_age', value: '6 mahine ka', memory_type: 'personal', lifecycle_state: 'CURRENT' },
      { id: 'mem-2', key: 'son_birth_date', value: '15/04/1992', memory_type: 'family', lifecycle_state: 'CURRENT' },
      { id: 'mem-3', key: 'son_name', value: 'Shreshth', memory_type: 'family', lifecycle_state: 'CURRENT' }
    ];

    const mockWorkingMemory = [
      { key: 'tiku_birthday', value: '17/02/2026' }
    ];

    const mockChats = [
      { role: 'assistant', content: 'tumhara birthday kab aata hai?', created_at: '2026-09-10T10:00:00Z' },
      { role: 'user', content: '15/04/1992', created_at: '2026-09-10T10:01:00Z' },
      { role: 'user', content: 'And tiku ka bday 17/02/2026 hai', created_at: '2026-09-10T10:05:00Z' }
    ];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') return createQueryBuilder(mockMemories);
      if (table === 'working_memory') return createQueryBuilder(mockWorkingMemory);
      if (table === 'chat_history') return createQueryBuilder(mockChats);
      return createQueryBuilder([]);
    });

    const result = await watchtowerMemoryAuditor.auditAndReconcileUser(userId);

    expect(result.findings.length).toBeGreaterThan(0);
    const dobFinding = result.findings.find(f => f.flawType === 'AGE_DOB_CONTRADICTION');
    expect(dobFinding).toBeDefined();
    expect(dobFinding?.action).toBe('AUTO_RECONCILE');
    expect(result.repairsApplied).toBeGreaterThanOrEqual(1);

    // Verifies cache invalidation occurred
    expect(cache.invalidate).toHaveBeenCalledWith(`wardrobes:${userId}`);
  });

  it('reconciles son_nickname when accidentally stored identical to real name and chat confirms pet nickname', async () => {
    const mockMemories = [
      { id: 'mem-10', key: 'son_name', value: 'shreshth', memory_type: 'family', lifecycle_state: 'CURRENT' },
      { id: 'mem-11', key: 'son_nickname', value: 'shreshth', memory_type: 'family', lifecycle_state: 'CURRENT' }
    ];

    const mockChats = [
      { role: 'user', content: 'Hum shreshth ko pyar se ghr pe tiku bulate hai', created_at: '2026-09-10T11:00:00Z' }
    ];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') return createQueryBuilder(mockMemories);
      if (table === 'working_memory') return createQueryBuilder([]);
      if (table === 'chat_history') return createQueryBuilder(mockChats);
      return createQueryBuilder([]);
    });

    const result = await watchtowerMemoryAuditor.auditAndReconcileUser(userId);

    const nickFinding = result.findings.find(f => f.flawType === 'NAME_NICKNAME_INVERSION');
    expect(nickFinding).toBeDefined();
    expect(nickFinding?.action).toBe('AUTO_RECONCILE');
    expect(nickFinding?.updates?.some(u => u.key === 'son_nickname' && u.value === 'Tiku')).toBe(true);
  });

  it('resolves WORK_VENTURE_COLLISION by preserving Conviction HR as primary employer and Shetty Dhaba as venture', async () => {
    const mockMemories = [
      { id: 'mem-20', key: 'company_name', value: "Shetty's Dhaba", memory_type: 'work', lifecycle_state: 'CURRENT' },
      { id: 'mem-21', key: 'work_schedule', value: 'Monday to Saturday, 11 AM to 8 PM at Conviction HR', memory_type: 'work', lifecycle_state: 'CURRENT' }
    ];

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'memories') return createQueryBuilder(mockMemories);
      if (table === 'working_memory') return createQueryBuilder([]);
      if (table === 'chat_history') return createQueryBuilder([]);
      return createQueryBuilder([]);
    });

    const result = await watchtowerMemoryAuditor.auditAndReconcileUser(userId);

    const workFinding = result.findings.find(f => f.flawType === 'WORK_VENTURE_COLLISION');
    expect(workFinding).toBeDefined();
    expect(workFinding?.action).toBe('AUTO_RECONCILE');
    expect(workFinding?.updates?.some(u => u.key === 'company_name' && u.value === 'Conviction HR')).toBe(true);
    expect(workFinding?.updates?.some(u => u.key === 'venture_name' && u.value === "Shetty's Dhaba")).toBe(true);
  });
});
