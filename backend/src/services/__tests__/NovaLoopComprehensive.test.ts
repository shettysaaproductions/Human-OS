/**
 * NovaLoopComprehensive.test.ts — Comprehensive Test Suite for Nova Loop Engineering Layer
 *
 * Validates the 8 core engineering invariants:
 * A. Contextual failure detection (e.g. location/transit amnesia)
 * B. Duplicate detection (same failure observed twice -> detection_count increments)
 * C. Regression detection (resolved incident recurring -> status = regression)
 * D. Checkpoint correctness (messages with identical timestamps processed safely via dual-cursor)
 * E. Restart safety (cursor advancement only after persistence; restart is idempotent)
 * F. Capability blocking (required capability unavailable -> BLOCKED, safe halt without guessing)
 * G. Historical preservation (resolved incidents remain queryable, never deleted)
 * H. False-positive handling (ambiguous/healthy dialogue -> no_issue)
 */

import {
  ConversationalEvaluator,
  IncidentManager,
  NovaLoopScanner,
  RegressionVerifier,
  NovaLoopScheduler,
  computeIncidentFingerprint,
  normalizeFingerprintSlug,
  ObservableDialogueEvidence
} from '../nova-loop';
import { CapabilityUnavailableError } from '../../lib/cognitiveRouter';
import { supabaseAdmin } from '../../lib/supabase';

// In-memory mock database state for Nova Loop tables
const mockDb = {
  checkpoints: new Map<string, any>(),
  incidents: new Map<string, any>(),
  verifications: new Map<string, any>(),
  chatHistory: [] as any[]
};

