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

export class TurnAnalyzer {
  public static analyze(messages: ChatMessageInput[]): TurnAnalysisResult {
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
          const firstFact = extractedFacts[0];
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
            factKey: firstFact?.key || (lower.includes('her name') ? 'mother_name' : (lower.includes('his name') ? 'father_name' : undefined)),
            factValue: firstFact?.value || this.extractNameFromCorrection(lower),
            isProtected: isExplicitRemember,
            factClass: isExplicitRemember ? 'PROTECTED_FACT' : 'HIGH_CONFIDENCE_DURABLE_FACT'
          });
        }
        // 2. Check for extracted facts
        else if (extractedFacts.length > 0) {
          for (let i = 0; i < extractedFacts.length; i++) {
            const fact = extractedFacts[i];
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
              factKey: fact.key,
              factValue: fact.value,
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
        else if (/\b(plan|tomorrow|going to|will do|karunga|kal|meeting|gym|office|flight|trip|doctor|task)\b/i.test(lower)) {
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
    let m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:mummy|mom|mother|maa|mata)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z]+)\b/i);
    if (m) {
      facts.push({ key: 'mother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else {
      m = lower.match(/\b(?:my|meri)\s+(?:mummy|mom|mother|maa)\s+(?:is|hai)\s+([a-zA-Z]+)\b/i);
      if (m) facts.push({ key: 'mother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Father name
    m = lower.match(/\b(?:meri|mere|mara|my)?\s*(?:papa|dad|father|baap|pita|daddy)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z]+)\b/i);
    if (m) {
      facts.push({ key: 'father_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    } else {
      m = lower.match(/\b(?:my|mere)\s+(?:papa|dad|father|pita)\s+(?:is|hai)\s+([a-zA-Z]+)\b/i);
      if (m) facts.push({ key: 'father_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Wife name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:biwi|wife|patni)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z]+)\b/i);
    if (m) facts.push({ key: 'wife_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Husband name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:shauhar|husband|pati)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z]+)\b/i);
    if (m) facts.push({ key: 'husband_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Sister name
    m = lower.match(/\b(?:meri|mere|my)?\s*(?:behen|sister)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z]+)\b/i);
    if (m) facts.push({ key: 'sister_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

    // Brother name
    m = lower.match(/\b(?:mera|mere|my)?\s*(?:bhai|brother)(?:'s)?\s+(?:ka\s+naam|is|nam|name\s+is|hai|name)\s+([a-zA-Z]+)\b/i);
    if (m) facts.push({ key: 'brother_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

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
    m = lower.match(/\b(?:rehta hoon|rehti hoon|live in|living in|i am from|from|stay in|staying in)\s+([a-zA-Z]+)\b/i);
    if (m && !['a', 'the', 'my', 'home', 'here'].includes(m[1].toLowerCase())) {
      facts.push({ key: 'city', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });
    }

    // Name
    m = lower.match(/\b(?:mera naam|my name is)\s+([a-zA-Z]+)\b/i);
    if (m) facts.push({ key: 'user_name', value: this.cleanValue(m[1]), text, isProtected: isExplicitRemember, factClass });

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
        prompt += `- [${unit.type.toUpperCase()}] "${unit.text}" -> `;
        if (unit.type === 'question') prompt += `Must provide an answer.`;
        else if (unit.type === 'correction') prompt += `Must explicitly acknowledge and accept the correction (e.g. "Got it, ${unit.factValue || 'updated'}!").`;
        else if (unit.type === 'fact') prompt += `Must acknowledge this fact (${unit.factKey || 'detail'}: ${unit.factValue || unit.text}) warmly.`;
        else if (unit.type === 'emotion') prompt += `Must validate this emotion first.`;
        else if (unit.type === 'action') prompt += `Acknowledge this action/plan.`;
        else prompt += `Address naturally.`;
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
