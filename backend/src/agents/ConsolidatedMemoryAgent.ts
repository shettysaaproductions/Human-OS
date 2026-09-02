import { BaseAgent } from './BaseAgent';
import { Job } from '../services/QueueService';
import { complete } from '../lib/nvidia';
import { supabaseAdmin } from '../lib/supabase';
import { cache, CACHE_NS } from '../lib/cache';
import { createHash } from 'crypto';
import { logger } from '../lib/logger';
import { MemorySemanticResolver } from '../lib/MemorySemanticResolver';
import { isGarbageMemoryValue, filterGarbageWorkingMemories } from '../lib/memoryFilters';

// ── Hinglish vocative words that are NOT kinship facts ──────────────────────────
// "Bhai, sun" = addressing the listener. "Mera bhai Amit hai" = kinship fact.
const HINGLISH_VOCATIVES = new Set(['bhai','yaar','bro','boss','dude','arre','oye','man','buddy','re']);

// Kinship-statement patterns — must be present for brother/bhai_name to be extracted
const KINSHIP_PATTERNS = /\b(my|mera|mere|hamara|hamare|meri|apna|us(?:ka|ki)|uska|ek|ek\s+bhai|bhai\s+ka\s+naam|brother\s+ka\s+naam|brother\s+hai|bhai\s+hai)\b/i;

// ── Generic entity blocklist (pre-DB filter — layer 1 defense-in-depth) ─────────
// memoryRepository also enforces this as layer 2. Both layers exist for safety.
const GENERIC_ENTITY_VALUES_AGENT = new Set([
  'wife', 'husband', 'mom', 'mother', 'dad', 'father', 'bhai', 'brother',
  'sister', 'son', 'daughter', 'didi', 'bhabhi', 'nana', 'nani', 'dada',
  'dadi', 'spouse', 'partner', 'girlfriend', 'boyfriend', 'friend', 'yaar',
]);

/**
 * Filter LLM-extracted semantic memories before persistence.
 * Removes generic entity values and vocative misclassifications.
 */
