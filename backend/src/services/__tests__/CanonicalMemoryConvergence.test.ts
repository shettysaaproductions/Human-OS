/**
 * CanonicalMemoryConvergence.test.ts — Phase 2 Canonical Memory & Entity Convergence Test Suite
 *
 * Verifies the 18 core invariants:
 * 1. ONE CANONICAL SEMANTIC GRAPH: memory_bubbles is truth, memories is attributes.
 * 2. ORDER-INDEPENDENT CONVERGENCE: Permutations of facts, aliases, and relations converge to the same graph.
 * 3. STRICT FACT OWNERSHIP: Facts belong to the entity, not to domain compartments.
 * 4. SAFE ENTITY MERGING: Merging provisional entities preserves facts and aliases without data loss.
 * 5. CANONICAL GRAPH GENERATION: Knowledge Graph API returns clean data without regex heuristics.
 */

import { canonicalEntityEngine } from '../CanonicalEntityEngine';
import { canonicalGraphService } from '../CanonicalGraphService';
import { safeMemoryReconciler } from '../SafeMemoryReconciler';

// In-memory mock database state for testing convergence
interface MockDb {
  memory_bubbles: any[];
  memories: any[];
  reminders: any[];
  memory_bubble_moves: any[];
  kg_nodes: any[];
}

let mockDb: MockDb;

// Mock Supabase
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
          for (const item of list) {
            if (filters.every((f) => f(item))) {
              Object.assign(item, updatesToApply);
            }
          }
          return { data: null, error: null };
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
            if (col === 'user_id' && !r.user_id) return true;
            return r[col] === val;
          });
          return builder;
        }),
        neq: jest.fn().mockImplementation((col: string, val: any) => {
          filters.push((r: any) => r[col] !== val);
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
                if (op === 'ilike') {
                  const cleaned = target.replace(/%/g, '');
                  return rVal.includes(cleaned);
                }
              }
              return false;
            });
          });
          return builder;
        }),
        contains: jest.fn().mockImplementation((col: string, obj: any) => {
          filters.push((r: any) => {
            if (col === 'metadata' && obj?.aliases && Array.isArray(obj.aliases)) {
              const aliases: string[] = r.metadata?.aliases || [];
              return obj.aliases.some((targetAlias: string) =>
                aliases.some((a) => a.toLowerCase() === targetAlias.toLowerCase())
              );
            }
            return false;
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
          const inserted = arr.map((r) => ({ id: r.id || `mock-${Date.now()}-${Math.random()}`, ...r }));
          ((mockDb as any)[table] = (mockDb as any)[table] || []).push(...inserted);
          return Promise.resolve({ data: inserted, error: null });
        }),
        upsert: jest.fn().mockImplementation((row: any) => {
          const list = ((mockDb as any)[table] = (mockDb as any)[table] || []);
          const idx = list.findIndex((r: any) => r.name === row.name && (!r.user_id || !row.user_id || r.user_id === row.user_id));
          if (idx >= 0) {
            list[idx] = { ...list[idx], ...row };
          } else {
            list.push({ id: `mock-${Date.now()}`, ...row });
          }
          return Promise.resolve({ data: null, error: null });
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
  },
}));

