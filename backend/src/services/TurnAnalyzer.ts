import { ChatMessageInput } from '../routes/chat';
import crypto from 'crypto';
import { TemporalParser } from '../utils/temporalParser';
import { TemporalMetadata } from '../types/memory';
import { MemorySemanticResolver } from '../lib/MemorySemanticResolver';
import { isValueDerivedKey } from '../lib/correctionSemantics';

export type SemanticUnitType = 'question' | 'fact' | 'emotion' | 'action' | 'correction' | 'casual';
export type FactClassification = 'HIGH_CONFIDENCE_DURABLE_FACT' | 'PROTECTED_FACT' | 'TRANSIENT_FACT';

export interface SemanticUnit {
  unitId: string;
  sourceMessageId: string;
  order: number;
  type: SemanticUnitType;
  text: string;
  importance: number;
  responseRequired: boolean;
  acknowledgementPreferred: boolean;
  memoryCandidate: boolean;
  actionCandidate: boolean;
  factKey?: string;
  factValue?: string;
  oldValue?: string;
  relationship?: string;
  isProtected?: boolean;
  factClass?: FactClassification;
  temporalMetadata?: TemporalMetadata;
}

/**
 * Deterministic reminder intent detected in user message (BUG-03).
 * Extracted BEFORE the LLM call so the reminder can be persisted
 * regardless of whether the LLM emits a <subconscious_actions> block.
 */
export interface ReminderIntent {
  /** The full user sentence that triggered this intent */
  text: string;
  /** The extracted time phrase (e.g., "3 baje", "in 20 min", "kal subah 9") */
  timePhrase: string;
  /** Raw time string for parsing by ReminderEngine (always numeric) */
  rawTime: string;
  /** Period-of-day word extracted separately (shaam/subah/raat/dopahar) */
  periodWord?: string;
  /** True if intent was detected but no time phrase found — let LLM clarify */
  isAmbiguous: boolean;
}

/**
 * Amendment 3: Structured negated goal — carries the negated concept AND
 * which memory key it targets for deterministic state propagation.
 */
export interface NegatedGoal {
  /** The raw negated concept string (e.g. "cloud kitchen") */
  concept: string;
  /**
   * The canonical memory/working_memory key this negation targets.
   * e.g. "current_project", "current_focus"
   */
  targetFactKey?: string;
  /**
   * true if the negation is temporary / currently paused ("abhi nahi")
   * false if permanent ("kabhi nahi", "completely dropped")
   */
  isCurrent: boolean;
}

export interface TurnAnalysisResult {
  units: SemanticUnit[];
  hasQuestions: boolean;
  hasFacts: boolean;
  hasEmotions: boolean;
  hasActions: boolean;
  hasCorrections: boolean;
  /** BUG-03: Deterministic reminder intent if found */
  reminderIntent?: ReminderIntent | null;
  /** BUG-06 / Amendment 3: Negated concept nouns from corrections (legacy string array) */
  negativeCorrectionConcepts?: string[];
  /** Amendment 3: Structured negated goals with targetFactKey for deterministic propagation */
  negatedGoals?: NegatedGoal[];
  /**
   * P0-B: Text of every clause classified as 'question'.
   * Forwarded to ConsolidatedMemoryAgent so the LLM is instructed NOT
   * to extract durable memories from these specific clauses.
   * An empty array means no question clauses were detected.
   */
  questionClauses?: string[];
  /** P0-1: Explicit remember command detected ("remember this") */
  hasExplicitRemember?: boolean;
  /** P0-3: Specific target key of the correction, or null if ambiguous */
  correctionTarget?: string | null;
  /** P0-1: Deterministic value for the correction extracted from the user turn */
  correctionValue?: string | null;
}

export interface ExtractedFact {
  key: string;
  value: string;
  text: string;
  isProtected: boolean;
  factClass: FactClassification;
  temporalMetadata?: TemporalMetadata;
}

export interface TurnContext {
  recentMessages?: Array<{ role?: string; content?: string } | string>;
  memories?: Array<{ key?: string; value?: string; memory_type?: string }>;
}

const FEMININE_RELATIONS = ['mother_name', 'mother_nickname', 'sister_name', 'sister_nickname', 'wife_name', 'wife_nickname', 'daughter_name', 'daughter_nickname', 'grandmother_name'];
const MASCULINE_RELATIONS = ['father_name', 'father_nickname', 'brother_name', 'brother_nickname', 'husband_name', 'husband_nickname', 'son_name', 'son_nickname', 'grandfather_name'];
const ALL_PERSON_RELATIONS = [...FEMININE_RELATIONS, ...MASCULINE_RELATIONS];

