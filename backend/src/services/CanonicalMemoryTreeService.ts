/**
 * CanonicalMemoryTreeService.ts
 *
 * The canonical single source of truth for Nova's hierarchical memory graph.
 * Manages memory_bubbles (domain -> entity -> stem -> attribute),
 * enforces entity resolution gating, relationship ownership, stable identities,
 * authority hierarchies, and safe subtree operations.
 */

import { supabaseAdmin } from '../lib/supabase';
import { LifeDomainKey, DOMAIN_TAXONOMY } from '../lib/memoryDomains';
import { universalBranchRelocationService, BranchRelocationProposal, RelocationExecutionResult } from './UniversalBranchRelocationService';
import { logger } from '../lib/logger';
import { isValidEntityName } from '../lib/entitySemanticValidator';

export type BubbleType = 'domain' | 'entity' | 'branch' | 'attribute';

export type AuthorityLevel =
  | 'EXPLICIT_USER'
  | 'CONFIRMED_USER_CORRECTION'
  | 'DETERMINISTIC'
  | 'INFERRED'
  | 'PROPOSED';

export const AUTHORITY_RANK: Record<AuthorityLevel, number> = {
  EXPLICIT_USER: 100,
  CONFIRMED_USER_CORRECTION: 95,
  DETERMINISTIC: 90,
  INFERRED: 60,
  PROPOSED: 40,
};

