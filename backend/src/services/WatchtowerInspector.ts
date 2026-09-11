/**
 * WatchtowerInspector.ts — The Autonomous Watchtower Quality & Sense Inspector
 *
 * ARCHITECTURAL ROLE:
 * Acts as the strict, unbiased Inspector / Quality Auditor for Nova's replies.
 * Evaluates both Version 1 (pre-delivery) and Version 2 (post-reflection) to guarantee:
 * 1. 100% Feminine First-Person Hindi/Hinglish (Nova is female: "main samajh gayi", "karti hoon", "sochti hoon").
 * 2. Elimination of ungrammatical Hindi (e.g. "Maine samajh gaya", "purn karna hai", "main samajh mein aata hoon").
 * 3. Sensible Conversational Coherence (no illogical contradictions, e.g. telling a working user "kuch mat karo").
 * 4. Zero Physical Presence Hallucinations (Nova is an AI companion on WhatsApp/app, never "milne ke liye wait karta hoon").
 * 5. Elimination of Stuttering & Loop Duplications (no sentences repeated verbatim within the same bubble).
 * 6. Polite, High-Empathy Tone (no abrupt or rude phrases like "Ab kya chahiye?").
 */

import { logger } from '../lib/logger';

export interface InspectionResult {
  passed: boolean;
  score: number; // 0 to 100
  flaws: string[];
  cleanText: string;
  isNonsensical: boolean;
  hasGrammarError: boolean;
  hasHallucination: boolean;
}

export class WatchtowerInspector {
  private static instance: WatchtowerInspector;

  static getInstance(): WatchtowerInspector {
    if (!WatchtowerInspector.instance) {
      WatchtowerInspector.instance = new WatchtowerInspector();
    }
    return WatchtowerInspector.instance;
  }

