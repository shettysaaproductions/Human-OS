/**
 * SemanticCompressionService.ts — Phase 2E-D Semantic Compression & Verification Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. NON-DESTRUCTIVE / DRY-RUN FOR SOURCE DATA: Source records in `working_memory` and
 *    `episodic_memories` are NEVER deleted, pruned, or archived. Source data remains 100% available.
 * 2. TWO-STAGE VERIFICATION PIPELINE:
 *    Source Evidence -> Draft (Flash Medium) -> Entailment & Temporal Verification (Flash High)
 *    -> [Optional Pro High Escalation] -> Canonical Safety Check -> MemoryRepository Write -> Readback.
 * 3. STRICT AUTHORITY CLASSIFICATION: Compressed memories are assigned `source_authority: 'subconscious_inference'`
 *    (or derived authority). NEVER impersonates `explicit_user` or `deterministic`.
 * 4. TEMPORAL PRESERVATION: Chronological sequences (e.g. left Company A, joined Company B)
 *    must be preserved and NEVER flattened into simultaneous timeless assertions.
 * 5. FREQUENCY != TRUTH: Repeated trivial events (e.g. eating pizza 3x) must NEVER
 *    create ungrounded personality traits or psychological conclusions.
 * 6. CANONICAL REPOSITORY GATEWAY: All semantic writes MUST route through `memoryRepository.upsertMemory()`.
 * 7. POST-WRITE READBACK VERIFICATION: Validates row in DB before confirming proposal.
 * 8. CROSS-USER ISOLATION: Strict rejection if any source reference belongs to another user.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  CognitiveCategory,
  CompressionDraft,
  CompressionVerificationResult,
  ExtractedMemory,
  MemoryPromotionCandidate,
  MemorySourceReference,
  MemoryType,
  SourceAuthority,
  VerifiedSemanticProposal,
} from '../types/memory';
import { canonicalizeKey } from '../lib/memoryKeySchema';
import { isGarbageMemoryValue } from '../lib/memoryFilters';
import { cognitiveRouter } from '../lib/cognitiveRouter';
import { memoryRepository } from './memoryRepository';
import crypto from 'crypto';

export const COMPRESSION_LIMITS = {
  MAX_PROPOSALS_PER_USER_RUN: 5,
  MAX_INPUT_TOKENS: 1500,
  MAX_OUTPUT_TOKENS: 512,
  MAX_PRO_ESCALATIONS_PER_USER_RUN: 1,
} as const;

export interface CompressionEvidencePacket {
  userId: string;
  candidate: MemoryPromotionCandidate;
  workingMemoryEvidence: Array<{
    id: string;
    key: string;
    value: string;
    created_at: string;
  }>;
  episodicMemoryEvidence: Array<{
    id: string;
    summary: string;
    emotion?: string | null;
    source_message_id?: string | null;
    created_at: string;
  }>;
  existingCanonicalMemories: Array<{
    key: string;
    value: string;
    source_authority?: string;
  }>;
  hasMissingProvenance: boolean;
  estimatedTokens: number;
}

export function generateCompressionFingerprint(
  userId: string,
  sourceIds: string[],
  key: string,
  value: string
): string {
  const sortedIds = [...sourceIds].sort().join(',');
  const normKey = canonicalizeKey((key || '').trim().toLowerCase()).canonical;
  const normVal = (value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto
    .createHash('sha256')
    .update(`${userId}:${sortedIds}:${normKey}:${normVal}`)
    .digest('hex');
}

export function mapCategoryToMemoryType(category: CognitiveCategory, key: string): MemoryType {
  const lowerKey = key.toLowerCase();
  if (lowerKey.includes('wife') || lowerKey.includes('husband') || lowerKey.includes('son') || lowerKey.includes('daughter') || lowerKey.includes('mother') || lowerKey.includes('father') || lowerKey.includes('family')) {
    return 'family';
  }
  if (lowerKey.includes('work') || lowerKey.includes('company') || lowerKey.includes('job') || lowerKey.includes('office') || lowerKey.includes('boss')) {
    return 'work';
  }
  if (lowerKey.includes('goal') || lowerKey.includes('target') || category === 'GOAL') {
    return 'goals';
  }
  if (lowerKey.includes('prefer') || lowerKey.includes('like') || lowerKey.includes('habit') || category === 'PREFERENCE') {
    return 'preferences';
  }
  if (lowerKey.includes('health') || lowerKey.includes('diet') || lowerKey.includes('med') || lowerKey.includes('doctor')) {
    return 'health';
  }
  if (lowerKey.includes('birthday') || lowerKey.includes('anniversary') || lowerKey.includes('date')) {
    return 'important_dates';
  }
  return 'personal';
}

export class SemanticCompressionService {
  private proposalStore: Map<string, VerifiedSemanticProposal[]> = new Map();
  private processedFingerprints: Set<string> = new Set();
  private proEscalationCounts: Map<string, number> = new Map();

  /**
   * Builds bounded evidence packet for a promotion candidate.
   * Validates cross-user isolation and provenance.
   */
  async buildCompressionEvidencePacket(
    userId: string,
    candidate: MemoryPromotionCandidate
  ): Promise<CompressionEvidencePacket | null> {
    const wmIds = candidate.source_references
      .filter(r => r.type === 'working_memory')
      .map(r => r.id);

    const epIds = candidate.source_references
      .filter(r => r.type === 'episodic_memory')
      .map(r => r.id);

    let workingMemoryEvidence: any[] = [];
    let episodicMemoryEvidence: any[] = [];
    let hasMissingProvenance = candidate.source_references.length === 0;

    // 1. Fetch referenced working memories
    if (wmIds.length > 0) {
      const { data: wms } = await qt.track('fetch_comp_wm', 'working_memory', () =>
        supabaseAdmin
          .from('working_memory')
          .select('id, user_id, key, value, created_at')
          .in('id', wmIds)
      );

    const safeWms = Array.isArray(wms) ? wms : (wms ? [wms] : []);
    for (const w of safeWms) {
      if (w.user_id !== userId) {
        logger.warn('[SemanticCompression] Cross-user working memory reference detected! Rejecting packet.', {
          targetUserId: userId,
          recordUserId: w.user_id,
          recordId: w.id,
        });
        return null;
      }
    }

    workingMemoryEvidence = safeWms.map((w: any) => ({
      id: w.id,
      key: w.key,
      value: w.value,
      created_at: w.created_at,
    }));
    }

    // 2. Fetch referenced episodic memories
    if (epIds.length > 0) {
      const { data: eps } = await qt.track('fetch_comp_ep', 'episodic_memories', () =>
        supabaseAdmin
          .from('episodic_memories')
          .select('id, user_id, summary, emotion, source_message_id, created_at')
          .in('id', epIds)
      );

      const safeEps = Array.isArray(eps) ? eps : (eps ? [eps] : []);
      // Cross-User Isolation check on episodic memory
      for (const e of safeEps) {
        if (e.user_id !== userId) {
          logger.warn('[SemanticCompression] Cross-user episodic memory reference detected! Rejecting packet.', {
            targetUserId: userId,
            recordUserId: e.user_id,
            recordId: e.id,
          });
          return null;
        }
      }

      episodicMemoryEvidence = safeEps.map((e: any) => ({
        id: e.id,
        summary: e.summary,
        emotion: e.emotion,
        source_message_id: e.source_message_id,
        created_at: e.created_at,
      }));
    }

    // Check missing provenance if IDs did not match
    if (workingMemoryEvidence.length === 0 && episodicMemoryEvidence.length === 0) {
      hasMissingProvenance = true;
    }

    // 3. Fetch existing canonical semantic memories for duplicate/conflict detection
    const { data: mems } = await qt.track('fetch_comp_mems', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('key, value, source_authority')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .limit(50)
    );

    const safeMems = Array.isArray(mems) ? mems : (mems ? [mems] : []);
    const existingCanonicalMemories = safeMems.map((m: any) => ({
      key: m.key,
      value: m.value,
      source_authority: m.source_authority,
    }));

    const rawChars =
      JSON.stringify(workingMemoryEvidence).length +
      JSON.stringify(episodicMemoryEvidence).length +
      JSON.stringify(existingCanonicalMemories).length +
      JSON.stringify(candidate).length;
    const estimatedTokens = Math.round(rawChars / 4);

    return {
      userId,
      candidate,
      workingMemoryEvidence,
      episodicMemoryEvidence,
      existingCanonicalMemories,
      hasMissingProvenance,
      estimatedTokens,
    };
  }

  /**
   * Generates a neutral, factual compressed draft using Gemini 3.7 Flash Medium.
   */
  async generateCompressionDraft(
    packet: CompressionEvidencePacket
  ): Promise<CompressionDraft | null> {
    const wmText = packet.workingMemoryEvidence.length > 0
      ? packet.workingMemoryEvidence.map(w => `- [WM: ${w.id}] (${w.created_at}) key="${w.key}", value="${w.value}"`).join('\n')
      : 'None';

    const epText = packet.episodicMemoryEvidence.length > 0
      ? packet.episodicMemoryEvidence.map(e => `- [EP: ${e.id}] (${e.created_at}) "${e.summary}" (emotion: ${e.emotion || 'neutral'})`).join('\n')
      : 'None';

    const memText = packet.existingCanonicalMemories.length > 0
      ? packet.existingCanonicalMemories.map(m => `- ${m.key}: "${m.value}" (authority: ${m.source_authority || 'unknown'})`).join('\n')
      : 'None';

    const prompt = `=== CANDIDATE EVIDENCE FOR COMPRESSION ===
User: ${packet.userId}
Proposed Category: ${packet.candidate.category}
Proposed Key: ${packet.candidate.proposed_key}
Proposed Value: ${packet.candidate.proposed_value}

[Source Working Memory Records (Chronological)]:
${wmText}

[Source Episodic Memory Records (Chronological)]:
${epText}

[Existing Canonical Semantic Memories (DO NOT CONFLICT)]:
${memText}

Synthesize a single concise, factual, durable compressed memory draft.`;

    const systemPrompt = `You are HumanOS Semantic Compression Generator (Phase 2E-D).
Your task is to synthesize a neutral, factual compressed memory statement supported strictly by the evidence.

STRICT EPISTEMIC RULES:
1. Synthesize ONLY claims directly supported by the supplied source evidence.
2. PRESERVE TEMPORAL ORDER: If evidence shows a chronological progression (e.g. left Company A, joined Company B), state the sequence accurately (e.g. "Previously worked at Company A and later joined Company B"). NEVER combine historical sequential events into simultaneous current facts (e.g. DO NOT say "Works at Company A and Company B").
3. FORBIDDEN ACTIONS:
   - NO personality profiling, psychological diagnosis, or trait extrapolation.
   - NO unsupported motivations or causal leaps.
   - NO generalizing repeated trivial events (Frequency != Truth: eating pizza 3x does NOT mean "obsessed with pizza").
   - NO invented facts or relationships.
4. Output JSON ONLY matching this schema:
{
  "draft": {
    "key": "canonical_concept_key",
    "value": "factual_compressed_statement",
    "category": "EVENT" | "FACT" | "PREFERENCE" | "GOAL" | "IDENTITY" | "PATTERN",
    "confidence": 0.0 to 1.0,
    "importance": 0 to 100,
    "reason": "succinct justification citing evidence",
    "temporal_summary": "chronology explanation if temporal transition occurred",
    "source_refs": [
      { "type": "working_memory" | "episodic_memory", "id": "record_id" }
    ]
  }
}
If evidence is insufficient, contradictory, or trivial, return {"draft": null}.`;

    try {
      const raw = await cognitiveRouter.complete(
        'BACKGROUND_COGNITION',
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.1, maxTokens: COMPRESSION_LIMITS.MAX_OUTPUT_TOKENS, jsonMode: true }
      );

      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.draft || typeof parsed.draft !== 'object') {
        logger.debug('[SemanticCompression] Generator returned null or invalid draft', { raw });
        return null;
      }

      const d = parsed.draft;
      const canonicalKey = canonicalizeKey(d.key || packet.candidate.proposed_key).canonical;
      const cleanValue = String(d.value || '').trim();

      if (!cleanValue || isGarbageMemoryValue(canonicalKey, cleanValue, 'SemanticCompressionGenerator')) {
        logger.debug('[SemanticCompression] Blocked garbage draft', { canonicalKey, cleanValue });
        return null;
      }

      // Valid verified source references from input packet
      const validWmIds = new Set(packet.workingMemoryEvidence.map(w => w.id));
      const validEpIds = new Set(packet.episodicMemoryEvidence.map(e => e.id));
      const verifiedRefs: MemorySourceReference[] = [];

      const draftRefs = Array.isArray(d.source_refs) ? d.source_refs : packet.candidate.source_references;
      for (const r of draftRefs) {
        if (r.type === 'working_memory' && validWmIds.has(r.id)) {
          verifiedRefs.push({ type: 'working_memory', id: r.id });
        } else if (r.type === 'episodic_memory' && validEpIds.has(r.id)) {
          verifiedRefs.push({ type: 'episodic_memory', id: r.id });
        }
      }

      const allSourceIds = verifiedRefs.map(r => r.id);
      const fingerprint = generateCompressionFingerprint(packet.userId, allSourceIds, canonicalKey, cleanValue);

      const memoryType = mapCategoryToMemoryType(d.category || packet.candidate.category, canonicalKey);

      return {
        draft_id: crypto.randomUUID(),
        user_id: packet.userId,
        candidate_id: packet.candidate.candidate_id,
        category: d.category || packet.candidate.category,
        proposed_key: canonicalKey,
        proposed_value: cleanValue,
        proposed_memory_type: memoryType,
        source_references: verifiedRefs,
        confidence: typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0.85,
        importance: typeof d.importance === 'number' ? Math.max(0, Math.min(100, d.importance)) : 75,
        reason: String(d.reason || 'Synthesized factual compression draft'),
        temporal_summary: d.temporal_summary || undefined,
        fingerprint,
        created_at: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('[SemanticCompression] Failed during draft generation', { error: err });
      return null;
    }
  }

  /**
   * Verifies draft entailment and temporal preservation via Gemini 3.7 Flash High.
   * Escalates to Gemini Pro High if uncertain and high value (max 1/user).
   */
  async verifyEntailmentAndTemporal(
    packet: CompressionEvidencePacket,
    draft: CompressionDraft
  ): Promise<CompressionVerificationResult> {
    const wmText = packet.workingMemoryEvidence.map(w => `- [WM: ${w.id}] (${w.created_at}) ${w.key}: ${w.value}`).join('\n');
    const epText = packet.episodicMemoryEvidence.map(e => `- [EP: ${e.id}] (${e.created_at}) ${e.summary}`).join('\n');

    const prompt = `=== SOURCE EVIDENCE ===
${wmText || 'None'}
${epText || 'None'}

=== PROPOSED COMPRESSED MEMORY ===
Key: "${draft.proposed_key}"
Value: "${draft.proposed_value}"
Category: ${draft.category}
Temporal Summary: ${draft.temporal_summary || 'None'}

Question: Does every substantive claim in this compressed memory follow directly from the supplied evidence, and is the temporal state accurate?`;

    const systemPrompt = `You are HumanOS Semantic Entailment & Temporal Verifier (Phase 2E-D).
Your role is to rigorously check whether the proposed compressed memory is strictly entailed by the source evidence without hallucination, overreach, or temporal distortion.

VERIFICATION CRITERIA:
1. ENTAILMENT CHECK:
   - Are all names, entities, relationships, and quantities exact?
   - Are there unsupported adjectives, psychological claims, or motivations? (If yes -> REJECT)
   - Did repeated trivial events get converted into personality traits? (If yes -> REJECT)
2. TEMPORAL CHECK:
   - Does the memory preserve temporal order?
   - If the user transitioned between states (e.g. jobs, locations, preferences), does the statement accurately reflect that sequence, rather than claiming simultaneous current states? (If chronological conflict -> REJECT)
3. DECISION:
   - "approve": 100% directly entailed, temporally accurate, zero speculation.
   - "reject": Hallucination, unsupported trait, temporal conflict, or unsupported causal claim.
   - "uncertain": Ambiguous evidence or borderline inference requiring senior escalation.

Return JSON ONLY matching this schema:
{
  "decision": "approve" | "reject" | "uncertain",
  "confidence": 0.0 to 1.0,
  "unsupported_claims": ["list of any unsupported claims found"],
  "temporal_conflict": boolean,
  "temporal_accurate": boolean,
  "reason": "succinct explanation of verification decision"
}`;

    // Helper to run verifier call
    const runVerifierCall = async (workload: any, isPro: boolean): Promise<CompressionVerificationResult> => {
      const raw = await cognitiveRouter.complete(
        workload,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        { temperature: 0.0, maxTokens: COMPRESSION_LIMITS.MAX_OUTPUT_TOKENS, jsonMode: true }
      );

      const parsed = JSON.parse(raw);
      const decision = (parsed.decision === 'approve' || parsed.decision === 'reject' || parsed.decision === 'uncertain')
        ? parsed.decision
        : 'reject';

      return {
        decision,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        unsupported_claims: Array.isArray(parsed.unsupported_claims) ? parsed.unsupported_claims : [],
        temporal_conflict: Boolean(parsed.temporal_conflict),
        temporal_accurate: parsed.temporal_accurate !== false,
        reason: String(parsed.reason || 'Verification completed'),
        verifier_model: isPro ? 'gemini-pro-high' : 'gemini-flash-high',
        escalated: isPro,
      };
    };

    try {
      // 1. Primary verification: Flash High via BACKGROUND_COGNITION / PROACTIVE_REASONING
      let result = await runVerifierCall('PROACTIVE_REASONING', false);

      // 2. Escalation check: If UNCERTAIN and high importance, attempt Pro High (max 1/user/run)
      if (result.decision === 'uncertain') {
        const currentEscalations = this.proEscalationCounts.get(packet.userId) || 0;
        if (currentEscalations < COMPRESSION_LIMITS.MAX_PRO_ESCALATIONS_PER_USER_RUN && draft.importance >= 70) {
          logger.info('[SemanticCompression] Escalating uncertain verification to Pro High', {
            userId: packet.userId,
            key: draft.proposed_key,
          });

          this.proEscalationCounts.set(packet.userId, currentEscalations + 1);
          const proResult = await runVerifierCall('CONVERSATION', true);
          proResult.escalation_reason = 'Primary verifier uncertain on high-value candidate';
          return proResult;
        } else {
          // If no escalation budget left or lower importance -> reject uncertain
          logger.info('[SemanticCompression] Uncertain verification rejected (escalation capped or low priority)', {
            userId: packet.userId,
            key: draft.proposed_key,
          });
          result.decision = 'reject';
          result.reason += ' (Uncertain decision rejected without escalation)';
        }
      }

      return result;
    } catch (err) {
      logger.error('[SemanticCompression] Verifier call failed', { error: err });
      return {
        decision: 'reject',
        confidence: 0,
        unsupported_claims: ['Verifier execution failed'],
        temporal_conflict: false,
        temporal_accurate: false,
        reason: `Verifier execution error: ${err instanceof Error ? err.message : String(err)}`,
        verifier_model: 'gemini-flash-high',
        escalated: false,
      };
    }
  }

  /**
   * Executes the full Phase 2E-D pipeline for a single promotion candidate.
   */
  async processCandidateCompression(
    userId: string,
    candidate: MemoryPromotionCandidate
  ): Promise<{
    status: 'verified_and_written' | 'rejected' | 'uncertain_rejected' | 'failed' | 'duplicate_skipped';
    proposal?: VerifiedSemanticProposal;
    reason?: string;
  }> {
    // 1. Build bounded evidence packet & cross-user check
    const packet = await this.buildCompressionEvidencePacket(userId, candidate);
    if (!packet) {
      return {
        status: 'rejected',
        reason: 'Failed to build evidence packet or cross-user reference detected',
      };
    }

    // 2. Generate compression draft (Flash Medium)
    const draft = await this.generateCompressionDraft(packet);
    if (!draft) {
      return {
        status: 'rejected',
        reason: 'Draft generator returned null or invalid factual draft',
      };
    }

    // 3. Check duplicate fingerprint
    if (this.processedFingerprints.has(draft.fingerprint)) {
      return {
        status: 'duplicate_skipped',
        reason: 'Duplicate compression fingerprint already processed',
      };
    }

    // 4. Verify Entailment & Temporal Preservation (Flash High -> Pro High)
    const verification = await this.verifyEntailmentAndTemporal(packet, draft);
    if (verification.decision === 'reject') {
      logger.info('[SemanticCompression] Draft rejected by verifier', {
        key: draft.proposed_key,
        unsupported: verification.unsupported_claims,
        reason: verification.reason,
      });
      return {
        status: 'rejected',
        reason: verification.reason,
      };
    }

    if (verification.decision === 'uncertain') {
      return {
        status: 'uncertain_rejected',
        reason: 'Verifier returned uncertain and proposal was safely rejected',
      };
    }

    // 5. Canonical Memory Safety Check & MemoryRepository Write
    const extractedMemory: ExtractedMemory = {
      shouldPersist: true,
      type: draft.proposed_memory_type,
      key: draft.proposed_key,
      value: draft.proposed_value,
      importance: draft.importance,
      confidence: Math.min(draft.confidence, verification.confidence),
      source_authority: 'subconscious_inference' as SourceAuthority, // Strict non-impersonation
      source_references: draft.source_references,
      compression_status: 'compressed',
    };

    // Route write through authoritative MemoryRepository
    await memoryRepository.upsertMemory(
      userId,
      extractedMemory,
      `Semantic compression from ${draft.source_references.length} source records`
    );

    // 6. Post-Write Readback Verification
    const { data: readback } = await qt.track('readback_compressed_mem', 'memories', () =>
      supabaseAdmin
        .from('memories')
        .select('id, key, value, user_id, source_authority, source_references, compression_status')
        .eq('user_id', userId)
        .eq('key', draft.proposed_key)
        .maybeSingle()
    );

    if (!readback || readback.key !== draft.proposed_key) {
      logger.error('[SemanticCompression] Write verification failed! Memory not found on readback.', {
        userId,
        key: draft.proposed_key,
      });
      return {
        status: 'failed',
        reason: 'Post-write readback verification failed',
      };
    }

    // 7. Register Verified Semantic Proposal (Non-destructive: archive_candidate = true)
    const proposal: VerifiedSemanticProposal = {
      proposal_id: crypto.randomUUID(),
      user_id: userId,
      key: draft.proposed_key,
      value: draft.proposed_value,
      memory_type: draft.proposed_memory_type,
      source_authority: readback.source_authority || 'subconscious_inference',
      source_references: draft.source_references,
      verification_result: verification,
      status: 'verified',
      written_memory_id: readback.id,
      archive_candidate: true, // Marker for Phase 2E-E proposal review, source is NOT deleted
      fingerprint: draft.fingerprint,
      created_at: new Date().toISOString(),
    };

    this.processedFingerprints.add(draft.fingerprint);
    const userProposals = this.proposalStore.get(userId) || [];
    this.proposalStore.set(userId, [...userProposals, proposal]);

    logger.info('[SemanticCompression] Successfully verified and wrote compressed semantic memory', {
      userId,
      key: proposal.key,
      writtenId: readback.id,
    });

    return {
      status: 'verified_and_written',
      proposal,
    };
  }

  /**
   * Rollback / invalidation mechanism: marks proposal invalidated without touching source evidence.
   */
  async invalidateProposal(userId: string, proposalId: string, reason: string): Promise<boolean> {
    const userProposals = this.proposalStore.get(userId) || [];
    const target = userProposals.find(p => p.proposal_id === proposalId);

    if (!target) return false;

    target.status = 'invalidated';
    target.invalidated_reason = reason;

    // If written to memories, archive or update status on the memory row
    if (target.written_memory_id) {
      await qt.track('invalidate_mem', 'memories', () =>
        supabaseAdmin
          .from('memories')
          .update({ is_archived: true, compression_status: 'rejected' })
          .eq('id', target.written_memory_id)
      );
    }

    logger.info('[SemanticCompression] Proposal invalidated without touching source records', {
      userId,
      proposalId,
      reason,
    });

    return true;
  }

  /**
   * Retrieves verified proposals for a user.
   */
  getProposals(userId: string): VerifiedSemanticProposal[] {
    return this.proposalStore.get(userId) || [];
  }
}

export const semanticCompressionService = new SemanticCompressionService();