export interface MemoryBubbleRecord {
  id: string;
  user_id: string;
  parent_bubble_id: string | null;
  slug: string;
  label: string;
  bubble_type: BubbleType;
  domain_key: LifeDomainKey;
  authority: AuthorityLevel;
  confidence: number;
  temporal_state: 'ACTIVE' | 'ARCHIVED' | 'SCHEDULED' | 'HISTORICAL';
  valid_from: string | null;
  valid_until: string | null;
  relation_type: string | null;
  metadata: Record<string, any>;
  is_archived: boolean;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemorySubtree {
  root: MemoryBubbleRecord;
  descendants: MemoryBubbleRecord[];
  memories: Array<{
    id: string;
    bubble_id: string;
    key: string;
    value: string;
    memory_type: string;
    importance?: number;
    confidence?: number;
    lifecycle_state?: string;
    updated_at: string;
  }>;
  reminders: Array<{
    id: string;
    bubble_id: string;
    text: string;
    trigger_at?: string;
    status: string;
  }>;
}

export interface EntityResolutionResult {
  entityId: string;
  entityName: string;
  entityType: 'person' | 'pet' | 'character' | 'project' | 'concept' | 'object';
  domainKey: LifeDomainKey;
  relationType?: string;
  parentEntityId?: string;
  parentBubbleId?: string;
  bubbleId?: string;
  isNew: boolean;
  confidence: number;
  authority: AuthorityLevel;
  temporalState: 'ACTIVE' | 'ARCHIVED' | 'SCHEDULED' | 'HISTORICAL' | 'CURRENT' | 'FUTURE' | 'UNKNOWN';
  isAmbiguous: boolean;
  clarificationQuestion?: string;
}

export type EntityResolutionGateResult = EntityResolutionResult;

function normalizeSlug(str: string): string {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function capitalizeWords(raw: string): string {
  return (raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function isInvalidEntityName(name: string): boolean {
  if (!name || name.trim().length < 2) return true;
  return !isValidEntityName(name).isValid;
}

export class CanonicalMemoryTreeService {
  private static instance: CanonicalMemoryTreeService;

  static getInstance(): CanonicalMemoryTreeService {
    if (!this.instance) {
      this.instance = new CanonicalMemoryTreeService();
    }
    return this.instance;
  }

  isInvalidEntityName(name: string): boolean {
    return isInvalidEntityName(name);
  }

  // ── 1. DOMAIN BUBBLES ────────────────────────────────────────────────────────

  /**
   * Ensures the root domain bubble (e.g. domain:family, domain:work) exists for a user.
   */
  async getOrCreateDomainBubble(userId: string, domainKey: LifeDomainKey): Promise<MemoryBubbleRecord> {
    const slug = `domain:${domainKey.toLowerCase()}`;
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .is('parent_bubble_id', null)
      .eq('slug', slug)
      .eq('is_archived', false)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (existing) return existing as MemoryBubbleRecord;

    const title = DOMAIN_TAXONOMY[domainKey]?.title || capitalizeWords(domainKey);
    const now = new Date().toISOString();

    const { data: created, error: insertErr } = await supabaseAdmin
      .from('memory_bubbles')
      .insert({
        user_id: userId,
        parent_bubble_id: null,
        label: title,
        slug,
        bubble_type: 'domain',
        domain_key: domainKey,
        relation_type: null,
        metadata: { domain: domainKey, system_generated: true },
        is_archived: false,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (insertErr) {
      // Handle concurrent insert race
      const { data: retry } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .is('parent_bubble_id', null)
        .eq('slug', slug)
        .single();
      if (retry) return retry as MemoryBubbleRecord;
      throw insertErr;
    }

    return created as MemoryBubbleRecord;
  }

  // ── 2. CANONICAL ENTITY RESOLUTION GATE ──────────────────────────────────────

  /**
   * Disambiguates an entity mention:
   * - Type: person vs pet vs character vs project vs concept/object
   * - Ownership: User -> Friend -> Friend's Father vs User -> Father
   * - Same surface name != same entity identity
   * - Antecedent / pronoun ambiguity detection
   * - Temporal state: HISTORICAL ("was in college", "used to live") vs CURRENT
   */
  async resolveEntity(
    userId: string,
    statement: string,
    context?: {
      recentMessages?: Array<{ role: string; content: string }>;
      expectedType?: string;
      domainHint?: LifeDomainKey;
    }
  ): Promise<EntityResolutionGateResult> {
    const text = statement.trim();
    const lower = text.toLowerCase();

    // A. Pronoun / Antecedent Disambiguation
    // Check if the statement relies on ambiguous pronouns ("he", "she", "they", "that guy")
    const pronounMatch = text.match(/\b(he|she|him|her|they|them|that guy|the guy|usne|woh|wo)\b/i);
    if (pronounMatch && !/^[A-Z][a-z]{2,}/.test(text)) {
      const recent = context?.recentMessages || [];
      const namedCandidates = new Set<string>();

      for (const msg of recent.slice(-8)) {
        for (const m of (msg.content || '').matchAll(/\b([A-Z][a-z]{2,30})\b/g)) {
          const candidate = m[1];
          if (!/^(Nova|You|I|The|This|That|Wait|Actually|Sure|Yes|No|What|Where|When|Why|How)$/i.test(candidate)) {
            namedCandidates.add(capitalizeWords(candidate));
          }
        }
      }

      if (namedCandidates.size > 1) {
        // AMBIGUOUS PRONOUN: Multiple possible antecedents. DO NOT MUTATE CANONICAL STATE!
        const list = Array.from(namedCandidates).join(' or ');
        return {
          entityId: 'ambiguous',
          entityName: pronounMatch[1],
          entityType: 'person',
          domainKey: 'family',
          confidence: 0.2,
          authority: 'PROPOSED',
          isNew: false,
          temporalState: 'UNKNOWN',
          isAmbiguous: true,
          clarificationQuestion: `Did you mean ${list}?`,
        };
      }
    }

    // B. Temporal Validity Detection
    const isHistorical = /\b(was|used to|pehle|purana|ex-|former|in college|past)\b/i.test(lower);
    const isFuture = /\b(will|going to|planning to|joining next month|aage)\b/i.test(lower);
    const temporalState = isHistorical ? 'HISTORICAL' : isFuture ? 'FUTURE' : 'CURRENT';

    // C. Entity Type & Domain Classification
    let entityType: EntityResolutionGateResult['entityType'] = 'person';
    let domainKey: LifeDomainKey = 'family';
    let relationType: string | undefined;

    // Pattern 1: Nested third-party relationship: e.g. "Ijaz's father Suresh", "Sushant's wife", "Friend's dog"
    const thirdPartyMatch = text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})'s\s+(father|mother|wife|husband|brother|sister|son|daughter|dog|cat|pet|friend|manager|boss)\b(?:\s+(?:named|called)?\s*([A-Za-z][A-Za-z0-9_-]{1,30}))?/i) ||
      text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:ke|ki|ka)\s+(papa|father|mummy|mother|biwi|wife|pati|husband|bhai|brother|behen|sister|kutta|dog|billi|cat|dost|friend)\b(?:\s+([A-Za-z][A-Za-z0-9_-]{1,30}))?/i);

    if (thirdPartyMatch) {
      const owner = capitalizeWords(thirdPartyMatch[1]);
      const rawRel = thirdPartyMatch[2].toLowerCase();
      const directName = thirdPartyMatch[3] ? capitalizeWords(thirdPartyMatch[3]) : undefined;

      const isPet = /dog|cat|kutta|billi|pet/i.test(rawRel);
      entityType = isPet ? 'pet' : 'person';
      relationType = rawRel;
      domainKey = 'family';

      const entityName = directName || `${owner}'s ${capitalizeWords(rawRel)}`;
      const entitySlug = `entity:${normalizeSlug(owner)}_${normalizeSlug(rawRel)}${directName ? `_${normalizeSlug(directName)}` : ''}`;

      // Check if parent entity bubble exists
      const { data: parentBubble } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .ilike('label', owner)
        .eq('is_archived', false)
        .maybeSingle();

      const parentBubbleId = parentBubble?.id;

      // Check if child entity bubble already exists
      const { data: existingChild } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('slug', entitySlug)
        .eq('is_archived', false)
        .maybeSingle();

      return {
        entityId: entitySlug,
        entityName,
        entityType,
        domainKey,
        relationType,
        parentEntityId: parentBubble?.slug || `entity:${normalizeSlug(owner)}`,
        parentBubbleId,
        bubbleId: existingChild?.id,
        isNew: !existingChild,
        confidence: 0.95,
        authority: 'EXPLICIT_USER',
        temporalState,
        isAmbiguous: false,
      };
    }

    // Pattern 1.5: Direct User Family Member Kinship & Name Resolution
    // Enforces the Limited Relations Law:
    // - "my father name is Suresh", "mere papa ka naam Suresh hai", "my mother name is Rajeshree"
    // - "mere papa bacho kapde bechte hai", "mere mummy tailor ka shop run karti hai", "papa ko call karna"
    // Always maps kinship vocatives (papa, mummy, dad, mom) to the canonical person entity (Suresh, Rajeshree)
    const familyDeclarationMatch = text.match(/\b(?:my|mere|mera|meri)?\s*(father|papa|pitaji|dad|mother|mummy|mom|maa|mataji|wife|biwi|patni|husband|pati|son|beta|daughter|beti|sister|behen|brother|bhai)\s*(?:(?:'s)?\s*name\s+(?:is|hai)|(?:\s*ka|\s*ki|\s*ke)?\s*(?:name|naam)\s*(?:hai\s+)?|\s+is\s+|\s+hai\s+)\s*([A-Za-z][A-Za-z0-9_-]{1,30})\b/i);

    const isFamilyDeclaration = !!(familyDeclarationMatch && !isInvalidEntityName(familyDeclarationMatch[2]));
    const matchedFamilyRole = isFamilyDeclaration
      ? familyDeclarationMatch[1].toLowerCase()
      : (/\b(papa|pitaji|dad|baap|father)\b/i.test(lower) ? 'father'
        : /\b(mummy|mom|maa|mataji|mother)\b/i.test(lower) ? 'mother'
        : /\b(biwi|patni|wife)\b/i.test(lower) ? 'wife'
        : /\b(pati|husband)\b/i.test(lower) ? 'husband'
        : /\b(beta|son)\b/i.test(lower) ? 'son'
        : /\b(beti|daughter)\b/i.test(lower) ? 'daughter'
        : /\b(bhai|bhaiya|brother)\b/i.test(lower) ? 'brother'
        : /\b(behen|didi|sister)\b/i.test(lower) ? 'sister'
        : undefined);

    if (matchedFamilyRole) {
      const canonicalRel = matchedFamilyRole === 'papa' || matchedFamilyRole === 'pitaji' || matchedFamilyRole === 'dad' || matchedFamilyRole === 'baap' ? 'Father'
        : matchedFamilyRole === 'mummy' || matchedFamilyRole === 'mom' || matchedFamilyRole === 'maa' || matchedFamilyRole === 'mataji' ? 'Mother'
        : matchedFamilyRole === 'biwi' || matchedFamilyRole === 'patni' ? 'Wife'
        : matchedFamilyRole === 'pati' ? 'Husband'
        : matchedFamilyRole === 'beta' ? 'Son'
        : matchedFamilyRole === 'beti' ? 'Daughter'
        : matchedFamilyRole === 'bhai' || matchedFamilyRole === 'bhaiya' ? 'Brother'
        : matchedFamilyRole === 'behen' || matchedFamilyRole === 'didi' ? 'Sister'
        : capitalizeWords(matchedFamilyRole);

      const declaredName = isFamilyDeclaration ? capitalizeWords(familyDeclarationMatch![2]) : undefined;

      // 1. Check existing active bubbles in family domain for this relation
      const { data: existingFamilyBubbles } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('domain_key', 'family')
        .eq('relation_type', canonicalRel)
        .eq('is_archived', false);

      let targetBubble = existingFamilyBubbles?.find(b => !isInvalidEntityName(b.label));

      // Also check if [rel]_name exists in memories
      const { data: nameMem } = await supabaseAdmin
        .from('memories')
        .select('value, bubble_id')
        .eq('user_id', userId)
        .eq('key', `${canonicalRel.toLowerCase()}_name`)
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const knownNameFromMem = (nameMem?.value && !isInvalidEntityName(nameMem.value)) ? capitalizeWords(nameMem.value) : undefined;

      if (!targetBubble && knownNameFromMem) {
        const { data: bubbleByName } = await supabaseAdmin
          .from('memory_bubbles')
          .select('*')
          .eq('user_id', userId)
          .eq('domain_key', 'family')
          .ilike('label', knownNameFromMem)
          .eq('is_archived', false)
          .maybeSingle();
        if (bubbleByName) targetBubble = bubbleByName as MemoryBubbleRecord;
      }

      if (declaredName) {
        if (targetBubble) {
          if (targetBubble.label !== declaredName) {
            const newSlug = `entity:${normalizeSlug(declaredName)}`;
            await supabaseAdmin
              .from('memory_bubbles')
              .update({ label: declaredName, slug: newSlug, relation_type: canonicalRel, updated_at: new Date().toISOString() })
              .eq('id', targetBubble.id);
            targetBubble.label = declaredName;
            targetBubble.slug = newSlug;
          }
          return {
            entityId: targetBubble.slug,
            entityName: declaredName,
            entityType: 'person',
            domainKey: 'family',
            relationType: canonicalRel,
            bubbleId: targetBubble.id,
            isNew: false,
            confidence: 0.99,
            authority: 'EXPLICIT_USER',
            temporalState,
            isAmbiguous: false,
          };
        } else {
          const created = await this.resolveOrCreateEntityBubble(userId, {
            entityName: declaredName,
            entityType: 'person',
            domainKey: 'family',
            relationType: canonicalRel,
          });
          return {
            entityId: created.slug,
            entityName: declaredName,
            entityType: 'person',
            domainKey: 'family',
            relationType: canonicalRel,
            bubbleId: created.id,
            isNew: true,
            confidence: 0.99,
            authority: 'EXPLICIT_USER',
            temporalState,
            isAmbiguous: false,
          };
        }
      } else if (targetBubble) {
        return {
          entityId: targetBubble.slug,
          entityName: targetBubble.label,
          entityType: 'person',
          domainKey: 'family',
          relationType: canonicalRel,
          bubbleId: targetBubble.id,
          isNew: false,
          confidence: 0.98,
          authority: 'EXPLICIT_USER',
          temporalState,
          isAmbiguous: false,
        };
      } else if (knownNameFromMem) {
        const created = await this.resolveOrCreateEntityBubble(userId, {
          entityName: knownNameFromMem,
          entityType: 'person',
          domainKey: 'family',
          relationType: canonicalRel,
        });
        return {
          entityId: created.slug,
          entityName: knownNameFromMem,
          entityType: 'person',
          domainKey: 'family',
          relationType: canonicalRel,
          bubbleId: created.id,
          isNew: false,
          confidence: 0.95,
          authority: 'EXPLICIT_USER',
          temporalState,
          isAmbiguous: false,
        };
      }
    }

    // Pattern 2: Project / Fictional Character
    // e.g. "Ramesh is a character in my short film", "Bruno is the dog character in my film"
    const characterMatch = text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:is|was|will be)\s+(?:a|the)?\s*(?:fictional\s+)?(?:character|hero|villain|lead|protagonist)\s+(?:in|for|of)\s+(?:my|the)?\s*([a-zA-Z0-9_ -]+)/i) ||
      text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:short\s+film|script|film|project|story)\s+(?:ka|ki|ke|me)\s+(?:character|hero|role)/i);

    if (characterMatch) {
      const entityName = capitalizeWords(characterMatch[1]);
      const project = characterMatch[2] ? capitalizeWords(characterMatch[2].trim()) : 'Project';
      entityType = 'character';
      domainKey = 'work';
      relationType = `Character (${project})`;

      const entitySlug = `entity:work_${normalizeSlug(entityName)}_character`;
      const { data: existing } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('slug', entitySlug)
        .eq('is_archived', false)
        .maybeSingle();

      return {
        entityId: entitySlug,
        entityName,
        entityType,
        domainKey,
        relationType,
        bubbleId: existing?.id,
        isNew: !existing,
        confidence: 0.95,
        authority: 'EXPLICIT_USER',
        temporalState,
        isAmbiguous: false,
      };
    }

    // Pattern 3: Pet revelation
    // e.g. "Bruno is my dog", "Simba is my cat", "Bruno mera kutta hai"
    const petMatch = text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:is|was)\s+(?:my|our)?\s*(dog|cat|puppy|kitten|pet|golden retriever|labrador|pug)\b/i) ||
      text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:mera|meri|humara)\s+(kutta|billi|pet|dog|cat)\b/i);

    if (petMatch) {
      const entityName = capitalizeWords(petMatch[1]);
      const petKind = /cat|kitten|billi/i.test(petMatch[2]) ? 'Pet Cat' : 'Pet Dog';
      entityType = 'pet';
      domainKey = 'family';
      relationType = petKind;

      const entitySlug = `entity:pet_${normalizeSlug(entityName)}`;
      const { data: existing } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('slug', entitySlug)
        .eq('is_archived', false)
        .maybeSingle();

      return {
        entityId: entitySlug,
        entityName,
        entityType,
        domainKey,
        relationType,
        bubbleId: existing?.id,
        isNew: !existing,
        confidence: 0.95,
        authority: 'EXPLICIT_USER',
        temporalState,
        isAmbiguous: false,
      };
    }

    // Pattern 4: Project / Object / Concept
    // e.g. "Guitar is my instrument", "Guitar is the name of my project", "HumanOS is my startup"
    const projectMatch = text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:is|was)\s+(?:the\s+name\s+of\s+my|my)\s+(project|startup|venture|film|app|company)\b/i);
    if (projectMatch) {
      const entityName = capitalizeWords(projectMatch[1]);
      entityType = 'project';
      domainKey = 'work';
      relationType = capitalizeWords(projectMatch[2]);

      const entitySlug = `entity:project_${normalizeSlug(entityName)}`;
      const { data: existing } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('slug', entitySlug)
        .eq('is_archived', false)
        .maybeSingle();

      return {
        entityId: entitySlug,
        entityName,
        entityType,
        domainKey,
        relationType,
        bubbleId: existing?.id,
        isNew: !existing,
        confidence: 0.95,
        authority: 'EXPLICIT_USER',
        temporalState,
        isAmbiguous: false,
      };
    }

    // Pattern 5: Direct Human / Relationship
    // e.g. "Ramesh is my friend", "Sita is my mother", "Rahul is my colleague"
    const relMatch = text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:is|was)\s+(?:my|our)?\s*(friend|colleague|mentor|brother|sister|father|mother|wife|husband|boss|manager|doctor|lawyer|dost|bhai|behen)\b/i) ||
      text.match(/\b([A-Za-z][A-Za-z0-9_-]{1,30})\s+(?:mera|meri)\s+(dost|friend|bhai|behen|colleague)\b/i);

    if (relMatch) {
      const entityName = capitalizeWords(relMatch[1]);
      const rawRel = relMatch[2].toLowerCase();
      relationType = /colleague|boss|manager/i.test(rawRel) ? 'Colleague' : /friend|dost/i.test(rawRel) ? 'Friend' : capitalizeWords(rawRel);
      domainKey = /colleague|boss|manager/i.test(rawRel) ? 'work' : 'family';
      entityType = 'person';

      const entitySlug = `entity:${normalizeSlug(entityName)}`;
      const { data: existing } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('slug', entitySlug)
        .eq('is_archived', false)
        .maybeSingle();

      return {
        entityId: entitySlug,
        entityName,
        entityType,
        domainKey,
        relationType,
        bubbleId: existing?.id,
        isNew: !existing,
        confidence: 0.95,
        authority: 'EXPLICIT_USER',
        temporalState,
        isAmbiguous: false,
      };
    }

    // Check if an existing active entity bubble for this user is mentioned
    const { data: userBubbles } = await supabaseAdmin
      .from('memory_bubbles')
      .select('id, label, slug, domain_key, relation_type, parent_bubble_id, metadata')
      .eq('user_id', userId)
      .eq('bubble_type', 'entity')
      .eq('is_archived', false);

    if (userBubbles && userBubbles.length > 0) {
      for (const b of userBubbles) {
        const labelPattern = new RegExp(`\\b${b.label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
        if (labelPattern.test(text)) {
          return {
            entityId: b.slug,
            entityName: b.label,
            entityType: (b.metadata?.entity_type as any) || 'person',
            domainKey: b.domain_key,
            relationType: b.relation_type || undefined,
            parentBubbleId: b.parent_bubble_id || undefined,
            bubbleId: b.id,
            isNew: false,
            confidence: 0.98,
            authority: 'EXPLICIT_USER',
            temporalState,
            isAmbiguous: false,
          };
        }
      }
    }

    // Contextual Action/Preposition match (e.g. "Call Ramesh", "Meet Priya", "Discuss with Vikram")
    const actionMatch = text.match(/\b(?:call|meet|tell|ask|email|message|talk\s+to|discuss\s+with|visit|remind|about|with|for|named|called)\s+([A-Za-z][A-Za-z0-9_-]{1,30})\b/i);
    let fallbackName = 'Entity';
    if (actionMatch && !isInvalidEntityName(actionMatch[1])) {
      fallbackName = capitalizeWords(actionMatch[1]);
    } else {
      for (const match of text.matchAll(/\b([A-Z][a-z]{2,30})\b/g)) {
        if (!isInvalidEntityName(match[1])) {
          fallbackName = capitalizeWords(match[1]);
          break;
        }
      }
    }

    const fallbackSlug = `entity:${normalizeSlug(fallbackName)}`;

    const { data: existing } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('slug', fallbackSlug)
      .eq('is_archived', false)
      .maybeSingle();

    return {
      entityId: fallbackSlug,
      entityName: fallbackName,
      entityType: 'person',
      domainKey: context?.domainHint || (existing?.domain_key as LifeDomainKey) || 'lifestyle',
      relationType: existing?.relation_type || undefined,
      bubbleId: existing?.id,
      isNew: !existing,
      confidence: fallbackName !== 'Entity' ? 0.8 : 0.4,
      authority: 'INFERRED',
      temporalState,
      isAmbiguous: false,
    };
  }

  // ── 3. RESOLVE OR CREATE ENTITY BUBBLE ───────────────────────────────────────

  /**
   * Resolves an entity bubble, or creates it safely with proper parent hierarchy.
   * Enforces:
   * - No duplicate active bubbles for same user + slug + parent.
   * - Segregation of same name in different domains (e.g. Ramesh friend vs Ramesh character).
   */
  async resolveOrCreateEntityBubble(
    userId: string,
    params: {
      entityName: string;
      entityType?: 'person' | 'pet' | 'character' | 'project' | 'concept' | 'object';
      domainKey?: LifeDomainKey;
      relationType?: string;
      parentBubbleId?: string;
      slugSuffix?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<MemoryBubbleRecord> {
    const domainKey = params.domainKey || 'family';
    const domainBubble = await this.getOrCreateDomainBubble(userId, domainKey);
    const parentBubbleId = params.parentBubbleId || domainBubble.id;

    // Quality gate: Refuse to persist invalid entity names
    const check = isValidEntityName(params.entityName, params.entityType);
    if (!check.isValid) {
      logger.warn(`[CanonicalMemoryTree] Blocked invalid entity bubble creation for "${params.entityName}": ${check.reason}`);
      return domainBubble;
    }

    const baseSlug = normalizeSlug(params.entityName);
    const disambiguator = params.slugSuffix ? `_${normalizeSlug(params.slugSuffix)}` : '';
    const slug = `entity:${baseSlug}${disambiguator}`;

    // 1. Check existing active bubble
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('parent_bubble_id', parentBubbleId)
      .eq('slug', slug)
      .eq('is_archived', false)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (existing) {
      // Update relationType if more specific relation provided
      if (params.relationType && existing.relation_type !== params.relationType) {
        const { data: updated } = await supabaseAdmin
          .from('memory_bubbles')
          .update({
            relation_type: params.relationType,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('*')
          .single();
        if (updated) return updated as MemoryBubbleRecord;
      }
      return existing as MemoryBubbleRecord;
    }

    // 2. Create new entity bubble under parent
    const now = new Date().toISOString();
    const { data: created, error: insertErr } = await supabaseAdmin
      .from('memory_bubbles')
      .insert({
        user_id: userId,
        parent_bubble_id: parentBubbleId,
        label: capitalizeWords(params.entityName),
        slug,
        bubble_type: 'entity',
        domain_key: domainKey,
        relation_type: params.relationType || null,
        metadata: {
          entity_type: params.entityType || 'person',
          ...(params.metadata || {}),
        },
        is_archived: false,
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (insertErr) {
      // Handle unique race condition
      const { data: raceExisting } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('parent_bubble_id', parentBubbleId)
        .eq('slug', slug)
        .single();
      if (raceExisting) return raceExisting as MemoryBubbleRecord;
      throw insertErr;
    }

    return created as MemoryBubbleRecord;
  }

  // ── 4. AUTOMATIC BUBBLE RESOLUTION FOR NORMAL MEMORY INSERTION ───────────────

  /**
   * Called by memoryRepository._upsertMemoryImpl:
   * Maps an incoming extracted memory to its canonical bubble.
   * Ensures NO flat memories are created without bubble_id.
   */
  async resolveOrCreateBubbleForMemory(
    userId: string,
    memory: {
      key: string;
      value: string;
      type?: string;
    },
    sourceMessage?: string
  ): Promise<MemoryBubbleRecord> {
    const key = String(memory.key || '').toLowerCase().trim();
    const val = String(memory.value || '').trim();
    const domainKey = (memory.type as LifeDomainKey) || 'lifestyle';

    // Check if the memory references an explicit entity
    // e.g. "friend_ramesh", "ramesh_location", "pet_bruno", "project_shortfilm"
    let entityNameCandidate: string | null = null;
    let relationCandidate: string | undefined;
    let entityTypeCandidate: 'person' | 'pet' | 'character' | 'project' | 'concept' = 'person';

    const friendMatch = key.match(/^friend_([a-z0-9_]+)$/);
    const familyMatch = key.match(/^(?:father|mother|wife|husband|brother|sister|son|daughter)_(.+)$/);
    const entityPropMatch = key.match(/^entity:([a-z0-9_]+):/);
    const prefixMatch = key.match(/^([a-z0-9_]+)_(?:location|occupation|city|work|job|age|phone|birthday|hobby)$/);

    if (friendMatch) {
      if (!isInvalidEntityName(val)) {
        entityNameCandidate = val;
        relationCandidate = 'Friend';
      }
    } else if (familyMatch) {
      const rel = key.split('_')[0].toLowerCase();
      const attr = familyMatch[1].toLowerCase();
      const relTitle = capitalizeWords(rel);

      if (attr === 'name' || attr === 'real_name') {
        if (!isInvalidEntityName(val)) {
          return this.resolveOrCreateEntityBubble(userId, {
            entityName: val,
            entityType: 'person',
            domainKey: 'family',
            relationType: relTitle,
          });
        }
      } else {
        // Attribute stem of family member (e.g. father_business, mother_occupation)
        // Attach directly to the existing entity bubble for this family relation!
        const { data: existingFamilyBubbles } = await supabaseAdmin
          .from('memory_bubbles')
          .select('*')
          .eq('user_id', userId)
          .eq('domain_key', 'family')
          .eq('relation_type', relTitle)
          .eq('is_archived', false);

        const targetBubble = existingFamilyBubbles?.find(b => !isInvalidEntityName(b.label));
        if (targetBubble) {
          return targetBubble as MemoryBubbleRecord;
        }

        // Also check if [rel]_name exists in memories
        const { data: nameMem } = await supabaseAdmin
          .from('memories')
          .select('value, bubble_id')
          .eq('user_id', userId)
          .eq('key', `${rel}_name`)
          .eq('is_archived', false)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const entityLabel = (nameMem?.value && !isInvalidEntityName(nameMem.value)) ? capitalizeWords(nameMem.value) : relTitle;
        return this.resolveOrCreateEntityBubble(userId, {
          entityName: entityLabel,
          entityType: 'person',
          domainKey: 'family',
          relationType: relTitle,
        });
      }
    } else if (entityPropMatch) {
      entityNameCandidate = entityPropMatch[1];
    } else if (prefixMatch) {
      entityNameCandidate = prefixMatch[1];
    } else if (sourceMessage) {
      // Use statement resolution
      const resolved = await this.resolveEntity(userId, sourceMessage, { domainHint: domainKey });
      if (resolved.entityName && resolved.entityName !== 'Entity' && !resolved.isAmbiguous) {
        entityNameCandidate = resolved.entityName;
        relationCandidate = resolved.relationType;
        entityTypeCandidate = resolved.entityType as any;
      }
    }

    if (entityNameCandidate && entityNameCandidate.length >= 2 && !/^(user|self|system)$/i.test(entityNameCandidate)) {
      return this.resolveOrCreateEntityBubble(userId, {
        entityName: entityNameCandidate,
        entityType: entityTypeCandidate,
        domainKey,
        relationType: relationCandidate,
      });
    }

    // Default: Assign to the domain bubble
    return this.getOrCreateDomainBubble(userId, domainKey);
  }

  // ── 5. SUBTREE RETRIEVAL ─────────────────────────────────────────────────────

  /**
   * Retrieves an entire subtree: root bubble + all descendant bubbles + all memories + all reminders.
   */
  async getSubtree(userId: string, rootBubbleId: string): Promise<MemorySubtree | null> {
    const { data: root, error: rootErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('id', rootBubbleId)
      .maybeSingle();

    if (rootErr || !root) return null;

    // Fetch all descendants recursively
    const { data: allBubbles, error: allErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false);

    if (allErr) throw allErr;

    const descendantIds = new Set<string>();
    const toProcess = [rootBubbleId];

    while (toProcess.length > 0) {
      const curr = toProcess.pop()!;
      for (const b of allBubbles || []) {
        if (b.parent_bubble_id === curr && !descendantIds.has(b.id)) {
          descendantIds.add(b.id);
          toProcess.push(b.id);
        }
      }
    }

    const allBubbleIds = [rootBubbleId, ...Array.from(descendantIds)];
    const descendants = (allBubbles || []).filter(b => descendantIds.has(b.id)) as MemoryBubbleRecord[];

    // Fetch memories attached to any bubble in this subtree
    const { data: memories, error: memErr } = await supabaseAdmin
      .from('memories')
      .select('id, bubble_id, key, value, memory_type, importance, confidence, lifecycle_state, updated_at')
      .eq('user_id', userId)
      .in('bubble_id', allBubbleIds)
      .eq('is_archived', false);

    if (memErr) throw memErr;

    // Fetch reminders attached to any bubble in this subtree
    const { data: reminders, error: remErr } = await supabaseAdmin
      .from('reminders')
      .select('id, bubble_id, text, trigger_at, status')
      .eq('user_id', userId)
      .in('bubble_id', allBubbleIds)
      .neq('status', 'cancelled')
      .neq('status', 'completed');

    if (remErr) throw remErr;

    return {
      root: root as MemoryBubbleRecord,
      descendants,
      memories: memories || [],
      reminders: reminders || [],
    };
  }

  // ── 6. ATTACH REMINDER TO BUBBLE ─────────────────────────────────────────────

  /**
   * Automatically resolves an entity mentioned in a reminder and links reminder.bubble_id.
   */
  async attachReminderToEntity(userId: string, reminderId: string, reminderText: string): Promise<string | null> {
    const resolved = await this.resolveEntity(userId, reminderText);
    if (resolved.isAmbiguous || !resolved.entityName || resolved.entityName === 'Entity') {
      return null;
    }

    const bubble = await this.resolveOrCreateEntityBubble(userId, {
      entityName: resolved.entityName,
      entityType: resolved.entityType,
      domainKey: resolved.domainKey,
      relationType: resolved.relationType,
    });

    await supabaseAdmin
      .from('reminders')
      .update({ bubble_id: bubble.id, updated_at: new Date().toISOString() })
      .eq('id', reminderId)
      .eq('user_id', userId);

    return bubble.id;
  }

  // ── 7. SUBTREE RELOCATION & RECLASSIFICATION ─────────────────────────────────

  async moveSubtree(userId: string, proposal: BranchRelocationProposal): Promise<RelocationExecutionResult> {
    return universalBranchRelocationService.executeBranchRelocation(userId, proposal);
  }

  // ── 8. SUBTREE ARCHIVAL ──────────────────────────────────────────────────────

  async archiveSubtree(userId: string, rootBubbleId: string, reason: string): Promise<{ archivedBubbles: number; archivedMemories: number }> {
    const subtree = await this.getSubtree(userId, rootBubbleId);
    if (!subtree) return { archivedBubbles: 0, archivedMemories: 0 };

    const bubbleIds = [subtree.root.id, ...subtree.descendants.map(d => d.id)];
    const now = new Date().toISOString();

    await supabaseAdmin
      .from('memory_bubbles')
      .update({ is_archived: true, updated_at: now, metadata: { archive_reason: reason } })
      .eq('user_id', userId)
      .in('id', bubbleIds);

    await supabaseAdmin
      .from('memories')
      .update({ is_archived: true, lifecycle_state: 'ARCHIVED', updated_at: now, supersession_reason: reason })
      .eq('user_id', userId)
      .in('bubble_id', bubbleIds);

    return {
      archivedBubbles: bubbleIds.length,
      archivedMemories: subtree.memories.length,
    };
  }
}

export const canonicalMemoryTreeService = CanonicalMemoryTreeService.getInstance();
