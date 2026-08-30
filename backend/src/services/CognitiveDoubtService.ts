/**
 * CognitiveDoubtService.ts — Core Epistemic Uncertainty & Clarification Service (Phase 2B)
 *
 * Responsibilities:
 * - Deterministic creation and updates of Cognitive Doubts
 * - Fingerprint deduplication & presentation loop prevention
 * - Non-destructive lifecycle transitions (open -> presented -> waiting_for_user -> resolved/expired)
 * - Safe epistemic gap detection (W-023..W-026) without LLM hallucinations
 * - Zero LLM cost, Zero core-state mutations (only writes to nova_cognitive_doubts)
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { qt } from '../lib/queryTracker';
import {
  CognitiveDoubtRecord,
  DoubtCreationDraft,
  DoubtStatus,
  DoubtResolutionMatch,
} from '../types/cognitiveDoubt';
import { generateDoubtFingerprint } from '../lib/doubtFingerprint';

export class CognitiveDoubtService {
  /**
   * Creates or updates a Cognitive Doubt record.
   * Guarantees idempotency via (user_id, fingerprint) uniqueness.
   */
  async createOrUpdateDoubt(draft: DoubtCreationDraft): Promise<CognitiveDoubtRecord | null> {
    try {
      const fingerprint = draft.fingerprint || generateDoubtFingerprint(
        draft.userId,
        draft.category,
        draft.targetEntityKeys || [],
        draft.question
      );

      const days = draft.expiresInDays || 14;
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      // Check if open or waiting doubt already exists for this fingerprint
      const { data: existing } = await qt.track(
        'doubt_check_existing',
        'nova_cognitive_doubts',
        () =>
          supabaseAdmin
            .from('nova_cognitive_doubts')
            .select('*')
            .eq('user_id', draft.userId)
            .eq('fingerprint', fingerprint)
            .maybeSingle()
      );

      if (existing) {
        // If already resolved or dismissed, do not resurrect unless genuinely new
        if (existing.status === 'resolved' || existing.status === 'dismissed') {
          return existing as CognitiveDoubtRecord;
        }

        // Update evidence and confidence without resetting presentation count
        const { data: updated, error: updErr } = await supabaseAdmin
          .from('nova_cognitive_doubts')
          .update({
            evidence: draft.evidence,
            confidence: draft.confidence ?? existing.confidence,
            urgency: draft.urgency ?? existing.urgency,
            priority: draft.priority ?? existing.priority,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('*')
          .single();

        if (updErr) {
          logger.debug('[CognitiveDoubt] Update existing doubt skipped/failed', { error: updErr.message });
          return existing as CognitiveDoubtRecord;
        }

        return updated as CognitiveDoubtRecord;
      }

      // Insert new doubt
      const insertPayload = {
        user_id: draft.userId,
        category: draft.category,
        question: draft.question,
        evidence: draft.evidence,
        confidence: draft.confidence ?? 0.85,
        urgency: draft.urgency ?? 'medium',
        priority: draft.priority ?? 'NEXT',
        status: 'open' as DoubtStatus,
        fingerprint,
        presentation_count: 0,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: created, error: insErr } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .insert(insertPayload)
        .select('*')
        .single();

      if (insErr) {
        logger.debug('[CognitiveDoubt] Doubt insertion skipped/failed', { error: insErr.message });
        return null;
      }

      logger.info('[CognitiveDoubt] Created new cognitive doubt', {
        userId: draft.userId,
        category: draft.category,
        id: created.id,
        fingerprint,
      });

      return created as CognitiveDoubtRecord;
    } catch (err: any) {
      logger.debug('[CognitiveDoubt] Non-fatal error in createOrUpdateDoubt', { error: err?.message });
      return null;
    }
  }

  /**
   * Fetches all active, unresolved doubts for a user.
   */
  async getOpenDoubts(userId: string): Promise<CognitiveDoubtRecord[]> {
    try {
      const nowIso = new Date().toISOString();
      const { data: doubts, error } = await qt.track(
        'doubt_fetch_open',
        'nova_cognitive_doubts',
        () =>
          supabaseAdmin
            .from('nova_cognitive_doubts')
            .select('*')
            .eq('user_id', userId)
            .in('status', ['open', 'eligible_for_clarification', 'presented', 'waiting_for_user'])
            .gt('expires_at', nowIso)
            .order('created_at', { ascending: false })
            .limit(10)
      );

      if (error || !doubts) {
        return [];
      }

      return doubts as CognitiveDoubtRecord[];
    } catch (err: any) {
      logger.debug('[CognitiveDoubt] Fetch open doubts non-fatal failure', { userId, error: err?.message });
      return [];
    }
  }

  /**
   * Marks a doubt as presented to the user.
   * Increments presentation count. If presented >= 2 times, transitions to waiting_for_user
   * to avoid loop spamming.
   */
  async markPresented(doubtId: string): Promise<CognitiveDoubtRecord | null> {
    try {
      const { data: existing } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .select('*')
        .eq('id', doubtId)
        .maybeSingle();

      if (!existing) return null;

      const newCount = (existing.presentation_count || 0) + 1;
      const nextStatus: DoubtStatus = newCount >= 2 ? 'waiting_for_user' : 'presented';

      const { data: updated, error } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .update({
          presentation_count: newCount,
          last_presented_at: new Date().toISOString(),
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', doubtId)
        .select('*')
        .single();

      if (error) return null;
      return updated as CognitiveDoubtRecord;
    } catch (err: any) {
      logger.debug('[CognitiveDoubt] markPresented error', { doubtId, error: err?.message });
      return null;
    }
  }

  /**
   * Resolves a doubt with evidence of user turn resolution.
   */
  async resolveDoubt(
    doubtId: string,
    resolutionTurnId: string,
    resolutionEvidence?: Record<string, any>
  ): Promise<CognitiveDoubtRecord | null> {
    try {
      const { data: existing } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .select('*')
        .eq('id', doubtId)
        .maybeSingle();

      if (!existing) return null;

      const mergedEvidence = {
        ...(existing.evidence || {}),
        resolution: resolutionEvidence || { resolvedAt: new Date().toISOString() },
      };

      const { data: resolved, error } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .update({
          status: 'resolved' as DoubtStatus,
          resolution_turn_id: resolutionTurnId,
          evidence: mergedEvidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', doubtId)
        .select('*')
        .single();

      if (error) return null;

      logger.info('[CognitiveDoubt] Resolved doubt', {
        doubtId,
        resolutionTurnId,
        category: existing.category,
      });

      return resolved as CognitiveDoubtRecord;
    } catch (err: any) {
      logger.debug('[CognitiveDoubt] resolveDoubt error', { doubtId, error: err?.message });
      return null;
    }
  }

  /**
   * Transitions an expired doubt to 'expired' status.
   */
  async expireDoubt(doubtId: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .update({ status: 'expired' as DoubtStatus, updated_at: new Date().toISOString() })
        .eq('id', doubtId);
      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Explicitly dismisses a doubt.
   */
  async dismissDoubt(doubtId: string): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .update({ status: 'dismissed' as DoubtStatus, updated_at: new Date().toISOString() })
        .eq('id', doubtId);
      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Scans and expires all past-due doubts for a user.
   */
  async checkAndExpireDoubts(userId: string): Promise<number> {
    try {
      const nowIso = new Date().toISOString();
      const { data: expired } = await supabaseAdmin
        .from('nova_cognitive_doubts')
        .update({ status: 'expired' as DoubtStatus, updated_at: nowIso })
        .eq('user_id', userId)
        .in('status', ['open', 'eligible_for_clarification', 'presented', 'waiting_for_user'])
        .lte('expires_at', nowIso)
        .select('id');

      return expired?.length || 0;
    } catch {
      return 0;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SAFE EPISTEMIC GAP DETECTORS (W-023..W-026)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * W-023: Family Knowledge Gap Detector
   * Detects statements like "Mere family mein 5 members hain" where grounded family facts count < claimed count.
   * NEVER invents missing members. Creates a Cognitive Doubt.
   */
  async detectFamilyKnowledgeGap(
    userId: string,
    userTurnText?: string,
    _turnId?: string
  ): Promise<CognitiveDoubtRecord | null> {
    if (!userTurnText) return null;

    const lower = userTurnText.toLowerCase();

    // Deterministic regex matching for family member count assertions:
    // Examples: "family mein 5 members", "family of 5", "5 log hain", "hum 5 hain"
    const countMatch = lower.match(/(?:family\s*(?:mein|me|of)?\s*(\d+)|(\d+)\s*(?:family\s*members|members\s*in\s*(?:my\s*)?family|log\s*hain|jan\s*hain))/i);
    if (!countMatch) return null;

    const claimedCountStr = countMatch[1] || countMatch[2];
    const claimedCount = parseInt(claimedCountStr, 10);
    if (isNaN(claimedCount) || claimedCount <= 1 || claimedCount > 20) return null;

    // Fetch existing grounded family facts from memories table
    const familyKeys = [
      'wife_name', 'husband_name', 'mother_name', 'father_name',
      'son_name', 'daughter_name', 'brother_name', 'sister_name',
      'son_nickname', 'daughter_nickname', 'child_name', 'pet_name'
    ];

    const { data: memories } = await qt.track(
      'doubt_w023_family_mems',
      'memories',
      () =>
        supabaseAdmin
          .from('memories')
          .select('key, value, source_authority')
          .eq('user_id', userId)
          .eq('is_archived', false)
          .in('key', familyKeys)
    );

    const groundedMap: Record<string, string> = {};
    for (const mem of memories || []) {
      // Exclude generic relational nouns
      if (mem.value && mem.value.toLowerCase() !== mem.key.split('_')[0]) {
        groundedMap[mem.key] = mem.value;
      }
    }

    // In a family of N, the user themselves is 1 member. Grounded family relations count = distinct members
    const groundedRelationsCount = Object.keys(groundedMap).length;
    const totalGroundedMembers = groundedRelationsCount + 1; // +1 for the user themselves

    if (totalGroundedMembers < claimedCount) {
      const missingCount = claimedCount - totalGroundedMembers;
      const question = `User stated their family has ${claimedCount} members, but only ${totalGroundedMembers} (${Object.keys(groundedMap).join(', ') || 'user only'}) are identified in durable memory. ${missingCount} family member identity is ungrounded.`;

      const draft: DoubtCreationDraft = {
        userId,
        category: 'identity_gap',
        question,
        evidence: {
          claimed_count: claimedCount,
          grounded_count: totalGroundedMembers,
          grounded_relations: groundedMap,
          missing_count: missingCount,
          source_utterance: userTurnText,
          directive: 'DO NOT ASSUME OR INVENT THE MISSING FAMILY MEMBER. If family discussion is relevant in conversation, clarify naturally.',
        },
        confidence: 0.95,
        urgency: 'medium',
        priority: 'NEXT',
        targetEntityKeys: ['family_members', 'family_count'],
        expiresInDays: 14,
      };

      return this.createOrUpdateDoubt(draft);
    }

    return null;
  }

  /**
   * Deterministic Resolution Matcher:
   * Inspects a user turn to verify if it legitimately answers an open doubt.
   */
  async checkResolutionOnUserTurn(
    userId: string,
    turnId: string,
    userMessageText: string
  ): Promise<DoubtResolutionMatch> {
    const openDoubts = await this.getOpenDoubts(userId);
    if (!openDoubts || openDoubts.length === 0) {
      return { matched: false, reason: 'No open doubts' };
    }

    const lower = userMessageText.toLowerCase().trim();

    for (const doubt of openDoubts) {
      // 1. Resolution for Family Identity Gap
      if (doubt.category === 'identity_gap' && doubt.evidence?.claimed_count) {
        // Check if user turn provides family member identity:
        // E.g. "My brother Rohan", "mera bhai Rohan", "sister Priya", "behen Priya", "chota bhai"
        const familyMemberPattern = /(?:my\s+|mera\s+|meri\s+)?(brother|sister|bhai|behen|dadi|dada|nani|nana|son|daughter|wife|husband|beta|beti)\s*(?:is|ka\s*naam\s*hai|hai|naam)?\s*([a-zA-Z]+)/i;
        const match = userMessageText.match(familyMemberPattern);

        if (match) {
          const relation = match[1].toLowerCase();
          const name = match[2];

          // Ensure name is not a stopword
          const stopWords = ['hai', 'kya', 'tha', 'thi', 'ho', 'bhi', 'aur', 'and', 'the', 'my', 'is', 'also'];
          if (!stopWords.includes(name.toLowerCase())) {
            await this.resolveDoubt(doubt.id, turnId, {
              resolvedByMessage: userMessageText,
              resolvedRelation: relation,
              resolvedName: name,
              resolvedAt: new Date().toISOString(),
            });

            return {
              matched: true,
              doubtId: doubt.id,
              category: doubt.category,
              resolutionTurnId: turnId,
              resolvedEntityKey: `${relation}_name`,
              resolvedEntityValue: name,
              reason: `Family identity gap answered with relation '${relation}' and name '${name}'`,
            };
          }
        }
      }

      // 2. Resolution for Ambiguous Project / Goal Intent
      if (doubt.category === 'intent_uncertainty' && doubt.evidence?.candidate_threads) {
        const candidates: string[] = doubt.evidence.candidate_threads;
        for (const cand of candidates) {
          if (lower.includes(cand.toLowerCase())) {
            await this.resolveDoubt(doubt.id, turnId, {
              resolvedByMessage: userMessageText,
              selectedThread: cand,
              resolvedAt: new Date().toISOString(),
            });

            return {
              matched: true,
              doubtId: doubt.id,
              category: doubt.category,
              resolutionTurnId: turnId,
              resolvedEntityKey: 'life_thread',
              resolvedEntityValue: cand,
              reason: `Intent ambiguity resolved to candidate '${cand}'`,
            };
          }
        }
      }
    }

    return { matched: false, reason: 'Turn does not address any open doubt' };
  }
}

export const cognitiveDoubtService = new CognitiveDoubtService();
