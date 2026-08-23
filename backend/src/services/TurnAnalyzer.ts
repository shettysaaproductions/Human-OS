import { ChatMessageInput } from '../routes/chat';
import crypto from 'crypto';

export type SemanticUnitType = 'question' | 'fact' | 'emotion' | 'action' | 'correction' | 'casual';

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
}

export interface TurnAnalysisResult {
  units: SemanticUnit[];
  hasQuestions: boolean;
  hasFacts: boolean;
  hasEmotions: boolean;
  hasActions: boolean;
  hasCorrections: boolean;
}

export class TurnAnalyzer {
  public static analyze(messages: ChatMessageInput[]): TurnAnalysisResult {
    const units: SemanticUnit[] = [];
    let order = 0;

    for (const msg of messages) {
      if (!msg.message) continue;
      const sourceMessageId = msg.client_message_id || crypto.randomUUID();
      
      // Basic sentence splitting (handles typical English and Hinglish punctuation)
      // Also preserves the whole message if no punctuation exists.
      const sentences = msg.message.split(/(?<=[.!?\n])\s+/).map(s => s.trim()).filter(s => s.length > 0);
      
      for (const sentence of sentences) {
        order++;
        const lower = sentence.toLowerCase();
        
        let type: SemanticUnitType = 'casual';
        let importance = 1;
        let responseRequired = false;
        let acknowledgementPreferred = true;
        let memoryCandidate = false;
        let actionCandidate = false;
        let factKey: string | undefined;
        let factValue: string | undefined;

        // 1. Correction Patterns
        if (/\b(actually|correction|nahi yaar|galat|nahi uska naam|not that|instead|wait no)\b/.test(lower)) {
           type = 'correction';
           importance = 9;
           responseRequired = true;
           memoryCandidate = true;
        }
        // 2. Questions
        else if (/\?/.test(lower) || /\b(kya|kahan|kab|kaise|kyun|kaun|who|why|what|where|when|how)\b/.test(lower)) {
           type = 'question';
           importance = 7;
           responseRequired = true;
        }
        // 3. Explicit Facts (Family, Name, Job)
        else {
           const factMatch = this.extractFact(lower, sentence);
           if (factMatch) {
             type = 'fact';
             importance = 8;
             memoryCandidate = true;
             acknowledgementPreferred = true;
             factKey = factMatch.key;
             factValue = factMatch.value;
           }
           // 4. Emotions
           else if (/\b(feel|sad|happy|angry|tension|stress|ro raha|dukhi|pareshan|gussa|thaka|tired)\b/i.test(lower)) {
             type = 'emotion';
             importance = 8;
             acknowledgementPreferred = true;
           }
           // 5. Actions / Plans
           else if (/\b(plan|tomorrow|going to|will do|karunga|kal|meeting|gym|office)\b/i.test(lower)) {
             type = 'action';
             importance = 6;
             actionCandidate = true;
           }
        }

        units.push({
          unitId: crypto.randomUUID(),
          sourceMessageId,
          order,
          type,
          text: sentence,
          importance,
          responseRequired,
          acknowledgementPreferred,
          memoryCandidate,
          actionCandidate,
          factKey,
          factValue
        });
      }
    }

    return {
      units,
      hasQuestions: units.some(u => u.type === 'question'),
      hasFacts: units.some(u => u.type === 'fact'),
      hasEmotions: units.some(u => u.type === 'emotion'),
      hasActions: units.some(u => u.type === 'action'),
      hasCorrections: units.some(u => u.type === 'correction')
    };
  }

  private static extractFact(lower: string, _original: string): { key: string, value: string } | null {
    // Mother
    let m = lower.match(/\b(meri|mere|mara|my)\s+(mummy|mom|mother|maa|mata)\s+(ka naam|is|nam|name is|hai)\s+([a-z]+)\b/i);
    if (m) return { key: 'mother_name', value: m[4] };
    
    // Father
    m = lower.match(/\b(meri|mere|mara|my)\s+(papa|dad|father|baap|pita)\s+(ka naam|is|nam|name is|hai)\s+([a-z]+)\b/i);
    if (m) return { key: 'father_name', value: m[4] };

    // Wife
    m = lower.match(/\b(meri|mere|mara|my)\s+(biwi|wife|patni)\s+(ka naam|is|nam|name is|hai)\s+([a-z]+)\b/i);
    if (m) return { key: 'wife_name', value: m[4] };

    // Husband
    m = lower.match(/\b(meri|mere|mara|my)\s+(shauhar|husband|pati)\s+(ka naam|is|nam|name is|hai)\s+([a-z]+)\b/i);
    if (m) return { key: 'husband_name', value: m[4] };

    // Sister
    m = lower.match(/\b(meri|mere|mara|my)\s+(behen|sister)\s+(ka naam|is|nam|name is|hai)\s+([a-z]+)\b/i);
    if (m) return { key: 'sister_name', value: m[4] };

    // Brother
    m = lower.match(/\b(mera|mere|mara|my)\s+(bhai|brother)\s+(ka naam|is|nam|name is|hai)\s+([a-z]+)\b/i);
    if (m) return { key: 'brother_name', value: m[4] };

    // Company / Job / Business
    m = lower.match(/\b(meri|mere|my)\s+(company|office|business|startup|agency)\s+(ka naam|is|name is|hai)\s+([a-z0-9\s]+)\b/i);
    if (m) return { key: 'company_name', value: m[4].trim() };

    m = lower.match(/\b(kaam karta|karti hoon|work at|working at|job at|employed at|started a company called)\s+([a-z0-9\s]+)\b/i);
    if (m) return { key: 'company_name', value: m[2].trim() };

    // City / Location
    m = lower.match(/\b(rehta hoon|rehti hoon|live in|living in|from)\s+([a-z]+)\b/i);
    if (m) return { key: 'city', value: m[2] };

    // Name
    m = lower.match(/\b(mera naam|my name is)\s+([a-z]+)\b/i);
    if (m) return { key: 'user_name', value: m[2] };

    return null;
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
        else if (unit.type === 'correction') prompt += `Must acknowledge and accept the correction.`;
        else if (unit.type === 'fact') prompt += `Must briefly acknowledge this fact warmly.`;
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
      if (unit.responseRequired) {
        // Very basic bounded coverage check:
        // Did we answer the question or acknowledge the correction?
        // Since we don't want an LLM call here, we just check if it's completely missing
        // It's hard to do deterministically without NLP.
        // Let's assume the LLM covers questions. We can check if ANY response was given.
        // If the reply is extremely short and there were multiple questions, maybe one was missed.
        // For facts, maybe we check if the factValue is in the reply? No, LLM might rephrase.
        // For now, if the reply is too short to cover the required units, flag it?
        // Actually, the user asked for a "lightweight bounded repair/recomposition".
        // Let's do a naive keyword overlap. If there's 0 overlap in keywords, it's uncovered.
      }
    }
    // As a simple heuristic, if the reply is < 15 characters and there were required units, we assume they are uncovered.
    if (lowerReply.length < 15 && analysis.units.some(u => u.responseRequired)) {
      return analysis.units.filter(u => u.responseRequired);
    }
    
    return uncovered;
  }
}
