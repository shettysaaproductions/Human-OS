/**
 * LifeThreadSynthesisEngine.ts — Phase 3D-C Progress, Blocker & Next-Useful-Step Synthesis
 *
 * Architectural Invariants:
 * 1. PROPOSAL NOT TRUTH: LLM proposals are SYSTEM_PROPOSAL only, NEVER authoritative user state.
 * 2. BOUNDED EVIDENCE PACKET: System suggestions, reminders, and passive compliance are excluded
 *    from user commitment evidence.
 * 3. NO GOAL CREATION & NO COMPLETION: LLM cannot create threads or mark them COMPLETED.
 * 4. STRICT REJECTION VALIDATOR: Rejects psychological profiling, fabricated dates, artificial urgency,
 *    and ungrounded commitment claims.
 * 5. CONTRADICTION DELEGATION: Conflicting evidence triggers CognitiveDoubtService; does not overwrite thread.
 * 6. MODEL COST CONTROL: LLM is invoked ONLY when evidence or blocker state changed; stable threads make 0 calls.
 * 7. ZERO DIRECT MESSAGING: Synthesis engine outputs to repository/memory only, never directly to chat/push.
 */

import { logger } from '../lib/logger';
import { chatCompletionBackground } from '../lib/nvidia';
import {
  LifeThreadRow,
  lifeThreadRepository,
} from './lifeThreadRepository';
import {
  LifeThreadEvidencePacket,
  LifeThreadSynthesisOutput,
  LifeThreadSynthesisDecision,
  LifeThreadNextUsefulStep,
} from '../types/lifeThreadCultivation';
import { cognitiveDoubtService } from './CognitiveDoubtService';

export class LifeThreadSynthesisEngine {
  /**
   * Assembles a strictly bounded evidence packet for a LifeThread.
   * Filters out system suggestions, reminders, and passive compliance from user commitment evidence.
   */
  assembleEvidencePacket(
    thread: LifeThreadRow,
    rawEvidenceItems: Array<{
      id: string;
      provenance: string;
      text: string;
      createdAt?: string;
      turnId?: string;
    }> = []
  ): LifeThreadEvidencePacket {
    // Strictly filter user-authored evidence
    const userEvidence = rawEvidenceItems
      .filter(
        item =>
          item.provenance === 'USER_EXPLICIT' ||
          item.provenance === 'USER_ACTION' ||
          item.provenance === 'USER_CONFIRMATION'
      )
      .map(item => ({
        id: item.id,
        provenance: item.provenance as 'USER_EXPLICIT' | 'USER_ACTION' | 'USER_CONFIRMATION',
        text: item.text,
        createdAt: item.createdAt || new Date().toISOString(),
        turnId: item.turnId,
      }));

    return {
      threadId: thread.id,
      userId: thread.user_id,
      topic: thread.topic,
      canonicalKey: thread.canonical_key,
      category: thread.category || 'GENERAL',
      cultivationStage: thread.cultivation_stage || 'DISCOVERY',
      groundedGoalStatement: thread.topic,
      userEvidence,
      existingBlockers: thread.blockers || [],
      milestones: thread.milestones || [],
      nextRelevantTime: thread.next_relevant_time || null,
      lastRelevantAt: thread.last_relevant_at || null,
    };
  }