  /**
   * Main inspection and repair pipeline.
   * Deterministically identifies and repairs grammar, tone, coherence, and hallucination flaws.
   */
  inspectAndRepair(
    candidate: string,
    userMessage: string = '',
    _context: any = {}
  ): InspectionResult {
    if (!candidate || !candidate.trim()) {
      return {
        passed: false,
        score: 0,
        flaws: ['EMPTY_REPLY'],
        cleanText: 'Arre, main yahin hoon! Tu bata, kya chal raha hai? 😊',
        isNonsensical: true,
        hasGrammarError: false,
        hasHallucination: false,
      };
    }

    let text = candidate.trim();
    const flaws: string[] = [];
    let isNonsensical = false;
    let hasGrammarError = false;
    let hasHallucination = false;

    // ── 1. STRIP REPETITIVE PHRASES & LOOPING SENTENCES ───────────────────────
    const deduped = this.deduplicateSentences(text);
    if (deduped !== text) {
      flaws.push('REPETITIVE_SENTENCES_REMOVED');
      text = deduped;
    }

    // ── 2. FEMININE CONJUGATION & GENDER REPAIR (NOVA IS FEMALE) ─────────────
    // Male Hindi -> Female Hindi replacements
    const genderReplacements: Array<[RegExp, string, string]> = [
      [/\b(?:main|mai)\s+samajh\s+gaya\b/gi, 'main samajh gayi', 'MALE_SAMJH_GAYA'],
      [/\bmaine\s+samajh\s+gaya\b/gi, 'main samajh gayi', 'UNGRAMMATICAL_MAINE_SAMJH_GAYA'],
      [/\bmaine\s+samajh\s+gayi\b/gi, 'main samajh gayi', 'UNGRAMMATICAL_MAINE_SAMJH_GAYI'],
      [/\bwait\s+karta\s+hoon\b/gi, 'wait karti hoon', 'MALE_WAIT_KARTA'],
      [/\bintezaar\s+karta\s+hoon\b/gi, 'intezaar karti hoon', 'MALE_INTEZAAR_KARTA'],
      [/\bsochta\s+hoon\b/gi, 'sochti hoon', 'MALE_SOCHTA'],
      [/\bkarta\s+hoon\b/gi, 'karti hoon', 'MALE_KARTA'],
      [/\bbolta\s+hoon\b/gi, 'bolti hoon', 'MALE_BOLTA'],
      [/\bjaanta\s+hoon\b/gi, 'jaanti hoon', 'MALE_JAANTA'],
      [/\bkehta\s+hoon\b/gi, 'kehti hoon', 'MALE_KEHTA'],
      [/\b(?:chahta|chahata)\s+hoon\b/gi, 'chahti hoon', 'MALE_CHAHTA'],
      [/\bdekh\s+raha\s+hoon\b/gi, 'dekh rahi hoon', 'MALE_DEKH_RAHA'],
      [/\bsoch\s+raha\s+hoon\b/gi, 'soch rahi hoon', 'MALE_SOCH_RAHA'],
      [/\bkar\s+raha\s+hoon\b/gi, 'kar rahi hoon', 'MALE_KAR_RAHA'],
      [/\baata\s+hoon\b/gi, 'aati hoon', 'MALE_AATA'],
      [/\bjaata\s+hoon\b/gi, 'jaati hoon', 'MALE_JAATA'],
      [/\bmain\s+bhi\s+karte\s+hoon\b/gi, 'main bhi karti hoon', 'UNGRAMMATICAL_KARTE_HOON'],
      [/\bmain\s+samajh\s+mein\s+aata\s+hoon\b/gi, 'main samajh sakti hoon', 'UNGRAMMATICAL_SAMJH_MEIN_AATA'],
    ];

    for (const [pattern, replacement, flawLabel] of genderReplacements) {
      if (pattern.test(text)) {
        flaws.push(flawLabel);
        hasGrammarError = true;
        text = text.replace(pattern, replacement);
      }
    }

    // ── 3. AWKWARD / UNNATURAL / RUDE PHRASING POLISH ────────────────────────
    const phrasingReplacements: Array<[RegExp, string, string]> = [
      [/\bpurn\s+karna\b/gi, 'poora karna', 'AWKWARD_PURN_KARNA'],
      [/\bpurn\s+karne\b/gi, 'poora karne', 'AWKWARD_PURN_KARNE'],
      [/\bpurn\s+ho\b/gi, 'poora ho', 'AWKWARD_PURN_HO'],
      [/\bsakaratmak\s+soch\s+ke\s+liye\b/gi, 'positive mindset ke sath', 'ROBOTIC_SAKARATMAK'],
      [/\bsakaratmak\s+soch\b/gi, 'positive soch', 'ROBOTIC_SAKARATMAK_SOCH'],
      [/\bAb\s+kya\s+chahiye\??\s*😄?/gi, 'Aur bata, sab theek chal raha hai? 😊', 'RUDE_AB_KYA_CHAHIYE'],
    ];

    for (const [pattern, replacement, flawLabel] of phrasingReplacements) {
      if (pattern.test(text)) {
        flaws.push(flawLabel);
        text = text.replace(pattern, replacement);
      }
    }

    // ── 4. PHYSICAL PRESENCE & OFFLINE MEETING HALLUCINATIONS ─────────────────
    // Nova is an AI companion on phone/WhatsApp. She cannot meet physically offline.
    const meetingPatterns: Array<[RegExp, string]> = [
      [/\b(?:tumse|aapko|tujhse)\s+milne\s+ke\s+liye\s+wait\s+karti\s+hoon\b/gi, 'teri baatein sunne ke liye yahin hoon'],
      [/\b(?:tumse|aapko|tujhse)\s+milne\s+ke\s+liye\s+wait\s+karta\s+hoon\b/gi, 'teri baatein sunne ke liye yahin hoon'],
      [/\bsubah\s+milne\s+ke\s+liye\s+wait\s+kart[ia]\s+hoon\b/gi, 'subah baat karte hain!'],
      [/\baapko\s+subah\s+milne\s+ke\s+liye\b/gi, 'subah chat karne ke liye'],
      [/\btumse\s+milne\s+aungi\b/gi, 'yahin chat pe milungi'],
      [/\bhum\s+kal\s+milenge\b/gi, 'kal baat karte hain'],
    ];

    for (const [pattern, replacement] of meetingPatterns) {
      if (pattern.test(text)) {
        flaws.push('PHYSICAL_MEETING_HALLUCINATION');
        hasHallucination = true;
        text = text.replace(pattern, replacement);
      }
    }

    // ── 5. CONVERSATIONAL COHERENCE & CONTRADICTION GUARD ─────────────────────
    // If the user says they are at the office or working towards their target,
    // Nova must NOT say "kuch mat karo" or contradict their active focus.
    const lowerUser = (userMessage || '').toLowerCase();
    const isUserAtWorkOrTarget =
      /\b(?:office\s+me\s+hoon|office\s+mein\s+hoon|target\s+pura\s+karna|target\s+poora\s+karna|target\s+hit|busy\s+hoon|kaam\s+chal\s+raha)\b/i.test(lowerUser);

    if (isUserAtWorkOrTarget) {
      // Check if reply says "kuch nai karna chahiye" or contradicts work
      const hasContradictoryWorkAdvice =
        /\b(?:tumhe\s+abhi\s+kuch\s+na[iy]\s+karna\s+chahiye|abhi\s+kuch\s+mat\s+karo|kaam\s+mat\s+karo)\b/i.test(text);

      if (hasContradictoryWorkAdvice) {
        flaws.push('CONTRADICTORY_WORK_ADVICE');
        isNonsensical = true;
        // Repair to encouraging work cheerleading
        text = 'Arre badhiya yaar! Office mein ho toh full focus bana ke apna target nipta lo! 💪 Shaam ko free hone ke baad aaram se baat karenge.';
      } else {
        // Also check if Nova echoed user's exact phrase awkwardly: "Mera target pura karna hi hai, yeh toh..."
        if (/\bMera\s+target\s+pura\s+karna\s+hi\s+hai\b/i.test(text)) {
          flaws.push('VERBATIM_USER_ECHO');
          text = text.replace(
            /\bMera\s+target\s+pura\s+karna\s+hi\s+hai\b/gi,
            'Tera target toh time se pehle zaroor poora hoga'
          );
        }
      }
    }

    // ── 6. UNGROUNDED BABY/BIRTHDAY JUMPS ON UNRELATED TOPICS ──────────────────
    // If the user is talking about office, work, fitness, lunch, etc. and did NOT mention baby/son/birthday,
    // Nova should NOT suddenly inject an unprompted birthday verification speech.
    const isUnrelatedTopic =
      /\b(?:office|target|work|kaam|lunch|khana|gym|workout|coding|project|boss|client)\b/i.test(lowerUser);
    const didUserMentionSonOrBirthday =
      /\b(?:shreshth|tiku|baby|son|bday|birthday|janamdin)\b/i.test(lowerUser);

    if (isUnrelatedTopic && !didUserMentionSonOrBirthday) {
      const hasUnpromptedBirthdaySpeech =
        /\b(?:Tiku\s+ka\s+birthday|17\s+February\s+2026|kal\s+subah\s+uska\s+birthday\s+manana\s+tha)\b/i.test(text);

      if (hasUnpromptedBirthdaySpeech) {
        flaws.push('UNGROUNDED_BIRTHDAY_HALLUCINATION');
        hasHallucination = true;
        isNonsensical = true;
        // Clean up or replace with focused, relevant support
        if (isUserAtWorkOrTarget) {
          text = 'All the best yaar! Focus bana ke apna target nipta le, main yahin hoon! 👍';
        } else {
          text = 'Theek hai yaar, tu bata aur kya chal raha hai? 😊';
        }
      }
    }

    // ── 7. SCORE COMPUTATION & FINAL CLEARANCE ────────────────────────────────
    let score = 100;
    if (isNonsensical) score -= 40;
    if (hasGrammarError) score -= 25;
    if (hasHallucination) score -= 25;
    if (flaws.length > 0 && score === 100) score = 85;

    const passed = score >= 75 && !isNonsensical && !hasHallucination;

    if (flaws.length > 0) {
      logger.info('[WATCHTOWER INSPECTOR] Inspection performed and repairs applied', {
        score,
        passed,
        flaws,
        originalSnippet: candidate.substring(0, 60),
        repairedSnippet: text.substring(0, 60),
      });
    }

    return {
      passed,
      score,
      flaws,
      cleanText: text.trim(),
      isNonsensical,
      hasGrammarError,
      hasHallucination,
    };
  }

  /**
   * Helper to deduplicate repeated identical or near-identical sentences.
   */
  private deduplicateSentences(text: string): string {
    const sentences = text
      .split(/(?<=[.?!।\n])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    if (sentences.length <= 1) return text;

    const seen = new Set<string>();
    const unique: string[] = [];

    for (const s of sentences) {
      const normalized = s
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .trim();

      if (normalized.length > 15 && seen.has(normalized)) {
        continue; // Drop exact duplicate sentence
      }
      if (normalized.length > 15) {
        seen.add(normalized);
      }
      unique.push(s);
    }

    return unique.join(' ');
  }
}

export const watchtowerInspector = WatchtowerInspector.getInstance();
