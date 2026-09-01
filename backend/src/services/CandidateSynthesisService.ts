/**
 * CandidateSynthesisService.ts — Phase 2E-C Nightly Candidate Synthesis Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. DATABASE-BACKED RUN CLAIM: Exactly ONE logical nightly synthesis run per calendar day
 *    (`candidate_synthesis:YYYY-MM-DD`). Multiple processes attempting the same run will see
 *    ALREADY_RUNNING or ALREADY_COMPLETED and perform 0 LLM calls.
 * 2. PRE-CALL USER BATCH CLAIMING: Within a nightly run, each user batch MUST be claimed
 *    via distributed database lease (`candidate_synthesis_claims`) BEFORE any Gemini LLM call.
 * 3. STRICT MODEL BUDGET: Max 1 Gemini call per user per logical nightly run across all processes.
 * 4. DRY-RUN / CANDIDATE-ONLY: Synthesizes potential promotion candidates only.
 *    MUST NOT promote anything into durable semantic memory (0 writes to `memories`).
 * 5. ZERO MODEL CALLS ON EMPTY BATCHES: If a user has 0 eligible working/episodic records,
 *    skip LLM execution entirely.
 * 6. STRICT USER ISOLATION: Every batch is strictly bounded to ONE user.
 * 7. FREQUENCY != TRUTH: Repeated trivial events (e.g. eating pizza 5x) must NEVER
 *    automatically become personality traits, preferences, or psychological claims.
 * 8. CANONICAL KEY NORMALIZATION: All candidate keys are normalized via `canonicalizeKey()`.
 * 9. DEDUPLICATION AGAINST CANONICAL MEMORY: Does not generate duplicate candidates for
 *    facts that are already canonical in semantic memory.
 * 10. NO SOURCE DELETION: Never deletes or archives source working/episodic records.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  CognitiveCategory,
  MemoryPromotionCandidate,
  MemorySourceReference,
} from '../types/memory';
import { canonicalizeKey } from '../lib/memoryKeySchema';
import { isGarbageMemoryValue } from '../lib/memoryFilters';
import { cognitiveRouter } from '../lib/cognitiveRouter';
import crypto from 'crypto';

export const CANDIDATE_SYNTHESIS_LIMITS = {
  MAX_USERS_PER_RUN: 50,
  MAX_CANDIDATES_PER_USER: 10,
  MAX_WORKING_MEMORY_RECORDS_PER_USER: 15,
  MAX_EPISODIC_RECORDS_PER_USER: 10,
  MAX_MODEL_CALLS_PER_USER: 1,
  MAX_INPUT_TOKENS: 1500,
  MAX_OUTPUT_TOKENS: 4000,
  MAX_RETRIES: 2,
  LEASE_DURATION_MINUTES: 5,
  CANDIDATE_TTL_DAYS: 7,
} as const;

export interface CandidateEvidencePacket {
  userId: string;
  workingMemoryRecords: Array<{
    id: string;
    key: string;
    value: string;
    created_at: string;
    promotion_status?: string | null;
  }>;
  episodicRecords: Array<{
    id: string;
    summary: string;
    emotion?: string | null;
    source_message_id?: string | null;
    created_at: string;
  }>;
  canonicalSemanticKeys: Array<{
    key: string;
    value: string;
  }>;
  estimatedTokens: number;
}

export interface RawCandidatePayload {
  category: CognitiveCategory;
  key: string;
  value: string;
  confidence: number;
  importance?: number;
  reason: string;
  source_refs: Array<{
    type: 'working_memory' | 'episodic_memory';
    id: string;
  }>;
}

export interface CandidateSynthesisResult {
  userId: string;
  status: 'completed' | 'empty_batch' | 'skipped' | 'failed';
  modelCalls: number;
  candidatesGenerated: MemoryPromotionCandidate[];
  candidatesDeduplicated: number;
  candidatesRejected: number;
  error?: string;
  reason?: string;
}

export function getLogicalRunId(targetDate: Date = new Date()): string {
  // Compute date string in IST timezone (Asia/Kolkata)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = formatter.format(targetDate);
  return `candidate_synthesis:${dateStr}`;
}

export function getCanonicalKeyString(rawKey: string): string {
  if (!rawKey || typeof rawKey !== 'string') return '';
  return canonicalizeKey(rawKey.trim().toLowerCase()).canonical;
}

export function generateCandidateFingerprint(
  userId: string,
  category: CognitiveCategory,
  key: string,
  value: string
): string {
  const normKey = getCanonicalKeyString(key);
  const normVal = (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(`${userId}:${category}:${normKey}:${normVal}`)
    .digest('hex');
}

export class CandidateSynthesisService {
  // In-memory candidate storage with bounded user maps (Phase 2E-C holding buffer)
  private candidateStore: Map<string, MemoryPromotionCandidate[]> = new Map();
  private fingerprintStore: Set<string> = new Set();

  /**
   * Claims a logical nightly synthesis run in the database.
   * Guarantees only ONE active or completed run per calendar day.
   */
  async claimNightlyRun(runId: string): Promise<{
    claimed: boolean;
    status: 'claimed' | 'already_running' | 'already_completed';
  }> {
    try {
      const { data: existing } = await qt.track('check_nightly_run', 'candidate_synthesis_runs', () =>
        supabaseAdmin
          .from('candidate_synthesis_runs')
          .select('id, status, started_at')
          .eq('id', runId)
          .maybeSingle()
      );

      if (!existing) {
        // Attempt insert
        const { error: insertErr } = await qt.track('insert_nightly_run', 'candidate_synthesis_runs', () =>
          supabaseAdmin.from('candidate_synthesis_runs').insert({
            id: runId,
            status: 'running',
            started_at: new Date().toISOString(),
          })
        );

        if (!insertErr) {
          return { claimed: true, status: 'claimed' };
        }

        // Conflict check
        const { data: secondCheck } = await supabaseAdmin
          .from('candidate_synthesis_runs')
          .select('id, status, started_at')
          .eq('id', runId)
          .maybeSingle();

        if (secondCheck?.status === 'completed') {
          return { claimed: false, status: 'already_completed' };
        }
        return { claimed: false, status: 'already_running' };
      }

      if (existing.status === 'completed') {
        return { claimed: false, status: 'already_completed' };
      }

      if (existing.status === 'running') {
        // Stale run check (older than 2 hours)
        const ageMs = Date.now() - new Date(existing.started_at).getTime();
        if (ageMs > 2 * 60 * 60 * 1000) {
          logger.warn('[CandidateSynthesis] Reclaiming stale nightly run (> 2h old)', { runId, ageMs });
          return { claimed: true, status: 'claimed' };
        }
        return { claimed: false, status: 'already_running' };
      }

      // If failed previously, allow retry if > 30 minutes old
      return { claimed: true, status: 'claimed' };
    } catch (err) {
      logger.error('[CandidateSynthesis] Error in claimNightlyRun, failing safely', { runId, err });
      return { claimed: false, status: 'already_running' };
    }
  }

  /**
   * Acquires a database-backed distributed lease on a specific user before calling Gemini.
   */
  async claimUserBatch(
    runId: string,
    userId: string
  ): Promise<{ claimed: boolean; reason?: string }> {
    try {
      const leaseUntil = new Date(
        Date.now() + CANDIDATE_SYNTHESIS_LIMITS.LEASE_DURATION_MINUTES * 60 * 1000
      ).toISOString();

      // 1. Try initial atomic insert
      const { data: inserted, error: insertErr } = await qt.track('insert_user_claim', 'candidate_synthesis_claims', () =>
        supabaseAdmin
          .from('candidate_synthesis_claims')
          .insert({
            run_id: runId,
            user_id: userId,
            status: 'claimed',
            claimed_at: new Date().toISOString(),
            lease_until: leaseUntil,
            attempt_count: 1,
            model_called: false,
          })
          .select('id')
          .maybeSingle()
      );

      if (!insertErr && inserted?.id) {
        return { claimed: true };
      }

      // 2. If row exists, check existing claim state
      const { data: existing } = await qt.track('get_user_claim', 'candidate_synthesis_claims', () =>
        supabaseAdmin
          .from('candidate_synthesis_claims')
          .select('id, status, lease_until, attempt_count')
          .eq('run_id', runId)
          .eq('user_id', userId)
          .maybeSingle()
      );

      if (!existing) {
        return { claimed: false, reason: 'claim_fetch_failed' };
      }

      if (existing.status === 'completed') {
        return { claimed: false, reason: 'already_completed' };
      }

      if (existing.status === 'claimed') {
        const isLeaseActive = new Date(existing.lease_until).getTime() > Date.now();
        if (isLeaseActive) {
          return { claimed: false, reason: 'active_lease' };
        }

        // Expired lease (crashed process recovery)
        if (existing.attempt_count >= CANDIDATE_SYNTHESIS_LIMITS.MAX_RETRIES) {
          await supabaseAdmin
            .from('candidate_synthesis_claims')
            .update({ status: 'failed', error: 'Max retries exceeded' })
            .eq('id', existing.id);
          return { claimed: false, reason: 'max_retries_exceeded' };
        }

        // Reclaim expired lease
        const { data: reclaimed } = await qt.track('reclaim_user_lease', 'candidate_synthesis_claims', () =>
          supabaseAdmin
            .from('candidate_synthesis_claims')
            .update({
              status: 'claimed',
              claimed_at: new Date().toISOString(),
              lease_until: leaseUntil,
              attempt_count: existing.attempt_count + 1,
            })
            .eq('id', existing.id)
            .eq('status', 'claimed')
            .lte('lease_until', new Date().toISOString())
            .select('id')
            .maybeSingle()
        );

        if (reclaimed?.id) {
          logger.info('[CandidateSynthesis] Successfully reclaimed expired user lease', { runId, userId });
          return { claimed: true };
        }

        return { claimed: false, reason: 'reclaim_race_lost' };
      }

      if (existing.status === 'failed') {
        if (existing.attempt_count < CANDIDATE_SYNTHESIS_LIMITS.MAX_RETRIES) {
          const { data: retried } = await supabaseAdmin
            .from('candidate_synthesis_claims')
            .update({
              status: 'claimed',
              claimed_at: new Date().toISOString(),
              lease_until: leaseUntil,
              attempt_count: existing.attempt_count + 1,
              error: null,
            })
            .eq('id', existing.id)
            .select('id')
            .maybeSingle();

          if (retried?.id) return { claimed: true };
        }
        return { claimed: false, reason: 'previously_failed' };
      }

      return { claimed: false, reason: 'unhandled_claim_state' };
    } catch (err) {
      logger.error('[CandidateSynthesis] Error in claimUserBatch', { runId, userId, err });
      return { claimed: false, reason: 'error' };
    }
  }

  /**
   * Completes a user claim record in the database.
   */
  async completeUserClaim(
    runId: string,
    userId: string,
    result: { modelCalled: boolean; candidatesCount: number; error?: string }
  ): Promise<void> {
    try {
      await qt.track('complete_user_claim', 'candidate_synthesis_claims', () =>
        supabaseAdmin
          .from('candidate_synthesis_claims')
          .update({
            status: result.error ? 'failed' : 'completed',
            model_called: result.modelCalled,
            candidates_count: result.candidatesCount,
            error: result.error || null,
          })
          .eq('run_id', runId)
          .eq('user_id', userId)
      );
    } catch (err) {
      logger.error('[CandidateSynthesis] Failed to complete user claim in DB', { runId, userId, err });
    }
  }

  /**
   * Completes a logical nightly run in the database.
   */
  async completeNightlyRun(
    runId: string,
    stats: { totalUsers: number; candidatesCreated: number; modelCalls: number }
  ): Promise<void> {
    try {
      await qt.track('complete_nightly_run', 'candidate_synthesis_runs', () =>
        supabaseAdmin
          .from('candidate_synthesis_runs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            total_users: stats.totalUsers,
            candidates_created: stats.candidatesCreated,
            model_calls: stats.modelCalls,
          })
          .eq('id', runId)
      );
    } catch (err) {
      logger.error('[CandidateSynthesis] Failed to complete nightly run in DB', { runId, err });
    }
  }

  /**
   * Builds a compact, bounded evidence packet scoped strictly to ONE user.
   */
  async buildEvidencePacket(userId: string): Promise<CandidateEvidencePacket | null> {
    // 1. Fetch unpromoted working_memory candidate records
    const { data: wmRows } = await qt.track('candidate_synth_wm', 'working_memory', () =>
      supabaseAdmin
        .from('working_memory')
        .select('id, key, value, created_at, promotion_status')
        .eq('user_id', userId)
        .limit(CANDIDATE_SYNTHESIS_LIMITS.MAX_WORKING_MEMORY_RECORDS_PER_USER)
    );

    // 2. Fetch unpromoted recent episodic memories
    const { data: epRows } = await qt.track('candidate_synth_ep', 'episodic_memories', () =>
      supabaseAdmin
        .from('episodic_memories')
        .select('id, summary, emotion, source_message_id, created_at, promotion_status, is_archived')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(CANDIDATE_SYNTHESIS_LIMITS.MAX_EPISODIC_RECORDS_PER_USER)
    );

    const workingMemoryRecords = (wmRows || [])
      .filter((w: any) =>
        w.promotion_status !== 'PROMOTED' &&
        w.promotion_status !== 'SUPERSEDED' &&
        w.promotion_status !== 'INVALIDATED' &&
        w.promotion_status !== 'REJECTED'
      )
      .map((w: any) => ({
        id: w.id,
        key: (w.key || '').substring(0, 100),
        value: (w.value || '').substring(0, 200),
        created_at: w.created_at,
        promotion_status: w.promotion_status,
      }));

    const episodicRecords = (epRows || []).map((e: any) => ({
      id: e.id,
      summary: (e.summary || '').substring(0, 250),
      emotion: e.emotion || null,
      source_message_id: e.source_message_id,
      created_at: e.created_at,
    }));

    // Zero-check: If no working or episodic records exist, return empty
    if (workingMemoryRecords.length === 0 && episodicRecords.length === 0) {
      return null;
    }

    // 3. Fetch existing canonical semantic memory keys to prevent duplicate synthesis
    const { data: memRows } = await qt.track('candidate_synth_mems', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('key, value')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(50)
    );

    const canonicalSemanticKeys = (memRows || []).map((m: any) => ({
      key: m.key,
      value: (m.value || '').substring(0, 100),
    }));

    const rawChars =
      JSON.stringify(workingMemoryRecords).length +
      JSON.stringify(episodicRecords).length +
      JSON.stringify(canonicalSemanticKeys).length;
    const estimatedTokens = Math.round(rawChars / 4);

    return {
      userId,
      workingMemoryRecords,
      episodicRecords,
      canonicalSemanticKeys,
      estimatedTokens,
    };
  }

  /**
   * Constructs prompt and invokes Gemini Flash via CognitiveModelRouter.
   */
  async evaluateWithGemini(packet: CandidateEvidencePacket): Promise<RawCandidatePayload[]> {
    const wmText = packet.workingMemoryRecords.length > 0
      ? packet.workingMemoryRecords.map(w => `- [WM ID: ${w.id}] key="${w.key}", value="${w.value}"`).join('\n')
      : 'None';

    const epText = packet.episodicRecords.length > 0
      ? packet.episodicRecords.map(e => `- [EP ID: ${e.id}] "${e.summary}" (emotion: ${e.emotion || 'neutral'})`).join('\n')
      : 'None';

    const existingKeysText = packet.canonicalSemanticKeys.length > 0
      ? packet.canonicalSemanticKeys.map(m => `- ${m.key}: "${m.value}"`).join('\n')
      : 'None';

    const prompt = `=== CANDIDATE EVIDENCE PACKET (User: ${packet.userId}) ===

[Working Memory Candidate Records]:
${wmText}

[Recent Episodic Event Records]:
${epText}

[Existing Canonical Semantic Memories (DO NOT DUPLICATE)]:
${existingKeysText}

Identify only durable, useful candidate knowledge directly supported by the evidence above.`;

    const systemPrompt = `You are HumanOS Nightly Candidate Synthesis Engine (Phase 2E-C).
Your role is to identify only durable, useful candidate knowledge supported directly by the supplied evidence.

STRICT EPISTEMIC RULES:
1. Identify ONLY durable, useful candidate knowledge supported directly by the supplied evidence.
2. Categories:
   - "EVENT": Normally remains episodic. Only propose if it marks a significant durable life milestone.
   - "FACT": Propose only if stable and genuinely useful for long-term context.
   - "PREFERENCE": Propose only when evidence clearly indicates a recurring or explicit preference.
   - "GOAL": Propose only when evidence indicates an ongoing active goal.
   - "IDENTITY": Propose only with strong, direct evidence.
   - "PATTERN": Highest caution. Do NOT infer psychology or personality traits.
3. FREQUENCY != TRUTH: Repeated trivial events (e.g. eating pizza 3 times) MUST NOT create personality traits like "User loves pizza" or psychological conclusions.
4. DO NOT create duplicate candidates for facts that already exist in [Existing Canonical Semantic Memories].
5. Every candidate MUST include valid source_refs containing the exact "working_memory" or "episodic_memory" IDs provided in the evidence.
6. Return structured JSON ONLY matching this schema:
{
  "candidates": [
    {
      "category": "EVENT" | "FACT" | "PREFERENCE" | "GOAL" | "IDENTITY" | "PATTERN",
      "key": "canonical_concept_key",
      "value": "factual_value_string",
      "confidence": 0.0 to 1.0,
      "importance": 0 to 100,
      "reason": "succinct explanation citing evidence",
      "source_refs": [
        { "type": "working_memory" | "episodic_memory", "id": "record_id" }
      ]
    }
  ]
}
If no evidence warrants a promotion candidate, return {"candidates": []}.`;

    const rawResponse = await cognitiveRouter.complete(
      'BACKGROUND_COGNITION',
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.1, maxTokens: CANDIDATE_SYNTHESIS_LIMITS.MAX_OUTPUT_TOKENS, jsonMode: true }
    );

    try {
      const parsed = JSON.parse(rawResponse);
      if (!parsed || !Array.isArray(parsed.candidates)) {
        logger.warn('[CandidateSynthesis] Malformed JSON response: missing candidates array', { rawResponse });
        return [];
      }
      return parsed.candidates;
    } catch (parseErr: any) {
      const trimmed = rawResponse.trim();
      if ((trimmed.startsWith('{') && !trimmed.endsWith('}')) || (trimmed.startsWith('[') && !trimmed.endsWith(']'))) {
        logger.error('[CandidateSynthesis] JSON parse failed on model output (likely truncated)', { rawResponseLength: rawResponse.length, error: parseErr });
        throw new Error('MODEL_OUTPUT_TRUNCATED');
      }
      
      logger.warn('[CandidateSynthesis] Malformed JSON response', { rawResponse, error: parseErr });
      return [];
    }
  }

  /**
   * Validates, canonicalizes, and sanitizes raw model candidates against strict rules.
   */
  validateAndNormalizeCandidates(
    userId: string,
    rawCandidates: RawCandidatePayload[],
    packet: CandidateEvidencePacket
  ): { valid: MemoryPromotionCandidate[]; deduplicated: number; rejected: number } {
    const valid: MemoryPromotionCandidate[] = [];
    let deduplicated = 0;
    let rejected = 0;

    const validCategories = new Set<CognitiveCategory>(['EVENT', 'FACT', 'PREFERENCE', 'GOAL', 'IDENTITY', 'PATTERN']);
    const existingWkIds = new Set(packet.workingMemoryRecords.map(w => w.id));
    const existingEpIds = new Set(packet.episodicRecords.map(e => e.id));

    // Map existing canonical memories for duplicate checking
    const existingCanonicalMap = new Map<string, string>();
    packet.canonicalSemanticKeys.forEach(m => {
      existingCanonicalMap.set(getCanonicalKeyString(m.key), m.value.trim().toLowerCase());
    });

    const seenBatchFingerprints = new Set<string>();

    for (const raw of rawCandidates) {
      if (!raw || typeof raw !== 'object') {
        rejected++;
        continue;
      }

      // 1. Category validation
      if (!validCategories.has(raw.category)) {
        logger.debug('[CandidateSynthesis] Rejected invalid category', { raw });
        rejected++;
        continue;
      }

      // 2. Key and value validation
      if (!raw.key || typeof raw.key !== 'string' || !raw.value || typeof raw.value !== 'string') {
        rejected++;
        continue;
      }

      const canonicalKey = getCanonicalKeyString(raw.key);
      const cleanValue = raw.value.trim();

      // 3. Garbage / question check
      if (isGarbageMemoryValue(canonicalKey, cleanValue, 'CandidateSynthesis')) {
        logger.debug('[CandidateSynthesis] Rejected garbage value', { canonicalKey, cleanValue });
        rejected++;
        continue;
      }

      // Question detection in key/value
      if (
        cleanValue.endsWith('?') ||
        (/\b(kya|kaise|kab|kyun|who|what|where|when|why|how)\b/i.test(cleanValue) && cleanValue.split(' ').length > 4)
      ) {
        logger.debug('[CandidateSynthesis] Rejected question text in candidate value', { cleanValue });
        rejected++;
        continue;
      }

      // 4. Frequency != Truth check: Reject psychological / trait conclusions
      if (raw.category === 'PATTERN' || raw.category === 'IDENTITY') {
        const lowerVal = cleanValue.toLowerCase();
        if (
          lowerVal.includes('obsessed') ||
          lowerVal.includes('addicted') ||
          lowerVal.includes('always') ||
          lowerVal.includes('personality')
        ) {
          logger.debug('[CandidateSynthesis] Blocked ungrounded trait/psychology conclusion', { cleanValue });
          rejected++;
          continue;
        }
      }

      // 5. Duplicate canonical memory check
      const existingVal = existingCanonicalMap.get(canonicalKey);
      if (existingVal && existingVal === cleanValue.toLowerCase()) {
        logger.debug('[CandidateSynthesis] Skipped candidate identical to existing semantic memory', { canonicalKey });
        deduplicated++;
        continue;
      }

      // 6. Source reference verification (prevent hallucinated IDs)
      const rawRefs = Array.isArray(raw.source_refs) ? raw.source_refs : [];
      const verifiedRefs: MemorySourceReference[] = [];

      for (const ref of rawRefs) {
        if (ref.type === 'working_memory' && existingWkIds.has(ref.id)) {
          verifiedRefs.push({ type: 'working_memory', id: ref.id });
        } else if (ref.type === 'episodic_memory' && existingEpIds.has(ref.id)) {
          verifiedRefs.push({ type: 'episodic_memory', id: ref.id });
        }
      }

      if (verifiedRefs.length === 0) {
        logger.debug('[CandidateSynthesis] Rejected candidate with no valid grounded source references', { raw });
        rejected++;
        continue;
      }

      // 7. Fingerprint & batch deduplication
      const fingerprint = generateCandidateFingerprint(userId, raw.category, canonicalKey, cleanValue);
      if (seenBatchFingerprints.has(fingerprint) || this.fingerprintStore.has(fingerprint)) {
        deduplicated++;
        continue;
      }

      seenBatchFingerprints.add(fingerprint);

      const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.75;
      const importance = typeof raw.importance === 'number' ? Math.max(0, Math.min(100, raw.importance)) : 70;

      if (confidence < 0.65) {
        rejected++;
        continue;
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + CANDIDATE_SYNTHESIS_LIMITS.CANDIDATE_TTL_DAYS);

      valid.push({
        candidate_id: crypto.randomUUID(),
        user_id: userId,
        category: raw.category,
        proposed_key: canonicalKey,
        proposed_value: cleanValue,
        source_references: verifiedRefs,
        confidence,
        importance_estimate: importance,
        reason: String(raw.reason || 'Synthesized from verified episodic/working memory evidence'),
        created_at: new Date().toISOString(),
        status: 'candidate',
        fingerprint,
        expires_at: expiresAt.toISOString(),
      });

      if (valid.length >= CANDIDATE_SYNTHESIS_LIMITS.MAX_CANDIDATES_PER_USER) {
        break;
      }
    }

    return { valid, deduplicated, rejected };
  }

  /**
   * Stores synthesized candidates in the candidate holding buffer.
   */
  async storeCandidates(userId: string, candidates: MemoryPromotionCandidate[]): Promise<void> {
    if (candidates.length === 0) return;

    const existing = this.candidateStore.get(userId) || [];
    const updated = [...existing, ...candidates].slice(-50); // Keep max 50 recent candidates per user

    this.candidateStore.set(userId, updated);
    candidates.forEach(c => {
      if (c.fingerprint) this.fingerprintStore.add(c.fingerprint);
    });

    // Update metadata on source working_memory records (non-destructive status tag)
    const wmIds = candidates
      .flatMap(c => c.source_references)
      .filter(r => r.type === 'working_memory')
      .map(r => r.id);

    if (wmIds.length > 0) {
      await qt.track('tag_wm_candidates', 'working_memory', () =>
        supabaseAdmin
          .from('working_memory')
          .update({ promotion_status: 'CANDIDATE_SYNTHESIZED' })
          .in('id', wmIds)
      );
    }
  }

  /**
   * Executes candidate synthesis for a single isolated user, acquiring a database claim if runId is provided.
   */
  async synthesizeCandidatesForUser(userId: string, runId?: string): Promise<CandidateSynthesisResult> {
    // 1. If runId provided, acquire distributed database lease BEFORE any work
    if (runId) {
      const claimResult = await this.claimUserBatch(runId, userId);
      if (!claimResult.claimed) {
        logger.info('[CandidateSynthesis] User batch skipped — lease not acquired', {
          runId,
          userId,
          reason: claimResult.reason,
        });
        return {
          userId,
          status: 'skipped',
          modelCalls: 0,
          candidatesGenerated: [],
          candidatesDeduplicated: 0,
          candidatesRejected: 0,
          reason: claimResult.reason,
        };
      }
    }

    try {
      // 2. Build bounded evidence packet
      const packet = await this.buildEvidencePacket(userId);

      // 3. Check for empty batch -> 0 LLM calls
      if (!packet) {
        logger.debug('[CandidateSynthesis] Empty batch, 0 LLM calls', { userId });
        if (runId) {
          await this.completeUserClaim(runId, userId, { modelCalled: false, candidatesCount: 0 });
        }
        return {
          userId,
          status: 'empty_batch',
          modelCalls: 0,
          candidatesGenerated: [],
          candidatesDeduplicated: 0,
          candidatesRejected: 0,
        };
      }

      // 4. Invoke Gemini (Guaranteed max 1 call per claimed user)
      const rawCandidates = await this.evaluateWithGemini(packet);

      // 5. Validate & Normalize
      const { valid, deduplicated, rejected } = this.validateAndNormalizeCandidates(userId, rawCandidates, packet);

      // 6. Store Candidates (CANDIDATE ONLY — ZERO semantic memory writes)
      await this.storeCandidates(userId, valid);

      if (runId) {
        await this.completeUserClaim(runId, userId, {
          modelCalled: true,
          candidatesCount: valid.length,
        });
      }

      logger.info('[CandidateSynthesis] User synthesis complete', {
        userId,
        candidatesCreated: valid.length,
        deduplicated,
        rejected,
      });

      return {
        userId,
        status: 'completed',
        modelCalls: 1,
        candidatesGenerated: valid,
        candidatesDeduplicated: deduplicated,
        candidatesRejected: rejected,
      };
    } catch (err: any) {
      logger.error('[CandidateSynthesis] User synthesis failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });

      if (runId) {
        await this.completeUserClaim(runId, userId, {
          modelCalled: false,
          candidatesCount: 0,
          error: err.message,
        });
      }

      return {
        userId,
        status: 'failed',
        modelCalls: 0,
        candidatesGenerated: [],
        candidatesDeduplicated: 0,
        candidatesRejected: 0,
        error: err.message,
      };
    }
  }

  /**
   * Retrieves active promotion candidates for a given user.
   */
  getCandidates(userId: string, status?: 'candidate' | 'rejected' | 'expired'): MemoryPromotionCandidate[] {
    const userCandidates = this.candidateStore.get(userId) || [];
    if (!status) return userCandidates;
    return userCandidates.filter(c => c.status === status);
  }

  /**
   * Nightly cron runner for all active users (database-locked, isolated per user).
   */
  async runNightlyCandidateSynthesisForAllUsers(overrideRunId?: string): Promise<{
    runId: string;
    usersProcessed: number;
    candidatesCreated: number;
    totalModelCalls: number;
    status: 'completed' | 'already_running' | 'already_completed' | 'failed';
  }> {
    const runId = overrideRunId || getLogicalRunId();
    logger.info('[CandidateSynthesis] Attempting nightly candidate synthesis run claim...', { runId });

    // 1. Acquire database-backed logical run claim
    const runClaim = await this.claimNightlyRun(runId);
    if (!runClaim.claimed) {
      logger.info('[CandidateSynthesis] Nightly run skipped — already running or completed', {
        runId,
        status: runClaim.status,
      });
      return {
        runId,
        usersProcessed: 0,
        candidatesCreated: 0,
        totalModelCalls: 0,
        status: runClaim.status === 'already_completed' ? 'already_completed' : 'already_running',
      };
    }

    logger.info('[CandidateSynthesis] Nightly run claim acquired. Starting synthesis batch...', { runId });

    // 2. Fetch active users
    const { data: users } = await qt.track('synth_active_users', 'profiles', () =>
      supabaseAdmin
        .from('profiles')
        .select('id')
        .limit(CANDIDATE_SYNTHESIS_LIMITS.MAX_USERS_PER_RUN)
    );

    let usersProcessed = 0;
    let candidatesCreated = 0;
    let totalModelCalls = 0;

    for (const u of users || []) {
      try {
        const res = await this.synthesizeCandidatesForUser(u.id, runId);
        if (res.status === 'completed' || res.status === 'empty_batch') {
          usersProcessed++;
          candidatesCreated += res.candidatesGenerated.length;
          totalModelCalls += res.modelCalls;
        }
      } catch (userErr) {
        logger.error('[CandidateSynthesis] Individual user error, continuing batch', {
          userId: u.id,
          error: userErr,
        });
      }
    }

    // 3. Mark nightly run completed in database
    await this.completeNightlyRun(runId, {
      totalUsers: usersProcessed,
      candidatesCreated,
      modelCalls: totalModelCalls,
    });

    logger.info('[CandidateSynthesis] Nightly synthesis run completed and recorded', {
      runId,
      usersProcessed,
      candidatesCreated,
      totalModelCalls,
    });

    return {
      runId,
      usersProcessed,
      candidatesCreated,
      totalModelCalls,
      status: 'completed',
    };
  }
}

export const candidateSynthesisService = new CandidateSynthesisService();