export class TurnAnalyzer {
  public static analyze(messages: ChatMessageInput[], context?: TurnContext): TurnAnalysisResult {
    const units: SemanticUnit[] = [];
    let order = 0;

    for (const msg of messages) {
      // Strict USER-only: requires explicit role='user' (ingress normalized)
      if ((msg as any).role !== 'user') continue;
      if (!msg.message) continue;
      const sourceMessageId = msg.client_message_id || crypto.randomUUID();
      const rawText = msg.message.trim();
      if (!rawText) continue;

      // Split into clauses by sentence-ending punctuation or comma/conjunction boundaries when multiple clauses exist
      const clauses = this.splitIntoClauses(rawText);

      for (const clause of clauses) {
        order++;
        const lower = clause.toLowerCase();
        const extractedFacts = this.extractFacts(clause);
        const isExplicitRemember = /\b(remember this|don't forget|do not forget|yaad rakhna|bhoolna mat|hamesha yaad rakh)\b/i.test(lower);

        // 1. Check for structured/explicit correction
        const structuredCorrection = this.extractStructuredCorrection(clause);
        const isCorrectionRegex = /\b(actually|correction|nahi yaar|galat|nahi uska naam|not that|instead|wait no|correction:|wrong|incorrect|no, that is wrong)\b/i.test(lower);
        // Deterministic canonical favourite statement (e.g. "My favourite colour is blue").
        // Routed through the correction path so it is persisted deterministically without the LLM.
        const canonicalFavourite = this.extractCanonicalFavourite(clause);

        if (structuredCorrection || isCorrectionRegex) {
          let resolvedKey: string | undefined;
          let resolvedVal: string | undefined;
          let oldValue: string | undefined;
          let relationship: string | undefined;

          if (structuredCorrection && structuredCorrection.concept) {
            // Self-contained correction found!
            const sanitizedStructuredConcept = structuredCorrection.concept.trim().replace(/\s+/g, '_');
            const resolution = MemorySemanticResolver.resolveProposedKey(sanitizedStructuredConcept);
            if (resolution.action === 'PERSIST' && resolution.canonicalKey) {
              resolvedKey = resolution.canonicalKey;
            } else {
              resolvedKey = this.mapConceptToCanonicalKey(structuredCorrection.concept, context);
            }
            resolvedVal = structuredCorrection.value;
            relationship = resolvedKey;
          } else {
            // Ambiguous correction (e.g. "Make that blue") OR fallback regex matched.
            const specificFact = extractedFacts.find(f => f.key !== 'UNKNOWN_RELATION');
            resolvedKey = specificFact?.key;
            resolvedVal = structuredCorrection ? structuredCorrection.value : (specificFact?.value || this.extractNameFromCorrection(lower));
            
            if (!resolvedKey || resolvedKey === 'UNKNOWN_RELATION') {
              const antecedent = this.resolveAntecedent(clause, units, context);
              if (antecedent) {
                resolvedKey = antecedent.factKey;
                oldValue = antecedent.oldValue;
                relationship = antecedent.relationship;
              } else if (structuredCorrection && !structuredCorrection.concept) {
                // Completely ambiguous with no context -> NO-OP
                resolvedKey = undefined;
              }
            }
          }

          // Force ambiguous correction targets through the semantic resolver if we have a key
          if (resolvedKey) {
            const finalRes = MemorySemanticResolver.resolveProposedKey(resolvedKey);
            if (finalRes.action === 'QUARANTINE') {
               resolvedKey = undefined;
            } else if (finalRes.action === 'PERSIST' && finalRes.canonicalKey) {
               resolvedKey = finalRes.canonicalKey;
            }
          }

          // Canonical person-name corrections are capitalized deterministically
          // (e.g. "actually Amit" -> "Amit"). Colour/preference values stay as written.
          if (resolvedKey && resolvedVal && ALL_PERSON_RELATIONS.includes(resolvedKey)) {
            resolvedVal = this.cleanValue(resolvedVal);
          }

          // Grammar-extracted target/value is advisory only. Drop value-appended keys
          // so they cannot be treated as an authoritative concept.
          if (resolvedKey && resolvedVal && isValueDerivedKey(resolvedKey, resolvedVal)) {
            resolvedKey = undefined;
            resolvedVal = undefined;
          }

          const temporalResult = TemporalParser.extractTemporalMetadata(clause);
          const temporalMetadata = TemporalParser.toMetadata(temporalResult);

          units.push({
            unitId: crypto.randomUUID(),
            sourceMessageId,
            order,
            type: 'correction',
            text: clause,
            importance: 9,
            responseRequired: true,
            acknowledgementPreferred: true,
            memoryCandidate: true,
            actionCandidate: false,
            factKey: resolvedKey,
            factValue: resolvedVal,
            oldValue,
            relationship,
            isProtected: isExplicitRemember,
            factClass: isExplicitRemember ? 'PROTECTED_FACT' : 'HIGH_CONFIDENCE_DURABLE_FACT',
            temporalMetadata,
          });
        }
        // 1b. Deterministic canonical favourite statement (no correction marker)
        else if (canonicalFavourite) {
          const finalRes = MemorySemanticResolver.resolveProposedKey(canonicalFavourite.key);
          const finalKey = (finalRes.action === 'PERSIST' && finalRes.canonicalKey)
            ? finalRes.canonicalKey
            : null;
          if (finalKey) {
            units.push({
              unitId: crypto.randomUUID(),
              sourceMessageId,
              order,
              type: 'correction',
              text: clause,
              importance: 8,
              responseRequired: true,
              acknowledgementPreferred: true,
              memoryCandidate: true,
              actionCandidate: false,
              factKey: finalKey,
              factValue: canonicalFavourite.value,
              isProtected: false,
              factClass: 'HIGH_CONFIDENCE_DURABLE_FACT',
              temporalMetadata: TemporalParser.toMetadata(TemporalParser.extractTemporalMetadata(clause)),
            });
          }
        }
        // 1c. Classify favourite-color assertions as corrections without extracting target/value.
        // Value interpretation is the MEMORY LLM's job.
        else if (this.isFavouriteColorAssertion(clause)) {
          units.push({
            unitId: crypto.randomUUID(),
            sourceMessageId,
            order,
            type: 'correction',
            text: clause,
            importance: 8,
            responseRequired: true,
            acknowledgementPreferred: true,
            memoryCandidate: true,
            actionCandidate: false,
            isProtected: false,
            factClass: 'HIGH_CONFIDENCE_DURABLE_FACT',
            temporalMetadata: TemporalParser.toMetadata(TemporalParser.extractTemporalMetadata(clause)),
          });
        }
        // 2. Check for extracted facts
        else if (extractedFacts.length > 0) {
          for (let i = 0; i < extractedFacts.length; i++) {
            const fact = extractedFacts[i];
            let factKey = fact.key;
            let oldValue: string | undefined;
            let relationship: string | undefined;

            let unitType: SemanticUnitType = 'fact';
            if (factKey === 'UNKNOWN_RELATION' || factKey === 'UNKNOWN_REAL_NAME' || factKey === 'UNKNOWN_NICKNAME') {
              const antecedent = this.resolveAntecedent(clause, units, context);
              if (antecedent) {
                factKey = antecedent.factKey;
                oldValue = antecedent.oldValue;
                relationship = antecedent.relationship;
                if (antecedent.isCorrection) {
                  unitType = 'correction';
                }
              }
            }

            units.push({
              unitId: crypto.randomUUID(),
              sourceMessageId,
              order: i === 0 ? order : ++order,
              type: unitType,
              text: fact.text,
              importance: fact.isProtected ? 9 : (unitType === 'correction' ? 9 : 8),
              responseRequired: unitType === 'correction',
              acknowledgementPreferred: true,
              memoryCandidate: true,
              actionCandidate: false,
              factKey,
              factValue: fact.value,
              oldValue,
              relationship,
              isProtected: fact.isProtected,
              factClass: fact.factClass,
              temporalMetadata: fact.temporalMetadata,
            });
          }
        }
        // 3. Check for questions
        else if (/\?/.test(clause) || /\b(kya|kahan|kab|kaise|kyun|kaun|who|why|what|where|when|how|can you|will you|tell me)\b/i.test(lower)) {
          units.push({
            unitId: crypto.randomUUID(),
            sourceMessageId,
            order,
            type: 'question',
            text: clause,
            importance: 7,
            responseRequired: true,
            acknowledgementPreferred: true,
            memoryCandidate: false,
            actionCandidate: false,
            isProtected: false
          });
        }
        // 4. Check for emotions
        else if (/\b(feel|sad|happy|angry|tension|stress|ro raha|dukhi|pareshan|gussa|thaka|tired|upset|exhausted|depressed|anxious|excited)\b/i.test(lower)) {
          units.push({
            unitId: crypto.randomUUID(),
            sourceMessageId,
            order,
            type: 'emotion',
            text: clause,
            importance: 8,
            responseRequired: false,
            acknowledgementPreferred: true,
            memoryCandidate: false,
            actionCandidate: false,
            isProtected: false
          });
        }
        // 5. Actions / Plans
        else if (/\b(plan|tomorrow|going to|will do|karunga|kal|meeting|gym|office|flight|trip|doctor|task|tell him|tell her|call him|call her|remind me to)\b/i.test(lower)) {
          units.push({
            unitId: crypto.randomUUID(),
            sourceMessageId,
            order,
            type: 'action',
            text: clause,
            importance: 6,
            responseRequired: false,
            acknowledgementPreferred: true,
            memoryCandidate: true,
            actionCandidate: true,
            factClass: 'TRANSIENT_FACT',
            isProtected: false
          });
        }
        // 6. Casual / Explicit Remember without predefined key
        else {
          units.push({
            unitId: crypto.randomUUID(),
            sourceMessageId,
            order,
            type: 'casual',
            text: clause,
            importance: isExplicitRemember ? 8 : 1,
            responseRequired: isExplicitRemember,
            acknowledgementPreferred: isExplicitRemember,
            memoryCandidate: isExplicitRemember,
            actionCandidate: false,
            isProtected: isExplicitRemember,
            factClass: isExplicitRemember ? 'PROTECTED_FACT' : undefined
          });
        }
      }
    }

    // P0-1: Deterministic state-affecting analysis MUST use USER messages only.
    // Assistant/system/unknown roles never contribute. Ingress boundary normalizes
    // production role-less input to role='user' so strict filter preserves compatibility.
    const userFullText = messages
      .filter(m => (m as any).role === 'user')
      .map(m => m.message || '')
      .join(' ');
    const negatedGoals = this.extractNegatedGoals(userFullText);

    // BUG-06 legacy / BUG-NEGATION-RESUME: Only propagate FACTUAL CORRECTIONS (isCurrent = false)
    // Temporal pauses (isCurrent = true) must NOT be mixed into negativeCorrectionConcepts,
    // otherwise LifeThreadAgent will inject [CONCEPT SUPERSEDED] into provenance.
    const factualCorrections = negatedGoals.filter(g => !g.isCurrent).map(g => g.concept);

    // P0-B: Collect text of all question-classified clauses.
    // Used by ConsolidatedMemoryAgent to suppress extraction from question text.
    const questionClauses = units
      .filter(u => u.type === 'question')
      .map(u => u.text);

    const hasCorrections = units.some(u => u.type === 'correction');
    const firstCorrectionWithKey = units.find(u => u.type === 'correction' && !!u.factKey);
    const correctionTarget = hasCorrections ? (firstCorrectionWithKey ? firstCorrectionWithKey.factKey! : null) : null;
    const correctionValue = hasCorrections && firstCorrectionWithKey && firstCorrectionWithKey.factValue ? firstCorrectionWithKey.factValue : null;

    return {
      units,
      hasQuestions: units.some(u => u.type === 'question'),
      hasFacts: units.some(u => u.type === 'fact' || (u.type === 'correction' && !!u.factKey)),
      hasEmotions: units.some(u => u.type === 'emotion'),
      hasActions: units.some(u => u.type === 'action'),
      hasCorrections,
      hasExplicitRemember: units.some(u => u.isProtected === true),
      correctionTarget,
      correctionValue,
      // BUG-03: Deterministic reminder extraction across all clauses (USER only)
      reminderIntent: this.extractReminderIntent(userFullText),
      // BUG-06 legacy: string array for backward compat (factual only)
      negativeCorrectionConcepts: factualCorrections,
      // Amendment 3: structured negated goals with targetFactKey + isCurrent (both pauses and drops)
      negatedGoals,
      // P0-B: Question clause texts for admission-guard forwarding
      questionClauses,
    };
  }

  /**
   * BUG-03: Deterministic reminder intent extraction.
   * Runs BEFORE the LLM so reminders can be persisted regardless of LLM behavior.
   * Returns null if no reminder intent detected.
   * Returns { isAmbiguous: true } if intent found but time phrase missing.
   */
  public static extractReminderIntent(text: string): ReminderIntent | null {
    const lower = text.toLowerCase();

    // Step 1: Check for reminder intent keywords
    const REMINDER_INTENT_RE = /\b(yaad dila|yaad dilao|remind me|reminder.*set|yaad kara|yaad kar dena|mujhe yaad|set reminder|alarm laga|mujhe remind|yaad rakhna|yaad dena|bata dena|yaad karna)\b/i;
    if (!REMINDER_INTENT_RE.test(lower)) return null;

    // Step 2: Extract time phrase.
    // CRITICAL: kal/aaj patterns use THREE capture groups:
    //   m[1] = day word (kal/aaj)
    //   m[2] = period word (shaam/subah/raat/dopahar) — may be undefined
    //   m[3] = numeric hour (ALWAYS the rawTime)
    // Do NOT use m[1] ?? m[2] ?? m[0] — that returns the period word instead of the number.
    const TIME_PATTERNS: Array<{ re: RegExp; extractRaw: (m: RegExpMatchArray) => string; extractPeriod?: (m: RegExpMatchArray) => string }> = [
      // "in 20 minutes" / "in 2 hours"
      { re: /in\s+(\d+)\s*min(?:utes?)?/i,  extractRaw: m => m[1] + 'min' },
      { re: /in\s+(\d+)\s*hour(?:s)?/i,     extractRaw: m => m[1] + 'hour' },
      // "kal shaam 4 baje" / "kal 9 baje" / "kal 9:30"
      { re: /(kal|aaj)\s+(?:(subah|shaam|raat|dopahar)\s+)?(\d{1,2}(?::\d{2})?)\s*(?:baje)?/i,
        extractRaw: m => m[3],
        extractPeriod: m => m[2] || '' },
      // "shaam 4 baje" (no kal/aaj prefix)
      { re: /(subah|shaam|raat|dopahar)\s+(\d{1,2}(?::\d{2})?)\s*(?:baje)?/i,
        extractRaw: m => m[2],
        extractPeriod: m => m[1] },
      // "3 pm" / "9:30 am" / "5 baje" with suffix
      { re: /(\d{1,2}(?::\d{2})?)\s*(?:am|pm|baje)/i, extractRaw: m => m[1] },
      // "at 5pm" / "at 17:00"
      { re: /at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i, extractRaw: m => m[1] },
      // bare "5 baje" (digit followed by baje)
      { re: /(\d{1,2})\s*baje/i, extractRaw: m => m[1] },
    ];

    let timePhrase = '';
    let rawTime = '';
    let periodWord = '';

    for (const { re, extractRaw, extractPeriod } of TIME_PATTERNS) {
      const m = lower.match(re);
      if (m) {
        timePhrase = m[0].trim();
        rawTime = extractRaw(m)?.trim() ?? '';
        periodWord = extractPeriod ? (extractPeriod(m)?.trim() ?? '') : '';
        break;
      }
    }

    if (!timePhrase || !rawTime) {
      // Intent detected but no time — ambiguous, let LLM ask for clarification
      return { text, timePhrase: '', rawTime: '', isAmbiguous: true };
    }

    return { text, timePhrase, rawTime, periodWord: periodWord || undefined, isAmbiguous: false };
  }

  /**
   * BUG-06: Extract negated concept nouns from correction messages.
   * Used by LifeThreadAgent to mark superseded concepts within threads
   * WITHOUT killing the entire thread.
   *
   * Examples:
   *   "fashion ka shop nahi" → ["fashion ka shop", "fashion"]
   *   "koi ladki nahi hai" → ["ladki"]
   */
  /**
   * Amendment 3: Extract negated concepts WITH structured metadata.
   * Returns NegatedGoal[] — each entry has concept string + targetFactKey + isCurrent flag.
   * Also populates the legacy string-array field (negativeCorrectionConcepts) for backward compat.
   */
  public static extractNegatedGoals(text: string): NegatedGoal[] {
    const lower = text.toLowerCase();

    // Check if the overall turn context has temporal deferral/pause markers
    const hasTemporalPause = /\b(abhi|filhaal|abhi ke liye|hold pe|hold par|baad mein|baad me|pause|temporary|temporarily)\b/i.test(lower);

    // ── Pattern set: captures the SUBJECT of the negation ──────────────────────
    const NEGATION_PATTERNS: Array<{ re: RegExp; isCurrent: boolean }> = [
      // "cloud kitchen abhi start nahi kar raha" / "cloud kitchen abhi nahi"
      { re: /([a-z][a-z\s]{2,30}?)\s+(?:abhi|filhaal|abhi ke liye)\s+(?:start\s+)?(?:nahi|nahin|mat)(?:\s+(?:kar|ho|chal|bana|karna|raha|rahe|rahi))?/gi, isCurrent: true },
      // "cloud kitchen hold pe / pause pe rakha hai"
      { re: /([a-z][a-z\s]{2,30}?)\s+(?:ko|usko|isko)?\s*(?:hold|pause)\s+pe\s+(?:rakha|dala|kar)/gi, isCurrent: true },
      // "abhi cloud kitchen nahi" — subject follows abhi
      { re: /(?:abhi|filhaal)\s+([a-z][a-z\s]{2,25}?)\s+(?:nahi|nahin|nai)/gi, isCurrent: true },
      // "cloud kitchen postpone/cancel kar diya" — subject precedes action
      { re: /([a-z][a-z\s]{2,25}?)\s+(?:postpone|cancel|band|rok)\s+(?:kar|ho|diya|karna|dena)/gi, isCurrent: false },
      // "<noun> ka shop/business nahi" — confirmed production pattern
      { re: /([a-z][a-z\s]{1,20}?)\s+(?:ka|ki|ke)?\s+(?:shop|dukaan|business|kaam)\s+nahi/gi, isCurrent: false },
      // bare "<noun> nahi tha/thi/hai"
      { re: /([a-z][a-z\s]{2,25}?)\s+nahi(?:\s+(?:tha|thi|hai))?\b/gi, isCurrent: false },
      // "koi <noun> nahi"
      { re: /koi\s+([a-z][a-z\s]{1,20}?)\s+nahi/gi, isCurrent: false },
    ];

    // Noise words to strip from captured concepts
    const NOISE = new Set([
      'main','mein','mai','to','kya','yeh','woh','tha','thi','the','nahi','nahin','mat','kar','chal','ho','bhi','toh','na','hi','ke','ka','ki','ek',
      'start','shuru','karna','kare','raha','rahi','rahe','usko','isko','mera','meri','mere','apna','apni','apne','hai','abhi','filhaal'
    ]);

    const conceptMap = new Map<string, NegatedGoal>();

    for (const { re, isCurrent } of NEGATION_PATTERNS) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(lower)) !== null) {
        const raw = m[1]?.trim() ?? '';
        // Filter out noise-only matches
        const tokens = raw.split(/\s+/).filter(t => t.length > 1 && !NOISE.has(t));
        const concept = tokens.join(' ').trim();
        if (concept.length < 2) continue;

        // If the sentence has temporal pause markers, force isCurrent = true (waiting/paused)
        const finalIsCurrent = hasTemporalPause ? true : isCurrent;

        // Attempt to match to a known memory key heuristically
        let targetFactKey: string | undefined;
        if (/kitchen|restaurant|food|cafe|startup|business|shop|project|venture/i.test(concept)) {
          targetFactKey = 'current_project';
        } else if (/gym|diet|workout|exercise|fitness/i.test(concept)) {
          targetFactKey = 'current_focus';
        }

        // If concept already seen, keep the more specific/safe entry
        if (conceptMap.has(concept)) {
          const existing = conceptMap.get(concept)!;
          if (finalIsCurrent && !existing.isCurrent) {
            existing.isCurrent = true;
          }
          if (targetFactKey && !existing.targetFactKey) {
            existing.targetFactKey = targetFactKey;
          }
        } else {
          // Check if any existing concept is substring or superstring
          let merged = false;
          for (const [existingKey, existingGoal] of conceptMap.entries()) {
            if (existingKey.includes(concept) || concept.includes(existingKey)) {
              if (concept.length < existingKey.length) {
                conceptMap.delete(existingKey);
                conceptMap.set(concept, {
                  concept,
                  targetFactKey: targetFactKey || existingGoal.targetFactKey,
                  isCurrent: finalIsCurrent || existingGoal.isCurrent
                });
              } else {
                if (finalIsCurrent) existingGoal.isCurrent = true;
                if (targetFactKey) existingGoal.targetFactKey = targetFactKey;
              }
              merged = true;
              break;
            }
          }
          if (!merged) {
            conceptMap.set(concept, { concept, targetFactKey, isCurrent: finalIsCurrent });
          }
        }
      }
    }

    return Array.from(conceptMap.values());
  }

  /**
   * BUG-06 legacy shim — returns just the concept strings for backward compatibility.
   * New callers should use extractNegatedGoals() for full structured results.
   */
  public static extractNegatedConcepts(text: string): string[] {
    return this.extractNegatedGoals(text).map(g => g.concept);
  }

  private static splitIntoClauses(text: string): string[] {
    // Split on sentence terminators first
    const primary = text.split(/(?<=[.!?\n])\s+/).map(s => s.trim()).filter(Boolean);
    const result: string[] = [];

    for (const p of primary) {
      // If the sentence contains multiple distinct fact clauses separated by commas, 'and', 'aur', or boundary words like 'pyar se', 'nickname', 'actually'
      const hasConjunction = p.includes(',') || /\b(and|aur)\b/i.test(p) || /(?<=\b(?:hai|is|tha|thi|named))\s+(?=pyar\s+se\b|nick\s*name\b|actual\b|real\s+name\b|naam\b)/i.test(p);
      if (hasConjunction) {
        const parts = p.split(/,\s*(?:and\s+|aur\s+)?|\s+(?:and|aur)\s+|(?<=\b(?:hai|is|tha|thi|named))\s+(?=pyar\s+se\b|nick\s*name\b|actual\b|real\s+name\b)/i)
          .map(s => s.trim())
          .filter(Boolean);
        if (parts.length > 1 && parts.some(part => this.extractFacts(part).length > 0)) {
          result.push(...parts);
          continue;
        }
      }
      result.push(p);
    }
    return result.length > 0 ? result : [text];
  }

  public static resolveAntecedent(
    clause: string,
    unitsSoFar: SemanticUnit[],
    context?: TurnContext
  ): { factKey: string; oldValue?: string; relationship: string; isCorrection?: boolean } | null {
    const lower = clause.toLowerCase();
    
    const isFem = /\b(she|her|hers|uski|iski|didi|behen|beti|biwi|patni|maa|mummy|daughter|sister|wife|mother)\b/i.test(lower);
    const isMasc = /\b(he|him|his|uske|iska|bhai|bhaiya|beta|bete|pati|shauhar|papa|dad|son|brother|husband|father)\b/i.test(lower);
    const isNeutral = /\b(they|them|their|unka|unki|woh|uska|child|baccha|bacha|person)\b/i.test(lower);
    const isGenericCorrection = /\b(actually|instead|correction:?|galat|nahi yaar|i mean|mean|real name|actual name|asli naam)\b/i.test(lower);
    const isNicknameIntent = /\b(nick\s*name|nickname|pyar\s+se|pyar\s+ka\s+naam)\b/i.test(lower);
    const isRealNameIntent = /\b(real\s+name|actual\s+name|formal\s+name|asli\s+naam)\b/i.test(lower);

    // 1. Search backwards in current turn's already processed units for Generic Concepts
    for (let i = unitsSoFar.length - 1; i >= 0; i--) {
      const u = unitsSoFar[i];
      // If we already resolved a concept in the same turn (e.g. from a previous clause)
      if (u.factKey && !ALL_PERSON_RELATIONS.includes(u.factKey)) {
        return { factKey: u.factKey, oldValue: u.oldValue, relationship: u.relationship || u.factKey, isCorrection: true };
      }
    }

    const mapKeyForIntent = (baseKey: string, baseVal?: string, rel?: string) => {
      const relationship = rel || baseKey.replace(/_(name|nickname)$/g, '');
      if (isNicknameIntent) {
        return {
          factKey: `${relationship}_nickname`,
          oldValue: undefined,
          relationship,
          isCorrection: false
        };
      }
      if (isRealNameIntent) {
        return {
          factKey: `${relationship}_name`,
          oldValue: baseVal,
          relationship,
          isCorrection: true
        };
      }
      return {
        factKey: baseKey,
        oldValue: baseVal,
        relationship,
        isCorrection: isGenericCorrection
      };
    };

    // 2. Search backwards in context.recentMessages (immediate conversation context ONLY)
    if (context?.recentMessages && Array.isArray(context.recentMessages)) {
      for (let i = context.recentMessages.length - 1; i >= 0; i--) {
        const msg = context.recentMessages[i];
        const role = typeof msg === 'string' ? 'user' : (msg.role || 'user');
        if (role !== 'user') continue; // USER ONLY evidence
        
        const text = typeof msg === 'string' ? msg : (msg.content || '');
        if (!text) continue;
        
        const structured = this.extractStructuredCorrection(text);
        if (structured && structured.concept) {
          const mappedKey = this.mapConceptToCanonicalKey(structured.concept, context);
          return { factKey: mappedKey, oldValue: structured.value, relationship: mappedKey, isCorrection: true };
        }

        const facts = this.extractFacts(text);
        for (const f of facts) {
          if (f.key && ALL_PERSON_RELATIONS.includes(f.key)) {
            if (isFem && FEMININE_RELATIONS.includes(f.key)) {
              return mapKeyForIntent(f.key, f.value, f.key.replace(/_(name|nickname)$/g, ''));
            }
            if (isMasc && MASCULINE_RELATIONS.includes(f.key)) {
              return mapKeyForIntent(f.key, f.value, f.key.replace(/_(name|nickname)$/g, ''));
            }
            if ((isNeutral || (!isFem && !isMasc) || isGenericCorrection || isNicknameIntent || isRealNameIntent) && ALL_PERSON_RELATIONS.includes(f.key)) {
              return mapKeyForIntent(f.key, f.value, f.key.replace(/_(name|nickname)$/g, ''));
            }
          }
        }
      }
    }
    
    // If it's a generic correction without ANY person pronoun or name intent, DO NOT guess a person relation.
    // It could be correcting a work preference or something else.
    if (!isFem && !isMasc && !isNeutral && !isNicknameIntent && !isRealNameIntent) {
      // Attempt deterministic string matching against generic context.memories
      if ((isGenericCorrection || /\b(make that|make it|change it to|ek correction hai)\b/i.test(lower)) && context?.memories) {
        for (const mem of context.memories) {
          if (!mem.key) continue;
          if (this.normalizeForMatch(lower).includes(this.normalizeForMatch(mem.key))) {
            return { factKey: mem.key, oldValue: mem.value, relationship: mem.key, isCorrection: true };
          }
        }
      }
      return null;
    }

    // 3. Search backwards in current turn's already processed units for Person Relations
    for (let i = unitsSoFar.length - 1; i >= 0; i--) {
      const u = unitsSoFar[i];
      if (u.factKey && ALL_PERSON_RELATIONS.includes(u.factKey)) {
        if (isFem && FEMININE_RELATIONS.includes(u.factKey)) {
          return mapKeyForIntent(u.factKey, u.factValue, u.relationship);
        }
        if (isMasc && MASCULINE_RELATIONS.includes(u.factKey)) {
          return mapKeyForIntent(u.factKey, u.factValue, u.relationship);
        }
        if ((isNeutral || (!isFem && !isMasc) || isGenericCorrection || isNicknameIntent || isRealNameIntent) && ALL_PERSON_RELATIONS.includes(u.factKey)) {
          return mapKeyForIntent(u.factKey, u.factValue, u.relationship);
        }
      }
    }

    // 4. Check context.memories ONLY for explicit nickname / real-name clarifications
    if ((isNicknameIntent || isRealNameIntent) && context?.memories && Array.isArray(context.memories)) {
      for (const m of context.memories) {
        if (m.key && ALL_PERSON_RELATIONS.includes(m.key)) {
          if (isFem && FEMININE_RELATIONS.includes(m.key)) {
            return mapKeyForIntent(m.key, m.value, m.key.replace(/_(name|nickname)$/g, ''));
          }
          if (isMasc && MASCULINE_RELATIONS.includes(m.key)) {
            return mapKeyForIntent(m.key, m.value, m.key.replace(/_(name|nickname)$/g, ''));
          }
          if (ALL_PERSON_RELATIONS.includes(m.key)) {
            return mapKeyForIntent(m.key, m.value, m.key.replace(/_(name|nickname)$/g, ''));
          }
        }
      }
    }

    return null;
  }

  public static extractFacts(text: string): ExtractedFact[] {
    const lower = text.toLowerCase();
    const facts: ExtractedFact[] = [];
    const isExplicitRemember = /\b(remember this|don't forget|do not forget|yaad rakhna|bhoolna mat|hamesha yaad rakh)\b/i.test(lower);
    const isTransient = /\b(today|aaj|right now|currently visiting|for now|temporary|filhal|abhi ke liye)\b/i.test(lower);
    const factClass: FactClassification = isExplicitRemember
      ? 'PROTECTED_FACT'
      : isTransient
      ? 'TRANSIENT_FACT'
      : 'HIGH_CONFIDENCE_DURABLE_FACT';

    // ── Family Relationships: Real/Formal Names & Direct Nicknames ───────────

    // Mother nickname
    let m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:mummy|mom|mother|maa|mata)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'mother_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Mother name
    if (facts.every(f => f.key !== 'mother_nickname')) {
      m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:mummy|mom|mother|maa|mata)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) {
        facts.push({ key: 'mother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      } else {
        m = lower.match(/\b(?:my|meri)\s+(?:mummy|mom|mother|maa)\s+(?:is|hai)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
        if (m) facts.push({ key: 'mother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Father nickname
    m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:papa|dad|father|baap|pita|daddy)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'father_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Father name
    if (facts.every(f => f.key !== 'father_nickname')) {
      m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:papa|dad|father|baap|pita|daddy)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) {
        facts.push({ key: 'father_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      } else {
        m = lower.match(/\b(?:my|mere)\s+(?:papa|dad|father|pita)\s+(?:is|hai)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
        if (m) facts.push({ key: 'father_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Wife nickname
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:biwi|wife|patni)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'wife_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Wife name
    if (facts.every(f => f.key !== 'wife_nickname')) {
      m = lower.match(/\b(?:meri|mere|my)?\s*(?:biwi|wife|patni)(?:'s)?\s+(?:ka\s+naam\s+(?:hai\s+)?|is\s+|nam\s+(?:hai\s+)?|name\s+is\s+|hai\s+|name\s+)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) facts.push({ key: 'wife_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Husband nickname
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:shauhar|husband|pati)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'husband_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Husband name
    if (facts.every(f => f.key !== 'husband_nickname')) {
      m = lower.match(/\b(?:meri|mere|my)?\s*(?:shauhar|husband|pati)(?:'s)?\s+(?:ka\s+naam\s+(?:hai\s+)?|is\s+|nam\s+(?:hai\s+)?|name\s+is\s+|hai\s+|name\s+)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) facts.push({ key: 'husband_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Sister nickname
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:behen|sister|didi)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'sister_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Sister name
    if (facts.every(f => f.key !== 'sister_nickname')) {
      m = lower.match(/\b(?:meri|mere|my)?\s*(?:behen|sister)(?:'s)?\s+(?:ka\s+naam\s+(?:hai\s+)?|is\s+|nam\s+(?:hai\s+)?|name\s+is\s+|hai\s+|name\s+)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i) ||
          lower.match(/\b(?:meri|mere|my)\s+(?:behen|sister)\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)\s+(?:hai|is)\b/i);
      if (m) facts.push({ key: 'sister_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Brother nickname
    m = lower.match(/\b(?:mera|mere|my)?\s*(?:bhai|brother|bhaiya)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'brother_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Brother name
    if (facts.every(f => f.key !== 'brother_nickname')) {
      m = lower.match(/\b(?:mera|mere|my)?\s*(?:bhai|brother)(?:'s)?\s+(?:ka\s+naam\s+(?:hai\s+)?|is\s+|nam\s+(?:hai\s+)?|name\s+is\s+|hai\s+|name\s+)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i) ||
          lower.match(/\b(?:mera|mere|my)\s+(?:bhai|brother)\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)\s+(?:hai|is)\b/i);
      if (m) facts.push({ key: 'brother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Son nickname
    m = lower.match(/\b(?:mera|mere|my)?\s*(?:beta|bete|son|child)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i) ||
        lower.match(/\b(?:mera|mere|my)?\s*(?:beta|bete|son|child)\s+ko\s+pyar\s+se\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)\s+(?:bulate|bulati|rakha|bolte|hai)\b/i);
    if (m) facts.push({ key: 'son_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Son name
    if (facts.every(f => f.key !== 'son_nickname')) {
      m = lower.match(/\b(?:mera|mere|my)?\s*(?:beta|bete|son|child)(?:'s)?\s+(?:ka\s+naam\s+(?:hai\s+)?|is\s+|nam\s+(?:hai\s+)?|name\s+is\s+|hai\s+|name\s+)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) facts.push({ key: 'son_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Daughter nickname
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:beti|daughter)(?:'s)?\s+(?:ka\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i) ||
        lower.match(/\b(?:meri|mere|my)?\s*(?:beti|daughter)\s+ko\s+pyar\s+se\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)\s+(?:bulate|bulati|rakha|bolte|hai)\b/i);
    if (m) facts.push({ key: 'daughter_nickname', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Daughter name
    if (facts.every(f => f.key !== 'daughter_nickname')) {
      m = lower.match(/\b(?:meri|mere|my)?\s*(?:beti|daughter)(?:'s)?\s+(?:ka\s+naam\s+(?:hai\s+)?|is\s+|nam\s+(?:hai\s+)?|name\s+is\s+|hai\s+|name\s+)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) facts.push({ key: 'daughter_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Generic Nickname (requires antecedent resolution)
    m = lower.match(/\b(?:pyar\s+se\s+)?(?:nick\s*name|nickname|pyar\s+ka\s+naam)\s+(?:hai\s+|is\s+|rakha\s+hai\s+|to\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+rakha|\s+hai|\s+is|[.,;!]|$)/i) ||
        lower.match(/\bpyar\s+se\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)\s+(?:bulata|bulate|bulati|bolte|rakha|rakhi)\b/i);
    if (m && facts.every(f => !f.key.endsWith('_nickname'))) {
      const cleanNick = this.cleanValue(m[1]);
      if (!this.isStopPronoun(cleanNick)) {
        facts.push({ key: 'UNKNOWN_NICKNAME', value: cleanNick, text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Generic Real / Formal Name (requires antecedent resolution)
    m = lower.match(/\b(?:real\s+name|actual\s+name|formal\s+name|asli\s+naam)\s+(?:is\s+|hai\s+|to\s+|)([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m && facts.every(f => !f.key.endsWith('_name'))) {
      const cleanReal = this.cleanValue(m[1]);
      if (!this.isStopPronoun(cleanReal)) {
        facts.push({ key: 'UNKNOWN_REAL_NAME', value: cleanReal, text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Company / Job
    m = lower.match(/\b(?:started|founded|created|built)\s+(?:a\s+)?(?:company|startup|agency|firm|business)(?:\s+(?:called|named))?\s+([a-zA-Z0-9\s]+?)(?:[.,;]|$|\band\b)/i);
    if (m) {
      facts.push({ key: 'company_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else {
      m = lower.match(/\b(?:meri|mere|my)\s+(?:company|office|business|startup|agency)(?:'s)?\s+(?:ka\s+naam|is|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:[.,;]|$|\band\b)/i);
      if (m) {
        facts.push({ key: 'company_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      } else {
        m = lower.match(/\b(?:kaam karta|karti hoon|work at|working at|worked at|joined|employed at|job at|now work at|now working at)\s+([a-zA-Z0-9\s]+?)(?:[.,;]|$|\band\b|\bin\s+\d{4}|\bin\s+[a-z]+|\bsince\b)/i);
        if (m) facts.push({ key: 'company_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Passports / Identifiers
    m = lower.match(/\b(?:my\s+)?(passport|license|email|phone|aadhaar|pan)\s*(?:number|no|id)?\s*(?:is|hai|=|:)?\s*([a-zA-Z0-9]+)\b/i);
    if (m && !['a', 'the', 'is'].includes(m[2].toLowerCase())) {
      facts.push({ key: `${m[1].toLowerCase()}_number`, value: m[2].trim(), text, isProtected: isExplicitRemember, factClass });
    }

    // City / Location — covers "Mai Dahisar me rehta hu" and "living in Dahisar"
    m = lower.match(/\b(?:rehta hoon|rehti hoon|rehta hun|rehta hu|rehti hu|live in|living in|i am from|from|stay in|staying in)\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+me\b|(?:\s+me[in]?)?\s+rehta|[.,;!]|$)/i);
    if (m && !['a', 'the', 'my', 'home', 'here'].includes(m[1].trim().toLowerCase())) {
      facts.push({ key: 'city', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else if (facts.every(f => f.key !== 'city')) {
      // Hinglish: "Mai Dahisar me rehta hu" — the city is between 'mai/main/i' and 'me/mein rehta'
      m = lower.match(/\b(?:mai|main|i)\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+me\s+rehta|\s+mein\s+rehta|\s+me\s+rehti|\s+se\s+hu|\s+se\s+hoon)/i);
      if (m && !['a', 'the', 'my', 'home', 'here'].includes(m[1].trim().toLowerCase())) {
        facts.push({ key: 'city', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Name — maps to user_name key; full_name is just an alias stored at persistence layer
    m = lower.match(/\b(?:mera naam|mera pura name|mera pura naam|my name is|my full name is|my full name)\s+([a-zA-Z0-9][a-zA-Z0-9\s]*?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) {
      const nameVal = this.cleanValue(m[1]);
      facts.push({ key: 'user_name', value: nameVal, text, isProtected: isExplicitRemember, factClass });
    }

    // Ambiguous Name (No relationship specified)
    if (facts.length === 0) {
      m = lower.match(/\b(?:her|his|unka|unki|iska|iski|their)?\s*(?:name|naam|nam)\s+(?:is|hai)\s+([a-zA-Z]+)\b/i) || 
          lower.match(/\b(?:actually|instead|correction:?)\s+([a-zA-Z]+)\b/i);
      if (m && !lower.includes('my name') && !lower.includes('mera naam')) {
        facts.push({ key: 'UNKNOWN_RELATION', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Fallback: If user explicitly asked to remember something but no pattern matched
    if (facts.length === 0 && isExplicitRemember) {
      facts.push({ key: 'UNKNOWN_FACT', value: text, text, isProtected: true, factClass: 'PROTECTED_FACT' });
    }

    const temporalResult = TemporalParser.extractTemporalMetadata(text);
    const temporalMetadata = TemporalParser.toMetadata(temporalResult);

    for (const f of facts) {
      if (!f.temporalMetadata) {
        f.temporalMetadata = temporalMetadata;
      }
    }

    return facts;
  }

  private static extractNameFromCorrection(lower: string): string | undefined {
    // Try explicit "name is X" / "naam hai X" / "naam X hai" patterns first
    const m = lower.match(/\b(?:her|his|unka|unki|iska|iski|their|uska|uski|actual)?\s*name\s+is\s+([a-zA-Z][a-zA-Z\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i) ||
              lower.match(/\b(?:naam|nam)\s+(?:hai\s+)?([a-zA-Z][a-zA-Z\s]+?)(?:\s+hai|[.,;!]|$)/i);
    if (m) {
      const candidate = this.cleanValue(m[1]);
      return this.isStopPronoun(candidate) ? undefined : candidate;
    }
    // Fallback: 'actually X' — but skip pronouns
    const fallback = lower.match(/\b(?:actually|instead|correction:?)\s+([a-zA-Z]+)\b/i);
    if (fallback) {
      const candidate = this.cleanValue(fallback[1]);
      return this.isStopPronoun(candidate) ? undefined : candidate;
    }
    return undefined;
  }

  /** Returns true if the given word is a pronoun that should not be treated as a person's name */
  private static isStopPronoun(word: string): boolean {
    const PRONOUNS = new Set(['her', 'his', 'him', 'she', 'he', 'they', 'them', 'their',
      'uska', 'uski', 'unka', 'unki', 'iska', 'iski', 'woh', 'wo', 'yeh', 'ye',
      'actually', 'instead', 'correction', 'naam', 'name', 'hai', 'tha', 'thi']);
    return PRONOUNS.has(word.toLowerCase().trim());
  }

  private static cleanValue(val: string): string {
    const trimmed = val.trim().replace(/[.,;!?]+$/, '');
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }

  public static buildTurnAnalysisPrompt(analysis: TurnAnalysisResult): string {
    if (analysis.units.length === 0) return '';

    let prompt = `\n\n## 🔍 TURN ANALYSIS (CRITICAL RESPONSIVENESS CONSTRAINT)\n`;
    prompt += `The user's turn contains multiple semantic units. You MUST explicitly cover ALL required points below in your response.\n`;

    let requiredCount = 0;
    for (const unit of analysis.units) {
      if (unit.responseRequired || unit.acknowledgementPreferred || unit.type === 'fact' || unit.type === 'correction') {
        const isUnknownRelation = unit.factKey === 'UNKNOWN_RELATION' || (!unit.factKey && !!unit.factValue);
        const relation = unit.relationship || (unit.factKey && !isUnknownRelation ? unit.factKey.replace(/_name/g, '') : '');
        
        prompt += `- [${unit.type.toUpperCase()}] "${unit.text}" -> `;
        
        if (unit.type === 'question') {
          prompt += `Must provide an answer.`;
        } else if (unit.type === 'correction') {
          if (isUnknownRelation) {
            prompt += `[RELATIONSHIP_STATE = UNKNOWN, RELATIONSHIP_VALUE = NONE, ANTECEDENT = NONE]\n  * CRITICAL MANDATORY CONSTRAINT: The relationship of '${unit.factValue}' is completely UNKNOWN.\n  * You MUST NOT guess or assume any relationship (do NOT assume sister, brother, mother, friend, colleague, etc.).\n  * Output ONLY ONE concise clarification question (e.g., "${unit.factValue} kaun hain tumhare liye — sister, friend, ya koi aur?").\n  * RELEVANCE-FIRST & CONVERSATIONAL RESTRAINT: Do NOT append time-of-day commentary, speculative emotions ("tension hai kya"), unrelated questions, or generic reassurance. Keep it strictly to the concise clarification.`;
          } else {
            const oldValStr = unit.oldValue ? `, old_value = ${unit.oldValue}` : '';
            prompt += `[RELATIONSHIP_STATE = KNOWN, RELATIONSHIP = '${relation}', ANTECEDENT = FOUND]\n  * Relationship is confirmed as '${relation}'.\n  * Do NOT guess gender/title (no 'bhaiya'/'didi' unless explicitly used by user). No clarification needed.\n  * Acknowledge the correction concisely and cleanly (e.g., "Got it — ${unit.factValue}, your ${relation}. 😊").\n  * RELEVANCE-FIRST & CONVERSATIONAL RESTRAINT: Continue ONLY with context that genuinely exists in this conversation. Do NOT generate speculative commentary (no "itni raat ko kyun yaad aaya", no "pehle main bhool gaya", no unprompted questions). (logical_key = ${unit.factKey}, relationship = ${relation}${oldValStr}, new_value = ${unit.factValue}, event = correction).`;
          }
        } else if (unit.type === 'fact') {
          if (isUnknownRelation) {
            prompt += `[RELATIONSHIP_STATE = UNKNOWN, RELATIONSHIP_VALUE = NONE, ANTECEDENT = NONE]\n  * CRITICAL MANDATORY CONSTRAINT: The relationship of '${unit.factValue}' is completely UNKNOWN.\n  * You MUST NOT guess or assume any relationship (do NOT assume sister, brother, mother, friend, colleague, etc.).\n  * Output ONLY ONE concise clarification question (e.g., "${unit.factValue} kaun hain tumhare liye — sister, friend, ya koi aur?").\n  * RELEVANCE-FIRST & CONVERSATIONAL RESTRAINT: Do NOT guess any relationship. Do NOT append time-of-day commentary, speculative emotions, unrelated questions, or generic reassurance. Keep it strictly to the concise clarification.`;
          } else {
            prompt += `[RELATIONSHIP_STATE = KNOWN, RELATIONSHIP = '${relation}', ANTECEDENT = FOUND]\n  * Relationship is confirmed as '${relation}'.\n  * Do NOT guess gender/title (no 'bhaiya'/'didi'). No clarification needed.\n  * Acknowledge this fact (${relation}: ${unit.factValue || unit.text}) warmly and concisely based ONLY on real conversation context without unprompted speculative questions.`;
          }
        } else if (unit.type === 'emotion') {
          prompt += `Must validate this emotion first.`;
        } else if (unit.type === 'action') {
          prompt += `Acknowledge this action/plan. [CLARIFICATION GUARD: If an action is missing a critical parameter (e.g., WHO 'him' refers to, WHERE to go) and it cannot be resolved from context, ask the user directly in normal chat who 'him' refers to with a single concise question.]`;
        } else {
          prompt += `Address naturally.`;
        }
        prompt += `\n`;
        requiredCount++;
      }
    }

    if (requiredCount === 0) return '';
    return prompt;
  }

  public static getUncoveredUnits(analysis: TurnAnalysisResult, finalReply: string): SemanticUnit[] {
    const uncovered: SemanticUnit[] = [];
    const lowerReply = finalReply.toLowerCase();

    for (const unit of analysis.units) {
      // Questions require an answer or substantive coverage
      if (unit.type === 'question' && unit.responseRequired) {
        // If the reply is an exact repetition/echo of the question, it's not covered
        const lowerQuestion = unit.text.toLowerCase().replace(/[?.,!]/g, '').trim();
        const isEcho = lowerReply.replace(/[?.,!]/g, '').trim() === lowerQuestion;
        if (isEcho || lowerReply.length < 10) {
          uncovered.push(unit);
        }
      }
      // Corrections require explicit acknowledgment
      else if (unit.type === 'correction' && unit.responseRequired) {
        const valueAcknowledged = unit.factValue && lowerReply.includes(unit.factValue.toLowerCase());
        const correctionAcknowledged = /\b(sorry|oh|got it|noted|theek|sahi|achha|acha|update|samajh|my bad|arrey|aree)\b/i.test(lowerReply);
        if (!valueAcknowledged && !correctionAcknowledged) {
          uncovered.push(unit);
        }
      }
      // Facts with high importance: check if acknowledged
      else if (unit.type === 'fact' && unit.factValue) {
        const valLower = unit.factValue.toLowerCase();
        const valuePresent = lowerReply.includes(valLower);
        const acknowledged = /\b(nice|sweet|great|badhiya|mast|sahi|noted|got it|cool|kya baat|congrats|mubarak|shandar|superb)\b/i.test(lowerReply);
        // If the fact was neither mentioned nor acknowledged at all in a non-empty response
        if (!valuePresent && !acknowledged && lowerReply.length < 15) {
          uncovered.push(unit);
        }
      }
    }

    return uncovered;
  }

  public static extractStructuredCorrection(text: string): { concept: string | null, value: string } | null {
    let lower = text.toLowerCase();
    
    const markerRegex = /\b(actually|correction|nahi(?: yaar)?|galat(?: tha)?|not that|instead|wait no|ek correction hai|correct that|no, that is wrong|wrong|incorrect)\b/ig;
    const hasMarker = markerRegex.test(lower);
    lower = lower.replace(markerRegex, '').replace(/^[:,\.\-\s—]+|[:,\.\-\s—]+$/g, '').trim();

    const directValueMatch = lower.match(/^(?:make that|make it|change it to|make it as)\s+([a-z0-9\s]+)$/i) || 
                             (hasMarker && lower.split(/\s+/).length <= 2 ? [null, lower] : null);
    if (directValueMatch && directValueMatch[1]) {
      return { concept: null, value: directValueMatch[1].trim() };
    }

    if (!hasMarker && !directValueMatch) {
      return null; // Not a structured correction without a marker
    }

    let match = lower.match(/^(?:my|mera|meri|merko)?\s*(.+?)\s+(?:is|hai|toh)\s+(.+?)(?:\s+hai|\s+is|\.|$)/i);
    if (match) {
      return { concept: match[1].trim(), value: match[2].trim() };
    }
    
    match = lower.match(/^([a-z0-9\s]+?)\s+(?:is|hai)\s+(?:my|mera|meri)?\s*(.+?)(?:,|\s+not\s+.*|\.|$)/i);
    if (match) {
      return { concept: match[2].trim(), value: match[1].trim() };
    }
    
    match = lower.match(/^(?:my|mera|meri)?\s*(.+?)\s+([a-z0-9]+)(?:\s+hai|\s+is|\.|$)/i);
    if (match) {
      return { concept: match[1].trim(), value: match[2].trim() };
    }
    
    return null;
  }

  /**
   * Deterministically detect canonical favourite statements (e.g. "My favourite
   * colour is blue"). Returns the canonical key (before authoritative resolution)
   * and the as-written value, or null if no canonical favourite was stated.
   * Explicit correction-marked turns are intentionally excluded so they route
   * through the structured-correction branch instead.
   */
  public static isFavouriteColorAssertion(text: string): boolean {
    const lower = text.toLowerCase();
    if (!/\b(?:favourite|favorite)\s+(?:colour|color)\b/i.test(lower)) return false;
    if (/\?/.test(text)) return false;
    if (/\b(kya|kaunsa|what|which)\b/i.test(lower)) return false;
    return true;
  }

  public static extractCanonicalFavourite(text: string): { key: string; value: string } | null {
    const lower = text.toLowerCase();
    const hasMarker = /\b(actually|correction|instead|wait no|wrong|incorrect|no, that is wrong|nahi|galat)\b/i.test(lower);
    if (hasMarker) return null;

    const m = lower.match(/\b(?:my\s+)?(?:favourite|favorite)\s+(?:colour|color)\s+is\s+([a-z0-9][a-z0-9\s-]*)(?:[.,;!]|$)/i);
    if (m) {
      const value = m[1].trim().replace(/[.,;!]+$/, '');
      if (!value) return null;
      return { key: 'favourite_color', value };
    }
    return null;
  }

  public static normalizeForMatch(str: string): string {
    return str.toLowerCase()
      .replace(/_/g, '')
      .replace(/\s+/g, '')
      .replace(/colour/g, 'color')
      .replace(/favourite/g, 'favorite');
  }

  public static mapConceptToCanonicalKey(concept: string, context?: TurnContext): string {
    const sanitizedConcept = concept.trim().replace(/\s+/g, '_');
    const resolution = MemorySemanticResolver.resolveProposedKey(sanitizedConcept);
    if (resolution.action === 'PERSIST' && resolution.canonicalKey) {
      return resolution.canonicalKey;
    }

    let normalizedConcept = this.normalizeForMatch(concept);
    
    if (context?.memories) {
      for (const mem of context.memories) {
        if (!mem.key) continue;
        if (this.normalizeForMatch(mem.key) === normalizedConcept || normalizedConcept.includes(this.normalizeForMatch(mem.key))) {
          return mem.key;
        }
      }
    }
    
    return concept.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }
}

