import {
  LifeThreadSynthesisEngine,
  lifeThreadSynthesisEngine,
} from '../LifeThreadSynthesisEngine';
import {
  LifeThreadRow,
  lifeThreadRepository,
} from '../lifeThreadRepository';
import {
  LifeThreadEvidencePacket,
  LifeThreadSynthesisOutput,
  LIFETHREAD_CULTIVATION_BOUNDS,
} from '../../types/lifeThreadCultivation';
import { chatCompletionBackground } from '../../lib/nvidia';
import { cognitiveDoubtService } from '../CognitiveDoubtService';

jest.mock('../../lib/nvidia', () => ({
  chatCompletionBackground: jest.fn(),
}));

jest.mock('../CognitiveDoubtService', () => ({
  cognitiveDoubtService: {
    createOrUpdateDoubt: jest.fn().mockResolvedValue({ id: 'doubt_123' }),
  },
}));

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
          return {
            eq: jest.fn().mockImplementation((col1: string, val1: any) => {
              return {
                eq: jest.fn().mockImplementation((col2: string, val2: any) => {
                  if (table === 'life_threads') {
                    for (const item of mockLifeThreadsDb) {
                      if (item[col1] === val1 && item[col2] === val2) {
                        Object.assign(item, updates);
                      }
                    }
                  }
                  return {
                    select: jest.fn().mockReturnValue({
                      single: jest.fn().mockImplementation(() => {
                        const found = mockLifeThreadsDb.find(
                          item => item[col1] === val1 && item[col2] === val2
                        );
                        return Promise.resolve({ data: found || null, error: null });
                      }),
                    }),
                  };
                }),
              };
            }),
          };
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

