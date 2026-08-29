import { ChatMessageInput } from '../routes/chat';
import crypto from 'crypto';

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
}

export interface ExtractedFact {
  key: string;
  value: string;
  text: string;
  isProtected: boolean;
  factClass: FactClassification;
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

        // 1. Check for explicit correction
        const isCorrection = /\b(actually|correction|nahi yaar|galat|nahi uska naam|not that|instead|wait no|correction:)\b/i.test(lower);

        if (isCorrection) {
          // For corrections: prefer specific relation facts, but ignore UNKNOWN_RELATION facts
          // since their 'value' may contain pronouns (e.g. 'uska') captured by the fallback pattern.
          const specificFact = extractedFacts.find(f => f.key !== 'UNKNOWN_RELATION');
          let resolvedKey: string | undefined = specificFact?.key;
          let resolvedVal: string | undefined = specificFact?.value || this.extractNameFromCorrection(lower);
          let oldValue: string | undefined;
          let relationship: string | undefined;

          // If no specific relation key was extracted or it is UNKNOWN_RELATION, attempt antecedent resolution
          if (!resolvedKey || resolvedKey === 'UNKNOWN_RELATION') {
            const antecedent = this.resolveAntecedent(clause, units, context);
            if (antecedent) {
              resolvedKey = antecedent.factKey;
              oldValue = antecedent.oldValue;
              relationship = antecedent.relationship;
            }
          }

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
            factClass: isExplicitRemember ? 'PROTECTED_FACT' : 'HIGH_CONFIDENCE_DURABLE_FACT'
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
              factClass: fact.factClass
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

    const fullText = messages.map(m => m.message || '').join(' ');
    const negatedGoals = this.extractNegatedGoals(fullText);

    return {
      units,
      hasQuestions: units.some(u => u.type === 'question'),
      hasFacts: units.some(u => u.type === 'fact' || (u.type === 'correction' && !!u.factKey)),
      hasEmotions: units.some(u => u.type === 'emotion'),
      hasActions: units.some(u => u.type === 'action'),
      hasCorrections: units.some(u => u.type === 'correction'),
      // BUG-03: Deterministic reminder extraction across all clauses
      reminderIntent: this.extractReminderIntent(fullText),
      // BUG-06 legacy: string array for backward compat
      negativeCorrectionConcepts: negatedGoals.map(g => g.concept),
      // Amendment 3: structured negated goals with targetFactKey + isCurrent
      negatedGoals,
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
    const results: NegatedGoal[] = [];

    // ── Pattern set: captures the SUBJECT of the negation ──────────────────────
    // Each entry: { re, isCurrent }
    // isCurrent=true  → user paused/deferred ("abhi nahi", "filhaal nahi")
    // isCurrent=false → user dropped permanently ("kabhi nahi", "cancel kar diya")
    const NEGATION_PATTERNS: Array<{ re: RegExp; isCurrent: boolean }> = [
      // "cloud kitchen abhi start nahi kar raha" — subject precedes negation clause
      { re: /([a-z][a-z\s]{2,30}?)\s+(?:abhi|filhaal|abhi ke liye)\s+(?:start\s+)?(?:nahi|nahin|mat)(?:\s+(?:kar|ho|chal|bana))?/gi, isCurrent: true },
      // "abhi cloud kitchen nahi" — subject follows abhi
      { re: /(?:abhi|filhaal)\s+([a-z][a-z\s]{2,25}?)\s+(?:nahi|nahin|nai)/gi, isCurrent: true },
      // "cloud kitchen postpone/cancel kar diya" — subject precedes action
      { re: /([a-z][a-z\s]{2,25}?)\s+(?:postpone|cancel|band|rok)\s+(?:kar|ho|diya|karna|dena)/gi, isCurrent: false },
      // "<noun> ka shop/business nahi" — confirmed production pattern
      { re: /([a-z][a-z\s]{1,20}?)\s+(?:ka|ki|ke)?\s+(?:shop|dukaan|business|kaam)\s+nahi/gi, isCurrent: false },
      // bare "<noun> nahi tha/thi"
      { re: /([a-z][a-z\s]{2,25}?)\s+nahi(?:\s+(?:tha|thi|hai))?\b/gi, isCurrent: false },
      // "koi <noun> nahi"
      { re: /koi\s+([a-z][a-z\s]{1,20}?)\s+nahi/gi, isCurrent: false },
    ];

    // Noise words to strip from captured concepts
    const NOISE = new Set(['main','mein','mai','to','kya','yeh','woh','tha','thi','nahi','kar','chal','ho','bhi','toh','na','hi','ke','ka','ki','ek']);

    const seenConcepts = new Set<string>();

    for (const { re, isCurrent } of NEGATION_PATTERNS) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(lower)) !== null) {
        const raw = m[1]?.trim() ?? '';
        // Filter out noise-only matches
        const tokens = raw.split(/\s+/).filter(t => t.length > 1 && !NOISE.has(t));
        const concept = tokens.join(' ').trim();
        if (concept.length < 2 || seenConcepts.has(concept)) continue;
        seenConcepts.add(concept);

        // Attempt to match to a known memory key heuristically
        // (chat.ts will do the authoritative DB match against actual memory values)
        let targetFactKey: string | undefined;
        if (/kitchen|restaurant|food|cafe|startup|business|shop|project|venture/i.test(concept)) {
          targetFactKey = 'current_project';
        } else if (/gym|diet|workout|exercise|fitness/i.test(concept)) {
          targetFactKey = 'current_focus';
        }

        results.push({ concept, targetFactKey, isCurrent });
      }
    }

    return results;
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

    if (!isFem && !isMasc && !isNeutral && !isGenericCorrection && !isNicknameIntent && !isRealNameIntent) {
      return null;
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

    // 1. Search backwards in current turn's already processed units
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

    // 2. Search backwards in context.recentMessages (immediate conversation context ONLY)
    if (context?.recentMessages && Array.isArray(context.recentMessages)) {
      for (let i = context.recentMessages.length - 1; i >= 0; i--) {
        const msg = context.recentMessages[i];
        const text = typeof msg === 'string' ? msg : (msg.content || '');
        if (!text) continue;
        
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

    // 3. Check context.memories ONLY for explicit nickname / real-name clarifications
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
        m = lower.match(/\b(?:kaam karta|karti hoon|work at|working at|job at|employed at)\s+([a-zA-Z0-9\s]+?)(?:[.,;]|$|\band\b)/i);
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
}

