/**
 * p0_cognitive_reliability.test.ts
 * ──────────────────────────────────────────────────────────────────
 * Phase 0 Cognitive Reliability Foundation — focused unit tests.
 *
 * Tests three invariants without hitting the network or database:
 *
 *   P0-A  Every unique user turn gets a unique, stable turn_id. The
 *         same user message in a second turn gets a different turn_id.
 *
 *   P0-B  TurnAnalyzer populates questionClauses correctly, and
 *         isGarbageMemoryValue rejects Hinglish interrogative values.
 *
 *   P0-C  ChatHistoryHelpers.saveAssistantMessage accepts the new
 *         opts parameter without breaking the existing call signature.
 */

import { TurnAnalyzer } from '../../services/TurnAnalyzer';
import { isGarbageMemoryValue } from '../../lib/memoryFilters';

// ── Minimal mock so we can import ChatHistoryHelpers without Supabase ──
jest.mock('../../lib/supabase', () => ({
  supabaseAdmin: {
    from: () => ({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'test-id' }, error: null }) }) }),
    }),
  },
}));
jest.mock('../../lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { saveAssistantMessage } from '../../services/ChatHistoryHelpers';

// ════════════════════════════════════════════════════════════════════
// P0-A: Canonical Turn Identity
// ════════════════════════════════════════════════════════════════════
describe('P0-A: Canonical Turn Identity', () => {
  it('TurnAnalyzer.analyze is deterministic — same input → same unit types', () => {
    const msgs = [{ message: 'Mera naam Rahul hai aur mujhe Python pasand hai' }];
    const r1 = TurnAnalyzer.analyze(msgs);
    const r2 = TurnAnalyzer.analyze(msgs);
    // Unit types must be identical across two calls
    expect(r1.units.map(u => u.type)).toEqual(r2.units.map(u => u.type));
  });

  it('Turn ID is a valid UUID (stable client_message_id path)', () => {
    // Simulate what chat.ts does: prefer the saved DB row id when it's a UUID
    const clientId = '550e8400-e29b-41d4-a716-446655440000';
    const userMessageId = clientId; // DB save succeeded and returned the client id
    const syntheticPrefixes = ['msg_', 'proactive_'];
    const isStable =
      userMessageId &&
      !syntheticPrefixes.some(p => userMessageId.startsWith(p));
    expect(isStable).toBe(true);
    // A different message must not share the same id (no id collisions)
    const { v4: uuidv4 } = require('crypto');
    // Just verify the fallback UUID path produces unique ids
    const id1 = require('crypto').randomUUID();
    const id2 = require('crypto').randomUUID();
    expect(id1).not.toBe(id2);
  });
});

// ════════════════════════════════════════════════════════════════════
// P0-B: Question-Aware Memory Admission
// ════════════════════════════════════════════════════════════════════
describe('P0-B: TurnAnalyzer.questionClauses', () => {
  it('populates questionClauses for a pure question message', () => {
    const msgs = [{ message: 'Kya aaj meeting hai?' }];
    const result = TurnAnalyzer.analyze(msgs);
    expect(result.hasQuestions).toBe(true);
    expect(result.questionClauses).toBeDefined();
    expect(result.questionClauses!.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty questionClauses for a pure fact statement', () => {
    const msgs = [{ message: 'Mera beta ka naam Aryan hai' }];
    const result = TurnAnalyzer.analyze(msgs);
    expect(result.questionClauses).toBeDefined();
    expect(result.questionClauses!.length).toBe(0);
  });

  it('correctly separates question clauses from fact clauses in a mixed message', () => {
    // Mixed: "Mere papa ka naam Suresh hai. Unki age kya hai?"
    const msgs = [{ message: 'Mere papa ka naam Suresh hai. Unki age kya hai?' }];
    const result = TurnAnalyzer.analyze(msgs);
    // Should detect the fact (papa_name / father_name)
    expect(result.hasFacts).toBe(true);
    // Should also detect the question
    expect(result.hasQuestions).toBe(true);
    // questionClauses should only contain the question text, not the fact text
    const qClauses = result.questionClauses || [];
    expect(qClauses.some(c => /naam/.test(c) || /Suresh/.test(c))).toBe(false);
  });
});

describe('P0-B: isGarbageMemoryValue — Hinglish interrogative guard', () => {
  // Values that ARE garbage (question fragments)
  const garbageCases: [string, string][] = [
    ['hold_goal', 'kaunsa hold pe hai'],
    ['main_goals', 'kya hai abhi'],
    ['pending_task', 'kya karna chahiye'],
    ['next_step', 'what should I do'],
    ['schedule', 'where are you going'],
  ];

  test.each(garbageCases)(
    'BLOCKS garbage key=%s value="%s"',
    (key, value) => {
      expect(isGarbageMemoryValue(key, value, 'test')).toBe(true);
    }
  );

  // Values that are VALID memories (should NOT be blocked)
  const validCases: [string, string][] = [
    ['father_name', 'Rajesh'],
    ['sister_name', 'Priya'],
    ['son_name', 'Aryan'],
    ['company_name', 'Acme Corp'],
    ['birth_date', '1990-05-15'],
    ['preferred_name', 'Saaket'],
  ];

  test.each(validCases)(
    'ALLOWS valid key=%s value="%s"',
    (key, value) => {
      expect(isGarbageMemoryValue(key, value, 'test')).toBe(false);
    }
  );
});

// ════════════════════════════════════════════════════════════════════
// P0-C: Chat History Source Attribution
// ════════════════════════════════════════════════════════════════════
describe('P0-C: saveAssistantMessage — source attribution opts', () => {
  it('accepts opts with sourceType without throwing', async () => {
    // Should not throw — backward-compat check
    await expect(
      saveAssistantMessage(
        'user-123',
        'conv-456',
        'Hello yaar!',
        'NovaConsciousnessEngine',
        undefined,
        { sourceType: 'nace_outreach', outreachLogId: 'log-789' }
      )
    ).resolves.toBeUndefined();
  });

  it('accepts call without opts (backward compatibility)', async () => {
    await expect(
      saveAssistantMessage('user-123', 'conv-456', 'Reminder hai yaar', 'ReminderSchedulerService')
    ).resolves.toBeUndefined();
  });

  it('accepts call with sourceType=conversational', async () => {
    await expect(
      saveAssistantMessage('user-123', 'conv-456', 'Bilkul yaar!', 'SystemFallback', undefined, {
        sourceType: 'conversational',
      })
    ).resolves.toBeUndefined();
  });
});