function filterSemanticMemories(memories: any[], sourceMessage: string): any[] {
  const lowerSrc = sourceMessage.toLowerCase();
  
  // Detect family relation in source message for mapping unscoped keys
  let detectedRelation: string | null = null;
  if (/\b(beta|bete|son|child|bacha|baccha)\b/i.test(lowerSrc)) detectedRelation = 'son';
  else if (/\b(beti|daughter)\b/i.test(lowerSrc)) detectedRelation = 'daughter';
  else if (/\b(wife|biwi|patni)\b/i.test(lowerSrc)) detectedRelation = 'wife';
  else if (/\b(husband|pati|shauhar)\b/i.test(lowerSrc)) detectedRelation = 'husband';
  else if (/\b(mom|mother|maa|mummy|mata)\b/i.test(lowerSrc)) detectedRelation = 'mother';
  else if (/\b(dad|father|papa|pita)\b/i.test(lowerSrc)) detectedRelation = 'father';
  else if (/\b(sister|behen|didi)\b/i.test(lowerSrc)) detectedRelation = 'sister';
  else if (/\b(brother|bhai|bhaiya)\b/i.test(lowerSrc)) detectedRelation = 'brother';

  return memories
    .map(mem => {
      let key = (mem.key ?? '').toLowerCase().trim();

      // Map unscoped real_name / nickname to relation-scoped canonical keys
      if (detectedRelation) {
        if (key === 'real_name' || key === 'formal_name' || key === 'actual_name') {
          key = `${detectedRelation}_name`;
        } else if (key === 'nickname' || key === 'nick_name' || key === 'pyar_ka_naam') {
          key = `${detectedRelation}_nickname`;
        }
      }

      // Agent-level key normalization (defense-in-depth before memoryRepository)
      const resolution = MemorySemanticResolver.resolveProposedKey(key);
      if (resolution.action === 'QUARANTINE' || resolution.action === 'NO_OP') {
        logger.warn('[ConsolidatedMemoryAgent] Key quarantined at agent level', { original: mem.key, reason: resolution.reason });
        return { ...mem, shouldPersist: false };
      }
      
      if (resolution.canonicalKey !== (mem.key ?? '')) {
        logger.info('[ConsolidatedMemoryAgent] Key normalized at agent level', { original: mem.key, canonical: resolution.canonicalKey });
        return { ...mem, key: resolution.canonicalKey };
      }
      return mem;
    })
    .filter(mem => {
      if (!mem.shouldPersist) return false;
      const key: string = mem.key ?? '';
      const value: string = (mem.value ?? '').trim();

      // Block unscoped generic real_name / nickname without relationship context
      if ((key === 'real_name' || key === 'nickname' || key === 'nick_name') && !detectedRelation) {
        logger.info('[ConsolidatedMemoryAgent] BLOCKED unscoped generic name/nickname key', { key, value });
        return false;
      }

      // ── BUG-01: Generic entity blocklist ───────────────────────────────────
      if (key.endsWith('_name') && GENERIC_ENTITY_VALUES_AGENT.has(value.toLowerCase())) {
        logger.info('[ConsolidatedMemoryAgent] BLOCKED generic entity value (pre-DB filter)', { key, value });
        return false;
      }

      // ── BUG-02: Hinglish vocative disambiguation ──────────────────────────
      // Reject brother_name / bhai_name unless the source sentence contains a
      // kinship-statement pattern (e.g. "mera bhai", "brother ka naam")
      const isBrotherKey = key === 'brother_name' || key === 'bhai_name' || key === 'brother';
      if (isBrotherKey) {
        const hasKinshipPattern = KINSHIP_PATTERNS.test(lowerSrc);
        const hasVocativeOnly = HINGLISH_VOCATIVES.has(value.toLowerCase()) && !hasKinshipPattern;
        if (hasVocativeOnly) {
          logger.info('[ConsolidatedMemoryAgent] BLOCKED vocative as kinship fact', { key, value, sourceMessage: sourceMessage.substring(0, 80) });
          return false;
        }
        if (!hasKinshipPattern) {
          logger.info('[ConsolidatedMemoryAgent] BLOCKED brother_name without kinship evidence', { key, value });
          return false;
        }
      }

      return true;
    });
}


/**
 * ConsolidatedMemoryAgent — Performs ALL 7 memory extractions in a SINGLE LLM call.
 *
 * Before this, chat.ts enqueued 6 separate jobs (semantic, working_memory, episodic,
 * kg, emotional, milestone) + 1 short_term = 7 LLM calls per user message. That was
 * burning through NVIDIA free-tier rate limits fast. Now a single call returns a
 * structured JSON blob covering all memory types, which we persist in parallel.
 *
 * This reduces per-message LLM load by ~6x for memory extraction.
 *
 * CACHING: Similar messages (normalized) get cached extraction results to avoid
 * redundant LLM calls. Cache TTL is 1 hour.
 */

export interface ConsolidatedExtraction {
  semantic_memories?: any[];
  working_memories?: any[];
  episodic_memories?: any[];
  kg_entities?: any[];
  emotional_state?: any | null;
  milestone?: any | null;
  short_term?: any | null;
}