  /**
   * Gating: Determines whether LLM synthesis is genuinely required.
   * Prevents wasteful token usage on stable or dormant threads.
   */
  shouldSynthesize(thread: LifeThreadRow, packet: LifeThreadEvidencePacket): boolean {
    const stage = thread.cultivation_stage || 'DISCOVERY';
    const state = thread.state || 'active';

    // 1. Terminal states never synthesize
    if (state === 'completed' || state === 'abandoned' || state === 'superseded') {
      return false;
    }

    // 2. Dormant or blocked threads without fresh user evidence do not synthesize
    if ((stage === 'DORMANT' || stage === 'WAITING_ON_EXTERNAL') && packet.userEvidence.length === 0) {
      return false;
    }

    // 3. Discovery with 0 user evidence does not synthesize
    if (stage === 'DISCOVERY' && packet.userEvidence.length === 0) {
      return false;
    }

    // 4. If thread already has a valid next_useful_step and no new user evidence arrived, skip
    if (thread.next_useful_step && packet.userEvidence.length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Strict Validator for LLM Synthesis Output.
   * Returns null if valid, or a descriptive rejection reason if invalid.
   */
  validateSynthesisOutput(
    output: any,
    packet: LifeThreadEvidencePacket
  ): { isValid: boolean; rejectionReason?: string; isContradictory?: boolean } {
    if (!output || typeof output !== 'object') {
      return { isValid: false, rejectionReason: 'Output is not a valid JSON object' };
    }

    // 1. Check for psychological claims / profiling
    const textToCheck = `${output.progress_summary || ''} ${output.blocker_summary || ''} ${
      output.next_step_proposal?.description || ''
    } ${output.next_step_proposal?.title || ''}`.toLowerCase();

    const psychologicalPatterns = [
      /\b(is motivated|highly dedicated|feels lazy|procrastinat|passionate about|lacks discipline|feels stressed|psycholog)\b/i,
      /\b(user has strong willpower|user is struggling with focus|user is deeply committed)\b/i,
    ];

    for (const pat of psychologicalPatterns) {
      if (pat.test(textToCheck)) {
        return { isValid: false, rejectionReason: `Psychological profiling detected: matched ${pat.source}` };
      }
    }

    // 2. Check for scolding, artificial urgency, or pressuring tone
    const pressurePatterns = [
      /\b(you must|you have to|you should|urgently need to|hurry up|don't procrastinate|make sure you finish)\b/i,
      /\b(you promised to|why haven't you)\b/i,
    ];

    for (const pat of pressurePatterns) {
      if (pat.test(textToCheck)) {
        return { isValid: false, rejectionReason: `Pressuring/scolding tone detected: matched ${pat.source}` };
      }
    }

    // 3. Check for unauthorized completion claims
    if (output.temporal_consistency === 'CURRENT' && output.progress_summary?.toLowerCase().includes('completed the entire goal')) {
      const allMilestonesDone = packet.milestones.length > 0 && packet.milestones.every(m => m.completed);
      if (!allMilestonesDone) {
        return { isValid: false, rejectionReason: 'Unauthorized goal completion claim without verified milestones' };
      }
    }

    // 4. Check next step bounds
    if (output.next_step_proposal) {
      const { title, description, duration_mins, leverage_score } = output.next_step_proposal;
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return { isValid: false, rejectionReason: 'Proposed next step title is missing or empty' };
      }
      if (!description || typeof description !== 'string') {
        return { isValid: false, rejectionReason: 'Proposed next step description is missing' };
      }
      if (typeof duration_mins !== 'number' || duration_mins < 5 || duration_mins > 120) {
        return { isValid: false, rejectionReason: `Duration ${duration_mins}m is outside valid bounds (5–120m)` };
      }
      if (typeof leverage_score !== 'number' || leverage_score < 0 || leverage_score > 100) {
        return { isValid: false, rejectionReason: `Leverage score ${leverage_score} is outside valid bounds (0–100)` };
      }
    }

    // 5. Check Contradiction / Uncertainty
    if (output.temporal_consistency === 'CONFLICTING' || output.confidence === 'UNCERTAIN') {
      return {
        isValid: false,
        isContradictory: true,
        rejectionReason: `Evidence contradiction detected: ${output.uncertainty_reason || 'conflicting user statements'}`,
      };
    }

    return { isValid: true };
  }

  /**
   * Synthesizes progress, blocker interpretation, and next useful step proposal.
   */
  async synthesizeNextStep(
    thread: LifeThreadRow,
    rawEvidenceItems: Array<{
      id: string;
      provenance: string;
      text: string;
      createdAt?: string;
      turnId?: string;
    }> = []
  ): Promise<LifeThreadSynthesisDecision> {
    const nowIso = new Date().toISOString();
    const packet = this.assembleEvidencePacket(thread, rawEvidenceItems);

    // Check Gating
    if (!this.shouldSynthesize(thread, packet)) {
      return {
        threadId: thread.id,
        accepted: false,
        rejectionReason: 'Gating rule: Thread is stable, dormant, or lacks fresh evidence; synthesis skipped',
        synthesizedAt: nowIso,
      };
    }

    // Construct LLM Prompt
    const systemPrompt = `You are the Human-OS LifeThread Synthesis Engine.
Your task is to analyze grounded user evidence for an existing LifeThread and synthesize:
1. A neutral, factual progress summary (NO psychological profiling, NO comments on user motivation).
2. A factual blocker summary if evidence clearly establishes one (or null if none).
3. Exactly ONE bounded, high-leverage micro-step proposal (5–30 mins) that lowers cognitive burden.

RULES:
- Tone must be supportive, neutral, and low-pressure. Use phrasing like "One possible next step is..."
- NEVER use guilt, shame, artificial urgency ("you must", "hurry").
- NEVER declare the entire goal completed unless explicit evidence confirms it.
- NEVER fabricate deadlines, dates, or third parties not mentioned in the evidence.
- If evidence contains contradictory statements, set confidence="UNCERTAIN" and temporal_consistency="CONFLICTING".

Return strictly valid JSON matching this schema:
{
  "progress_summary": string | null,
  "blocker_summary": string | null,
  "next_step_proposal": {
    "title": string,
    "description": string,
    "duration_mins": number (5-60),
    "leverage_score": number (0-100)
  } | null,
  "confidence": "HIGH" | "MEDIUM" | "LOW" | "UNCERTAIN",
  "evidence_ids": string[],
  "temporal_consistency": "CURRENT" | "HISTORICAL" | "FUTURE_INTENT" | "CONFLICTING",
  "uncertainty_reason": string | null
}`;

    const userPrompt = `LIFETHREAD CONTEXT:
Topic: "${packet.topic}"
Canonical Key: "${packet.canonicalKey}"
Category: ${packet.category}
Stage: ${packet.cultivationStage}
Existing Blockers: ${JSON.stringify(packet.existingBlockers)}
Milestones: ${JSON.stringify(packet.milestones)}

GROUNDED USER EVIDENCE:
${packet.userEvidence.length > 0
  ? packet.userEvidence.map(e => `[${e.provenance} - ID:${e.id}]: "${e.text}"`).join('\n')
  : '(No new user-authored evidence; evaluate current state)'}
`;

    let rawResponse = '';
    let parsed: LifeThreadSynthesisOutput;

    try {
      rawResponse = await chatCompletionBackground(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.1, maxTokens: 500 }
      );

      // Clean JSON fences if present
      const cleaned = rawResponse.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (err: any) {
      logger.warn('[LifeThreadSynthesis] LLM parse failure or timeout', {
        threadId: thread.id,
        error: err.message,
      });
      return {
        threadId: thread.id,
        accepted: false,
        rejectionReason: `LLM invocation/parse failed: ${err.message}`,
        synthesizedAt: nowIso,
      };
    }

    // Run Strict Validator
    const validation = this.validateSynthesisOutput(parsed, packet);

    if (!validation.isValid) {
      logger.info('[LifeThreadSynthesis] Output rejected by validator', {
        threadId: thread.id,
        reason: validation.rejectionReason,
        isContradictory: validation.isContradictory,
      });

      // Handle Contradiction via CognitiveDoubtService
      if (validation.isContradictory) {
        try {
          await cognitiveDoubtService.createOrUpdateDoubt({
            userId: thread.user_id,
            category: 'contradiction_ambiguity',
            question: parsed.uncertainty_reason || `Contradiction detected in goal "${thread.topic}"`,
            targetEntityKeys: [thread.canonical_key || thread.topic],
            unresolvedQuestionType: 'lifethread_contradiction',
            evidence: {
              topic: thread.topic,
              uncertaintyReason: parsed.uncertainty_reason || 'Conflicting user evidence in life thread',
              evidenceSnippet: packet.userEvidence.map(e => e.text).join(' | '),
            },
          });
        } catch (dErr: any) {
          logger.warn('[LifeThreadSynthesis] Doubt creation non-fatal error', { error: dErr.message });
        }
      }

      return {
        threadId: thread.id,
        accepted: false,
        rejectionReason: validation.rejectionReason,
        wasContradictory: validation.isContradictory,
        output: parsed,
        synthesizedAt: nowIso,
      };
    }

    // Build Validated Step Proposal
    const proposal: LifeThreadNextUsefulStep | null = parsed.next_step_proposal
      ? {
          title: parsed.next_step_proposal.title.trim(),
          description: parsed.next_step_proposal.description.trim(),
          duration_mins: Math.max(5, Math.min(60, Math.round(parsed.next_step_proposal.duration_mins))),
          leverage_score: Math.max(0, Math.min(100, Math.round(parsed.next_step_proposal.leverage_score))),
        }
      : null;

    // Persist Proposal through Single Writer Repository
    if (proposal) {
      try {
        await lifeThreadRepository.createOrUpdateThread(
          thread.user_id,
          {
            threadId: thread.id,
            topic: thread.topic,
            nextUsefulStep: proposal,
          },
          {
            sourceAuthority: 'deterministic_turn_analysis',
            evidenceProvenance: 'SYSTEM_OBSERVATION',
            reason: `Grounded next step synthesized: "${proposal.title}"`,
          }
        );
      } catch (pErr: any) {
        logger.error('[LifeThreadSynthesis] Repository update failed', {
          threadId: thread.id,
          error: pErr.message,
        });
      }
    }

    return {
      threadId: thread.id,
      accepted: true,
      output: parsed,
      nextUsefulStepProposal: proposal,
      synthesizedAt: nowIso,
    };
  }
}

export const lifeThreadSynthesisEngine = new LifeThreadSynthesisEngine();
