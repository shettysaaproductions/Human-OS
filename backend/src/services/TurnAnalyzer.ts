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

export interface TurnAnalysisResult {
  units: SemanticUnit[];
  hasQuestions: boolean;
  hasFacts: boolean;
  hasEmotions: boolean;
  hasActions: boolean;
  hasCorrections: boolean;
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

const FEMININE_RELATIONS = ['mother_name', 'sister_name', 'wife_name', 'daughter_name', 'grandmother_name'];
const MASCULINE_RELATIONS = ['father_name', 'brother_name', 'husband_name', 'son_name', 'grandfather_name'];
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
          let resolvedKey: string | undefined = extractedFacts[0]?.key;
          let resolvedVal: string | undefined = extractedFacts[0]?.value || this.extractNameFromCorrection(lower);
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

            if (factKey === 'UNKNOWN_RELATION') {
              const antecedent = this.resolveAntecedent(clause, units, context);
              if (antecedent) {
                factKey = antecedent.factKey;
                oldValue = antecedent.oldValue;
                relationship = antecedent.relationship;
              }
            }

            units.push({
              unitId: crypto.randomUUID(),
              sourceMessageId,
              order: i === 0 ? order : ++order,
              type: 'fact',
              text: fact.text,
              importance: fact.isProtected ? 9 : 8,
              responseRequired: false,
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

    return {
      units,
      hasQuestions: units.some(u => u.type === 'question'),
      hasFacts: units.some(u => u.type === 'fact' || (u.type === 'correction' && !!u.factKey)),
      hasEmotions: units.some(u => u.type === 'emotion'),
      hasActions: units.some(u => u.type === 'action'),
      hasCorrections: units.some(u => u.type === 'correction')
    };
  }

  private static splitIntoClauses(text: string): string[] {
    // Split on sentence terminators first
    const primary = text.split(/(?<=[.!?\n])\s+/).map(s => s.trim()).filter(Boolean);
    const result: string[] = [];

    for (const p of primary) {
      // If the sentence contains multiple distinct fact clauses separated by commas / 'and'
      if (p.includes(',') || /\band\b/i.test(p)) {
        const parts = p.split(/,\s*(?:and\s+)?|\s+and\s+/i).map(s => s.trim()).filter(Boolean);
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
  ): { factKey: string; oldValue?: string; relationship: string } | null {
    const lower = clause.toLowerCase();
    
    const isFem = /\b(she|her|hers|uski|iski)\b/i.test(lower);
    const isMasc = /\b(he|him|his|uske|iska)\b/i.test(lower);
    const isNeutral = /\b(they|them|their|unka|unki|woh|uska)\b/i.test(lower);
    const isGenericCorrection = /\b(actually|instead|correction:?|galat|nahi yaar)\b/i.test(lower);

    if (!isFem && !isMasc && !isNeutral && !isGenericCorrection) {
      return null;
    }

    // 1. Search backwards in current turn's already processed units
    for (let i = unitsSoFar.length - 1; i >= 0; i--) {
      const u = unitsSoFar[i];
      if (u.factKey && ALL_PERSON_RELATIONS.includes(u.factKey)) {
        if (isFem && FEMININE_RELATIONS.includes(u.factKey)) {
          return { factKey: u.factKey, oldValue: u.factValue, relationship: u.factKey.replace(/_name/g, '') };
        }
        if (isMasc && MASCULINE_RELATIONS.includes(u.factKey)) {
          return { factKey: u.factKey, oldValue: u.factValue, relationship: u.factKey.replace(/_name/g, '') };
        }
        if ((isNeutral || (!isFem && !isMasc)) && ALL_PERSON_RELATIONS.includes(u.factKey)) {
          return { factKey: u.factKey, oldValue: u.factValue, relationship: u.factKey.replace(/_name/g, '') };
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
              return { factKey: f.key, oldValue: f.value, relationship: f.key.replace(/_name/g, '') };
            }
            if (isMasc && MASCULINE_RELATIONS.includes(f.key)) {
              return { factKey: f.key, oldValue: f.value, relationship: f.key.replace(/_name/g, '') };
            }
            if ((isNeutral || (!isFem && !isMasc)) && ALL_PERSON_RELATIONS.includes(f.key)) {
              return { factKey: f.key, oldValue: f.value, relationship: f.key.replace(/_name/g, '') };
            }
          }
        }
      }
    }

    // Note: Do NOT search long-term memories for conversational pronouns (her/him/she/he).
    // An antecedent must be established in the active conversation turn or recent messages.
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

    // Mother name
    let m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:mummy|mom|mother|maa|mata)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) {
      facts.push({ key: 'mother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else {
      m = lower.match(/\b(?:my|meri)\s+(?:mummy|mom|mother|maa)\s+(?:is|hai)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) facts.push({ key: 'mother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Father name
    m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:papa|dad|father|baap|pita|daddy)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) {
      facts.push({ key: 'father_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else {
      m = lower.match(/\b(?:my|mere)\s+(?:papa|dad|father|pita)\s+(?:is|hai)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
      if (m) facts.push({ key: 'father_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Wife name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:biwi|wife|patni)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'wife_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Husband name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:shauhar|husband|pati)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'husband_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Sister name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:behen|sister)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'sister_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Brother name
    m = lower.match(/\b(?:mera|mere|my)?\s*(?:bhai|brother)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'brother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Son name
    m = lower.match(/\b(?:mera|mere|my)?\s*(?:beta|bete|son|child)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'son_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Daughter name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:beti|daughter)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'daughter_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

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

    // City / Location
    m = lower.match(/\b(?:rehta hoon|rehti hoon|rehta hu|live in|living in|i am from|from|stay in|staying in)\s+([a-zA-Z0-9\s]+?)(?:\s+me|(?:\s+me)?\s+rehta|[.,;!]|$)/i);
    if (m && !['a', 'the', 'my', 'home', 'here'].includes(m[1].toLowerCase())) {
      facts.push({ key: 'city', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else {
      m = lower.match(/\b(?:mai|main|i)\s+([a-zA-Z0-9\s]+?)(?:\s+me\s+rehta|\s+mein\s+rehta|\s+se\s+hu)/i);
      if (m && !['a', 'the', 'my', 'home', 'here'].includes(m[1].toLowerCase())) {
        facts.push({ key: 'city', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
      }
    }

    // Name
    m = lower.match(/\b(?:mera naam|mera pura name|mera pura naam|my name is|my full name is|my full name)\s+([a-zA-Z0-9\s]+?)(?:\s+hai|\s+is|[.,;!]|$)/i);
    if (m) facts.push({ key: 'user_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

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
    const m = lower.match(/\b(?:her|his|unka|unki|iska|iski|their|actual)?\s*name\s+is\s+([a-zA-Z]+)\b/i) ||
              lower.match(/\b(?:naam|nam)\s+(?:hai|is)\s+([a-zA-Z]+)\b/i) ||
              lower.match(/\b(?:actually|instead|correction:?)\s+([a-zA-Z]+)\b/i);
    return m ? this.cleanValue(m[1]) : undefined;
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