jest.mock('../CanonicalMemoryTreeService', () => ({
  canonicalMemoryTreeService: {
    resolveOrCreateEntityBubble: jest.fn().mockImplementation(async (userId: string, params: any) => {
      const bubble = {
        id: `bubble-${params.entityName.toLowerCase()}`,
        user_id: userId,
        label: params.entityName,
        slug: `entity:${params.entityName.toLowerCase()}`,
        bubble_type: 'entity',
        domain_key: params.domainKey || 'family',
        relation_type: params.relationType || 'Associate',
        metadata: { aliases: [], attributes: {} },
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockDb.memory_bubbles.push(bubble);
      return bubble;
    }),
    getOrCreateDomainBubble: jest.fn().mockImplementation(async (userId: string, domain: string) => ({
      id: `domain-${domain}`,
      slug: `domain:${domain}`,
      label: domain,
      bubble_type: 'domain',
    })),
  },
}));

jest.mock('../memoryRepository', () => ({
  memoryRepository: {
    upsertMemory: jest.fn().mockImplementation(async (userId: string, memory: any) => {
      const record = {
        id: `mem-${Date.now()}-${Math.random()}`,
        user_id: userId,
        key: memory.key,
        value: memory.value,
        bubble_id: memory.bubble_id,
        memory_type: memory.type || 'family',
        is_archived: false,
        updated_at: new Date().toISOString(),
      };
      mockDb.memories.push(record);
      return record;
    }),
  },
}));

describe('Canonical Memory & Entity Engine (Phase 2)', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockDb = {
      memory_bubbles: [],
      memories: [],
      reminders: [],
      memory_bubble_moves: [],
      kg_nodes: [],
    };
    jest.clearAllMocks();
  });

  describe('1. Order-Independent Convergence (Permutation A vs Permutation B)', () => {
    it('Permutation A: Shreshth first -> Tiku nickname second -> Tiku birthday third', async () => {
      // Step 1: "Shreshth is my son."
      const shreshth = await canonicalEntityEngine.createOrResolveEntity(userId, 'Shreshth', 'Son', 'family');
      expect(shreshth.name).toBe('Shreshth');
      expect(shreshth.relationToUser).toBe('Son');

      // Step 2: "Tiku is Shreshth's nickname."
      const aliasRes = await canonicalEntityEngine.registerAlias(userId, shreshth.id, 'Tiku');
      expect(aliasRes.status).toBe('alias_added');
      expect(aliasRes.targetEntity.aliases).toContain('Tiku');

      // Step 3: "Tiku was born on 17/02/2026."
      // Resolving "Tiku" must automatically resolve to Shreshth!
      const resolved = await canonicalEntityEngine.resolveEntity(userId, 'Tiku');
      expect(resolved).not.toBeNull();
      expect(resolved?.id).toBe(shreshth.id);
      expect(resolved?.name).toBe('Shreshth');

      // Attach birthday fact to resolved entity
      const factRes = await canonicalEntityEngine.attachFactToEntity(
        userId,
        resolved!.id,
        'birth_date',
        '17/02/2026',
        { source: 'chat', timestamp: new Date().toISOString(), confidence: 1.0, acquisitionMode: 'user_stated' }
      );
      expect(factRes.status).toBe('fact_attached');

      // Assert Final Graph State for Permutation A
      const activeBubbles = mockDb.memory_bubbles.filter((b) => !b.is_archived);
      expect(activeBubbles.length).toBe(1); // EXACTLY ONE ENTITY BUBBLE
      expect(activeBubbles[0].label).toBe('Shreshth');
      expect(activeBubbles[0].metadata.aliases).toContain('Tiku');

      const linkedMemories = mockDb.memories.filter((m) => m.bubble_id === shreshth.id);
      expect(linkedMemories.length).toBe(1);
      expect(linkedMemories[0].value).toBe('17/02/2026');
    });

    it('Permutation B: Tiku birthday first -> Tiku is Shreshth nickname second -> Shreshth is my son third', async () => {
      // Step 1: "Tiku was born on 17/02/2026." (Provisional entity created for Tiku)
      const tiku = await canonicalEntityEngine.createOrResolveEntity(userId, 'Tiku', 'Associate', 'family');
      expect(tiku.name).toBe('Tiku');

      await canonicalEntityEngine.attachFactToEntity(
        userId,
        tiku.id,
        'birth_date',
        '17/02/2026',
        { source: 'chat', timestamp: new Date().toISOString(), confidence: 1.0, acquisitionMode: 'user_stated' }
      );

      // Verify provisional fact is attached to Tiku
      expect(mockDb.memories[0].bubble_id).toBe(tiku.id);

      // Step 2: "Tiku is Shreshth's nickname."
      // Shreshth is introduced. Tiku is discovered to be an alias for Shreshth!
      const shreshth = await canonicalEntityEngine.createOrResolveEntity(userId, 'Shreshth', 'Associate', 'family');
      const mergeRes = await canonicalEntityEngine.registerAlias(userId, shreshth.id, 'Tiku');

      expect(mergeRes.status).toBe('entities_merged');
      expect(mergeRes.targetEntity.name).toBe('Shreshth');
      expect(mergeRes.targetEntity.aliases).toContain('Tiku');

      // Step 3: "Shreshth is my son."
      await canonicalEntityEngine.createOrResolveEntity(userId, 'Shreshth', 'Son', 'family');

      // Assert Final Graph State for Permutation B:
      // Must CONVERGE to the exact same state as Permutation A!
      const activeBubbles = mockDb.memory_bubbles.filter((b) => !b.is_archived);
      expect(activeBubbles.length).toBe(1); // Tiku archived, Shreshth active!
      expect(activeBubbles[0].label).toBe('Shreshth');
      expect(activeBubbles[0].metadata.aliases).toContain('Tiku');

      // The birthday memory originally linked to Tiku was repointed to Shreshth!
      const linkedMemories = mockDb.memories.filter((m) => m.bubble_id === shreshth.id);
      expect(linkedMemories.length).toBe(1);
      expect(linkedMemories[0].value).toBe('17/02/2026');

      // Reversible audit trail created in memory_bubble_moves
      expect(mockDb.memory_bubble_moves.length).toBe(1);
      expect(mockDb.memory_bubble_moves[0].entity_name).toBe('Tiku');
    });
  });

  describe('2. Strict Fact Ownership & Entity Integrity', () => {
    it('attaches facts to the entity bubble, never to domain compartments', async () => {
      const shreshth = await canonicalEntityEngine.createOrResolveEntity(userId, 'Shreshth', 'Son', 'family');

      await canonicalEntityEngine.attachFactToEntity(
        userId,
        shreshth.id,
        'school_name',
        'Delhi Public School',
        { source: 'chat', timestamp: new Date().toISOString(), confidence: 1.0, acquisitionMode: 'user_stated' }
      );

      const mem = mockDb.memories[0];
      expect(mem.bubble_id).toBe(shreshth.id);
      expect(mem.bubble_id).not.toBe('domain-family');
      expect(mem.key).toBe('entity:shreshth:school_name');
      expect(mem.value).toBe('Delhi Public School');
    });
  });

  describe('3. Safe Existing Data Reconciliation', () => {
    it('reconciles legacy flat keys and archives phantom bubbles', async () => {
      // Simulate existing legacy flat database state
      mockDb.memories = [
        { id: 'm1', key: 'son_name', value: 'Shreshth', bubble_id: null, is_archived: false, user_id: userId },
        { id: 'm2', key: 'son_nickname', value: 'Tuku', bubble_id: null, is_archived: false, user_id: userId },
        { id: 'm3', key: 'son_birth_date', value: '17/02/2026', bubble_id: null, is_archived: false, user_id: userId },
        { id: 'm4', key: 'wife_name', value: 'Sakshi', bubble_id: null, is_archived: false, user_id: userId },
      ];

      mockDb.memory_bubbles = [
        { id: 'b-phantom', label: 'kar', slug: 'entity:kar', is_archived: false, user_id: userId, bubble_type: 'entity' },
      ];

      const summary = await safeMemoryReconciler.reconcileUserData(userId);

      expect(summary.entitiesResolved).toBeGreaterThanOrEqual(2); // Shreshth and Sakshi
      expect(summary.memoriesLinked).toBe(4); // All 4 memories linked to bubble_ids
      expect(summary.phantomBubblesArchived).toBe(1); // 'kar' phantom archived

      // Verify Shreshth bubble has Tuku and Tiku in aliases
      const sonBubble = mockDb.memory_bubbles.find((b) => b.label === 'Shreshth');
      expect(sonBubble).toBeDefined();
      expect(sonBubble.metadata.aliases).toContain('Tuku');
      expect(sonBubble.metadata.aliases).toContain('Tiku');

      // Verify phantom bubble is archived
      const phantom = mockDb.memory_bubbles.find((b) => b.id === 'b-phantom');
      expect(phantom.is_archived).toBe(true);
    });
  });

  describe('4. Data-Driven Canonical Graph Generation (Zero Hardcoded Names)', () => {
    it('generates clean graph levels without hardcoded regex heuristics', async () => {
      // Populate canonical bubbles
      mockDb.memory_bubbles = [
        {
          id: 'b-shreshth',
          label: 'Shreshth',
          slug: 'entity:shreshth',
          bubble_type: 'entity',
          domain_key: 'family',
          relation_type: 'Son',
          parent_bubble_id: null,
          metadata: { aliases: ['Tiku', 'Tuku'] },
          is_archived: false,
          user_id: userId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      mockDb.memories = [
        {
          id: 'm-dob',
          key: 'entity:shreshth:birth_date',
          value: '17 Feb 2026',
          bubble_id: 'b-shreshth',
          memory_type: 'family',
          is_archived: false,
          lifecycle_state: 'CURRENT',
          user_id: userId,
          updated_at: new Date().toISOString(),
        },
      ];

      const graph = await canonicalGraphService.getCanonicalKnowledgeGraph(userId, 'Aryan');

      expect(graph.nodes.length).toBeGreaterThanOrEqual(7); // Core + 5 depts + 1 entity + 1 stem
      const coreNode = graph.nodes.find((n) => n.id === 'user-core');
      expect(coreNode?.name).toBe('Aryan');

      const entityNode = graph.nodes.find((n) => n.id === 'bubble-b-shreshth');
      expect(entityNode).toBeDefined();
      expect(entityNode?.name).toBe('Shreshth (Son)');
      expect(entityNode?.hierarchyLevel).toBe(2);

      const stemNode = graph.nodes.find((n) => n.id === 'mem-m-dob');
      expect(stemNode).toBeDefined();
      expect(stemNode?.name).toBe('Birthday: 17 Feb 2026');
      expect(stemNode?.hierarchyLevel).toBe(3);
      expect(stemNode?.parentEntityId).toBe('bubble-b-shreshth');
    });
  });
});