jest.mock('../../lib/supabase', () => {
  return {
    supabaseAdmin: {
      from: jest.fn().mockImplementation((table: string) => {
        let selectedFields = '*';
        let queryFilters: Array<(row: any) => boolean> = [];
        let orderFields: Array<{ col: string; ascending: boolean }> = [];
        let limitVal: number | null = null;

        const builder: any = {
          select: jest.fn().mockImplementation((fields?: string) => {
            selectedFields = fields || '*';
            return builder;
          }),
          eq: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] === val);
            return builder;
          }),
          lt: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] < val);
            return builder;
          }),
          gt: jest.fn().mockImplementation((col: string, val: any) => {
            queryFilters.push((row: any) => row[col] > val);
            return builder;
          }),
          or: jest.fn().mockImplementation((orClause: string) => {
            // Mock dual-cursor parsing: created_at.gt.X,and(created_at.eq.X,id.gt.Y)
            if (orClause.includes('created_at.gt') && orClause.includes('id.gt')) {
              const matches = orClause.match(/created_at\.gt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)/);
              if (matches) {
                const targetTs = matches[1];
                const targetId = matches[3];
                queryFilters.push((row: any) => {
                  return row.created_at > targetTs || (row.created_at === targetTs && row.id > targetId);
                });
              }
            }
            return builder;
          }),
          order: jest.fn().mockImplementation((col: string, opts?: { ascending?: boolean }) => {
            orderFields.push({ col, ascending: opts?.ascending ?? true });
            return builder;
          }),
          limit: jest.fn().mockImplementation((n: number) => {
            limitVal = n;
            return builder;
          }),
          insert: jest.fn().mockImplementation((payload: any) => {
            const row = Array.isArray(payload) ? { ...payload[0] } : { ...payload };
            if (!row.id) row.id = `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

            if (table === 'nova_loop_checkpoints') {
              mockDb.checkpoints.set(row.stage, row);
            } else if (table === 'nova_engineering_incidents') {
              mockDb.incidents.set(row.fingerprint, row);
            } else if (table === 'nova_incident_verifications') {
              mockDb.verifications.set(row.id, row);
            } else if (table === 'chat_history') {
              mockDb.chatHistory.push(row);
            }

            return {
              select: () => ({
                single: () => Promise.resolve({ data: row, error: null }),
                maybeSingle: () => Promise.resolve({ data: row, error: null })
              }),
              then: (resolve: any) => resolve({ data: row, error: null })
            };
          }),
          update: jest.fn().mockImplementation((updates: any) => {
            return {
              eq: (col: string, val: any) => {
                let updatedRow: any = null;
                if (table === 'nova_loop_checkpoints') {
                  const existing = mockDb.checkpoints.get(val);
                  if (existing) {
                    updatedRow = { ...existing, ...updates };
                    mockDb.checkpoints.set(val, updatedRow);
                  }
                } else if (table === 'nova_engineering_incidents') {
                  for (const [fp, inc] of mockDb.incidents.entries()) {
                    if (inc[col] === val) {
                      updatedRow = { ...inc, ...updates };
                      mockDb.incidents.set(fp, updatedRow);
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
          maybeSingle: jest.fn().mockImplementation(async () => {
            let dataset: any[] = [];
            if (table === 'nova_loop_checkpoints') dataset = Array.from(mockDb.checkpoints.values());
            else if (table === 'nova_engineering_incidents') dataset = Array.from(mockDb.incidents.values());
            else if (table === 'chat_history') dataset = mockDb.chatHistory;

            for (const filter of queryFilters) {
              dataset = dataset.filter(filter);
            }
            return { data: dataset[0] || null, error: null };
          }),
          single: jest.fn().mockImplementation(async () => {
            let dataset: any[] = [];
            if (table === 'nova_loop_checkpoints') dataset = Array.from(mockDb.checkpoints.values());
            else if (table === 'nova_engineering_incidents') dataset = Array.from(mockDb.incidents.values());
            else if (table === 'chat_history') dataset = mockDb.chatHistory;

            for (const filter of queryFilters) {
              dataset = dataset.filter(filter);
            }
            return { data: dataset[0] || null, error: null };
          }),
          then: jest.fn().mockImplementation((resolve: any) => {
            let dataset: any[] = [];
            if (table === 'nova_loop_checkpoints') dataset = Array.from(mockDb.checkpoints.values());
            else if (table === 'nova_engineering_incidents') dataset = Array.from(mockDb.incidents.values());
            else if (table === 'chat_history') dataset = [...mockDb.chatHistory];

            for (const filter of queryFilters) {
              dataset = dataset.filter(filter);
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

describe('Nova Loop Engineering Subsystem Comprehensive Verification', () => {
  beforeEach(() => {
    mockDb.checkpoints.clear();
    mockDb.incidents.clear();
    mockDb.verifications.clear();
    mockDb.chatHistory = [];
  });

  // ── TEST A: Contextual Failure Detection ───────────────────────────────────
  test('A. Contextual Failure Detection: Flags transit amnesia without relying on Nova self-report', async () => {
    const evaluator = new ConversationalEvaluator();

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_001',
      conversationId: 'conv_123',
      userMessageId: 'msg_u1',
      userMessage: 'I am right now going home by metro from office.',
      userMessageTimestamp: '2026-09-24T18:00:00.000Z',
      assistantMessageId: 'msg_a1',
      assistantResponse: 'Where are you going?',
      assistantResponseTimestamp: '2026-09-24T18:00:03.000Z',
      surroundingContext: []
    };

    const finding = await evaluator.evaluateTurn(evidence);

    expect(finding).not.toBeNull();
    expect(finding?.flawType).toBe('CONTEXT_AMNESIA');
    expect(finding?.confidence).toBeGreaterThanOrEqual(0.75);
    expect(finding?.canonicalSubject).toBe('transit_destination_amnesia');
    expect(finding?.failureSignature).toBe('questioned_destination_after_transit_explicitly_stated');
    expect(finding?.reasoningSummary).toContain('Nova questioned the user destination');
  });

  // ── TEST B: Duplicate Detection ───────────────────────────────────────────
  test('B. Duplicate Detection: Repeated observations increment count instead of creating duplicates', async () => {
    const manager = new IncidentManager();

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_002',
      conversationId: 'conv_456',
      userMessageId: 'msg_u10',
      userMessage: 'Office se nikal ke metro me hoon.',
      userMessageTimestamp: '2026-09-24T18:10:00.000Z',
      assistantMessageId: 'msg_a10',
      assistantResponse: 'Kahan ja rahe ho?',
      assistantResponseTimestamp: '2026-09-24T18:10:04.000Z',
      surroundingContext: []
    };

    const evaluator = new ConversationalEvaluator();
    const finding = (await evaluator.evaluateTurn(evidence))!;

    // 1st Observation
    const firstRes = await manager.recordFinding(finding, evidence);
    expect(firstRes.action).toBe('NEW_INCIDENT');
    expect(firstRes.detectionCount).toBe(1);
    expect(mockDb.incidents.size).toBe(1);

    // 2nd Observation of same defect
    const secondRes = await manager.recordFinding(finding, evidence);
    expect(secondRes.action).toBe('DUPLICATE_OBSERVED');
    expect(secondRes.detectionCount).toBe(2);
    expect(mockDb.incidents.size).toBe(1); // No new row added
  });

  // ── TEST C: Regression Detection ──────────────────────────────────────────
  test('C. Regression Detection: Resolved fingerprint recurring transitions to REGRESSION', async () => {
    const manager = new IncidentManager();

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_003',
      conversationId: 'conv_789',
      userMessageId: 'msg_u20',
      userMessage: 'Going home by metro.',
      userMessageTimestamp: '2026-09-24T18:20:00.000Z',
      assistantMessageId: 'msg_a20',
      assistantResponse: 'Where are you going?',
      assistantResponseTimestamp: '2026-09-24T18:20:03.000Z',
      surroundingContext: []
    };

    const evaluator = new ConversationalEvaluator();
    const finding = (await evaluator.evaluateTurn(evidence))!;

    // 1. Initial occurrence
    const initRes = await manager.recordFinding(finding, evidence);
    expect(initRes.status).toBe('open');

    // 2. Resolved via engineering patch
    await manager.resolveIncident(initRes.incidentId, 'Fixed prompt grounding for metro transit context');
    const resolvedRecord = mockDb.incidents.get(initRes.fingerprint);
    expect(resolvedRecord.status).toBe('resolved');

    // 3. New occurrence of identical defect later
    const regRes = await manager.recordFinding(finding, evidence);
    expect(regRes.action).toBe('REGRESSION_DETECTED');
    expect(regRes.status).toBe('regression');
    expect(regRes.detectionCount).toBe(2);

    // Historical resolution note preserved
    const regressionRecord = mockDb.incidents.get(initRes.fingerprint);
    expect(regressionRecord.resolution_note).toContain('REGRESSION detected');
  });

  // ── TEST D: Checkpoint Dual-Cursor Timestamp Correctness ───────────────────
  test('D. Checkpoint Correctness: Messages sharing identical timestamps are both processed via (created_at, message_id)', async () => {
    const identicalTimestamp = '2026-09-24T18:30:00.000Z';

    // Seed 2 distinct messages with identical timestamps
    mockDb.chatHistory = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        user_id: 'u1',
        conversation_id: 'c1',
        role: 'user',
        content: 'I am right now going home by metro from office.',
        created_at: identicalTimestamp,
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        user_id: 'u1',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'Where are you going?',
        created_at: identicalTimestamp,
      }
    ];

    const scanner = new NovaLoopScanner();
    const batchResult = await scanner.scanNextBatch(10, 'conversational_audit');

    expect(batchResult.messagesProcessed).toBe(2);
    expect(batchResult.cursorAdvancedTo?.created_at).toBe(identicalTimestamp);
    expect(batchResult.cursorAdvancedTo?.message_id).toBe('00000000-0000-0000-0000-000000000002');
  });

  // ── TEST E: Restart Safety ────────────────────────────────────────────────
  test('E. Restart Safety: Interruption before cursor commit does not corrupt state', async () => {
    const timestamp = '2026-09-24T18:40:00.000Z';
    mockDb.chatHistory = [
      {
        id: '00000000-0000-0000-0000-000000000010',
        user_id: 'u1',
        conversation_id: 'c1',
        role: 'user',
        content: 'I am right now going home by metro from office.',
        created_at: timestamp,
      },
      {
        id: '00000000-0000-0000-0000-000000000011',
        user_id: 'u1',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'Where are you going?',
        created_at: timestamp,
      }
    ];

    // Seed initial checkpoint at epoch 0
    mockDb.checkpoints.set('conversational_audit', {
      stage: 'conversational_audit',
      last_scanned_created_at: '1970-01-01T00:00:00Z',
      last_scanned_message_id: null,
      total_scanned_count: 0,
      incidents_found: 0
    });

    const scanner = new NovaLoopScanner();

    // 1st run: processes batch and advances cursor
    const run1 = await scanner.scanNextBatch(10, 'conversational_audit');
    expect(run1.messagesProcessed).toBe(2);
    expect(mockDb.incidents.size).toBe(1);

    // 2nd run immediately after: nothing new to scan
    const run2 = await scanner.scanNextBatch(10, 'conversational_audit');
    expect(run2.messagesProcessed).toBe(0);
    expect(mockDb.incidents.size).toBe(1); // No duplicates
  });

  // ── TEST F: Capability Blocking ───────────────────────────────────────────
  test('F. Capability Blocking: Unavailable capability halts safely into status=blocked without guessing', async () => {
    const manager = new IncidentManager();

    const finding = {
      flawType: 'OTHER' as const,
      severity: 'high' as const,
      confidence: 0.90,
      canonicalSubject: 'complex_multi_turn_causal_failure',
      failureSignature: 'capability_unavailable_for_deep_reasoning',
      evidenceReferences: { userMessageId: 'u1', assistantMessageId: 'a1', priorTurnIds: [] },
      reasoningSummary: 'Requires ROOT_CAUSE_DIAGNOSIS (score 3); capability is unavailable.',
      requiredCapability: 'ROOT_CAUSE_DIAGNOSIS' as const,
      recommendedAction: 'Escalate to Tier 3 reasoning'
    };

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_004',
      conversationId: 'c1',
      userMessageId: 'u1',
      userMessage: 'Complex message',
      userMessageTimestamp: '2026-09-24T18:50:00.000Z',
      assistantMessageId: 'a1',
      assistantResponse: 'Inadequate response',
      assistantResponseTimestamp: '2026-09-24T18:50:03.000Z',
      surroundingContext: []
    };

    const result = await manager.recordFinding(finding, evidence);

    expect(result.action).toBe('BLOCKED_CAPABILITY');
    expect(result.status).toBe('blocked');

    const stored = mockDb.incidents.get(result.fingerprint);
    expect(stored.blocked_reason).toContain('Requires ROOT_CAUSE_DIAGNOSIS');
  });

  // ── TEST G: Historical Preservation ───────────────────────────────────────
  test('G. Historical Preservation: Resolved incidents and evidence remain intact in ledger', async () => {
    const manager = new IncidentManager();

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_005',
      conversationId: 'c5',
      userMessageId: 'u5',
      userMessage: 'Going home by metro.',
      userMessageTimestamp: '2026-09-24T19:00:00.000Z',
      assistantMessageId: 'a5',
      assistantResponse: 'Where are you going?',
      assistantResponseTimestamp: '2026-09-24T19:00:03.000Z',
      surroundingContext: []
    };

    const evaluator = new ConversationalEvaluator();
    const finding = (await evaluator.evaluateTurn(evidence))!;

    const rec = await manager.recordFinding(finding, evidence);
    await manager.resolveIncident(rec.incidentId, 'Resolved via prompt tuning in commit abc1234');

    const incidentInDb = mockDb.incidents.get(rec.fingerprint);
    expect(incidentInDb).toBeDefined();
    expect(incidentInDb.status).toBe('resolved');
    expect(incidentInDb.evidence.userMessage).toBe('Going home by metro.');
    expect(incidentInDb.resolution_note).toBe('Resolved via prompt tuning in commit abc1234');
  });

  // ── TEST H: False-Positive Handling ───────────────────────────────────────
  test('H. False-Positive Handling: Natural healthy banter yields no_issue', async () => {
    const evaluator = new ConversationalEvaluator();

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_006',
      conversationId: 'c6',
      userMessageId: 'u6',
      userMessage: 'Aaj mausam kitna achha hai!',
      userMessageTimestamp: '2026-09-24T19:10:00.000Z',
      assistantMessageId: 'a6',
      assistantResponse: 'Haan sach me, kafi suhana lag raha hai! Tum bahar ja rahe ho kya?',
      assistantResponseTimestamp: '2026-09-24T19:10:03.000Z',
      surroundingContext: []
    };

    const finding = await evaluator.evaluateTurn(evidence);

    // Natural conversation must not trigger a false positive
    expect(finding).toBeNull();
  });

  // ── TEST I: Multi-User Interleaved Timeline Isolation ──────────────────────
  test('I. Multi-User Interleaved Isolation: User B message never leaks into User A evidence', async () => {
    // Interleaved timeline in global chat_history:
    // 1. User A says: "I am right now going home by metro from office." (18:00:00)
    // 2. User B says: "Where is my dinner order?" (18:00:01)
    // 3. Assistant responds to User A: "Where are you going?" (18:00:02)
    mockDb.chatHistory = [
      {
        id: 'msg-uA-1',
        user_id: 'user_A',
        conversation_id: 'conv_A',
        role: 'user',
        content: 'I am right now going home by metro from office.',
        created_at: '2026-09-24T18:00:00.000Z',
      },
      {
        id: 'msg-uB-1',
        user_id: 'user_B',
        conversation_id: 'conv_B',
        role: 'user',
        content: 'Where is my dinner order?',
        created_at: '2026-09-24T18:00:01.000Z',
      },
      {
        id: 'msg-aA-1',
        user_id: 'user_A',
        conversation_id: 'conv_A',
        role: 'assistant',
        content: 'Where are you going?',
        created_at: '2026-09-24T18:00:02.000Z',
      }
    ];

    const scanner = new NovaLoopScanner();
    const result = await scanner.scanNextBatch(10, 'conversational_audit');

    expect(result.messagesProcessed).toBe(3);
    expect(result.turnsEvaluated).toBe(1);
    expect(result.incidentsFound).toBe(1);

    // Verify incident record in database
    const storedIncident = Array.from(mockDb.incidents.values())[0];
    expect(storedIncident).toBeDefined();
    expect(storedIncident.user_id).toBe('user_A');
    expect(storedIncident.flaw_type).toBe('CONTEXT_AMNESIA');

    // CRITICAL ASSERTION: The evidence userMessage must be User A's prompt, NOT User B's!
    expect(storedIncident.evidence.userMessage).toBe('I am right now going home by metro from office.');
    expect(storedIncident.evidence.userMessage).not.toContain('dinner order');
    expect(storedIncident.evidence.userId).toBe('user_A');
  });

  // ── TEST J: Complex Multi-User & Multi-Conversation Timeline ───────────────
  test('J. Complex Multi-User Interleaving: Correctly pairs prompts across distinct users and conversations', async () => {
    mockDb.chatHistory = [
      {
        id: 'msg-u1',
        user_id: 'u1',
        conversation_id: 'c1',
        role: 'user',
        content: 'Going home by metro.',
        created_at: '2026-09-24T18:01:00.000Z',
      },
      {
        id: 'msg-u2',
        user_id: 'u2',
        conversation_id: 'c2',
        role: 'user',
        content: 'I worked 12 hours today.',
        created_at: '2026-09-24T18:01:01.000Z',
      },
      {
        id: 'msg-u3',
        user_id: 'u3',
        conversation_id: 'c3',
        role: 'user',
        content: 'Remind me tomorrow.',
        created_at: '2026-09-24T18:01:02.000Z',
      },
      {
        id: 'msg-a2',
        user_id: 'u2',
        conversation_id: 'c2',
        role: 'assistant',
        content: 'Take some rest yaar, you earned it!',
        created_at: '2026-09-24T18:01:03.000Z',
      },
      {
        id: 'msg-a1',
        user_id: 'u1',
        conversation_id: 'c1',
        role: 'assistant',
        content: 'Where are you going?', // Context amnesia for u1
        created_at: '2026-09-24T18:01:04.000Z',
      }
    ];

    const scanner = new NovaLoopScanner();
    const result = await scanner.scanNextBatch(10, 'conversational_audit');

    expect(result.messagesProcessed).toBe(5);
    expect(result.turnsEvaluated).toBe(2);
    // Only u1 had a defect (amnesia on metro); u2 had supportive healthy banter (no flaw)
    expect(result.incidentsFound).toBe(1);

    const u1Incident = Array.from(mockDb.incidents.values()).find(inc => inc.user_id === 'u1');
    expect(u1Incident).toBeDefined();
    expect(u1Incident?.evidence.userMessage).toBe('Going home by metro.');
    expect(u1Incident?.evidence.userMessage).not.toContain('worked 12 hours');
  });

  // ── TEST K: Scheduler Lifecycle & Re-entrancy Protection ───────────────────
  test('K. Scheduler Lifecycle: Handles start, stop, and skips concurrent re-entrancy cleanly', async () => {
    const scheduler = new NovaLoopScheduler();

    // Verify initial start
    scheduler.start(60_000);
    // Secondary start must be idempotent
    scheduler.start(60_000);

    // Stop scheduler
    scheduler.stop();

    // Verify runOnce re-entrancy protection
    // Simulate active scan
    (scheduler as any).isScanning = true;
    const skippedRun = await scheduler.runOnce(10);
    expect(skippedRun).toBeNull();

    // Reset
    (scheduler as any).isScanning = false;
  });

  // ── TEST L: Fingerprint Taxonomy Normalization ─────────────────────────────
  test('L. Fingerprint Taxonomy Normalization: Prevents wording variations from fragmenting fingerprints', () => {
    const slug1 = normalizeFingerprintSlug('forgot the destination after transit');
    const slug2 = normalizeFingerprintSlug('heading_home_where_location');
    const slug3 = normalizeFingerprintSlug('transit_destination_amnesia');

    // All transit/location amnesia phrases must converge to the canonical slug
    expect(slug1).toBe('transit_destination_amnesia');
    expect(slug2).toBe('transit_destination_amnesia');
    expect(slug3).toBe('transit_destination_amnesia');

    const workplaceSlug = normalizeFingerprintSlug('user workplace where company');
    expect(workplaceSlug).toBe('workplace_amnesia');

    const leakSlug = normalizeFingerprintSlug('system_prompt_instruction_rules');
    expect(leakSlug).toBe('prompt_instruction_leak');

    // Distinct failures must not merge
    expect(slug1).not.toBe(workplaceSlug);
  });

  // ── TEST M: Regression Replay Semantics ────────────────────────────────────
  test('M. Regression Replay Semantics: Handles missing fix response without false regressions', async () => {
    const manager = new IncidentManager();
    const verifier = new RegressionVerifier();

    const evidence: ObservableDialogueEvidence = {
      userId: 'test_user_007',
      conversationId: 'c7',
      userMessageId: 'u7',
      userMessage: 'Office se nikal ke metro me hoon.',
      userMessageTimestamp: '2026-09-24T19:20:00.000Z',
      assistantMessageId: 'a7',
      assistantResponse: 'Kahan ja rahe ho?',
      assistantResponseTimestamp: '2026-09-24T19:20:03.000Z',
      surroundingContext: []
    };

    const evaluator = new ConversationalEvaluator();
    const finding = (await evaluator.evaluateTurn(evidence))!;
    const rec = await manager.recordFinding(finding, evidence);

    // 1. Replay with NO candidate fix response
    const auditRes = await verifier.verifyIncident(rec.incidentId);
    expect(auditRes.passed).toBe(false);
    expect(auditRes.flawFound).toBe(false); // Does NOT claim current pipeline has the flaw
    expect(auditRes.details.testedWithProposedFix).toBe(false);
    expect(auditRes.details.limitationNotice).toContain('No proposed fix response supplied');

    // 2. Replay with a proposed clean fix response
    const cleanFixResponse = 'Sahi hai yaar! Ghar pohoch ke aaram karna, metro me bheed toh nahi hai?';
    const fixRes = await verifier.verifyIncident(rec.incidentId, cleanFixResponse, 'commit-test-123');
    expect(fixRes.passed).toBe(true);
    expect(fixRes.flawFound).toBe(false);
    expect(fixRes.details.testedWithProposedFix).toBe(true);

    // Verify incident auto-resolved in ledger
    const resolvedRecord = mockDb.incidents.get(rec.fingerprint);
    expect(resolvedRecord.status).toBe('resolved');
  });
});