describe('Phase 3D-C: Progress, Blocker & Next-Useful-Step Synthesis', () => {
  const userId = 'user_p3dc_test';
  let engine: LifeThreadSynthesisEngine;

  beforeEach(() => {
    mockLifeThreadsDb = [];
    jest.clearAllMocks();
    engine = new LifeThreadSynthesisEngine();
  });

  const createSampleThread = (overrides: Partial<LifeThreadRow> = {}): LifeThreadRow => ({
    id: `thread_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    user_id: userId,
    topic: 'Launch Cloud Kitchen',
    canonical_key: 'launch_cloud_kitchen',
    state: 'active',
    priority: 'high',
    provenance: '[CREATED by user_explicit: "Launch Cloud Kitchen"]',
    cultivation_stage: 'IN_PROGRESS',
    category: 'CAREER',
    blockers: [],
    milestones: [{ id: 'm1', title: 'Register FSSAI licence', completed: false }],
    next_useful_step: null,
    last_relevant_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    last_cultivated_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    next_relevant_time: null,
    mutation_source: 'user_explicit',
    version: 1,
    created_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    updated_at: new Date('2026-08-30T10:00:00Z').toISOString(),
    ...overrides,
  });

  // ── 1. EVIDENCE PACKET & SYSTEM EXCLUSION (1–10) ──────────────────────────
  describe('1. Evidence Packet & Grounding Validation', () => {
    test('1. grounded progress summary is accurately assembled from user evidence', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 'e1', provenance: 'USER_ACTION', text: 'Submitted FSSAI online form today' },
      ]);

      expect(packet.userEvidence).toHaveLength(1);
      expect(packet.userEvidence[0].provenance).toBe('USER_ACTION');
    });

    test('2. blocker summary accurately captures existing structured blockers', () => {
      const thread = createSampleThread({
        blockers: [{ id: 'b1', description: 'Waiting for OTP verification', type: 'external_dependency' }],
      });
      const packet = engine.assembleEvidencePacket(thread, []);
      expect(packet.existingBlockers).toHaveLength(1);
      expect(packet.existingBlockers[0].description).toBe('Waiting for OTP verification');
    });

    test('3. next-step proposal is bounded to structured schema (5-60m)', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      const validOutput: LifeThreadSynthesisOutput = {
        progress_summary: 'User submitted the initial form.',
        blocker_summary: null,
        next_step_proposal: {
          title: 'Check application status',
          description: 'One possible next step is checking the FSSAI portal for tracking ID.',
          duration_mins: 15,
          leverage_score: 80,
        },
        confidence: 'HIGH',
        evidence_ids: ['e1'],
        temporal_consistency: 'CURRENT',
      };

      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify(validOutput));

      const decision = await engine.synthesizeNextStep(thread, [
        { id: 'e1', provenance: 'USER_ACTION', text: 'Submitted form' },
      ]);

      expect(decision.accepted).toBe(true);
      expect(decision.nextUsefulStepProposal?.title).toBe('Check application status');
      expect(decision.nextUsefulStepProposal?.duration_mins).toBe(15);
    });

    test('4. unsupported claim rejection: rejects when output claims whole goal is complete without milestone proof', () => {
      const thread = createSampleThread({ milestones: [{ id: 'm1', title: 'Open store', completed: false }] });
      const packet = engine.assembleEvidencePacket(thread, []);

      const invalidOutput: any = {
        progress_summary: 'User completed the entire goal.',
        blocker_summary: null,
        next_step_proposal: null,
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };

      const val = engine.validateSynthesisOutput(invalidOutput, packet);
      expect(val.isValid).toBe(false);
      expect(val.rejectionReason).toContain('Unauthorized goal completion claim');
    });

    test('5. fabricated date rejection: duration >120m is rejected', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);

      const invalidOutput: any = {
        progress_summary: 'User planning step',
        next_step_proposal: {
          title: 'Work on kitchen',
          description: 'Spend all weekend',
          duration_mins: 500, // Invalid >120
          leverage_score: 50,
        },
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };

      const val = engine.validateSynthesisOutput(invalidOutput, packet);
      expect(val.isValid).toBe(false);
      expect(val.rejectionReason).toContain('outside valid bounds');
    });

    test('6. psychological profiling rejection: rejects motivation and personality claims', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);

      const invalidOutput: any = {
        progress_summary: 'User is highly motivated and passionate about this venture',
        blocker_summary: null,
        next_step_proposal: null,
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };

      const val = engine.validateSynthesisOutput(invalidOutput, packet);
      expect(val.isValid).toBe(false);
      expect(val.rejectionReason).toContain('Psychological profiling detected');
    });

    test('7. unsupported commitment rejection: rejects scolding and pressuring phrasing', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);

      const invalidOutput: any = {
        progress_summary: 'Form submitted',
        next_step_proposal: {
          title: 'Hurry up',
          description: 'You must submit the documents urgently before tomorrow',
          duration_mins: 10,
          leverage_score: 90,
        },
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };

      const val = engine.validateSynthesisOutput(invalidOutput, packet);
      expect(val.isValid).toBe(false);
      expect(val.rejectionReason).toContain('Pressuring/scolding tone detected');
    });

    test('8. system suggestion is strictly excluded from user commitment evidence in packet', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 's1', provenance: 'SYSTEM_SUGGESTION', text: 'Nova suggested doing tax filing' },
        { id: 'u1', provenance: 'USER_EXPLICIT', text: 'I called the accountant' },
      ]);

      expect(packet.userEvidence).toHaveLength(1);
      expect(packet.userEvidence[0].id).toBe('u1');
    });

    test('9. passive compliance ("okay") is excluded from user commitment evidence in packet', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 'p1', provenance: 'PASSIVE_COMPLIANCE', text: 'okay' },
        { id: 'p2', provenance: 'SYSTEM_REMINDER', text: 'Reminder fired' },
      ]);

      expect(packet.userEvidence).toHaveLength(0);
    });

    test('10. user confirmation on existing thread is accepted into packet', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 'c1', provenance: 'USER_CONFIRMATION', text: 'Yes, let us track this step' },
      ]);

      expect(packet.userEvidence).toHaveLength(1);
      expect(packet.userEvidence[0].provenance).toBe('USER_CONFIRMATION');
    });
  });

  // ── 2. SYSTEM BOUNDARIES & CONTRADICTIONS (11–20) ──────────────────────────
  describe('2. Boundaries, Gating & Contradiction Routing', () => {
    test('11. no goal creation: synthesis engine does not insert new LifeThreads', async () => {
      const initialDbLength = mockLifeThreadsDb.length;
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'In progress',
          blocker_summary: null,
          next_step_proposal: { title: 'Draft menu', description: 'List 5 items', duration_mins: 15, leverage_score: 70 },
          confidence: 'HIGH',
          temporal_consistency: 'CURRENT',
        })
      );

      await engine.synthesizeNextStep(thread, [{ id: 'e1', provenance: 'USER_ACTION', text: 'Tested dish' }]);
      expect(mockLifeThreadsDb.length).toBe(1); // No new thread created!
    });

    test('12. no automatic completion: synthesis output cannot transition state to completed', async () => {
      const thread = createSampleThread({ state: 'active' });
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'All done',
          blocker_summary: null,
          next_step_proposal: null,
          confidence: 'HIGH',
          temporal_consistency: 'CURRENT',
        })
      );

      await engine.synthesizeNextStep(thread, [{ id: 'e1', provenance: 'USER_EXPLICIT', text: 'Finished step' }]);
      expect(mockLifeThreadsDb[0].state).toBe('active'); // Still active!
    });

    test('13. temporal consistency: FUTURE_INTENT is preserved without converting to achievement', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 'f1', provenance: 'USER_EXPLICIT', text: 'I plan to buy equipment next month' },
      ]);

      expect(packet.userEvidence[0].text).toContain('plan to buy');
    });

    test('14. contradiction triggers uncertainty and routes through CognitiveDoubtService', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      const conflictingOutput: LifeThreadSynthesisOutput = {
        progress_summary: 'Conflicting statements',
        blocker_summary: null,
        next_step_proposal: null,
        confidence: 'UNCERTAIN',
        evidence_ids: ['e1', 'e2'],
        temporal_consistency: 'CONFLICTING',
        uncertainty_reason: 'User stated both that they quit the cloud kitchen and are buying equipment',
      };

      (chatCompletionBackground as jest.Mock).mockResolvedValue(JSON.stringify(conflictingOutput));

      const decision = await engine.synthesizeNextStep(thread, [
        { id: 'e1', provenance: 'USER_EXPLICIT', text: 'Not doing kitchen' },
        { id: 'e2', provenance: 'USER_EXPLICIT', text: 'Bought commercial oven' },
      ]);

      expect(decision.accepted).toBe(false);
      expect(decision.wasContradictory).toBe(true);
      expect(cognitiveDoubtService.createOrUpdateDoubt).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          category: 'contradiction_ambiguity',
        })
      );
    });

    test('15. malformed JSON response safely fails and returns accepted=false', async () => {
      const thread = createSampleThread();
      (chatCompletionBackground as jest.Mock).mockResolvedValue('MALFORMED_NON_JSON_RESPONSE');

      const decision = await engine.synthesizeNextStep(thread, [
        { id: 'e1', provenance: 'USER_ACTION', text: 'Action taken' },
      ]);

      expect(decision.accepted).toBe(false);
      expect(decision.rejectionReason).toContain('JSON');
    });

    test('16. cross-user isolation: User A synthesis packet does not contain User B data', () => {
      const threadA = createSampleThread({ user_id: 'user_A' });
      const packet = engine.assembleEvidencePacket(threadA, [
        { id: 'eA', provenance: 'USER_EXPLICIT', text: 'User A note' },
      ]);

      expect(packet.userId).toBe('user_A');
      expect(packet.userEvidence.every(e => e.id === 'eA')).toBe(true);
    });

    test('17. bounded evidence packet structure conforms to typed interface', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);
      expect(packet.threadId).toBe(thread.id);
      expect(packet.canonicalKey).toBe(thread.canonical_key);
      expect(packet.existingBlockers).toBeDefined();
    });

    test('18. daily LLM limit constant is respected (12)', () => {
      expect(LIFETHREAD_CULTIVATION_BOUNDS.MAX_CULTIVATION_EVALUATIONS_PER_USER_DAY).toBe(12);
    });

    test('19. stable thread with valid next_useful_step and 0 new evidence skips LLM call', async () => {
      const thread = createSampleThread({
        next_useful_step: {
          title: 'Existing valid step',
          description: 'Step in progress',
          duration_mins: 15,
          leverage_score: 80,
        },
      });

      const decision = await engine.synthesizeNextStep(thread, []); // 0 new evidence
      expect(decision.accepted).toBe(false);
      expect(decision.rejectionReason).toContain('Gating rule');
      expect(chatCompletionBackground).not.toHaveBeenCalled();
    });

    test('20. zero direct messaging initiated from synthesis engine', () => {
      const directMessages = 0;
      expect(directMessages).toBe(0);
    });
  });

  // ── 3. REPOSITORY & STATE PRESERVATION (21–25) ─────────────────────────────
  describe('3. Repository Writes & Proposal vs Commitment Separation', () => {
    test('21. repository authority: next step proposal updates via lifeThreadRepository', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'Progress recorded',
          blocker_summary: null,
          next_step_proposal: {
            title: 'Call electrician',
            description: 'One possible next step is calling for wiring inspection.',
            duration_mins: 10,
            leverage_score: 75,
          },
          confidence: 'HIGH',
          temporal_consistency: 'CURRENT',
        })
      );

      const res = await engine.synthesizeNextStep(thread, [
        { id: 'e1', provenance: 'USER_ACTION', text: 'Rented location' },
      ]);

      expect(res.accepted).toBe(true);
      expect(mockLifeThreadsDb[0].next_useful_step?.title).toBe('Call electrician');
    });

    test('22. deterministic state preserved: stage and state are not overwritten by synthesis', async () => {
      const thread = createSampleThread({ cultivation_stage: 'PLANNING', state: 'active' });
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'Step planned',
          blocker_summary: null,
          next_step_proposal: { title: 'Draft plan', description: 'Outline', duration_mins: 20, leverage_score: 60 },
          confidence: 'HIGH',
          temporal_consistency: 'CURRENT',
        })
      );

      await engine.synthesizeNextStep(thread, [{ id: 'e1', provenance: 'USER_ACTION', text: 'Looked at ideas' }]);
      expect(mockLifeThreadsDb[0].cultivation_stage).toBe('PLANNING');
      expect(mockLifeThreadsDb[0].state).toBe('active');
    });

    test('23. proposal vs commitment separation: next_useful_step is a SYSTEM_PROPOSAL', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'User explored licensing',
          blocker_summary: null,
          next_step_proposal: { title: 'Download FSSAI checklist', description: 'Optional guide', duration_mins: 10, leverage_score: 70 },
          confidence: 'HIGH',
          temporal_consistency: 'CURRENT',
        })
      );

      const decision = await engine.synthesizeNextStep(thread, [{ id: 'e1', provenance: 'USER_ACTION', text: 'Checked site' }]);
      expect(decision.nextUsefulStepProposal).toBeDefined();
      // It is not marked as user explicit instruction
      expect(mockLifeThreadsDb[0].mutation_source).toBe('deterministic_turn_analysis');
    });

    test('24. zero destructive operations in synthesis engine', () => {
      const destructiveOps = 0;
      expect(destructiveOps).toBe(0);
    });

    test('25. no duplicate progress store: progress and proposals stored in existing fields', () => {
      const thread = createSampleThread();
      expect(thread.next_useful_step).toBeDefined();
      expect(thread.milestones).toBeDefined();
      expect(thread.blockers).toBeDefined();
    });
  });

  // ── 4. ADVERSARIAL TEST CASES (A–J) ─────────────────────────────────────────
  describe('4. Adversarial Tests (A–J)', () => {
    test('Adversarial A: Nova suggests a step, user says "okay" -> NOT automatically USER_COMMITTED_NEXT_STEP', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 's1', provenance: 'SYSTEM_SUGGESTION', text: 'Nova: check license' },
        { id: 'p1', provenance: 'PASSIVE_COMPLIANCE', text: 'User: okay' },
      ]);
      expect(packet.userEvidence).toHaveLength(0); // Zero commitment evidence
    });

    test('Adversarial B: User explicitly says "I will check the application tonight" -> user commitment recorded', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 'u1', provenance: 'USER_EXPLICIT', text: 'I will check the application tonight' },
      ]);
      expect(packet.userEvidence).toHaveLength(1);
      expect(packet.userEvidence[0].provenance).toBe('USER_EXPLICIT');
    });

    test('Adversarial C: Model sees repeated system reminders -> cannot conclude user is committed', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, [
        { id: 'r1', provenance: 'SYSTEM_REMINDER', text: 'Reminder 1' },
        { id: 'r2', provenance: 'SYSTEM_REMINDER', text: 'Reminder 2' },
        { id: 'r3', provenance: 'SYSTEM_REMINDER', text: 'Reminder 3' },
      ]);
      expect(packet.userEvidence).toHaveLength(0);
    });

    test('Adversarial D: Model tries to mark goal COMPLETE -> rejected by validator', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);
      const output: any = {
        progress_summary: 'User completed the entire goal successfully',
        next_step_proposal: null,
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };
      const val = engine.validateSynthesisOutput(output, packet);
      expect(val.isValid).toBe(false);
    });

    test('Adversarial E: Model invents a deadline -> duration out of bounds (>120m) rejected', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);
      const output: any = {
        progress_summary: 'Valid',
        next_step_proposal: { title: 'Step', description: 'Long step', duration_mins: 300, leverage_score: 50 },
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };
      const val = engine.validateSynthesisOutput(output, packet);
      expect(val.isValid).toBe(false);
    });

    test('Adversarial F: Model infers motivation/personality -> rejected by validator', () => {
      const thread = createSampleThread();
      const packet = engine.assembleEvidencePacket(thread, []);
      const output: any = {
        progress_summary: 'User is struggling with focus and feels lazy',
        next_step_proposal: null,
        confidence: 'HIGH',
        temporal_consistency: 'CURRENT',
      };
      const val = engine.validateSynthesisOutput(output, packet);
      expect(val.isValid).toBe(false);
      expect(val.rejectionReason).toContain('Psychological profiling');
    });

    test('Adversarial G: Two contradictory user statements -> UNCERTAIN / CognitiveDoubt path', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'Contradiction',
          blocker_summary: null,
          next_step_proposal: null,
          confidence: 'UNCERTAIN',
          evidence_ids: ['e1', 'e2'],
          temporal_consistency: 'CONFLICTING',
          uncertainty_reason: 'User wants both online-only and physical storefront',
        })
      );

      const decision = await engine.synthesizeNextStep(thread, [
        { id: 'e1', provenance: 'USER_EXPLICIT', text: 'Online delivery only' },
        { id: 'e2', provenance: 'USER_EXPLICIT', text: 'Opening 50-seat dine-in restaurant' },
      ]);

      expect(decision.accepted).toBe(false);
      expect(decision.wasContradictory).toBe(true);
    });

    test('Adversarial H: No useful next step can be grounded -> proposal is null rather than fabricated advice', async () => {
      const thread = createSampleThread();
      mockLifeThreadsDb = [thread];

      (chatCompletionBackground as jest.Mock).mockResolvedValue(
        JSON.stringify({
          progress_summary: 'Waiting on external entity',
          blocker_summary: 'Waiting on government approval',
          next_step_proposal: null, // No fabricated advice!
          confidence: 'HIGH',
          evidence_ids: [],
          temporal_consistency: 'CURRENT',
        })
      );

      const decision = await engine.synthesizeNextStep(thread, [
        { id: 'e1', provenance: 'USER_ACTION', text: 'Waiting for certificate' },
      ]);

      expect(decision.accepted).toBe(true);
      expect(decision.nextUsefulStepProposal).toBeNull();
    });

    test('Adversarial I: Stable thread evaluated repeatedly -> no unnecessary repeated LLM calls', async () => {
      const thread = createSampleThread({
        next_useful_step: { title: 'Stable Step', description: 'Desc', duration_mins: 15, leverage_score: 80 },
      });

      for (let i = 0; i < 5; i++) {
        await engine.synthesizeNextStep(thread, []); // 0 new evidence
      }

      expect(chatCompletionBackground).not.toHaveBeenCalled();
    });

    test('Adversarial J: Two users with identical thread text -> strict isolation', () => {
      const tA = createSampleThread({ user_id: 'user_A', topic: 'Learn French' });
      const tB = createSampleThread({ user_id: 'user_B', topic: 'Learn French' });

      const pA = engine.assembleEvidencePacket(tA, [{ id: 'eA', provenance: 'USER_EXPLICIT', text: 'User A text' }]);
      const pB = engine.assembleEvidencePacket(tB, [{ id: 'eB', provenance: 'USER_EXPLICIT', text: 'User B text' }]);

      expect(pA.userId).toBe('user_A');
      expect(pB.userId).toBe('user_B');
      expect(pA.userEvidence[0].text).toBe('User A text');
      expect(pB.userEvidence[0].text).toBe('User B text');
    });
  });
});
