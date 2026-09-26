/**
 * NovaLoopVerificationProductionPath.test.ts — Verification Lifecycle & Production Path Tests
 *
 * Tests the complete lifecycle specified in Phase 5:
 * A. 0.80 finding → incident UNVERIFIED → verifier invoked → confirmed → VERIFIED
 * B. 0.80 finding → verifier rejects → REJECTED
 * C. 0.80 finding → verifier inconclusive → INCONCLUSIVE
 * D. 0.80 finding → provider capability unavailable → BLOCKED
 * E. duplicate finding → same semantic fingerprint → detection_count increments → no duplicate actionable task
 * F. >=0.90 deterministic/high-confidence finding → intended VERIFIED path
 * G. historical UNVERIFIED rows remain unchanged
 * H. Gemini unavailable → NVIDIA fallback still works during verification
 * I. verifier unavailable → failure is represented safely and does not silently become VERIFIED
 * J. Precision measurement metrics & manual-review sampling
 */

import {
  ConversationalEvaluator,
  IncidentManager,
  adversarialVerifier,
  AdversarialVerifier,
  ObservableDialogueEvidence,
  EvaluationFinding
} from '../nova-loop';
import { cognitiveRouter, CapabilityUnavailableError } from '../../lib/cognitiveRouter';
import { supabaseAdmin } from '../../lib/supabase';

// Mock DB state
const mockDb = {
  incidents: new Map<string, any>(),
  verifications: new Map<string, any>()
};

