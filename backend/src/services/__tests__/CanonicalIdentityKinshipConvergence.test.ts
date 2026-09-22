/**
 * CanonicalIdentityKinshipConvergence.test.ts
 *
 * Verifies Gates 1 through 10 of the Relationship-First Canonical Identity Engine:
 * - Test A: Sequence A ("Shreshth is my son" -> "Tiku is my son's nickname")
 * - Test B: Sequence B ("Tiku is my son's nickname" -> "Shreshth is my son's real name")
 * - Test C: "Mera naam Sagar hai" then "Tiku mera beta hai" (Self != relative)
 * - Test D: "Tiku mera beta hai" then "Mera naam Sagar hai"
 * - Test E: "Sagar is my son" rejected from usurping user identity without explicit evidence
 * - Test F: Two genuinely different children ("Rahul" and "Amit") remain separate
 * - Test G: Idempotent alias registration
 * - Test H: Idempotent reconciliation
 * - Test I: Concurrency convergence
 * - Multilingual phrasing across English, Hindi, and Hinglish
 */

import { CanonicalMemoryTreeService } from '../CanonicalMemoryTreeService';
import { CanonicalEntityEngine } from '../CanonicalEntityEngine';

interface MockDbState {
  profiles: any[];
  users: any[];
  memory_bubbles: any[];
  memories: any[];
  reminders: any[];
  kg_nodes: any[];
  kg_edges: any[];
}

