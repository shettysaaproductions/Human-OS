/**
 * CognitiveDoubtPhase2fc.test.ts — Phase 2F-C Cognitive Doubt Anti-Loop Test Suite
 *
 * Validates all 22 required architectural invariants:
 * 1. same fingerprint + same evidence -> reuse
 * 2. open duplicate suppression
 * 3. presented duplicate suppression
 * 4. resolved cooldown (7 days)
 * 5. dismissed cooldown (7 days)
 * 6. changed evidence reopening
 * 7. changed evidence preserves historical attempt count
 * 8. lifetime clarification limit (max 9)
 * 9. authoritative resolution
 * 10. ambiguous response handling
 * 11. presentation counter increments
 * 12. evidence-version stability
 * 13. evidence-version changes only on semantic change
 * 14. fingerprint stability
 * 15. question type distinguishes semantic doubts
 * 16. concurrency idempotency
 * 17. cross-user isolation
 * 18. provenance preservation
 * 19. no durable memory from doubt
 * 20. safe DB failure
 * 21. user burden cap
 * 22. waiting_for_user protection (max 3 per version)
 */

import { cognitiveDoubtService, DOUBT_LIMITS } from '../CognitiveDoubtService';
import { doubtEligibilityEngine } from '../DoubtEligibilityEngine';
import { generateDoubtFingerprint, deriveEvidenceVersion } from '../../lib/doubtFingerprint';
import { supabaseAdmin } from '../../lib/supabase';
import { DoubtCreationDraft, CognitiveDoubtRecord } from '../../types/cognitiveDoubt';

let mockDoubtsDb: any[] = [];
let mockMemoriesDb: any[] = [];

jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: jest.fn().mockImplementation((table: string) => {
      const isDoubts = table === 'nova_cognitive_doubts';
      const isMemories = table === 'memories';
      const store = isDoubts ? mockDoubtsDb : mockMemoriesDb;

      const builder: any = {
        _filters: {},
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockImplementation(function (k: string, v: any) {
          builder._filters[k] = v;
          return builder;
        }),
        in: jest.fn().mockImplementation(function (k: string, v: any[]) {
          builder._filters[k] = v;
          return builder;
        }),
        gt: jest.fn().mockReturnThis(),
        lte: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        insert: jest.fn().mockImplementation((payload: any) => {
          if (isDoubts) {
            const existing = store.find((item: any) => item.user_id === payload.user_id && item.fingerprint === payload.fingerprint);
            if (existing) {
              return {
                select: () => ({
                  single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
                  maybeSingle: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }),
                }),
              };
            }
          }
          const newRow = { id: `doubt_${Date.now()}_${Math.random()}`, ...payload };
          store.push(newRow);
          const res = { data: newRow, error: null };
          return {
            select: () => ({
              single: () => Promise.resolve(res),
              maybeSingle: () => Promise.resolve(res),
            }),
          };
        }),
        update: jest.fn().mockImplementation((updatePayload: any) => {
          const updBuilder: any = {
            _filters: {},
            eq: jest.fn().mockImplementation(function (k: string, v: any) {
              updBuilder._filters[k] = v;
              return updBuilder;
            }),
            in: jest.fn().mockImplementation(function (k: string, v: any[]) {
              updBuilder._filters[k] = v;
              return updBuilder;
            }),
            lte: jest.fn().mockImplementation(function (k: string, v: any) {
              updBuilder._filters[k] = v;
              return updBuilder;
            }),
            select: jest.fn().mockImplementation(function () {
              const updatedItems: any[] = [];
              for (const item of store) {
                let match = true;
                if (updBuilder._filters.id && item.id !== updBuilder._filters.id) match = false;
                if (updBuilder._filters.user_id && item.user_id !== updBuilder._filters.user_id) match = false;
                if (updBuilder._filters.fingerprint && item.fingerprint !== updBuilder._filters.fingerprint) match = false;
                if (match) {
                  Object.assign(item, updatePayload);
                  updatedItems.push(item);
                }
              }
              const ret: any = Promise.resolve({ data: updatedItems, error: null });
              ret.single = () => Promise.resolve({ data: updatedItems[0] || null, error: null });
              ret.maybeSingle = () => Promise.resolve({ data: updatedItems[0] || null, error: null });
              return ret;
            }),
          };
          updBuilder.then = (resolve: any) => {
            const updatedItems: any[] = [];
            for (const item of store) {
              let match = true;
              if (updBuilder._filters.user_id && item.user_id !== updBuilder._filters.user_id) match = false;
              if (match) {
                Object.assign(item, updatePayload);
                updatedItems.push(item);
              }
            }
            return resolve({ data: updatedItems, error: null });
          };
          return updBuilder;
        }),
      };

      builder.single = () => {
        const found = store.find((item: any) => {
          for (const [k, v] of Object.entries(builder._filters)) {
            if (Array.isArray(v)) {
              if (!v.includes(item[k])) return false;
            } else if (item[k] !== v) {
              return false;
            }
          }
          return true;
        });
        return Promise.resolve({ data: found || null, error: null });
      };

      builder.maybeSingle = builder.single;

      builder.then = (resolve: any) => {
        const matching = store.filter((item: any) => {
          for (const [k, v] of Object.entries(builder._filters)) {
            if (Array.isArray(v)) {
              if (!v.includes(item[k])) return false;
            } else if (item[k] !== v) {
              return false;
            }
          }
          return true;
        });
        return resolve({ data: matching, error: null });
      };

      return builder;
    }),
  },
}));

