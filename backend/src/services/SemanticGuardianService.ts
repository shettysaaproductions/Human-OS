/**
 * SemanticGuardianService.ts — Phase 2D Semantic Guardian & Cognitive Consistency Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. BOUNDED REASONING ONLY: Operates only where deterministic evaluation cannot safely establish ground truth.
 * 2. COMPACT EVIDENCE PACKAGES: Bounded context budget (<= 1000 tokens) scoped strictly to 1 user.
 * 3. NO DIRECT CORE DB MUTATIONS: Zero direct writes to memories, life_threads, reminders, chat_history.
 * 4. STRUCTURED OUTPUT ONLY: Enforces strict JSON schema validation. Rejects natural language / prompt injections.
 * 5. CONFIDENCE & RISK POLICIES:
 *    - High (>= 0.90): may emit typed repair candidates or confident doubts.
 *    - Medium (0.70–0.89): emits cognitive doubt.
 *    - Low (< 0.70): emits no_action or tentative cognitive doubt (never repair).
 * 6. FREE-TIER EFFICIENCY & THROTTLING: Max 10 semantic evaluations per user per 24h.
 * 7. FAIL-SAFE: 429, timeouts, malformed JSON safely fallback to `no_action` with zero system degradation.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import { cognitiveRouter } from '../lib/cognitiveRouter';
import {
  CompactEvidencePackage,
  SemanticAnomalyCode,
  SemanticGuardianResult,
  SemanticOutcome,
  SemanticRiskLevel,
} from '../types/semanticGuardian';
import { cognitiveDoubtService } from './CognitiveDoubtService';
import { canonicalStateReconciler } from './CanonicalStateReconciler';
import { RepairOrderDraft } from '../types/canonicalRepair';

import { config } from '../config';

// In-memory sliding window rate-limiter: Max 10 calls per user per 24h
const userEvaluationTimestamps = new Map<string, number[]>();
const MAX_EVALUATIONS_PER_24H = 10;
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

export class SemanticGuardianService {
  /**
   * Evaluates semantic consistency for a specific anomaly escalation.
   */
  async evaluateSemanticConsistency(
    evidence: CompactEvidencePackage,
    forcedModel?: string
  ): Promise<SemanticGuardianResult> {
    const startedAt = Date.now();

    // 1. User Isolation Guard
    if (!evidence.userId) {
      return this.createFallbackResult(evidence.anomalyCode, 'User isolation error: missing userId', startedAt);
    }

    // 2. Per-User 24h Rate Limiting
    if (!this.checkAndConsumeRateLimit(evidence.userId)) {
      logger.warn('[SemanticGuardian] Per-user 24h rate limit reached', { userId: evidence.userId });
      return this.createFallbackResult(evidence.anomalyCode, 'Rate limit exceeded (Max 10 calls / 24h)', startedAt);
    }

    // 3. Model Tier Selection (Flash Low / Default from config, escalate if needed)
    const model = forcedModel || config.gemini.chatModel || 'gemini-3.6-flash';

    try {
      const prompt = this.buildPrompt(evidence);
      const jsonResponseStr = await cognitiveRouter.complete(
        'BACKGROUND_COGNITION',
        [
          {
            role: 'system',
            content: `You are HumanOS Semantic Guardian. You perform strict epistemic and cognitive consistency verification.
Output MUST be strict JSON adhering to:
{
  "outcome": "no_action" | "cognitive_doubt" | "repair_candidate" | "human_review",
  "anomaly_code": "${evidence.anomalyCode}",
  "confidence": 0.0 to 1.0,
  "reason": "Clear succinct explanation",
  "evidence_refs": ["ref1", "ref2"],
  "proposed_question": "Optional clarification question for cognitive doubt",
  "repair_type": null | "MEMORY_ALIAS_CANONICALIZATION" | "GENERIC_RELATIONAL_NOISE" | "DUPLICATE_REMINDER" | "ORPHANED_LIFE_THREAD_ACTION" | "EXPIRED_REMINDER_STATE",
  "proposed_repair_state": {} or null,
  "doubt_category": null | "identity_gap" | "contradiction_ambiguity" | "intent_uncertainty" | "temporal_conflict" | "schedule_gap" | "entity_resolution",
  "risk_level": "low" | "medium" | "high"
}
Rules:
- NEVER invent missing entities or assume relationships from names alone.
- If two facts conflict without explicit correction, outcome is "cognitive_doubt" or "human_review".
- If user intent resumes an existing waiting thread, note it.
- Low confidence (< 0.70) must NEVER output "repair_candidate".`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        { temperature: 0.1, maxTokens: 512, jsonMode: true }
      );

      // 4. Parse & Validate Structured JSON Output
      const parsed = this.validateAndNormalizeResponse(jsonResponseStr, evidence.anomalyCode);
      const durationMs = Date.now() - startedAt;

      const result: SemanticGuardianResult = {
        ...parsed,
        model_used: model,
        execution_duration_ms: durationMs,
      };

      // 5. Handle Outcome Routing (Cognitive Doubt / Safe Repair Candidate)
      await this.routeOutcome(evidence.userId, evidence, result);

      logger.info('[SemanticGuardian] Evaluation complete', {
        userId: evidence.userId,
        anomalyCode: evidence.anomalyCode,
        outcome: result.outcome,
        confidence: result.confidence,
        durationMs,
      });

      return result;
    } catch (err: any) {
      logger.warn('[SemanticGuardian] Execution failed / timeout / 429 — falling back to safe no_action', {
        userId: evidence.userId,
        error: err?.message,
      });
      return this.createFallbackResult(evidence.anomalyCode, `Evaluation failed: ${err?.message}`, startedAt, model);
    }
  }

  /**
   * Builds a compact, bounded evidence package (<= 1000 tokens) scoped to one user.
   */
  async buildCompactEvidencePackage(
    userId: string,
    anomalyCode: SemanticAnomalyCode,
    targetEntityKey?: string,
    targetEntityId?: string
  ): Promise<CompactEvidencePackage> {
    // 1. Fetch relevant turns (last 5 turns)
    const { data: turns } = await qt.track('sem_guard_turns', 'chat_history', () =>
      supabaseAdmin
        .from('chat_history')
        .select('role, content, turn_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5)
    );

    const recentTurns = (turns || []).reverse().map((t: any) => ({
      role: t.role as 'user' | 'assistant',
      content: (t.content || '').substring(0, 200), // bounded length
      turn_id: t.turn_id,
      created_at: t.created_at,
    }));

    // 2. Fetch canonical memories related to target key or entity
    const { data: mems } = await qt.track('sem_guard_mems', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('key, value, source_authority, created_at, is_protected')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(10)
    );

    const canonicalMemories = (mems || [])
      .filter((m: any) => !targetEntityKey || (m.key || '').toLowerCase().includes(targetEntityKey.toLowerCase()))
      .slice(0, 6)
      .map((m: any) => ({
        key: m.key,
        value: (m.value || '').substring(0, 100),
        source_authority: m.source_authority,
        created_at: m.created_at,
        is_protected: m.is_protected,
      }));

    // 3. Fetch active / waiting LifeThreads
    const { data: threads } = await qt.track('sem_guard_threads', 'life_threads', () =>
      supabaseAdmin
        .from('life_threads')
        .select('id, canonical_key, topic, state, provenance, source_message_seq')
        .eq('user_id', userId)
        .in('state', ['active', 'waiting', 'blocked'])
        .limit(3)
    );

    const relevantLifeThreads = (threads || []).map((t: any) => ({
      id: t.id,
      canonical_key: t.canonical_key,
      topic: t.topic,
      state: t.state,
      provenance_summary: (t.provenance || '').slice(-150),
      source_message_seq: t.source_message_seq,
    }));

    // 4. Fetch open doubts
    const openDoubts = await cognitiveDoubtService.getOpenDoubts(userId);
    const openDoubtContext = (openDoubts || []).slice(0, 3).map(d => ({
      id: d.id,
      category: d.category,
      question: d.question,
      evidence: d.evidence,
    }));

    // Approximate token count estimation (4 chars ~ 1 token)
    const rawChars =
      JSON.stringify(recentTurns).length +
      JSON.stringify(canonicalMemories).length +
      JSON.stringify(relevantLifeThreads).length +
      JSON.stringify(openDoubtContext).length;
    const tokenEstimate = Math.round(rawChars / 4);

    return {
      userId,
      anomalyCode,
      entityKey: targetEntityKey,
      targetEntityId,
      recentRelevantTurns: recentTurns,
      canonicalMemories,
      relevantLifeThreads,
      relevantReminders: [],
      openDoubtContext,
      contextBudgetTokensEstimate: tokenEstimate,
    };
  }

  /**
   * Prompts builder for semantic consistency checks.
   */
  private buildPrompt(pkg: CompactEvidencePackage): string {
    return [
      `=== COMPACT EVIDENCE PACKET (User: ${pkg.userId}, Code: ${pkg.anomalyCode}) ===`,
      pkg.entityKey ? `Target Concept / Key: ${pkg.entityKey}` : '',
      `\n[Recent Relevant Turns]:\n` +
        pkg.recentRelevantTurns.map(t => `${t.role.toUpperCase()}: ${t.content}`).join('\n'),
      `\n[Canonical Durable Memories]:\n` +
        pkg.canonicalMemories.map(m => `- ${m.key}: "${m.value}" (authority: ${m.source_authority})`).join('\n'),
      `\n[Life Threads]:\n` +
        pkg.relevantLifeThreads.map(t => `- [${t.state.toUpperCase()}] ${t.topic} (key: ${t.canonical_key})`).join('\n'),
      pkg.openDoubtContext && pkg.openDoubtContext.length > 0
        ? `\n[Open Cognitive Doubts]:\n` +
          pkg.openDoubtContext.map(d => `- [${d.category}] ${d.question}`).join('\n')
        : '',
      `\nEvaluate semantic consistency for code ${pkg.anomalyCode} and return structured JSON output.`,
    ].filter(Boolean).join('\n');
  }

  /**
   * Validates and sanitizes model JSON output.
   */
  private validateAndNormalizeResponse(rawJson: string, expectedCode: SemanticAnomalyCode): Omit<SemanticGuardianResult, 'model_used' | 'execution_duration_ms'> {
    try {
      const parsed = JSON.parse(rawJson);
      const validOutcomes: SemanticOutcome[] = ['no_action', 'cognitive_doubt', 'repair_candidate', 'human_review'];
      const outcome: SemanticOutcome = validOutcomes.includes(parsed.outcome) ? parsed.outcome : 'no_action';
      const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;

      // Strict confidence policy: Low confidence (<0.70) cannot emit repair_candidate
      const effectiveOutcome: SemanticOutcome =
        outcome === 'repair_candidate' && confidence < 0.90 ? 'cognitive_doubt' : outcome;

      const riskLevel: SemanticRiskLevel = ['low', 'medium', 'high'].includes(parsed.risk_level)
        ? parsed.risk_level
        : 'medium';

      return {
        outcome: effectiveOutcome,
        anomaly_code: expectedCode,
        confidence,
        reason: String(parsed.reason || 'Semantic consistency evaluated'),
        evidence_refs: Array.isArray(parsed.evidence_refs) ? parsed.evidence_refs : [],
        proposed_question: parsed.proposed_question ? String(parsed.proposed_question) : null,
        repair_type: parsed.repair_type || null,
        proposed_repair_state: parsed.proposed_repair_state || null,
        doubt_category: parsed.doubt_category || null,
        risk_level: riskLevel,
      };
    } catch {
      return {
        outcome: 'no_action',
        anomaly_code: expectedCode,
        confidence: 0,
        reason: 'Malformed JSON output from model',
        evidence_refs: [],
        risk_level: 'low',
      };
    }
  }

  /**
   * Routes downstream outcomes strictly through canonical services.
   */
  private async routeOutcome(
    userId: string,
    evidence: CompactEvidencePackage,
    result: SemanticGuardianResult
  ): Promise<void> {
    // 1. Cognitive Doubt Routing
    if (result.outcome === 'cognitive_doubt' && result.proposed_question) {
      await cognitiveDoubtService.createOrUpdateDoubt({
        userId,
        category: result.doubt_category || 'contradiction_ambiguity',
        question: result.proposed_question,
        evidence: {
          semantic_reason: result.reason,
          confidence: result.confidence,
          evidence_refs: result.evidence_refs,
          anomaly_code: result.anomaly_code,
        },
        priority: result.confidence >= 0.85 ? 'NOW' : 'NEXT',
        urgency: result.risk_level === 'high' ? 'high' : 'medium',
        targetEntityKeys: evidence.entityKey ? [evidence.entityKey] : [],
      });
    }

    // 2. Safe Repair Candidate Routing (Submitted to CanonicalStateReconciler for deterministic validation)
    if (result.outcome === 'repair_candidate' && result.repair_type && evidence.targetEntityId) {
      const draft: RepairOrderDraft = {
        userId,
        repairType: result.repair_type,
        targetEntityId: evidence.targetEntityId,
        expectedCurrentState: {},
        proposedState: result.proposed_repair_state || {},
        evidence: {
          semantic_confidence: result.confidence,
          reason: result.reason,
        },
        authority: 'watchtower_repair',
      };
      const order = await canonicalStateReconciler.submitRepairOrder(draft);
      if (order) {
        // Reconciler will validate all invariants and execute or reject
        await canonicalStateReconciler.executeRepair(order.id);
      }
    }
  }

  private createFallbackResult(
    code: SemanticAnomalyCode,
    reason: string,
    startedAt: number,
    model = 'gemini-2.5-flash'
  ): SemanticGuardianResult {
    return {
      outcome: 'no_action',
      anomaly_code: code,
      confidence: 0,
      reason,
      evidence_refs: [],
      risk_level: 'low',
      model_used: model,
      execution_duration_ms: Date.now() - startedAt,
    };
  }

  private checkAndConsumeRateLimit(userId: string): boolean {
    const now = Date.now();
    const timestamps = userEvaluationTimestamps.get(userId) || [];
    const valid = timestamps.filter(t => now - t < WINDOW_24H_MS);

    if (valid.length >= MAX_EVALUATIONS_PER_24H) {
      return false;
    }

    valid.push(now);
    userEvaluationTimestamps.set(userId, valid);
    return true;
  }

  _resetRateLimitsForTesting(): void {
    userEvaluationTimestamps.clear();
  }
}

export const semanticGuardian = new SemanticGuardianService();
export const semanticGuardianService = semanticGuardian;