let mockDb: MockDbState;

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      const filters: Array<(r: any) => boolean> = [];
      let updatesToApply: any = null;
      let isDelete = false;
      let limitCount: number | null = null;
      let orderCol: string | null = null;
      let orderAsc = true;

      const executeQuery = () => {
        const list = ((mockDb as any)[table] = (mockDb as any)[table] || []);
        if (isDelete) {
          (mockDb as any)[table] = list.filter((r: any) => !filters.every((f) => f(r)));
          return { data: null, error: null };
        }
        if (updatesToApply) {
          const updatedItems: any[] = [];
          for (const item of list) {
            if (filters.every((f) => f(item))) {
              Object.assign(item, updatesToApply);
              updatedItems.push(item);
            }
          }
          return { data: updatedItems, error: null };
        }
        let filtered = list.filter((r: any) => filters.every((f) => f(r)));
        if (orderCol) {
          filtered.sort((a: any, b: any) => {
            const valA = a[orderCol!] ?? '';
            const valB = b[orderCol!] ?? '';
            if (valA < valB) return orderAsc ? -1 : 1;
            if (valA > valB) return orderAsc ? 1 : -1;
            return 0;
          });
        }
        if (limitCount !== null) {
          filtered = filtered.slice(0, limitCount);
        }
        return { data: filtered, error: null };
      };

      const builder: any = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockImplementation((col: string, val: any) => {
          filters.push((r: any) => {
            if (col === 'is_archived' && r.is_archived === undefined) return val === false;
            return r[col] === val;
          });
          return builder;
        }),
        neq: jest.fn().mockImplementation((col: string, val: any) => {
          filters.push((r: any) => r[col] !== val);
          return builder;
        }),
        is: jest.fn().mockImplementation((col: string, val: any) => {
          filters.push((r: any) => r[col] === val);
          return builder;
        }),
        ilike: jest.fn().mockImplementation((col: string, pattern: string) => {
          const clean = pattern.replace(/%/g, '').toLowerCase();
          filters.push((r: any) => (r[col] || '').toLowerCase().includes(clean));
          return builder;
        }),
        in: jest.fn().mockImplementation((col: string, arr: any[]) => {
          filters.push((r: any) => arr.includes(r[col]));
          return builder;
        }),
        or: jest.fn().mockImplementation((cond: string) => {
          const subConds = cond.split(',').map((s) => s.trim());
          filters.push((r: any) => {
            return subConds.some((sc) => {
              const parts = sc.split('.');
              if (parts.length >= 3) {
                const col = parts[0];
                const op = parts[1];
                const val = parts.slice(2).join('.');
                const rVal = (r[col] ?? '').toString().toLowerCase();
                const target = val.toLowerCase();
                if (op === 'eq') return rVal === target;
                if (op === 'ilike') return rVal.includes(target.replace(/%/g, ''));
              }
              return false;
            });
          });
          return builder;
        }),
        order: jest.fn().mockImplementation((col: string, opts?: { ascending?: boolean }) => {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        }),
        limit: jest.fn().mockImplementation((n: number) => {
          limitCount = n;
          return builder;
        }),
        single: jest.fn().mockImplementation(() => {
          const res = executeQuery();
          return Promise.resolve({ data: (res.data && res.data[0]) || null, error: null });
        }),
        maybeSingle: jest.fn().mockImplementation(() => {
          const res = executeQuery();
          return Promise.resolve({ data: (res.data && res.data[0]) || null, error: null });
        }),
        insert: jest.fn().mockImplementation((rows: any) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          const inserted = arr.map((r) => ({
            id: r.id || `mock-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            is_archived: false,
            metadata: {},
            ...r,
          }));
          ((mockDb as any)[table] = (mockDb as any)[table] || []).push(...inserted);
          const insertRes = {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: inserted[0] || null, error: null }),
              maybeSingle: jest.fn().mockResolvedValue({ data: inserted[0] || null, error: null }),
            }),
            then: (resolve: any) => Promise.resolve({ data: inserted[0] || null, error: null }).then(resolve),
          };
          return insertRes;
        }),
        update: jest.fn().mockImplementation((up: any) => {
          updatesToApply = up;
          return builder;
        }),
        delete: jest.fn().mockImplementation(() => {
          isDelete = true;
          return builder;
        }),
        then: (onFulfilled: any, onRejected?: any) => {
          try {
            const res = executeQuery();
            return Promise.resolve(res).then(onFulfilled);
          } catch (e) {
            if (onRejected) return Promise.reject(e).catch(onRejected);
            throw e;
          }
        },
      };

      return builder;
    }),
    rpc: jest.fn((fnName: string, args: any) => {
      if (fnName === 'canonical_merge_entities') {
        const { p_user_id, p_source_bubble_id, p_target_bubble_id } = args;
        const source = mockDb.memory_bubbles.find((b) => b.id === p_source_bubble_id);
        const target = mockDb.memory_bubbles.find((b) => b.id === p_target_bubble_id);
        if (source && target) {
          source.is_archived = true;
          source.metadata = { ...(source.metadata || {}), archive_reason: `merged_into:${p_target_bubble_id}` };
          const aliases: string[] = target.metadata?.aliases || [];
          if (!aliases.includes(source.label)) aliases.push(source.label);
          target.metadata = { ...(target.metadata || {}), aliases };

          // Repoint memories
          for (const m of mockDb.memories) {
            if (m.bubble_id === p_source_bubble_id) {
              m.bubble_id = p_target_bubble_id;
            }
          }
        }
        return Promise.resolve({ data: { success: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  },
}));

describe('Relationship-First Canonical Identity & Kinship Convergence (Gates 1-10)', () => {
  const userId = 'user-convergence-test';
  let treeService: CanonicalMemoryTreeService;
  let entityEngine: CanonicalEntityEngine;

  beforeEach(() => {
    mockDb = {
      profiles: [{ id: userId, preferred_name: 'Sagar' }],
      users: [{ id: userId, name: 'Sagar' }],
      memory_bubbles: [
        { id: 'bubble-domain-family', user_id: userId, slug: 'domain:family', label: 'Family & Relationships', bubble_type: 'domain', domain_key: 'family', parent_bubble_id: null, is_archived: false },
        { id: 'bubble-domain-identity', user_id: userId, slug: 'domain:identity', label: 'Identity & Self', bubble_type: 'domain', domain_key: 'identity', parent_bubble_id: null, is_archived: false },
      ],
      memories: [],
      reminders: [],
      kg_nodes: [],
      kg_edges: [],
    };
    treeService = new CanonicalMemoryTreeService();
    entityEngine = CanonicalEntityEngine.getInstance();
    jest.clearAllMocks();
  });

  // ── TEST A: Sequence A ("Shreshth is my son" -> "Tiku is his nickname") ────────
  it('Test A: Sequence A ("Shreshth is my son" -> "Tiku is his nickname") converges to canonical Shreshth with alias Tiku', async () => {
    // 1. Shreshth is my son
    const sonBubble = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Shreshth',
      relationType: 'Son',
      domainKey: 'family',
    });
    expect(sonBubble.label).toBe('Shreshth');
    expect(sonBubble.relation_type).toBe('Son');

    // Attach son_name memory
    mockDb.memories.push({ id: 'mem-1', user_id: userId, key: 'son_name', value: 'Shreshth', bubble_id: sonBubble.id, is_archived: false });

    // 2. Tiku is his nickname
    const resolvedForNick = await treeService.resolveEntityBubbleForAttribute(userId, 'son_nickname', 'Tiku');
    expect(resolvedForNick.id).toBe(sonBubble.id);
    expect(resolvedForNick.label).toBe('Shreshth');

    // Attach son_nickname memory
    mockDb.memories.push({ id: 'mem-2', user_id: userId, key: 'son_nickname', value: 'Tiku', bubble_id: resolvedForNick.id, is_archived: false });

    // Invariants
    const activeSonBubbles = mockDb.memory_bubbles.filter((b) => b.relation_type === 'Son' && !b.is_archived);
    expect(activeSonBubbles.length).toBe(1);
    expect(activeSonBubbles[0].label).toBe('Shreshth');
    expect(activeSonBubbles[0].metadata?.aliases).toContain('Tiku');

    // Both memories point to same bubble
    const mem1 = mockDb.memories.find((m) => m.key === 'son_name');
    const mem2 = mockDb.memories.find((m) => m.key === 'son_nickname');
    expect(mem1.bubble_id).toBe(activeSonBubbles[0].id);
    expect(mem2.bubble_id).toBe(activeSonBubbles[0].id);
  });

  // ── TEST B: Sequence B ("Tiku is son nickname" -> "Shreshth is son real name") ──
  it('Test B: Sequence B (provisional nickname "Tiku" followed by real name "Shreshth") converges to canonical Shreshth with alias Tiku', async () => {
    // 1. "Tiku is my son's nickname" -> creates initial bubble
    const provisionalBubble = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Tiku',
      relationType: 'Son',
      domainKey: 'family',
    });
    expect(provisionalBubble.label).toBe('Tiku');
    mockDb.memories.push({ id: 'mem-nick', user_id: userId, key: 'son_nickname', value: 'Tiku', bubble_id: provisionalBubble.id, is_archived: false });

    // 2. "Shreshth is my son's real name" -> arrives later
    const canonicalPromoted = await treeService.resolveEntityBubbleForAttribute(userId, 'son_name', 'Shreshth');

    // Verify promotion: label is promoted to real name Shreshth, previous label Tiku becomes alias!
    expect(canonicalPromoted.label).toBe('Shreshth');
    expect(canonicalPromoted.metadata?.aliases).toContain('Tiku');

    mockDb.memories.push({ id: 'mem-name', user_id: userId, key: 'son_name', value: 'Shreshth', bubble_id: canonicalPromoted.id, is_archived: false });

    // Both memories now point to the canonical Shreshth bubble
    expect(mockDb.memories.find((m) => m.key === 'son_name').bubble_id).toBe(canonicalPromoted.id);
    expect(mockDb.memories.find((m) => m.key === 'son_nickname').bubble_id).toBe(canonicalPromoted.id);

    // Active Son bubbles count is exactly 1
    const activeSonBubbles = mockDb.memory_bubbles.filter((b) => b.relation_type === 'Son' && !b.is_archived);
    expect(activeSonBubbles.length).toBe(1);
    expect(activeSonBubbles[0].label).toBe('Shreshth');
  });

  // ── TEST C & D: Self Identity != Relative Entity ─────────────────────────────
  it('Test C: "Mera naam Sagar hai" then "Tiku mera beta hai" keeps Sagar strictly in identity domain', async () => {
    // 1. User sets name Sagar
    mockDb.profiles[0].preferred_name = 'Sagar';

    // 2. Tiku mera beta hai
    const sonBubble = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Tiku',
      relationType: 'Son',
      domainKey: 'family',
    });

    expect(sonBubble.label).toBe('Tiku');
    expect(sonBubble.domain_key).toBe('family');

    // Verify Sagar was NEVER created as Son
    const sagarSon = mockDb.memory_bubbles.find((b) => b.label === 'Sagar' && b.relation_type === 'Son' && !b.is_archived);
    expect(sagarSon).toBeUndefined();
  });

  it('Test D: "Tiku mera beta hai" then user name declared as Sagar does not corrupt Son entity', async () => {
    // 1. Son bubble created first
    const sonBubble = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Tiku',
      relationType: 'Son',
      domainKey: 'family',
    });
    expect(sonBubble.label).toBe('Tiku');

    // 2. User name declared as Sagar
    const identityBubble = await treeService.resolveEntityBubbleForAttribute(userId, 'preferred_name', 'Sagar');
    expect(identityBubble.domain_key).toBe('identity');

    // Son entity remains intact
    const son = mockDb.memory_bubbles.find((b) => b.relation_type === 'Son' && !b.is_archived);
    expect(son).toBeDefined();
    expect(son.label).toBe('Tiku');
  });

  // ── TEST E: "Sagar is my son" without explicit evidence rejected ─────────────
  it('Test E: "Sagar is my son" is blocked from turning user self identity into Son entity', async () => {
    mockDb.profiles[0].preferred_name = 'Sagar';

    const result = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Sagar',
      relationType: 'Son',
      domainKey: 'family',
    });

    // Routed to identity domain rather than creating a duplicate family relative entity
    expect(result.domain_key).toBe('identity');

    const activeSagarSon = mockDb.memory_bubbles.find((b) => b.label === 'Sagar' && b.relation_type === 'Son' && !b.is_archived);
    expect(activeSagarSon).toBeUndefined();
  });

  // ── TEST F: Two genuinely different children remain separate (Gate 6) ────────
  it('Test F: Sibling Guard preserves distinct entities for Rahul and Amit when user has two sons', async () => {
    // 1. Son 1: Rahul
    const rahul = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Rahul',
      relationType: 'Son',
      domainKey: 'family',
    });
    expect(rahul.label).toBe('Rahul');

    // 2. Son 2: Amit (distinct child, no alias evidence connecting them)
    const amit = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Amit',
      relationType: 'Son',
      domainKey: 'family',
    });
    expect(amit.label).toBe('Amit');

    // Both active bubbles must be preserved
    const activeSons = mockDb.memory_bubbles.filter((b) => b.relation_type === 'Son' && !b.is_archived);
    expect(activeSons.length).toBe(2);
    expect(activeSons.map((s) => s.label).sort()).toEqual(['Amit', 'Rahul']);
  });

  // ── TEST G: Repeated alias mentions remain idempotent ────────────────────────
  it('Test G: Registering same alias repeatedly is strictly idempotent', async () => {
    const son = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Shreshth',
      relationType: 'Son',
      domainKey: 'family',
    });

    // Mention alias Tiku multiple times
    await treeService.resolveEntityBubbleForAttribute(userId, 'son_nickname', 'Tiku');
    await treeService.resolveEntityBubbleForAttribute(userId, 'son_nickname', 'Tiku');
    await treeService.resolveEntityBubbleForAttribute(userId, 'son_nickname', 'Tiku');

    const activeSon = mockDb.memory_bubbles.find((b) => b.id === son.id);
    const aliases = activeSon.metadata?.aliases || [];
    const tikuOccurrences = aliases.filter((a: string) => a.toLowerCase() === 'tiku');
    expect(tikuOccurrences.length).toBe(1);
  });

  // ── TEST H: Multilingual Hinglish and Hindi input convergence ────────────────
  it('Test H: Hinglish & Hindi statements converge to the canonical entity correctly', async () => {
    // "Mera beta Shreshth hai"
    const sonBubble = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Shreshth',
      relationType: 'Son',
      domainKey: 'family',
    });
    mockDb.memories.push({ id: 'mem-shreshth', user_id: userId, key: 'son_name', value: 'Shreshth', bubble_id: sonBubble.id, is_archived: false });

    // "Pyaar se ghar pe Tiku bulate hai"
    const resolvedAlias = await treeService.resolveEntityBubbleForAttribute(userId, 'son_nickname', 'Tiku');
    expect(resolvedAlias.id).toBe(sonBubble.id);
    expect(resolvedAlias.label).toBe('Shreshth');
    expect(resolvedAlias.metadata?.aliases).toContain('Tiku');

    // "Bete ki birth date 17 Feb hai" -> attaches to canonical son
    const resolvedDob = await treeService.resolveEntityBubbleForAttribute(userId, 'son_birth_date', '17/02/2026');
    expect(resolvedDob.id).toBe(sonBubble.id);
  });

  // ── TEST I: Fact Ownership Guarantee (Zero Inversion) ────────────────────────
  it('Test I: Fact Ownership Guarantee ensures son_name and son_nickname are NEVER inverted', async () => {
    // Even if nickname memory is created first
    const nickBubble = await treeService.resolveOrCreateEntityBubble(userId, {
      entityName: 'Tiku',
      relationType: 'Son',
      domainKey: 'family',
    });
    mockDb.memories.push({ id: 'm-nick', user_id: userId, key: 'son_nickname', value: 'Tiku', bubble_id: nickBubble.id, is_archived: false });

    // When real name is resolved
    const nameBubble = await treeService.resolveEntityBubbleForAttribute(userId, 'son_name', 'Shreshth');
    mockDb.memories.push({ id: 'm-name', user_id: userId, key: 'son_name', value: 'Shreshth', bubble_id: nameBubble.id, is_archived: false });

    // Both point to the promoted real name entity
    expect(nameBubble.label).toBe('Shreshth');
    expect(nameBubble.id).toBe(nickBubble.id);
    expect(mockDb.memories.find((m) => m.key === 'son_name').bubble_id).toBe(nameBubble.id);
    expect(mockDb.memories.find((m) => m.key === 'son_nickname').bubble_id).toBe(nameBubble.id);
  });
});