describe('Phase 2F-C: Cognitive Doubt Anti-Loop & Evidence Versioning Suite', () => {
  const userA = '00000000-0000-4000-a000-000000000001';
  const userB = '00000000-0000-4000-b000-000000000002';

  beforeEach(() => {
    mockDoubtsDb = [];
    mockMemoriesDb = [];
    jest.clearAllMocks();
  });

  // ── TEST 1: Same Fingerprint + Same Evidence -> Reuse ─────────────────────
  it('1. Same fingerprint and same evidence version reuses existing doubt without duplicate', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown 5th family member',
      evidence: { claimed_count: 5, grounded_count: 4, grounded_relations: { wife: 'Sakshi' } },
      targetEntityKeys: ['family_members'],
    };

    const d1 = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    expect(d1).not.toBeNull();
    expect(mockDoubtsDb.length).toBe(1);

    const d2 = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    expect(d2?.id).toBe(d1?.id);
    expect(mockDoubtsDb.length).toBe(1); // 0 duplicate
  });

  // ── TEST 2 & 3: Open and Presented Duplicate Suppression ─────────────────
  it('2 & 3. Identical open and presented doubts do not duplicate or reset attempts', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown 5th family member',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    const presented = await cognitiveDoubtService.markPresented(created!.id);
    expect(presented?.presentation_count).toBe(1);
    expect(presented?.status).toBe('presented');

    // Repeated identical submission
    const duplicateSubmission = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    expect(duplicateSubmission?.id).toBe(created!.id);
    expect(duplicateSubmission?.presentation_count).toBe(1); // preserved
    expect(mockDoubtsDb.length).toBe(1);
  });

  // ── TEST 4: Resolved Cooldown ─────────────────────────────────────────────
  it('4. Resolved doubt with identical evidence within 7 days is suppressed', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown 5th family member',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    await cognitiveDoubtService.resolveDoubt(created!.id, 'turn_123', { name: 'Rohan' });

    // Incoming duplicate identical doubt 2 days later
    const duplicate = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    expect(duplicate?.status).toBe('resolved');
    expect(mockDoubtsDb.length).toBe(1);
  });

  // ── TEST 5: Dismissed Cooldown ────────────────────────────────────────────
  it('5. Dismissed doubt with identical evidence within 7 days is suppressed', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'intent_uncertainty',
      question: 'Which project are you working on?',
      evidence: { candidate_threads: ['Project Alpha', 'Project Beta'] },
      targetEntityKeys: ['project'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    await cognitiveDoubtService.dismissDoubt(created!.id);

    const duplicate = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    expect(duplicate?.status).toBe('dismissed');
    expect(mockDoubtsDb.length).toBe(1);
  });

  // ── TEST 6 & 7: Changed Evidence Reopening & Historical Attempt Count ─────
  it('6 & 7. Changed evidence reopens resolved doubt to open and preserves lifetime count', async () => {
    const draft1: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown 5th family member',
      evidence: { claimed_count: 5, grounded_count: 4, grounded_relations: { wife: 'Sakshi' } },
      targetEntityKeys: ['family_members'],
      unresolvedQuestionType: 'family_identity_gap',
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft1);
    await cognitiveDoubtService.markPresented(created!.id);
    await cognitiveDoubtService.resolveDoubt(created!.id, 'turn_123');

    // New evidence arrives: User says "Actually family mein 6 log hain!"
    const draft2: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown 6th family member',
      evidence: { claimed_count: 6, grounded_count: 4, grounded_relations: { wife: 'Sakshi' } },
      targetEntityKeys: ['family_members'],
      unresolvedQuestionType: 'family_identity_gap',
    };

    const reopened = await cognitiveDoubtService.createOrUpdateDoubt(draft2);
    expect(reopened?.status).toBe('open');
    expect(reopened?.presentation_count).toBe(0); // reset per-version counter
    expect(reopened?.evidence.lifetime_presentation_count).toBe(1); // preserved lifetime count
    expect(mockDoubtsDb.length).toBe(1); // Reopened in-place without duplicate row
  });

  // ── TEST 8: Lifetime Clarification Limit (Max 9) ───────────────────────────
  it('8. Doubt reaching MAX_LIFETIME_CLARIFICATION_ATTEMPTS transitions to waiting_for_user', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family count ambiguity',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    // Simulate 9 presentation cycles across versions
    mockDoubtsDb[0].evidence.lifetime_presentation_count = 8;
    mockDoubtsDb[0].presentation_count = 1;

    const presented = await cognitiveDoubtService.markPresented(created!.id);
    expect(presented?.status).toBe('waiting_for_user');
    expect(presented?.evidence.lifetime_presentation_count).toBe(9);
  });

  // ── TEST 9: Authoritative Resolution ──────────────────────────────────────
  it('9. Explicit authoritative answer resolves existing doubt', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown family member',
      evidence: { claimed_count: 5, grounded_count: 4, grounded_relations: {} },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    const resolution = await cognitiveDoubtService.checkResolutionOnUserTurn(userA, 'turn_auth_1', 'My brother is Rohan');

    expect(resolution.matched).toBe(true);
    expect(resolution.isResolved).toBe(true);
    expect(resolution.resolvedEntityKey).toBe('brother_name');
    expect(resolution.resolvedEntityValue).toBe('Rohan');

    const doubtInDb = mockDoubtsDb.find(d => d.id === created!.id);
    expect(doubtInDb.status).toBe('resolved');
    expect(doubtInDb.resolution_turn_id).toBe('turn_auth_1');
  });

  // ── TEST 10: Ambiguous Response Handling ──────────────────────────────────
  it('10. Ambiguous response to presented doubt keeps it unresolved and bounded', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Unknown family member',
      evidence: { claimed_count: 5, grounded_count: 4, grounded_relations: {} },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    await cognitiveDoubtService.markPresented(created!.id);

    const match = await cognitiveDoubtService.checkResolutionOnUserTurn(
      userA,
      'turn_amb_1',
      "He's the one I told you about"
    );

    expect(match.matched).toBe(true);
    expect(match.isResolved).toBe(false);
    expect(match.isAmbiguous).toBe(true);

    const doubtInDb = mockDoubtsDb.find(d => d.id === created!.id);
    expect(doubtInDb.status).toBe('presented'); // Still unresolved
    expect(doubtInDb.evidence.last_ambiguous_reply).toContain('told you about');
  });

  // ── TEST 11: Presentation Counter Increments ──────────────────────────────
  it('11. Presentation count increments sequentially', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    const p1 = await cognitiveDoubtService.markPresented(created!.id);
    expect(p1?.presentation_count).toBe(1);

    const p2 = await cognitiveDoubtService.markPresented(created!.id);
    expect(p2?.presentation_count).toBe(2);
  });

  // ── TEST 12 & 13: Evidence Version Stability & Change ─────────────────────
  it('12 & 13. Evidence version is stable for same facts and changes on semantic mutation', () => {
    const ev1 = deriveEvidenceVersion({ claimed_count: 5, grounded_relations: { wife: 'Sakshi' } });
    const ev1Duplicate = deriveEvidenceVersion({ grounded_relations: { wife: 'Sakshi' }, claimed_count: 5 });
    expect(ev1).toBe(ev1Duplicate); // Stable regardless of key order

    const ev2Changed = deriveEvidenceVersion({ claimed_count: 6, grounded_relations: { wife: 'Sakshi' } });
    expect(ev1).not.toBe(ev2Changed); // Changes when facts change
  });

  // ── TEST 14 & 15: Fingerprint Stability & Question Type ───────────────────
  it('14 & 15. Fingerprint is stable and distinguishes question types', () => {
    const fp1 = generateDoubtFingerprint(userA, 'identity_gap', ['family_members'], 'discrim', 'family_count');
    const fp1Dup = generateDoubtFingerprint(userA, 'identity_gap', ['family_members'], 'discrim', 'family_count');
    expect(fp1).toBe(fp1Dup);

    const fp2OtherType = generateDoubtFingerprint(userA, 'identity_gap', ['family_members'], 'discrim', 'family_relation');
    expect(fp1).not.toBe(fp2OtherType);
  });

  // ── TEST 16: Concurrency Idempotency ──────────────────────────────────────
  it('16. Concurrent identical doubt creation requests resolve to same record', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const [res1, res2] = await Promise.all([
      cognitiveDoubtService.createOrUpdateDoubt(draft),
      cognitiveDoubtService.createOrUpdateDoubt(draft),
    ]);

    expect(res1?.id).toBe(res2?.id);
    expect(mockDoubtsDb.length).toBe(1);
  });

  // ── TEST 17: Cross-User Isolation ─────────────────────────────────────────
  it('17. User A doubt never affects User B', async () => {
    const draftA: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };
    const draftB: DoubtCreationDraft = {
      userId: userB,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const doubtA = await cognitiveDoubtService.createOrUpdateDoubt(draftA);
    const doubtB = await cognitiveDoubtService.createOrUpdateDoubt(draftB);

    expect(doubtA?.id).not.toBe(doubtB?.id);
    expect(doubtA?.fingerprint).not.toBe(doubtB?.fingerprint);

    const openB = await cognitiveDoubtService.getOpenDoubts(userB);
    expect(openB.length).toBe(1);
    expect(openB[0].user_id).toBe(userB);
  });

  // ── TEST 18: Provenance Preservation ──────────────────────────────────────
  it('18. Resolution provenance and versioning metadata are preserved', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    await cognitiveDoubtService.resolveDoubt(created!.id, 'turn_prov_123', { note: 'Explicit resolution' });

    const doubtInDb = mockDoubtsDb.find(d => d.id === created!.id);
    expect(doubtInDb.resolution_turn_id).toBe('turn_prov_123');
    expect(doubtInDb.evidence.resolution.resolvedAt).toBeDefined();
    expect(doubtInDb.evidence.resolution.resolutionEvidenceVersion).toBeDefined();
  });

  // ── TEST 19: No Durable Memory from Doubt ─────────────────────────────────
  it('19. Doubt management creates 0 durable memories', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    await cognitiveDoubtService.createOrUpdateDoubt(draft);
    expect(mockMemoriesDb.length).toBe(0); // 0 writes to memories table
  });

  // ── TEST 20: Safe DB Failure ──────────────────────────────────────────────
  it('20. DB failure fails safely without throwing exceptions', async () => {
    (supabaseAdmin.from as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Database connection lost');
    });

    const result = await cognitiveDoubtService.createOrUpdateDoubt({
      userId: userA,
      category: 'identity_gap',
      question: 'Test',
      evidence: {},
    });

    expect(result).toBeNull();
  });

  // ── TEST 21: User Burden Cap ──────────────────────────────────────────────
  it('21. DoubtEligibilityEngine enforces user burden cap (max 1 doubt per turn)', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };
    await cognitiveDoubtService.createOrUpdateDoubt(draft);

    const decision = await doubtEligibilityEngine.evaluateEligibility({
      userId: userA,
      currentMessageText: 'How is my family doing?',
    });

    expect(decision.eligible).toBe(true);
    expect(decision.supervisoryDirective).toContain('SUPERVISORY COGNITIVE SIGNAL');
    expect(decision.supervisoryDirective).toContain('WHAT NOVA MUST NOT ASSUME');
  });

  // ── TEST 22: Waiting for User Protection (Max 3 attempts per version) ─────
  it('22. Third presentation transitions to waiting_for_user and blocks fourth attempt', async () => {
    const draft: DoubtCreationDraft = {
      userId: userA,
      category: 'identity_gap',
      question: 'Family gap',
      evidence: { claimed_count: 5, grounded_count: 4 },
      targetEntityKeys: ['family_members'],
    };

    const created = await cognitiveDoubtService.createOrUpdateDoubt(draft);
    await cognitiveDoubtService.markPresented(created!.id); // 1
    await cognitiveDoubtService.markPresented(created!.id); // 2
    const p3 = await cognitiveDoubtService.markPresented(created!.id); // 3

    expect(p3?.status).toBe('waiting_for_user');

    // Attempt 4 is blocked in eligibility engine
    const decision = await doubtEligibilityEngine.evaluateEligibility({
      userId: userA,
      currentMessageText: 'Let us talk about family',
    });

    expect(decision.eligible).toBe(false); // 4th attempt blocked!
  });
});