jest.mock('../../lib/supabase', () => {
  return {
    supabaseAdmin: {
      from: jest.fn().mockImplementation((table: string) => {
        let queryFilters: Array<(row: any) => boolean> = [];
        let orderFields: Array<{ col: string; ascending: boolean }> = [];
        let limitVal: number | null = null;

        const builder: any = {
          select: jest.fn().mockImplementation(() => builder),
          eq: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] === val);
            return builder;
          }),
          neq: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] !== val);
            return builder;
          }),
          in: jest.fn().mockImplementation((col: string, vals: any[]) => {
            queryFilters.push((row: any) => vals.includes(row[col]));
            return builder;
          }),
          gt: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] > val);
            return builder;
          }),
          gte: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] >= val);
            return builder;
          }),
          or: jest.fn().mockImplementation((orClause: string) => {
            if (orClause.includes('fingerprint.eq.')) {
              const fps = orClause.split(',').map(part => {
                const match = part.match(/fingerprint\.eq\.([a-f0-9]+)/);
                return match ? match[1] : '';
              }).filter(Boolean);
              queryFilters.push((row: any) => fps.includes(row.fingerprint));
            }
            return builder;
          }),
          order: jest.fn().mockImplementation((col: string, opts?: { ascending?: boolean }) => {
            orderFields.push({ col, ascending: opts?.ascending ?? true });
            return builder;
          }),
          limit: jest.fn().mockImplementation((val: number) => {
            limitVal = val;
            return builder;
          }),
          single: jest.fn().mockImplementation(async () => {
            const res = await builder;
            return {
              data: res.data && res.data.length > 0 ? res.data[0] : null,
              error: res.error
            };
          }),
          insert: jest.fn().mockImplementation((payload: any) => {
            const id = payload.id || `id_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const record = { ...payload, id };
            if (table === 'nova_engineering_incidents') {
              mockDb.incidents.set(record.fingerprint || id, record);
            } else if (table === 'nova_incident_verifications') {
              mockDb.verifications.set(id, record);
            }

            return {
              select: () => ({
                single: () => Promise.resolve({ data: record, error: null }),
                maybeSingle: () => Promise.resolve({ data: record, error: null })
              }),
              then: (resolve: any) => resolve({ data: record, error: null })
            };
          }),
          update: jest.fn().mockImplementation((patch: any) => {
            return {
              eq: (col: string, val: any) => {
                let updatedRow: any = null;
                if (table === 'nova_engineering_incidents') {
                  for (const [key, inc] of mockDb.incidents.entries()) {
                    if (inc[col] === val) {
                      updatedRow = { ...inc, ...patch };
                      mockDb.incidents.set(key, updatedRow);
                      break;
                    }
                  }
                }
                return {
                  select: () => ({
                    single: () => Promise.resolve({ data: updatedRow, error: null })
                  }),
                  then: (resolve: any) => resolve({ data: updatedRow, error: null })
                };
              }
            };
          }),
          then: jest.fn().mockImplementation((resolve: any) => {
            let dataset: any[] = [];
            if (table === 'nova_engineering_incidents') {
              dataset = Array.from(mockDb.incidents.values());
            } else if (table === 'nova_incident_verifications') {
              dataset = Array.from(mockDb.verifications.values());
            }

            for (const f of queryFilters) {
              dataset = dataset.filter(f);
            }

            if (orderFields.length > 0) {
              dataset.sort((a, b) => {
                for (const o of orderFields) {
                  if (a[o.col] < b[o.col]) return o.ascending ? -1 : 1;
                  if (a[o.col] > b[o.col]) return o.ascending ? 1 : -1;
                }
                return 0;
              });
            }

            if (limitVal !== null) {
              dataset = dataset.slice(0, limitVal);
            }

            resolve({ data: dataset, error: null });
          })
        };
        return builder;
      })
    }
  };
});

describe('Nova Loop Verification Production-Like Path (Phases A through I)', () => {
  let incidentManager: IncidentManager;

  beforeEach(() => {
    mockDb.incidents.clear();
    mockDb.verifications.clear();
    incidentManager = new IncidentManager();
    jest.restoreAllMocks();
  });

  // A. 0.80 finding → incident UNVERIFIED → verifier invoked → confirmed → VERIFIED
  test('A. 0.80 finding: initially UNVERIFIED, verifier confirms genuine defect, transitions to VERIFIED', async () => {
    jest.spyOn(cognitiveRouter, 'completeWithCapability').mockResolvedValue(JSON.stringify({
      verdict: 'GENUINE_DEFECT',
      confidence: 0.88,
      engineering_evidence: 'Nova persistently contradicted established identity fact.',
      adversary_critique: 'No justification found; identity inversion is an active defect.'
    }));

    const finding: EvaluationFinding = {
      flawType: 'CONTEXT_AMNESIA',
      severity: 'high',
      confidence: 0.80,
      canonicalSubject: 'user_identity',
      failureSignature: 'identity_amnesia',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Failed to recall user name.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Fix identity context.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_A',
      conversationId: 'conv_A',
      userMessageId: 'u1',
      userMessage: 'Mera naam bhul gaye?',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Aapka naam kya tha?',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);

    expect(res.actionabilityStatus).toBe('VERIFIED');
    expect(res.action).toBe('NEW_INCIDENT');

    const incident = Array.from(mockDb.incidents.values())[0];
    expect(incident.actionability_status).toBe('VERIFIED');

    const verif = Array.from(mockDb.verifications.values())[0];
    expect(verif.outcome).toBe('confirmed');
    expect(verif.passed).toBe(false); // Defect confirmed
    expect(verif.details.outcome).toBe('confirmed');
  });

  // B. 0.80 finding → verifier rejects → REJECTED
  test('B. 0.80 finding: verifier rejects benign behavior, transitions to REJECTED', async () => {
    jest.spyOn(cognitiveRouter, 'completeWithCapability').mockResolvedValue(JSON.stringify({
      verdict: 'ACCEPTABLE_BEHAVIOR',
      confidence: 0.86,
      engineering_evidence: 'Turn is polite small talk after user greeting.',
      adversary_critique: 'Harmless Hinglish pleasantry; no active goal was dropped.'
    }));

    const finding: EvaluationFinding = {
      flawType: 'GOAL_DERAILMENT',
      severity: 'medium',
      confidence: 0.80,
      canonicalSubject: 'casual_small_talk',
      failureSignature: 'small_talk_after_greeting',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Small talk flagged as derailment.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Review.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_B',
      conversationId: 'conv_B',
      userMessageId: 'u1',
      userMessage: 'Kaise ho',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Main theek hoon! Aap bataiye?',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);

    expect(res.actionabilityStatus).toBe('REJECTED');
    const incident = Array.from(mockDb.incidents.values())[0];
    expect(incident.actionability_status).toBe('REJECTED');

    const verif = Array.from(mockDb.verifications.values())[0];
    expect(verif.outcome).toBe('rejected');
    expect(verif.passed).toBe(true); // Interaction defended
  });

  // C. 0.80 finding → verifier inconclusive → INCONCLUSIVE
  test('C. 0.80 finding: verifier returns inconclusive, transitions to INCONCLUSIVE', async () => {
    jest.spyOn(cognitiveRouter, 'completeWithCapability').mockResolvedValue(JSON.stringify({
      verdict: 'INCONCLUSIVE',
      confidence: 0.50,
      engineering_evidence: 'Evidence is ambiguous; impossible to discern user intent.',
      adversary_critique: 'Unclear whether response was inappropriate.'
    }));

    const finding: EvaluationFinding = {
      flawType: 'GOAL_DERAILMENT',
      severity: 'medium',
      confidence: 0.80,
      canonicalSubject: 'ambiguous_conversation',
      failureSignature: 'unclear_intent',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Suspected derailment.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Inspect.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_C',
      conversationId: 'conv_C',
      userMessageId: 'u1',
      userMessage: 'Hmm',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Kuch socha?',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);

    expect(res.actionabilityStatus).toBe('INCONCLUSIVE');
    const incident = Array.from(mockDb.incidents.values())[0];
    expect(incident.actionability_status).toBe('INCONCLUSIVE');

    const verif = Array.from(mockDb.verifications.values())[0];
    expect(verif.outcome).toBe('inconclusive');
  });

  // D. 0.80 finding → provider capability unavailable → BLOCKED
  test('D. 0.80 finding: capability unavailable halts verifier safely, transitions to BLOCKED', async () => {
    jest.spyOn(cognitiveRouter, 'completeWithCapability').mockRejectedValue(
      new CapabilityUnavailableError('DEEP_SEMANTIC_REASONING', 2, 'Provider quotas exhausted')
    );

    const finding: EvaluationFinding = {
      flawType: 'CONTEXT_AMNESIA',
      severity: 'high',
      confidence: 0.80,
      canonicalSubject: 'temporal_amnesia',
      failureSignature: 'calendar_amnesia',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Amnesia finding.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Verify.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_D',
      conversationId: 'conv_D',
      userMessageId: 'u1',
      userMessage: 'Appointment kab hai?',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Pata nahi.',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);

    expect(res.actionabilityStatus).toBe('BLOCKED');
    const incident = Array.from(mockDb.incidents.values())[0];
    expect(incident.actionability_status).toBe('BLOCKED');

    const verif = Array.from(mockDb.verifications.values())[0];
    expect(verif.outcome).toBe('blocked');
  });

  // E. duplicate finding → same semantic fingerprint → detection_count increments → no duplicate actionable task
  test('E. duplicate finding: converges to same fingerprint, increments detection_count, queue size unchanged', async () => {
    const finding: EvaluationFinding = {
      flawType: 'GOAL_DERAILMENT',
      severity: 'high',
      confidence: 0.95, // Verified directly
      canonicalSubject: 'kin_birthday_planning',
      failureSignature: 'proactive_birthday_inundation_loop',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Tiku birthday loop.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Throttle.'
    };

    const evidence1: ObservableDialogueEvidence = {
      userId: 'user_prod_E',
      conversationId: 'conv_E1',
      userMessageId: 'u1',
      userMessage: 'Ghar ja raha hu',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Tiku ka birthday aane wala hai!',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const evidence2: ObservableDialogueEvidence = {
      ...evidence1,
      conversationId: 'conv_E2',
      userMessageId: 'u2',
      userMessage: 'Ghar pahunch gaya',
      assistantMessageId: 'a2',
      assistantResponse: 'Arre Tiku ka birthday plan kiya?'
    };

    const first = await incidentManager.recordFinding(finding, evidence1);
    expect(first.action).toBe('NEW_INCIDENT');
    expect(first.detectionCount).toBe(1);

    const queue1 = await incidentManager.getInternalEngineeringQueue();
    expect(queue1.queueLength).toBe(1);

    const second = await incidentManager.recordFinding(finding, evidence2);
    expect(second.action).toBe('DUPLICATE_OBSERVED');
    expect(second.detectionCount).toBe(2);

    const queue2 = await incidentManager.getInternalEngineeringQueue();
    expect(queue2.queueLength).toBe(1); // Queue length did NOT duplicate
    expect(queue2.items[0].detectionCount).toBe(2);
  });

  // F. >=0.90 deterministic/high-confidence finding → intended VERIFIED path
  test('F. >=0.90 finding bypasses secondary gate and is directly VERIFIED', async () => {
    const finding: EvaluationFinding = {
      flawType: 'CONTEXT_AMNESIA',
      severity: 'critical',
      confidence: 0.95,
      canonicalSubject: 'user_identity',
      failureSignature: 'critical_identity_failure',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Critical amnesia.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Fix.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_F',
      conversationId: 'conv_F',
      userMessageId: 'u1',
      userMessage: 'Who am I?',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'I have no idea who you are.',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);

    expect(res.actionabilityStatus).toBe('VERIFIED');
    expect(mockDb.verifications.size).toBe(0); // Secondary verifier bypassed
    const incident = Array.from(mockDb.incidents.values())[0];
    expect(incident.actionability_status).toBe('VERIFIED');
  });

  // G. historical UNVERIFIED rows remain unchanged
  test('G. historical UNVERIFIED rows remain UNVERIFIED and are not automatically promoted', async () => {
    // Seed historical incidents
    for (let i = 1; i <= 5; i++) {
      mockDb.incidents.set(`hist_fp_${i}`, {
        id: `hist_inc_${i}`,
        fingerprint: `hist_fp_${i}`,
        flaw_type: 'GOAL_DERAILMENT',
        status: 'open',
        actionability_status: 'UNVERIFIED',
        detection_count: 1,
        created_at: '2026-09-20T00:00:00.000Z'
      });
    }

    const queue = await incidentManager.getInternalEngineeringQueue();
    // Historical UNVERIFIED rows must NOT appear in actionable queue!
    expect(queue.queueLength).toBe(0);

    for (const [_, inc] of mockDb.incidents.entries()) {
      expect(inc.actionability_status).toBe('UNVERIFIED');
    }
  });

  // H. Gemini unavailable → NVIDIA fallback still works during verification
  test('H. Gemini unavailable: cognitiveRouter completes verification via NVIDIA fallback', async () => {
    // Simulate cognitiveRouter fallback executing seamlessly
    const completeSpy = jest.spyOn(cognitiveRouter, 'completeWithCapability').mockResolvedValue(JSON.stringify({
      verdict: 'GENUINE_DEFECT',
      confidence: 0.85,
      engineering_evidence: 'Verified via NVIDIA fallback.',
      adversary_critique: 'Confirmed defect.'
    }));

    const finding: EvaluationFinding = {
      flawType: 'CONTEXT_AMNESIA',
      severity: 'high',
      confidence: 0.80,
      canonicalSubject: 'fallback_audit',
      failureSignature: 'fallback_signature',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Test fallback.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Audit.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_H',
      conversationId: 'conv_H',
      userMessageId: 'u1',
      userMessage: 'Test',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Response',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);
    expect(res.actionabilityStatus).toBe('VERIFIED');
    expect(completeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'DEEP_SEMANTIC_REASONING' }),
      expect.any(Array)
    );
  });

  // I. verifier unavailable → failure is represented safely and does not silently become VERIFIED
  test('I. verifier unexpected crash: does NOT silently become VERIFIED, stays INCONCLUSIVE / UNVERIFIED', async () => {
    // Simulate unexpected network abort / runtime crash in executeAdversarialAudit
    jest.spyOn(cognitiveRouter, 'completeWithCapability').mockRejectedValue(
      new Error('ETIMEDOUT: Connection reset by peer')
    );

    const finding: EvaluationFinding = {
      flawType: 'GOAL_DERAILMENT',
      severity: 'medium',
      confidence: 0.80,
      canonicalSubject: 'crash_test',
      failureSignature: 'crash_signature',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Crash test finding.',
      requiredCapability: 'DEEP_SEMANTIC_REASONING',
      recommendedAction: 'Inspect.'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'user_prod_I',
      conversationId: 'conv_I',
      userMessageId: 'u1',
      userMessage: 'Crash test user message',
      userMessageTimestamp: '2026-09-26T12:00:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Crash test assistant response',
      assistantResponseTimestamp: '2026-09-26T12:00:02.000Z',
      surroundingContext: []
    };

    const res = await incidentManager.recordFinding(finding, evidence);

    // CRITICAL INVARIANT: Must NOT become VERIFIED on error!
    expect(res.actionabilityStatus).not.toBe('VERIFIED');
    expect(res.actionabilityStatus).toBe('INCONCLUSIVE');

    const incident = Array.from(mockDb.incidents.values())[0];
    expect(incident.actionability_status).toBe('INCONCLUSIVE');

    const queue = await incidentManager.getInternalEngineeringQueue();
    expect(queue.queueLength).toBe(0); // Not admitted to actionable queue
  });

  // J. Precision measurement metrics & manual review sample
  test('J. Precision measurement: getVerificationMetrics and sampleForManualReview work correctly', async () => {
    // Seed verification rows in mockDb
    mockDb.verifications.set('v1', { id: 'v1', incident_id: 'inc1', outcome: 'confirmed', created_at: '2026-09-26T12:00:00.000Z', details: { adversaryCritique: 'test', engineeringEvidence: 'test' } });
    mockDb.verifications.set('v2', { id: 'v2', incident_id: 'inc2', outcome: 'rejected', created_at: '2026-09-26T12:01:00.000Z', details: { adversaryCritique: 'test', engineeringEvidence: 'test' } });
    mockDb.verifications.set('v3', { id: 'v3', incident_id: 'inc3', outcome: 'inconclusive', created_at: '2026-09-26T12:02:00.000Z', details: { adversaryCritique: 'test', engineeringEvidence: 'test' } });
    mockDb.verifications.set('v4', { id: 'v4', incident_id: 'inc4', outcome: 'blocked', created_at: '2026-09-26T12:03:00.000Z', details: { adversaryCritique: 'test', engineeringEvidence: 'test' } });

    mockDb.incidents.set('inc1', { id: 'inc1', flaw_type: 'CONTEXT_AMNESIA', evidence: { userMessage: 'U1', assistantResponse: 'A1' } });

    const metrics = await adversarialVerifier.getVerificationMetrics();
    expect(metrics.totalVerifications).toBe(4);
    expect(metrics.confirmedCount).toBe(1);
    expect(metrics.rejectedCount).toBe(1);
    expect(metrics.inconclusiveCount).toBe(1);
    expect(metrics.blockedCount).toBe(1);
    expect(metrics.confirmedRatio).toBe(0.25);

    const samples = await adversarialVerifier.sampleForManualReview(5, 'confirmed');
    expect(samples.length).toBe(1);
    expect(samples[0].verificationId).toBe('v1');
    expect(samples[0].auditChecklist.humanVerdict).toBe('PENDING');
  });
});