function hashMessage(message: string): string {
  // Normalize: lowercase, trim, remove punctuation for similarity matching
  const normalized = message.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export class ConsolidatedMemoryAgent extends BaseAgent {
  constructor() {
    super('ConsolidatedMemoryAgent');
  }

  protected async execute(job: Job): Promise<number> {
    const { userId, messageId, message, questionClauses, turnId: _turnId, hasExplicitRemember, hasCorrections, correctionTarget } = job.payload;

    // P0-B: Build the question-clause suppression instruction if we have clause data.
    // This is the PRIMARY fix for question text being stored as memory values.
    const questionClauseList: string[] = Array.isArray(questionClauses) ? questionClauses : [];
    const questionSuppressionBlock = questionClauseList.length > 0
      ? `

CRITICAL — DO NOT EXTRACT FROM QUESTIONS:
The following text segments from this message are QUESTIONS, not statements of fact.
You MUST NOT extract any memory from these question segments:
${questionClauseList.map((q, i) => `  ${i + 1}. "${q}"`).join('\n')}
These are things the user is ASKING ABOUT, not telling you. Extracting them as facts would be wrong.
If the entire user message is a question, return empty arrays for all memory types.
`
      : '';

    const isExplicitAuthority = hasExplicitRemember || (hasCorrections && !!correctionTarget);

    // Check cache first (UNLESS IT'S A CORRECTION)
    // Correction turns bypass the semantic extraction cache entirely (P0-2)
    if (!hasCorrections) {
      const cacheKey = `memory_extraction:${hashMessage(message)}`;
      const cached = cache.get<ConsolidatedExtraction>(cacheKey);
      if (cached) {
        logger.info(`[ConsolidatedMemoryAgent] Cache hit for message ${messageId}`, { userId });
        return this.persistExtraction(userId, messageId, message, cached, { isExplicitAuthority });
      }
    }

    // P0-2: ENFORCE DETERMINISTIC CORRECTION ARCHITECTURE - BYPASS LLM
    if (hasCorrections) {
      const parsedCorrection: ConsolidatedExtraction = {};
      if (!correctionTarget || !job.payload.correctionValue || job.payload.correctionValue.trim() === '') {
        // Ambiguous correction or missing value -> zero semantic mutation
        parsedCorrection.semantic_memories = [];
      } else {
        // Unambiguous correction -> exactly ONE canonical target deterministically generated
        parsedCorrection.semantic_memories = [{
          shouldPersist: true,
          type: 'fact',
          key: correctionTarget,
          value: job.payload.correctionValue,
          importance: 100,
          confidence: 1.0,
          emotional_weight: 0,
          correction_intent: true
        }];
      }
      logger.info(`[ConsolidatedMemoryAgent] Correction deterministic bypass activated for message ${messageId}`);
      return this.persistExtraction(userId, messageId, message, parsedCorrection, { isExplicitAuthority });
    }

    let safetyInstructions = '';
    if (hasExplicitRemember) {
      safetyInstructions += `\n- The user explicitly COMMANDED you to remember this. Prioritize the core fact they want remembered and assign high importance.`;
    }

    const response = await complete('MEMORY', [
      {
        role: 'system',
        content: `You are the Unified Memory Extraction Agent for HumanOS.
Analyze the user's message and extract ALL relevant memory types in ONE structured JSON response.
${questionSuppressionBlock}
Return ONLY a valid JSON object with these exact keys (omit empty arrays/objects if nothing to extract):

{
  "semantic_memories": [
    {
      "shouldPersist": true,
      "type": "family" | "personal" | "work" | "goals" | "preferences" | "health" | "important_dates",
      "key": "snake_case_identifier",
      "value": "string value",
      "importance": 0-100,
      "confidence": 0.0-1.0,
      "emotional_weight": -10 to 10
    }
  ],
  "working_memories": [
    {
      "key": "snake_case_identifier",
      "value": "string value",
      "expires_in_hours": number (default 24)
    }
  ],
  "episodic_memories": [
    {
      "summary": "string describing the event",
      "emotion": "string (optional)",
      "emotional_valence": -10 to 10
    }
  ],
  "kg_entities": [
    {
      "entity": "Entity Name",
      "entity_type": "person" | "place" | "organization" | "project" | "concept" | "event",
      "relationship": "brief relationship to user (e.g., 'friend', 'boss', 'lives in')",
      "attributes": "any notable attributes"
    }
  ],
  "emotional_state": {
    "mood": "string (e.g., happy, anxious, tired, neutral)",
    "intensity": 1-10,
    "notes": "brief explanation"
  } | null,
  "milestone": {
    "title": "Achievement title",
    "description": "What was achieved",
    "category": "health" | "career" | "education" | "relationship" | "personal",
    "significance": 1-10
  } | null,
  "short_term": {
    "key": "snake_case_identifier",
    "value": "string value",
    "expires_in_hours": number (default 6)
  } | null
}

CRITICAL:
- If the user mentions ANY important time, date, schedule, or appointment worth remembering long-term, extract it as a 'semantic' memory with type "important_dates".
- Only extract what is genuinely present. Use null/empty arrays for absent types.
- Do NOT extract insignificant daily chatter.${safetyInstructions}

CANONICAL KEY SCHEMA (MANDATORY — USE THESE EXACT KEYS):
Do NOT invent aliases, plurals, or possessive variants. Use ONLY canonical keys:
  wife_name / wife_nickname
  mother_name / mother_nickname
  father_name / father_nickname
  son_name / son_nickname          ← use son_name for real/formal name and son_nickname for nickname
  daughter_name / daughter_nickname
  sister_name / sister_nickname
  brother_name / brother_nickname   ← NEVER 'bhai' alone as a key
  husband_name / husband_nickname
  company_name   ← NOT business_name, business, company, startup_name
  birth_date     ← NOT birthday, dob, bday, child_birthdate
  marriage_date  ← NOT wedding_date, anniversary
  preferred_name ← NOT name, user_name, my_name
RULE FOR NICKNAMES: NEVER output generic unscoped "real_name" or "nickname". For family members, ALWAYS use <relation>_name for the real name and <relation>_nickname for the nickname.
For any other concept, use descriptive snake_case that clearly expresses the concept.

ATOMICITY RULE (CRITICAL — ZERO TOLERANCE):
- Each distinct fact MUST be a SEPARATE object in the "semantic_memories" array.
- NEVER combine two or more distinct facts into a single memory object.
- Example: "My wife's name is Sakshi and I love her cooking" is TWO facts, so return:
  → Object 1: { "shouldPersist": true, "type": "family", "key": "wife_name", "value": "Sakshi", ... }
  → Object 2: { "shouldPersist": true, "type": "family", "key": "likes_wifes_cooking", "value": "User loves his wife's cooking", ... }
- Each memory object must contain EXACTLY ONE atomic fact — no compound statements.
- When in doubt, split it into MORE objects rather than fewer.`
      },
      {
        role: 'user',
        content: message
      }
    ], {
      response_format: { type: 'json_object' },
      temperature: 0.1
    });

    const parsed = JSON.parse(response) as ConsolidatedExtraction;
    
    // Cache the extraction result (1 hour TTL)
    const storeCacheKey = `memory_extraction:${hashMessage(message)}`;
    cache.set(storeCacheKey, parsed, 60 * 60 * 1000, CACHE_NS.WORKING_MEMORY);

    let totalCreated = await this.persistExtraction(userId, messageId, message, parsed, { isExplicitAuthority });

    return totalCreated;
  }

  private async persistExtraction(userId: string, messageId: string, messageText: string, parsed: ConsolidatedExtraction, opts?: { isExplicitAuthority?: boolean }): Promise<number> {
    let totalCreated = 0;
    const { memoryRepository } = await import('../services/memoryRepository');

    // ── Semantic memories ──
    const rawSemanticMemories = parsed.semantic_memories || [];
    // Apply pre-DB filters (BUG-01 generic value + BUG-02 vocative guard)
    // messageText is used as the source text for vocative check
    const semanticMemories = filterSemanticMemories(rawSemanticMemories, messageText);
    
    const candidateInserts: any[] = [];
    for (const mem of semanticMemories) {
      if (mem.shouldPersist) {
        // Amendment 1: Common garbage admission boundary — shared helper used by all paths
        if (isGarbageMemoryValue(mem.key ?? '', mem.value ?? '', 'ConsolidatedMemoryAgent:semantic')) {
          continue;
        }
        
        if (opts?.isExplicitAuthority) {
          // P0-1: Bypass candidate pool and directly insert into durable memory
          await memoryRepository.upsertMemory(userId, {
            key: mem.key,
            value: mem.value,
            type: (mem.type || 'semantic') as any,
            shouldPersist: true,
            source_authority: 'explicit_user',
            importance: mem.importance || 100,
            confidence: 1.0,
            emotional_weight: mem.emotional_weight || 0,
            source_message_id: messageId,
            source_references: [{ type: 'turn', id: messageId }]
          }, messageText);
          totalCreated++;
        } else {
          // Phase 2E-B: Route subconscious semantic extractions to WorkingMemory as candidates
          // instead of writing directly to durable semantic memory.
          candidateInserts.push({
            user_id: userId,
            key: mem.key,
            value: mem.value,
            promotion_status: 'CANDIDATE'
          });
        }
      }
    }
    
    if (candidateInserts.length > 0) {
      await supabaseAdmin.from('working_memory').insert(candidateInserts);
      totalCreated += candidateInserts.length;
    }

    // ── Working memories ──
    const rawWorkingMemories = parsed.working_memories || [];
    // Amendment 1: Filter garbage before insert
    const workingMemories = filterGarbageWorkingMemories(rawWorkingMemories, 'ConsolidatedMemoryAgent:working');
    if (workingMemories.length > 0) {
      const wmInserts = workingMemories.map((wm: any) => {
        const expires = new Date();
        expires.setHours(expires.getHours() + (wm.expires_in_hours || 24));
        return {
          user_id: userId,
          key: wm.key,
          value: wm.value,
          expires_at: expires.toISOString()
        };
      });
      await supabaseAdmin.from('working_memory').insert(wmInserts);
      totalCreated += wmInserts.length;
    }

    // ── Episodic memories ──
    const episodicMemories = parsed.episodic_memories || [];
    if (episodicMemories.length > 0) {
      const epInserts = episodicMemories.map((ep: any) => ({
        user_id: userId,
        summary: ep.summary,
        emotion: ep.emotion,
        emotional_valence: ep.emotional_valence,
        source_message_id: messageId
      }));
      await supabaseAdmin.from('episodic_memories').insert(epInserts);
      totalCreated += epInserts.length;
    }

    // ── KG entities ──
    const kgEntities = parsed.kg_entities || [];
    if (kgEntities.length > 0) {
      const kgInserts = kgEntities.map((kg: any) => ({
        user_id: userId,
        entity: kg.entity,
        entity_type: kg.entity_type,
        relationship: kg.relationship,
        attributes: kg.attributes
      }));
      await supabaseAdmin.from('kg_entities').insert(kgInserts);
      totalCreated += kgInserts.length;
    }

    // ── Emotional state ──
    if (parsed.emotional_state) {
      await supabaseAdmin.from('emotional_states').insert({
        user_id: userId,
        mood: parsed.emotional_state.mood,
        intensity: parsed.emotional_state.intensity,
        notes: parsed.emotional_state.notes
      });
      totalCreated++;
    }

    // ── Milestone ──
    if (parsed.milestone) {
      await supabaseAdmin.from('milestones').insert({
        user_id: userId,
        title: parsed.milestone.title,
        description: parsed.milestone.description,
        category: parsed.milestone.category,
        significance: parsed.milestone.significance,
        achieved_at: new Date().toISOString()
      });
      totalCreated++;
    }

    // ── Short term memory ──
    if (parsed.short_term) {
      const st = parsed.short_term;
      // Amendment 1: Guard short_term path too
      if (!isGarbageMemoryValue(st.key ?? '', st.value ?? '', 'ConsolidatedMemoryAgent:short_term')) {
        const expires = new Date();
        expires.setHours(expires.getHours() + (st.expires_in_hours || 6));
        await supabaseAdmin.from('short_term_memory').insert({
          user_id: userId,
          key: st.key,
          value: st.value,
          expires_at: expires.toISOString()
        });
        totalCreated++;
      }
    }

    return totalCreated;
  }
}

export const consolidatedMemoryAgent = new ConsolidatedMemoryAgent();
