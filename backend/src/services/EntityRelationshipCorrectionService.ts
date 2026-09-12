/**
 * EntityRelationshipCorrectionService.ts
 *
 * Universal Autonomous Entity & Concept Reclassification Engine.
 *
 * ARCHITECTURAL ROLE:
 * Handles user corrections and reclassifications when ANY entity, concept, habit,
 * vehicle, instrument, pet, tool, project, or person is corrected or moved across domains.
 *
 * Examples:
 * - "Ijaz is not my family member is is my office frind" (Family -> Work / Colleague)
 * - "Guitar is not my hobby, it is my full time profession" (Lifestyle -> Work / Profession)
 * - "Coco is not my cat, he is my pet dog" (Cat -> Dog within Family)
 * - "React is not just a side project, it's my core tech stack" (Lifestyle -> Work / Stack)
 * - "Mumbai is not a vacation trip, that's where I live" (Lifestyle -> Core Identity)
 * - "Keto is not a casual diet, it is my medical restriction" (Lifestyle -> Health)
 * - "Morning run is not an occasional hobby, it is my daily routine" (Lifestyle -> Routine)
 * - "Move tennis from sports to my fitness routine" (Lifestyle -> Routine)
 * - "Don't put BMW under travel, put it under cars" (Category adjustment)
 * - "Guitar mera timepass nahi hai, career hai" (Hinglish Lifestyle -> Work)
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { LifeDomainKey, DOMAIN_TAXONOMY, selectDynamicDrawerEmoji } from '../lib/memoryDomains';
import { invalidateAnalyticsCache } from '../routes/analytics';
import { chatCompletionMemory } from '../lib/nvidia';

export interface EntityCorrection {
  entityName: string;
  oldRelation?: string;
  oldDomain: LifeDomainKey;
  newRelation: string;
  newDomain: LifeDomainKey;
  rawText: string;
  isAttributeTransfer?: boolean;
  transferredValue?: string;
  targetKey?: string;
}

export interface CascadingDeletePreview {
  entityName: string;
  rootNodeId?: string;
  rootMemory?: { id: string; key: string; value: string };
  stemsCount: number;
  stems: Array<{ id: string; key: string; value: string; department?: string }>;
  remindersCount: number;
  reminders: Array<{ id: string; text: string; due_time?: string }>;
}

export interface CascadingDeleteResult {
  success: boolean;
  entityName: string;
  deletedStemsCount: number;
  cancelledRemindersCount: number;
  deletedStemNames: string[];
  cancelledReminderTexts: string[];
  message: string;
}

/**
 * Infers the LifeDomainKey for arbitrary concepts and categories.
 */
export function inferDomainFromConcept(concept: string, fallback: LifeDomainKey = 'lifestyle'): LifeDomainKey {
  if (!concept) return fallback;
  const c = concept.toLowerCase().trim();

  // 1. Work / Career / Profession / Tech Stack / Business
  if (/\b(work|career|profession|professional|job|office|colleague|colleagues|coworker|coworkers|manager|boss|client|clients|company|startup|venture|business|co-founder|cofounder|partner\s+in\s+business|tech\s*stack|stack|software|repo|coding|code|developer|project|freelance|employment|salary)\b/i.test(c)) {
    return 'work';
  }

  // 2. Family & Personal Relationships & Pets
  if (/\b(family|family\s+member|relative|relatives|brother|bhai|sister|behen|father|papa|dad|mother|mom|maa|son|beta|daughter|beti|wife|biwi|patni|husband|pati|spouse|partner|pet|dog|puppy|kutta|cat|kitten|billi|bird|parrot|cousin|uncle|aunt|dost|friend|close\s+friend|best\s+friend)\b/i.test(c)) {
    // If it mentions office friend or work friend, work takes precedence!
    if (/\b(office|work|colleague|coworker)\b/i.test(c)) {
      return 'work';
    }
    return 'family';
  }

  // 3. Goals & Ambitions & Milestones
  if (/\b(goal|goals|target|ambition|dream|dreams|milestone|milestones|vision|aim|resolution|bucket\s*list|future\s*plan|marathon|race)\b/i.test(c)) {
    return 'goals';
  }

  // 4. Core Identity / Personal Living Location
  if (/\b(home|home\s*city|residence|where\s+i\s+live|living\s+place|birth\s*place|native\s*place|identity|real\s*name|legal\s*name|citizenship|nationality)\b/i.test(c)) {
    return 'identity';
  }

  // 5. Default to Lifestyle (gym, fitness, workout, routines, habits, hobbies, instruments, food, travel)
  return 'lifestyle';
}

export class EntityRelationshipCorrectionService {
  private static instance: EntityRelationshipCorrectionService;

  static getInstance(): EntityRelationshipCorrectionService {
    if (!EntityRelationshipCorrectionService.instance) {
      EntityRelationshipCorrectionService.instance = new EntityRelationshipCorrectionService();
    }
    return EntityRelationshipCorrectionService.instance;
  }

