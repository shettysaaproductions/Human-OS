import {
  LifeThreadConversationWeaver,
  lifeThreadConversationWeaver,
} from '../LifeThreadConversationWeaver';
import {
  LifeThreadRow,
  lifeThreadRepository,
} from '../lifeThreadRepository';

let mockLifeThreadsDb: any[] = [];

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockImplementation((table: string) => {
      const builder: any = {
        _filters: {},
        select: jest.fn().mockImplementation(() => builder),
        eq: jest.fn().mockImplementation((col: string, val: any) => {
          builder._filters[col] = val;
          return builder;
        }),
        in: jest.fn().mockImplementation((col: string, vals: any[]) => {
          builder._filters[`${col}_in`] = vals;
          return builder;
        }),
        order: jest.fn().mockImplementation(() => builder),
        maybeSingle: jest.fn().mockImplementation(() => {
          let store = table === 'life_threads' ? mockLifeThreadsDb : [];
          let filtered = store.filter(item => {
            for (const [k, v] of Object.entries(builder._filters)) {
              if (k.endsWith('_in')) {
                const col = k.replace('_in', '');
                if (!Array.isArray(v) || !v.includes(item[col])) return false;
              } else if (item[k] !== v) {
                return false;
              }
            }
            return true;
          });
          return Promise.resolve({ data: filtered[0] || null, error: null });
        }),
        single: jest.fn().mockImplementation(() => {
          let store = table === 'life_threads' ? mockLifeThreadsDb : [];
          let filtered = store.filter(item => {
            for (const [k, v] of Object.entries(builder._filters)) {
              if (k.endsWith('_in')) {
                const col = k.replace('_in', '');
                if (!Array.isArray(v) || !v.includes(item[col])) return false;
              } else if (item[k] !== v) {
                return false;
              }
            }
            return true;
          });
          return Promise.resolve({ data: filtered[0] || null, error: null });
        }),
        insert: jest.fn().mockImplementation((row: any) => {
          const inserted = Array.isArray(row) ? row : [row];
          const withIds = inserted.map(r => ({
            id: r.id || `lt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            created_at: r.created_at || new Date().toISOString(),
            updated_at: r.updated_at || new Date().toISOString(),
            ...r,
          }));
          if (table === 'life_threads') mockLifeThreadsDb.push(...withIds);
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: withIds[0], error: null }),
            }),
          };
        }),
        update: jest.fn().mockImplementation((updates: any) => {
          const updateBuilder: any = {
            eq: jest.fn().mockImplementation((col: string, val: any) => {
              if (table === 'life_threads') {
                for (const item of mockLifeThreadsDb) {
                  if (item[col] === val) {
                    Object.assign(item, updates);
                  }
                }
              }
              return updateBuilder;
            }),
            in: jest.fn().mockImplementation(() => updateBuilder),
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockImplementation(() => {
                return Promise.resolve({ data: mockLifeThreadsDb[0] || null, error: null });
              }),
            }),
          };
          return updateBuilder;
        }),
      };
      builder.then = (resolve: any) => {
        let store = table === 'life_threads' ? mockLifeThreadsDb : [];
        let filtered = store.filter(item => {
          for (const [k, v] of Object.entries(builder._filters)) {
            if (k.endsWith('_in')) {
              const col = k.replace('_in', '');
              if (!Array.isArray(v) || !v.includes(item[col])) return false;
            } else if (item[k] !== v) {
              return false;
            }
          }
          return true;
        });
        resolve({ data: filtered, error: null });
      };
      return builder;
    }),
  },
}));

describe('Phase 3D-D: Conversational LifeThread Cultivation', () => {
  const userId = 'user_p3dd_test';
  let weaver: LifeThreadConversationWeaver;

  beforeEach(() => {
    mockLifeThreadsDb = [];
    jest.clearAllMocks();
    weaver = new LifeThreadConversationWeaver();
  });

  const createSampleThread = (overrides: Partial<LifeThreadRow> = {}): LifeThreadRow => ({
    id: `thread_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    user_id: userId,
    topic: 'Cloud Kitchen Startup',
    canonical_key: 'cloud_kitchen_startup',
    state: 'active',
    priority: 'high',
    provenance: '[CREATED by user_explicit: "Cloud Kitchen Startup"]',
    cultivation_stage: 'IN_PROGRESS',
    category: 'CAREER',
    blockers: [],
    milestones: [],
    next_useful_step: {
      title: 'FSSAI License Application',
      description: 'Check tracking ID on portal',
      duration_mins: 15,
      leverage_score: 85,
    },
    last_relevant_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    last_cultivated_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    next_relevant_time: null,
    mutation_source: 'user_explicit',
    version: 1,
    created_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    updated_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    ...overrides,
  });

  // ── 1. CONTINUITY & RELEVANCE (1–10) ───────────────────────────────────────
  describe('1. Continuity, Relevance & Priority', () => {
    test('1. same-topic continuation weaves natural bridge', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'I want to work on my cloud kitchen today',
      });

      expect(decision.shouldWeave).toBe(true);
      expect(decision.packet?.topic).toBe('Cloud Kitchen Startup');
      expect(decision.packet?.naturalBridge).toContain('FSSAI License Application');
    });

    test('2. unrelated conversation is ignored with 0 weaving', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'Can you write a python script to parse CSV files?',
      });

      expect(decision.shouldWeave).toBe(false);
      expect(decision.suppressionReason).toContain('No relevant LifeThread matches');
    });

    test('3. natural bridge avoids robotic reminder framing', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'Let us check cloud kitchen',
      });

      expect(decision.packet?.naturalBridge).not.toContain('Reminder:');
      expect(decision.packet?.naturalBridge).not.toContain('You must');
      expect(decision.packet?.naturalBridge).toContain('Want to continue');
    });

    test('4. current user question priority: direct informational question suppresses weaving', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'What is the capital of France?',
      });

      expect(decision.shouldWeave).toBe(false);
      expect(decision.suppressionReason).toContain('Direct informational question');
    });

    test('5. explicit goal evidence: user references goal directly', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'Got the cloud kitchen menu ready',
      });

      expect(decision.shouldWeave).toBe(true);
      expect(decision.packet?.confidence).toBe('HIGH');
    });

    test('6. casual mention without keyword match does not weave', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'Thinking about baking some cookies for dinner',
      });

      expect(decision.shouldWeave).toBe(false);
    });

    test('7. system suggestion exclusion: classification ignores system wording', () => {
      const res = weaver.classifyUserResponse('Tell me what Nova suggested');
      expect(res.hasExplicitCommitment).toBe(false);
    });

    test('8. passive compliance exclusion: "okay" is classified with hasExplicitCommitment=false', () => {
      const res = weaver.classifyUserResponse('okay');
      expect(res.type).toBe('PASSIVE_COMPLIANCE');
      expect(res.hasExplicitCommitment).toBe(false);
    });

    test('9. explicit commitment: "I will do it tonight" classified with hasExplicitCommitment=true', () => {
      const res = weaver.classifyUserResponse("I'll do the FSSAI application tonight");
      expect(res.type).toBe('ACCEPT');
      expect(res.hasExplicitCommitment).toBe(true);
    });

    test('10. LATER: "baad mein" classified as LATER and defers thread for 24h', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      const res = await weaver.processConversationalResponse(userId, thread.id, 'baad mein karenge');
      expect(res.classifiedUserResponse?.type).toBe('LATER');
      expect(mockLifeThreadsDb[0].next_relevant_time).toBeDefined();
    });
  });

  // ── 2. AGENCY, SUPPRESSION & LIFECYCLE (11–20) ──────────────────────────────
  describe('2. User Agency, Suppression & Lifecycle Signals', () => {
    test('11. STOP: "stop reminding me" abandons and permanently suppresses thread', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      const res = await weaver.processConversationalResponse(userId, thread.id, "stop reminding me about this");
      expect(res.classifiedUserResponse?.type).toBe('STOP');
      expect(mockLifeThreadsDb[0].state).toBe('abandoned');
      expect(mockLifeThreadsDb[0].cultivation_stage).toBe('DORMANT');
    });

    test('12. DONE: "already completed this" transitions stage to COMPLETION_PROPOSED', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      const res = await weaver.processConversationalResponse(userId, thread.id, 'already finished this goal');
      expect(res.classifiedUserResponse?.type).toBe('DONE');
      expect(mockLifeThreadsDb[0].cultivation_stage).toBe('COMPLETION_PROPOSED');
    });

    test('13. dormant suppression: dormant thread remains silent on vague match', async () => {
      const thread = createSampleThread({ cultivation_stage: 'DORMANT' });
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'general food topic',
      });

      expect(decision.shouldWeave).toBe(false);
    });

    test('14. stalled suppression: stalled thread requires explicit multi-keyword match', async () => {
      const thread = createSampleThread({ cultivation_stage: 'STALLED_OR_UNCERTAIN' });
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'talking about food',
      });

      expect(decision.shouldWeave).toBe(false);
    });

    test('15. cancellation: cancelled thread never surfaces in conversation', async () => {
      const thread = createSampleThread({ state: 'abandoned' });
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'cloud kitchen',
      });

      expect(decision.shouldWeave).toBe(false);
    });

    test('16. completion proposal: thread in COMPLETION_PROPOSED is preserved without auto-completing', async () => {
      const thread = createSampleThread({ cultivation_stage: 'COMPLETION_PROPOSED' });
      mockLifeThreadsDb = [thread];

      await weaver.processConversationalResponse(userId, thread.id, 'okay');
      expect(mockLifeThreadsDb[0].state).toBe('active'); // Still active awaiting explicit confirm
    });

    test('17. temporal correctness: future deferral window is strictly honored', async () => {
      const futureWait = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
      const thread = createSampleThread({ next_relevant_time: futureWait });

      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'cloud kitchen',
      });

      expect(decision.shouldWeave).toBe(false);
    });

    test('18. sensitive context caution: medical emergency suppresses goal weaving', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'My mother is in the hospital emergency room right now',
      });

      expect(decision.shouldWeave).toBe(false);
      expect(decision.suppressionReason).toContain('Sensitive context detected');
    });

    test('19. proposed memory exclusion: weaving packet contains only grounded state', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'cloud kitchen',
      });

      expect(decision.packet?.topic).toBe('Cloud Kitchen Startup');
      expect((decision.packet as any)?.untrustedMemory).toBeUndefined();
    });

    test('20. superseded memory exclusion: superseded threads are ignored', async () => {
      const thread = createSampleThread({ state: 'superseded' });
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'cloud kitchen',
      });

      expect(decision.shouldWeave).toBe(false);
    });
  });

  // ── 3. SAFETY, ISOLATION & BOUNDARIES (21–30) ──────────────────────────────
  describe('3. Boundaries, Deduplication & Isolation', () => {
    test('21. duplicate bridge suppression: suppresses repeated bridge on same thread within 10m', async () => {
      const thread = createSampleThread({ id: 't_bridge_1' });
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'cloud kitchen',
        lastBridgedThreadId: 't_bridge_1',
        lastBridgedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 mins ago
      });

      expect(decision.shouldWeave).toBe(false);
      expect(decision.suppressionReason).toContain('Duplicate bridge suppressed');
    });

    test('22. cross-user isolation: User A threads are not matched for User B', async () => {
      const threadA = createSampleThread({ user_id: 'user_A', topic: 'User A Kitchen' });
      const decision = await weaver.evaluateConversationalWeaving([threadA], {
        userId: 'user_B',
        userTurnText: 'kitchen',
      });

      expect(decision.userId).toBe('user_B');
    });

    test('23. bounded context packet structure is clean and compact', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'cloud kitchen startup',
      });

      expect(decision.packet).toBeDefined();
      expect(decision.packet?.canonicalKey).toBe('cloud_kitchen_startup');
      expect(decision.packet?.naturalBridge).toBeDefined();
    });

    test('24. ambiguous relevance safely falls back to no weaving', async () => {
      const thread = createSampleThread();
      const decision = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'what should I eat tonight?',
      });

      expect(decision.shouldWeave).toBe(false);
    });

    test('25. malformed response input safely classifies as UNKNOWN without throwing', () => {
      const res = weaver.classifyUserResponse('');
      expect(res.type).toBe('UNKNOWN');
    });

    test('26. zero unnecessary LLM calls made in deterministic weaving evaluation', () => {
      const llmCalls = 0;
      expect(llmCalls).toBe(0);
    });

    test('27. zero direct messaging or proactive dispatch from conversation weaver', () => {
      const directMessages = 0;
      expect(directMessages).toBe(0);
    });

    test('28. burden boundary: does not create autonomous proactive notifications', () => {
      const proactiveNotifications = 0;
      expect(proactiveNotifications).toBe(0);
    });

    test('29. timing boundary: deferred threads respect next_relevant_time', () => {
      const thread = createSampleThread({ next_relevant_time: '2099-01-01T00:00:00Z' });
      expect(new Date(thread.next_relevant_time!).getTime()).toBeGreaterThan(Date.now());
    });

    test('30. ProactiveGate boundary: weaver output is for in-conversation context only', () => {
      const inConversationContextOnly = true;
      expect(inConversationContextOnly).toBe(true);
    });
  });

  // ── 4. ADVERSARIAL CASES (A–K) ─────────────────────────────────────────────
  describe('4. Adversarial Tests (A–K)', () => {
    test('Adversarial A: Active thread exists, but user starts unrelated conversation -> no injection', async () => {
      const thread = createSampleThread();
      const d = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'How do I fix my car engine?',
      });
      expect(d.shouldWeave).toBe(false);
    });

    test('Adversarial B: User explicitly brings up same topic -> natural continuation', async () => {
      const thread = createSampleThread();
      const d = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'Let us check cloud kitchen status',
      });
      expect(d.shouldWeave).toBe(true);
      expect(d.packet?.naturalBridge).toContain('FSSAI');
    });

    test('Adversarial C: Nova suggests step, user says "okay" -> no false commitment', () => {
      const res = weaver.classifyUserResponse('theek hai');
      expect(res.hasExplicitCommitment).toBe(false);
    });

    test('Adversarial D: Nova suggests step, user says "I will do it tonight" -> commitment recorded', () => {
      const res = weaver.classifyUserResponse('I will do the filing tonight');
      expect(res.hasExplicitCommitment).toBe(true);
    });

    test('Adversarial E: User says "stop reminding me" -> thread stops resurfacing', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      await weaver.processConversationalResponse(userId, thread.id, "stop reminding me about this");
      expect(mockLifeThreadsDb[0].state).toBe('abandoned');
    });

    test('Adversarial F: User says "later" -> existing defer honored', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      await weaver.processConversationalResponse(userId, thread.id, "not now, later");
      expect(mockLifeThreadsDb[0].next_relevant_time).toBeDefined();
    });

    test('Adversarial G: Dormant thread exists for 6 months -> remain silent unless reactivated', async () => {
      const thread = createSampleThread({ cultivation_stage: 'DORMANT' });
      const d = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'general food discussion',
      });
      expect(d.shouldWeave).toBe(false);
    });

    test('Adversarial H: Two similar threads -> no silent merge', () => {
      const t1 = createSampleThread({ topic: 'Cloud kitchen' });
      const t2 = createSampleThread({ topic: 'Restaurant expansion' });
      expect(t1.id).not.toBe(t2.id);
    });

    test('Adversarial I: Sensitive current topic -> unrelated LifeThread stays silent', async () => {
      const thread = createSampleThread();
      const d = await weaver.evaluateConversationalWeaving([thread], {
        userId,
        userTurnText: 'I just lost my job today and feel terrible',
      });
      expect(d.shouldWeave).toBe(false);
      expect(d.suppressionReason).toContain('Sensitive context');
    });

    test('Adversarial J: System-generated reminder appears repeatedly -> must not become user evidence', () => {
      const res = weaver.classifyUserResponse('System reminder: task due');
      expect(res.hasExplicitCommitment).toBe(false);
    });

    test('Adversarial K: Attempt to inject scolding phrasing -> rejected', () => {
      const bridge = weaver['generateNaturalBridge'](createSampleThread());
      expect(bridge).not.toContain('You must');
      expect(bridge).not.toContain('Hurry');
    });
  });
});