  /**
   * Fast-path deterministic detection for entity corrections across arbitrary domains.
   * Handles natural typing typos (e.g., "is is", "frind", "collegue", "cowoker").
   */
  detectEntityCorrection(text: string): EntityCorrection | null {
    if (!text || typeof text !== 'string') return null;

    let clean = text.trim();
    if (!clean) return null;

    // Normalize out common user typos and speech artifacts
    clean = clean
      .replace(/\bregarding\s+memory:\s*\[[^\]]+\]:\s*["'][^"']*["']\s*-\s*/i, '') // strip modal quote prefix
      .replace(/\bregarding\s+memory:\s*\[[^\]]+\]:\s*/i, '')
      .replace(/\bregarding\s+([a-zA-Z]+):\s*/i, '$1 ')
      .replace(/^(actually|wait|no|listen|hey nova|nova|bhai|yaar)[,\s]+/i, '')
      .replace(/\bfrind\b/gi, 'friend')
      .replace(/\bcollegue\b/gi, 'colleague')
      .replace(/\bcowoker\b/gi, 'coworker')
      .replace(/\bis\s+is\b/gi, 'is')
      .replace(/\bhes\b/gi, "he's")
      .replace(/\bshes\b/gi, "she's");

    const lower = clean.toLowerCase();

    // ── Pattern T1: Cross-Branch Attribute Transfer: "(my) [attribute] of [entity] is not [value], it is of/for [target]" ──
    // e.g. "my timing of office is not 8am it of my gym time"
    // e.g. "the timing of office is not 8am, it is for my gym"
    const patternT1 = /\b(?:my\s+|the\s+)?(timing|time|schedule|hours|routine|place|location|day|date)\s+of\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)?)\s+(?:is\s+not|isn't|nahi\s+hai)\s+([0-9]+(?::[0-9]{2})?\s*(?:am|pm)?|[a-zA-Z0-9]+)\s*[,;.-]?\s*(?:it\s+is\s+|it's\s+|it\s+of\s+|is\s+|for\s+|woh\s+|wo\s+)?(?:of\s+|for\s+)?(?:my\s+)?([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})(?:[.,;!]|$)/i;
    const mt1 = lower.match(patternT1);
    if (mt1) {
      const attrType = mt1[1].trim();
      const oldSubject = mt1[2].trim();
      const transferredValue = mt1[3].trim();
      const newSubject = mt1[4].trim();
      if (oldSubject && newSubject && transferredValue) {
        const hasAttr = /\b(timing|time|schedule|hours|routine|place|location|day|date)\b/i.test(newSubject);
        return this.buildAttributeTransfer(
          transferredValue,
          `${oldSubject} ${attrType}`,
          hasAttr ? newSubject : `${newSubject} ${attrType}`,
          clean
        );
      }
    }

    // ── Pattern T2: Cross-Branch Attribute Transfer: "[entity] [attribute] is not [value], it is (of/for) [target]" ──
    // e.g. "office timing is not 8am, it is of my gym time"
    // e.g. "office hours are not 8am, it is my gym time"
    const patternT2 = /\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)?)\s+(timing|time|schedule|hours)\s+(?:is\s+not|isn't|are\s+not|aren't|nahi\s+hai)\s+([0-9]+(?::[0-9]{2})?\s*(?:am|pm)?)\s*[,;.-]?\s*(?:it\s+is\s+|it's\s+|it\s+of\s+|is\s+|for\s+|woh\s+|wo\s+)?(?:of\s+|for\s+)?(?:my\s+)?([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})(?:[.,;!]|$)/i;
    const mt2 = lower.match(patternT2);
    if (mt2) {
      const oldSubject = mt2[1].trim();
      const attrType = mt2[2].trim();
      const transferredValue = mt2[3].trim();
      const newSubject = mt2[4].trim();
      if (oldSubject && newSubject && transferredValue) {
        const hasAttr = /\b(timing|time|schedule|hours|routine|location|place|day|date|days)\b/i.test(newSubject);
        return this.buildAttributeTransfer(
          transferredValue,
          `${oldSubject} ${attrType}`,
          hasAttr ? newSubject : `${newSubject} ${attrType}`,
          clean
        );
      }
    }

    // ── Pattern T3: "[numeric time] is not my [old attribute], it is my [new attribute]" ──
    // e.g. "8am is not my office time, it is my gym time"
    const patternT3 = /\b([0-9]+(?::[0-9]{2})?\s*(?:am|pm)?)\s+(?:is\s+not|isn't)\s+(?:my\s+|for\s+)?([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s*[,;.-]?\s*(?:it\s+is\s+|it's\s+|is\s+|that's\s+)?(?:my\s+|for\s+)?([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})(?:[.,;!]|$)/i;
    const mt3 = lower.match(patternT3);
    if (mt3) {
      const transferredValue = mt3[1].trim();
      const oldAttr = mt3[2].trim();
      const newAttr = mt3[3].trim();
      return this.buildAttributeTransfer(transferredValue, oldAttr, newAttr, clean);
    }

    // ── Pattern T4: Hinglish Attribute Transfer ──
    // e.g. "office timing 8am nahi hai, gym ka time hai"
    const patternT4 = /\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)?)\s+(?:ka|ki|ke)?\s*(timing|time|schedule|hours)\s+([0-9]+(?::[0-9]{2})?\s*(?:am|pm)?)\s+nahi\s+(?:hai|tha|thi)?\s*[,;.-]?\s*(?:woh|wo)?\s*([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})\s+(?:ka\s+time|ka\s+hai|hai)(?:[.,;!]|$)/i;
    const mt4 = lower.match(patternT4);
    if (mt4) {
      const oldSubject = mt4[1].trim();
      const attrType = mt4[2]?.trim() || 'time';
      const transferredValue = mt4[3].trim();
      const newSubject = mt4[4].trim();
      if (oldSubject && newSubject && transferredValue) {
        const hasAttr = /\b(time|timing|schedule|jagah|location)\b/i.test(newSubject);
        return this.buildAttributeTransfer(
          transferredValue,
          `${oldSubject} ${attrType}`,
          hasAttr ? newSubject : `${newSubject} ${attrType}`,
          clean
        );
      }
    }

    // ── Pattern 1: Universal Direct Negation + Assertion ─────────────────────
    // e.g. "Ijaz is not my family member, he is my office friend"
    // e.g. "Guitar is not my hobby, it is my full time profession"
    // e.g. "Coco is not my cat, he is my pet dog"
    // e.g. "React is not a side project, it's my core tech stack"
    // e.g. "Mumbai is not a vacation trip, that is my home city"
    const pattern1 = /\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+(?:is\s+not|isn't|is\s+no\s+longer|are\s+not|aren't)(?:\s+(?:my|an|a|mera|meri|mere|just|only|simply))?\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})\s*(?:,\s*(?:it\s+is|it's|he\s+is|she\s+is|they\s+are|he's|she's|is|woh|wo|actually|to|that's|that\s+is)?|[,;.-]?\s+(?:it\s+is|it's|he\s+is|she\s+is|they\s+are|he's|she's|is|woh|wo|actually|to|that's|that\s+is))\s+(?:my|an|a|mera|meri|mere)?\s*([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})(?:[.,;!]|$)/i;
    const m1 = lower.match(pattern1);
    if (m1) {
      const entityName = this.cleanEntity(m1[1]);
      if (this.isValidEntityName(entityName)) {
        const oldConceptRaw = m1[2].trim();
        const newConceptRaw = m1[3].trim().replace(/\s+at\s+work$/i, '');
        if (oldConceptRaw && newConceptRaw && oldConceptRaw !== newConceptRaw) {
          return this.buildCorrection(entityName, oldConceptRaw, newConceptRaw, clean);
        }
      }
    }

    // ── Pattern 2: Universal Reversed Assertion ──────────────────────────────
    // e.g. "Ijaz is my office friend, not a family member"
    // e.g. "Guitar is my full time profession, not a hobby"
    // e.g. "Coco is my pet dog, not a cat"
    const pattern2 = /\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+(?:is|hai)\s+(?:my|mera|meri|mere|an|a)?\s*([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})\s*[,;.-]?\s*(?:not|nahi\s+hai|aur\s+nahi)\s+(?:my|mera|meri|mere|an|a)?\s*([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})(?:[.,;!]|$)/i;
    const m2 = lower.match(pattern2);
    if (m2) {
      const entityName = this.cleanEntity(m2[1]);
      if (this.isValidEntityName(entityName)) {
        const newConceptRaw = m2[2].trim();
        const oldConceptRaw = m2[3].trim();
        if (oldConceptRaw && newConceptRaw && oldConceptRaw !== newConceptRaw) {
          return this.buildCorrection(entityName, oldConceptRaw, newConceptRaw, clean);
        }
      }
    }

    // ── Pattern 3: Universal Move / Reassign Commands ─────────────────────────
    // e.g. "Move tennis from sports to fitness routine"
    // e.g. "Move Ijaz from family to office friends"
    // e.g. "Don't put BMW under travel, put it under cars"
    // e.g. "Guitar ko hobbies se hata kar work me daal do"
    const pattern3a = /\b(?:move|shift|transfer|put)\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+from\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+to\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})(?:\s+branch|\s+drawer|\s+wardrobe|\s+category)?(?:[.,;!]|$)/i;
    const m3a = lower.match(pattern3a);
    if (m3a) {
      const entityName = this.cleanEntity(m3a[1]);
      if (this.isValidEntityName(entityName)) {
        return this.buildCorrection(entityName, m3a[2].trim(), m3a[3].trim(), clean);
      }
    }

    const pattern3b = /\b(?:don't|do\s+not)\s+put\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+under\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})[,;.-]?\s*(?:put\s+it\s+under|move\s+it\s+to|it\s+belongs\s+to|it's\s+in)\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})(?:[.,;!]|$)/i;
    const m3b = lower.match(pattern3b);
    if (m3b) {
      const entityName = this.cleanEntity(m3b[1]);
      if (this.isValidEntityName(entityName)) {
        return this.buildCorrection(entityName, m3b[2].trim(), m3b[3].trim(), clean);
      }
    }

    const pattern3c = /\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+ko\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+se\s+(?:hata\s+kar|nikal\s+kar)\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,2})\s+(?:me|mein)\s+(?:daal|move|shift|put)(?:[.,;!]|$)/i;
    const m3c = lower.match(pattern3c);
    if (m3c) {
      const entityName = this.cleanEntity(m3c[1]);
      if (this.isValidEntityName(entityName)) {
        return this.buildCorrection(entityName, m3c[2].trim(), m3c[3].trim(), clean);
      }
    }

    // ── Pattern 4: Hinglish Direct Negation + Assertion ───────────────────────
    // 4a. With possession: "Guitar mera timepass nahi hai, career hai"
    const pattern4a = /\b([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)?)\s+(?:mera|meri|mere|ka|ki|ke)\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)?)\s+nahi\s+(?:hai|tha|thi)?\s*[,;.-]?\s*(?:mera|meri|mere|woh|wo|to|yeh)?\s*([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})\s+(?:hai|mein\s+aata\s+hai)(?:[.,;!]|$)/i;
    const m4a = lower.match(pattern4a);
    if (m4a) {
      const entityName = this.cleanEntity(m4a[1]);
      if (this.isValidEntityName(entityName)) {
        const oldConceptRaw = m4a[2].trim();
        const newConceptRaw = m4a[3].trim();
        if (oldConceptRaw && newConceptRaw && oldConceptRaw !== newConceptRaw) {
          return this.buildCorrection(entityName, oldConceptRaw, newConceptRaw, clean);
        }
      }
    }

    // 4b. Without possession: "Ijaz family member nahi hai, office ka dost hai"
    const pattern4b = /\b([a-zA-Z0-9]+)\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+)?)\s+nahi\s+(?:hai|tha|thi)?\s*[,;.-]?\s*(?:mera|meri|mere|woh|wo|to|yeh)?\s*([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,3})\s+(?:hai|mein\s+aata\s+hai)(?:[.,;!]|$)/i;
    const m4b = lower.match(pattern4b);
    if (m4b) {
      const entityName = this.cleanEntity(m4b[1]);
      if (this.isValidEntityName(entityName)) {
        const oldConceptRaw = m4b[2].trim();
        const newConceptRaw = m4b[3].trim();
        if (oldConceptRaw && newConceptRaw && oldConceptRaw !== newConceptRaw) {
          return this.buildCorrection(entityName, oldConceptRaw, newConceptRaw, clean);
        }
      }
    }

    return null;
  }

  /**
   * Dual-layer intelligence: Tries fast deterministic regex first, then falls
   * back to LLM workforce extraction (NVIDIA / Hippocampus) for complex conversational phrasing.
   */
  async detectOrInferCorrection(text: string): Promise<EntityCorrection | null> {
    if (!text || typeof text !== 'string') return null;

    // 1. Fast path: deterministic regex
    const fastMatch = this.detectEntityCorrection(text);
    if (fastMatch) return fastMatch;

    // 2. Check if the turn contains correction or category change cues
    const cueRegex = /\b(not my|not a|isn't|is not|are not|aren't|nahi hai|hata kar|reclassify|wrong branch|wrong category|wrong drawer|under .* instead|actually a|actually my|don't put|move .* to|shift .* to)\b/i;
    if (!cueRegex.test(text)) return null;

    // 3. Fallback: LLM workforce extraction
    try {
      const prompt = `Analyze if the user is correcting an entity/topic category or relationship in their life knowledge base.
User message: "${text}"

If the user is correcting or moving an entity (e.g. saying X is not Y, it is Z, or move X from Y to Z):
Return a JSON object with:
{
  "isCorrection": true,
  "entityName": "name of entity or topic (e.g. Guitar, Ijaz, Coco, React, Mumbai, Tennis)",
  "oldConcept": "previous concept or category (e.g. hobby, family member, cat, side project)",
  "newConcept": "new concept or category (e.g. profession, office friend, dog, tech stack)",
  "oldDomain": "work | family | goals | lifestyle | identity",
  "newDomain": "work | family | goals | lifestyle | identity"
}

If this message is NOT an entity/concept category correction, return:
{ "isCorrection": false }

Output ONLY valid JSON.`;

      const responseStr = await chatCompletionMemory([
        { role: 'system', content: 'You are a precise JSON memory extraction agent.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.1, maxTokens: 150 });

      const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.isCorrection && parsed.entityName && parsed.newConcept) {
        return this.buildCorrection(
          parsed.entityName,
          parsed.oldConcept || 'previous category',
          parsed.newConcept,
          text
        );
      }
    } catch (llmErr) {
      logger.warn('[EntityRelationshipCorrection] LLM fallback extraction warning', { error: String(llmErr) });
    }

    return null;
  }

  private cleanEntity(raw: string): string {
    return raw
      .replace(/^(my|a|an|the|mera|meri|mere)\s+/i, '')
      .replace(/\s+(is|hai|are)$/i, '')
      .trim();
  }

  private isValidEntityName(name: string): boolean {
    if (!name || name.trim().length < 2) return false;
    const clean = name.trim().toLowerCase();
    const stopWords = new Set([
      'he', 'she', 'it', 'they', 'this', 'that', 'there', 'who', 'what', 'why', 'when',
      'my', 'mine', 'your', 'his', 'her', 'our', 'their', 'mera', 'meri', 'mere', 'mai',
      'i', 'you', 'we', 'us', 'him', 'them', 'no', 'not', 'yes', 'so', 'and', 'but', 'or'
    ]);
    return !stopWords.has(clean);
  }

  private capitalizeWords(str: string): string {
    if (!str) return '';
    return str
      .trim()
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  private buildCorrection(entityName: string, oldConceptRaw: string, newConceptRaw: string, rawText: string): EntityCorrection {
    const cleanEntity = this.capitalizeWords(this.cleanEntity(entityName));
    const oldConcept = oldConceptRaw.trim().toLowerCase();
    let newConcept = newConceptRaw.trim();

    const oldDomain = inferDomainFromConcept(oldConcept, 'lifestyle');
    let newDomain = inferDomainFromConcept(newConcept, 'lifestyle');

    // Specific overrides for professional workplace and colleagues
    if (/\b(office|colleague|coworker|work\s+friend)\b/i.test(newConcept)) {
      newDomain = 'work';
      newConcept = newConcept.toLowerCase().includes('colleague') ? 'Colleague' : 'Office Friend';
    }

    const newRelation = this.capitalizeWords(newConcept);

    return {
      entityName: cleanEntity,
      oldRelation: oldConcept,
      oldDomain,
      newRelation,
      newDomain,
      rawText
    };
  }

  private buildAttributeTransfer(
    transferredValue: string,
    oldRelationRaw: string,
    newRelationRaw: string,
    rawText: string
  ): EntityCorrection {
    const oldConcept = oldRelationRaw.trim().toLowerCase();
    const newConcept = newRelationRaw.trim();
    const oldDomain = inferDomainFromConcept(oldConcept, 'work');
    const newDomain = inferDomainFromConcept(newConcept, 'lifestyle');

    const cleanVal = transferredValue.trim();
    const newRelationTitle = this.capitalizeWords(newConcept);
    const targetKey = newRelationTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    return {
      entityName: cleanVal,
      oldRelation: oldConcept,
      oldDomain,
      newRelation: newRelationTitle,
      newDomain,
      rawText,
      isAttributeTransfer: true,
      transferredValue: cleanVal,
      targetKey
    };
  }

  /**
   * Detects conversational bubble & stem cascading deletion intent.
   * e.g. "delete my pet bubble whose name was Tomy and its stems ware morning walk with him daily"
   * e.g. "delete my pet bubble Tomy"
   * e.g. "Tomy bubble ko delete kar do aur uske saare stems bhi"
   */
  detectDeleteIntent(text: string): { isDelete: boolean; entityName: string; cascade: boolean } | null {
    if (!text || typeof text !== 'string') return null;
    const clean = text.trim();
    if (!clean) return null;

    const lower = clean.toLowerCase();

    // 1. English:
    // e.g. "in family i delete my pet bubble whose name was Tomy and its stems ware morning walk with him daily"
    // e.g. "delete my pet bubble Tomy and all its stems"
    // e.g. "delete Tomy bubble"
    // e.g. "forget Tomy and all his details"
    const p1 = /\b(?:delete|remove|erase|forget|wipe)\s+(?:my\s+)?(?:pet\s+|family\s+|friend\s+|work\s+|routine\s+|habit\s+|bubble\s+|branch\s+)*(?:bubble\s+)?(?:named\s+|whose\s+name\s+(?:was|is)\s+)?([a-zA-Z0-9]+)(?:\s+bubble)?(?:\s+and\s+(?:all\s+)?(?:its|his|her|their)?\s*(?:stems|details|reminders|branches|routines|info|connected)[\s\S]*)?/i;
    const m1 = lower.match(p1);
    if (m1) {
      const rawEntity = m1[1].trim();
      const entityName = this.cleanEntity(rawEntity);
      if (this.isValidEntityName(entityName) && !/^(bubble|branch|detail|stem|node|memory|fact|everything|all|this|that|and|kar|do|kardo|ko|se|aur|uske)$/i.test(entityName)) {
        return {
          isDelete: true,
          entityName: this.capitalizeWords(entityName),
          cascade: true
        };
      }
    }

    // 2. Hinglish:
    // e.g. "Tomy bubble ko delete kar do aur uske saare stems bhi"
    // e.g. "Tomy bubble delete kar do"
    // e.g. "Tomy ko delete kar do"
    const p2 = /\b([a-zA-Z0-9]+)\s+(?:bubble\s+)?(?:ko\s+)?(?:aur\s+uske\s+(?:saare\s+)?stems\s*(?:bhi)?\s*)?(?:ko\s+)?(?:delete|remove|hata|bhool|mita)\s+(?:kar\s+do|kardo|do|dena|jao)/i;
    const m2 = lower.match(p2);
    if (m2) {
      const rawEntity = m2[1].trim();
      const entityName = this.cleanEntity(rawEntity);
      if (this.isValidEntityName(entityName) && !/^(bubble|branch|detail|stem|node|memory|fact|everything|all|this|that|and|kar|do|kardo|ko|se|aur|uske)$/i.test(entityName)) {
        return {
          isDelete: true,
          entityName: this.capitalizeWords(entityName),
          cascade: true
        };
      }
    }

    return null;
  }

  /**
   * Previews all child stems, associated memories, and connected reminders that would be
   * affected if a bubble/entity is deleted.
   */
  async previewCascadingDelete(userId: string, target: { nodeId?: string; rawKey?: string; entityName?: string }): Promise<CascadingDeletePreview> {
    let resolvedEntity = target.entityName || '';

    // If no explicit entityName, infer from rawKey or nodeId
    if (!resolvedEntity && target.rawKey) {
      resolvedEntity = target.rawKey
        .replace(/^(pet_|dog_|cat_|colleague_|friend_|routine_|instrument_|profession_|project_)/, '')
        .replace(/_/g, ' ');
    }

    // If still empty and nodeId exists, check kg_nodes
    if (!resolvedEntity && target.nodeId) {
      const { data: nodeData } = await supabaseAdmin
        .from('kg_nodes')
        .select('name, raw_key')
        .eq('user_id', userId)
        .eq('id', target.nodeId)
        .maybeSingle();

      if (nodeData) {
        resolvedEntity = (nodeData.name || '').replace(/\s*\([^)]*\)$/, '').trim();
      }
    }

    resolvedEntity = this.capitalizeWords(this.cleanEntity(resolvedEntity || 'Entity'));
    const slug = resolvedEntity.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // 1. Fetch active memories touching this entity
    const { data: mems } = await supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type')
      .eq('user_id', userId)
      .eq('is_archived', false);

    const matchingMems: Array<{ id: string; key: string; value: string; department?: string }> = [];
    let rootMemory: { id: string; key: string; value: string } | undefined;

    for (const m of (mems || [])) {
      const k = (m.key || '').toLowerCase();
      const v = (m.value || '').toLowerCase();
      const matches = k.includes(slug) || v.includes(resolvedEntity.toLowerCase()) || v.includes(slug) || m.id === target.nodeId;

      if (matches) {
        if (!rootMemory && (k === `pet_${slug}` || k === `dog_${slug}` || k === `cat_${slug}` || k === `friend_${slug}` || k === slug || m.id === target.nodeId)) {
          rootMemory = { id: m.id, key: m.key, value: m.value };
        } else {
          matchingMems.push({ id: m.id, key: m.key, value: m.value, department: m.memory_type });
        }
      }
    }

    // 2. Fetch active reminders connected to this entity
    const { data: allReminders } = await supabaseAdmin
      .from('reminders')
      .select('id, text, due_time, status, notes')
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .neq('status', 'completed');

    const matchingReminders: Array<{ id: string; text: string; due_time?: string }> = [];
    for (const r of (allReminders || [])) {
      const t = (r.text || '').toLowerCase();
      const n = ((r as any).notes || '').toLowerCase();
      if (t.includes(slug) || t.includes(resolvedEntity.toLowerCase()) || n.includes(slug) || n.includes(resolvedEntity.toLowerCase())) {
        matchingReminders.push({ id: r.id, text: r.text, due_time: r.due_time });
      }
    }

    return {
      entityName: resolvedEntity,
      rootNodeId: target.nodeId,
      rootMemory,
      stemsCount: matchingMems.length,
      stems: matchingMems,
      remindersCount: matchingReminders.length,
      reminders: matchingReminders
    };
  }

  /**
   * Recursively deletes an entity bubble, soft-tombstoning all downstream stems,
   * cancelling all connected reminders, clearing working memory, and severing KG nodes/edges.
   */
  async cascadingDeleteEntityBubble(
    userId: string,
    target: { nodeId?: string; rawKey?: string; entityName?: string; reason?: string }
  ): Promise<CascadingDeleteResult> {
    const now = new Date().toISOString();
    const preview = await this.previewCascadingDelete(userId, target);
    const { entityName, stems, reminders, rootMemory } = preview;
    const slug = entityName.toLowerCase().replace(/[^a-z0-9]/g, '_');

    logger.info('[EntityRelationshipCorrection] Executing cascading bubble deletion', {
      userId,
      entityName,
      stemsCount: stems.length,
      remindersCount: reminders.length
    });

    try {
      // 1. Soft-tombstone all root and stem memories
      const allMemIds = stems.map(s => s.id);
      if (rootMemory) allMemIds.push(rootMemory.id);
      if (target.nodeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.nodeId)) {
        allMemIds.push(target.nodeId);
      }

      if (allMemIds.length > 0) {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'INVALIDATED',
            supersession_reason: `[Cascading Bubble Deletion] ${target.reason || `Deleted parent bubble ${entityName} and all connected stems`}`,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', allMemIds);
      }

      // Also invalidate any memories by key or value matching slug
      await supabaseAdmin
        .from('memories')
        .update({
          is_archived: true,
          lifecycle_state: 'INVALIDATED',
          supersession_reason: `[Cascading Bubble Deletion] ${target.reason || `Deleted parent bubble ${entityName}`}`,
          updated_at: now
        })
        .eq('user_id', userId)
        .or(`key.ilike.%${slug}%,value.ilike.%${entityName}%`);

      // 2. Cancel all matching reminders
      const reminderIds = reminders.map(r => r.id);
      if (reminderIds.length > 0) {
        await supabaseAdmin
          .from('reminders')
          .update({
            status: 'cancelled',
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', reminderIds);
      }

      // 3. Clear from working_memory
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .or(`key.ilike.%${slug}%,value.ilike.%${entityName}%`);

      // 4. Delete from kg_nodes and kg_edges (root and all child stems)
      const { data: matchedKgNodes } = await supabaseAdmin
        .from('kg_nodes')
        .select('id, name')
        .eq('user_id', userId)
        .or(`name.ilike.%${entityName}%,raw_key.ilike.%${slug}%${target.nodeId ? `,id.eq.${target.nodeId}` : ''}`);

      const nodeIdsToDelete = new Set((matchedKgNodes || []).map(n => n.id));
      if (target.nodeId) nodeIdsToDelete.add(target.nodeId);

      if (nodeIdsToDelete.size > 0) {
        const idList = Array.from(nodeIdsToDelete);
        const { data: childEdges } = await supabaseAdmin
          .from('kg_edges')
          .select('target_node_id')
          .eq('user_id', userId)
          .in('source_node_id', idList);

        for (const ce of (childEdges || [])) {
          if (ce.target_node_id) nodeIdsToDelete.add(ce.target_node_id);
        }

        const finalIds = Array.from(nodeIdsToDelete);
        for (const id of finalIds) {
          await supabaseAdmin.from('kg_edges').delete().eq('user_id', userId).or(`source_node_id.eq.${id},target_node_id.eq.${id}`);
          await supabaseAdmin.from('kg_nodes').delete().eq('user_id', userId).eq('id', id);
        }
      }

      // 5. Record in nova_correction_ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'cascading_bubble_delete',
          field_name: `${slug}_cascade_delete`,
          previous_value: `${entityName} (${stems.length} stems, ${reminders.length} reminders)`,
          corrected_value: '[DELETED_WITH_ALL_STEMS]',
          reason: target.reason || `Cascading delete of ${entityName}`,
          created_at: now
        });
      } catch (lErr) {
        logger.warn('[EntityRelationshipCorrection] Ledger log warning', { error: String(lErr) });
      }

      // 6. Invalidate analytics cache
      invalidateAnalyticsCache(userId);

      const message = `Permanently deleted "${entityName}" along with ${stems.length} connected stem(s) and cancelled ${reminders.length} reminder(s).`;
      return {
        success: true,
        entityName,
        deletedStemsCount: stems.length,
        cancelledRemindersCount: reminders.length,
        deletedStemNames: stems.map(s => s.value || s.key),
        cancelledReminderTexts: reminders.map(r => r.text),
        message
      };
    } catch (err: any) {
      logger.error('[EntityRelationshipCorrection] Cascading delete failed', {
        userId,
        entityName,
        error: err?.message || String(err)
      });
      return {
        success: false,
        entityName,
        deletedStemsCount: 0,
        cancelledRemindersCount: 0,
        deletedStemNames: [],
        cancelledReminderTexts: [],
        message: err?.message || 'Cascading delete failed'
      };
    }
  }

  generateCascadingDeleteReply(result: CascadingDeleteResult): string {
    const { entityName, deletedStemsCount, cancelledRemindersCount, deletedStemNames } = result;
    const stemSummary = deletedStemNames.length > 0
      ? ` (jaise ${deletedStemNames.slice(0, 2).join(', ')})`
      : '';
    const remSummary = cancelledRemindersCount > 0
      ? ` aur ${cancelledRemindersCount} connected reminder(s) cancel kar diye hain`
      : '';

    return `Done Saa! Maine ${entityName} ko delete kar diya hai, aur uske saath uske ${deletedStemsCount} connected stems${stemSummary}${remSummary}. Ab ye graph aur memory me bilkul clean hai. 👍`;
  }

  /**
   * Executes the branch severing, memory supersession, KG update, and cache invalidation.
   */
  async severAndReclassifyEntity(userId: string, correction: EntityCorrection): Promise<{ success: boolean; message: string }> {
    if (!userId || !correction) {
      return { success: false, message: 'Invalid arguments' };
    }

    const now = new Date().toISOString();
    const { entityName, newRelation, oldRelation, oldDomain, newDomain, rawText } = correction;
    const cleanEntitySlug = entityName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const newConceptSlug = newRelation.toLowerCase().replace(/[^a-z0-9]/g, '_');

    // ── Branch A: Cross-Branch Attribute Transfer (e.g. "timing of office is not 8am it of my gym time") ──
    if (correction.isAttributeTransfer) {
      const val = correction.transferredValue || entityName;
      const targetSlug = (correction.targetKey || newConceptSlug).replace(/[^a-z0-9]/g, '_');
      const newMemoryKey = targetSlug.includes('time') || targetSlug.includes('timing')
        ? targetSlug
        : `${targetSlug}_time`;
      const newMemoryValue = `${newRelation} is ${val}`;

      // 1. Supersede any old memories associated with old concept/subject (e.g. office timing = 8am)
      const { data: existingMems } = await supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type')
        .eq('user_id', userId)
        .eq('is_archived', false);

      const memsToSupersede: string[] = [];
      const oldTokens = (oldRelation || '').toLowerCase().split(/\s+/).filter(t => t.length > 2);

      for (const m of (existingMems || [])) {
        const k = (m.key || '').toLowerCase();
        const v = (m.value || '').toLowerCase();
        const matchesOld = oldTokens.some(t => k.includes(t) || v.includes(t));
        const containsVal = v.includes(val.toLowerCase()) || k.includes(val.toLowerCase());
        if (matchesOld && (containsVal || m.memory_type === oldDomain)) {
          memsToSupersede.push(m.id);
        }
      }

      if (memsToSupersede.length > 0) {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            supersession_reason: `[Attribute Transfer] Value ${val} moved from ${oldRelation || oldDomain} to ${newRelation} (${newDomain}). (${rawText})`,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', memsToSupersede);
      }

      // 2. Persist new authoritative memory under the new domain
      const { data: existingTarget } = await supabaseAdmin
        .from('memories')
        .select('id')
        .eq('user_id', userId)
        .eq('key', newMemoryKey)
        .maybeSingle();

      if (existingTarget) {
        await supabaseAdmin
          .from('memories')
          .update({
            value: newMemoryValue,
            memory_type: newDomain,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            is_archived: false,
            updated_at: now
          })
          .eq('id', existingTarget.id);
      } else {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: newMemoryKey,
            value: newMemoryValue,
            memory_type: newDomain,
            importance: 85,
            confidence: 1.0,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            created_at: now,
            updated_at: now
          });
      }

      // 3. Clear/update working_memory
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .or(`key.eq.${newMemoryKey},key.ilike.%${targetSlug}%`);

      await supabaseAdmin
        .from('working_memory')
        .insert({
          user_id: userId,
          key: newMemoryKey,
          value: newMemoryValue,
          promotion_status: 'PROMOTED',
          created_at: now
        });

      // 4. Update Knowledge Graph nodes & edges
      const parentDeptId = `dept-${newDomain}`;
      const nodeId = `mem-${newMemoryKey}`;

      await supabaseAdmin.from('kg_nodes').upsert({
        id: nodeId,
        user_id: userId,
        name: `${newRelation} (${val})`,
        department: newDomain,
        entity_type: targetSlug,
        raw_key: newMemoryKey,
        color: DOMAIN_TAXONOMY[newDomain].color,
        emoji: selectDynamicDrawerEmoji(newRelation, val, newMemoryKey, newMemoryValue),
        updated_at: now
      });

      await supabaseAdmin.from('kg_edges').delete().eq('user_id', userId).eq('target_node_id', nodeId);
      await supabaseAdmin.from('kg_edges').insert({
        user_id: userId,
        source_node_id: parentDeptId,
        target_node_id: nodeId,
        relation_type: `${targetSlug.toUpperCase()}_BRANCH`,
        weight: 2,
        created_at: now
      });

      // 5. Record in nova_correction_ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'user_attribute_transfer',
          field_name: `${newMemoryKey}_transfer`,
          previous_value: `${oldRelation || oldDomain}: ${val}`,
          corrected_value: `${newRelation} (${newDomain}): ${val}`,
          reason: rawText,
          created_at: now
        });
      } catch {}

      // 6. Invalidate analytics cache
      invalidateAnalyticsCache(userId);

      const confirmMsg = `Transferred ${val} from ${oldRelation} to ${newRelation} under ${DOMAIN_TAXONOMY[newDomain].title}.`;
      logger.info('[EntityRelationshipCorrection] Attribute transfer complete', { userId, confirmMsg });
      return { success: true, message: confirmMsg };
    }

    // ── Branch B: Universal Entity Reclassification ──
    // Generate canonical memory key according to category and domain
    let newMemoryKey = `${newConceptSlug}_${cleanEntitySlug}`;
    if (newDomain === 'work') {
      if (newConceptSlug.includes('colleague') || newConceptSlug.includes('office') || newConceptSlug.includes('coworker')) {
        newMemoryKey = `colleague_${cleanEntitySlug}`;
      } else if (newConceptSlug.includes('profession') || newConceptSlug.includes('career') || newConceptSlug.includes('job')) {
        newMemoryKey = `profession_${cleanEntitySlug}`;
      } else if (newConceptSlug.includes('stack') || newConceptSlug.includes('project') || newConceptSlug.includes('tech')) {
        newMemoryKey = `project_${cleanEntitySlug}`;
      }
    } else if (newDomain === 'family') {
      if (newConceptSlug.includes('dog') || newConceptSlug.includes('puppy')) {
        newMemoryKey = `dog_${cleanEntitySlug}`;
      } else if (newConceptSlug.includes('cat') || newConceptSlug.includes('kitten')) {
        newMemoryKey = `cat_${cleanEntitySlug}`;
      } else if (newConceptSlug.includes('pet')) {
        newMemoryKey = `pet_${cleanEntitySlug}`;
      } else if (newConceptSlug.includes('friend') || newConceptSlug.includes('dost')) {
        newMemoryKey = `friend_${cleanEntitySlug}`;
      }
    } else if (newDomain === 'lifestyle') {
      if (newConceptSlug.includes('routine') || newConceptSlug.includes('habit')) {
        newMemoryKey = `routine_${cleanEntitySlug}`;
      } else if (newConceptSlug.includes('instrument') || newConceptSlug.includes('guitar') || newConceptSlug.includes('piano')) {
        newMemoryKey = `instrument_${cleanEntitySlug}`;
      }
    }

    const newMemoryValue = `${entityName} is ${newRelation}`;

    logger.info('[EntityRelationshipCorrection] Severing old branch and reclassifying entity', {
      userId,
      entityName,
      oldRelation,
      oldDomain,
      newRelation,
      newDomain,
      newMemoryKey
    });

    try {
      // 1. Supersede any existing memories touching this entity in the old domain or matching old concept
      const { data: existingMems } = await supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type')
        .eq('user_id', userId)
        .eq('is_archived', false);

      const memsToSupersede: string[] = [];
      const oldConceptClean = (oldRelation || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const m of (existingMems || [])) {
        const k = (m.key || '').toLowerCase();
        const v = (m.value || '').toLowerCase();

        const touchesEntity = k.includes(cleanEntitySlug) || v.includes(entityName.toLowerCase()) || v.includes(cleanEntitySlug);
        const matchesOldConcept = oldConceptClean ? (k.includes(oldConceptClean) || v.includes(oldConceptClean)) : false;
        const matchesOldDomain = m.memory_type === oldDomain;

        if (touchesEntity && (matchesOldConcept || (oldDomain !== newDomain && matchesOldDomain) || (oldDomain === 'family' && (k === 'brother_name' || k.includes('family') || k.startsWith('friend_'))))) {
          memsToSupersede.push(m.id);
        }
      }

      if (memsToSupersede.length > 0) {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            supersession_reason: `[Universal Reclassification] User explicitly corrected: ${entityName} is not ${oldRelation || oldDomain}, but ${newRelation} (${newDomain}). (${rawText})`,
            updated_at: now
          })
          .eq('user_id', userId)
          .in('id', memsToSupersede);

        logger.info('[EntityRelationshipCorrection] Superseded old memories', {
          userId,
          count: memsToSupersede.length,
          ids: memsToSupersede
        });
      }

      // 2. Persist new authoritative memory under the new domain
      const { data: existingTarget } = await supabaseAdmin
        .from('memories')
        .select('id')
        .eq('user_id', userId)
        .eq('key', newMemoryKey)
        .maybeSingle();

      if (existingTarget) {
        await supabaseAdmin
          .from('memories')
          .update({
            value: newMemoryValue,
            memory_type: newDomain,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            is_archived: false,
            updated_at: now
          })
          .eq('id', existingTarget.id);
      } else {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: newMemoryKey,
            value: newMemoryValue,
            memory_type: newDomain,
            importance: 85,
            confidence: 1.0,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_authority: 'explicit_user',
            created_at: now,
            updated_at: now
          });
      }

      // 3. Clear/update working_memory
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .or(`key.eq.brother_name,key.eq.family_${cleanEntitySlug},key.eq.friend_${cleanEntitySlug},key.ilike.%${cleanEntitySlug}%`);

      await supabaseAdmin
        .from('working_memory')
        .insert({
          user_id: userId,
          key: newMemoryKey,
          value: newMemoryValue,
          promotion_status: 'PROMOTED',
          created_at: now
        });

      // 4. Update Knowledge Graph nodes & edges (if present in kg_nodes)
      const { data: matchedKgNodes } = await supabaseAdmin
        .from('kg_nodes')
        .select('id, name, department')
        .eq('user_id', userId)
        .or(`name.ilike.%${entityName}%,raw_key.ilike.%${cleanEntitySlug}%`);

      for (const kn of (matchedKgNodes || [])) {
        // Sever old edges to old department or parents
        await supabaseAdmin
          .from('kg_edges')
          .delete()
          .eq('user_id', userId)
          .or(`target_node_id.eq.${kn.id},source_node_id.eq.${kn.id}`);

        const newEmoji = selectDynamicDrawerEmoji(entityName, newRelation, newMemoryKey, newMemoryValue);

        // Update node department and metadata
        await supabaseAdmin
          .from('kg_nodes')
          .update({
            department: newDomain,
            name: `${entityName} (${newRelation})`,
            entity_type: newConceptSlug,
            color: DOMAIN_TAXONOMY[newDomain].color,
            emoji: newEmoji,
            updated_at: now
          })
          .eq('id', kn.id);

        // Add new edge from new department root
        const parentDeptId = `dept-${newDomain}`;
        await supabaseAdmin
          .from('kg_edges')
          .insert({
            user_id: userId,
            source_node_id: parentDeptId,
            target_node_id: kn.id,
            relation_type: `${newConceptSlug.toUpperCase()}_BRANCH`,
            weight: 2,
            created_at: now
          });
      }

      // 5. Record in nova_correction_ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'user_chat_entity_reclassification',
          field_name: `${cleanEntitySlug}_classification`,
          previous_value: oldRelation || oldDomain,
          corrected_value: `${newRelation} (${newDomain})`,
          reason: rawText,
          created_at: now
        });
      } catch (ledgerErr) {
        logger.warn('[EntityRelationshipCorrection] Non-fatal ledger insert warning', { error: String(ledgerErr) });
      }

      // 6. Invalidate analytics and wardrobe caches immediately
      invalidateAnalyticsCache(userId);

      const confirmMsg = `Severed ${entityName} from ${oldDomain} branch and moved to ${newRelation} under ${DOMAIN_TAXONOMY[newDomain].title}.`;
      logger.info('[EntityRelationshipCorrection] Reclassification complete', { userId, confirmMsg });

      return { success: true, message: confirmMsg };
    } catch (err: any) {
      logger.error('[EntityRelationshipCorrection] Reclassification failed', {
        userId,
        error: err?.message || String(err)
      });
      return { success: false, message: err?.message || 'Reclassification failed' };
    }
  }

  /**
   * Generates a warm, authentic, best-friend acknowledgment reply for Nova.
   */
  generateNovaReply(correction: EntityCorrection): string {
    const { entityName, newRelation, oldRelation, oldDomain, newDomain, isAttributeTransfer, transferredValue } = correction;

    if (isAttributeTransfer) {
      const val = transferredValue || entityName;
      const oldLabel = oldRelation || 'old schedule';
      const newDomainTitle = DOMAIN_TAXONOMY[newDomain]?.title || newDomain;
      return `Got it, Saa! Maine ${val} ko ${oldLabel} se hata kar tumhare ${newRelation} (${newDomainTitle}) me shift kar diya hai. 😊`;
    }

    if (newDomain === 'work' && (newRelation.toLowerCase().includes('office') || newRelation.toLowerCase().includes('colleague'))) {
      return `Got it, Saa! Maine ${entityName} ko family se hata kar tumhare office friends / work branch me shift kar diya hai. 😊`;
    }
    const oldLabel = oldRelation || oldDomain;
    const newDomainTitle = DOMAIN_TAXONOMY[newDomain]?.title || newDomain;
    return `Got it, Saa! Maine ${entityName} ko ${oldLabel} se hata kar tumhare ${newRelation} (${newDomainTitle}) me shift kar diya hai. 😊`;
  }
}

export const entityRelationshipCorrectionService = EntityRelationshipCorrectionService.getInstance();
