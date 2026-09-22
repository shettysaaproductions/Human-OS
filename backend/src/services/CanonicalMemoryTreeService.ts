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
import { isValidEntityName, inferSemanticEntityType, SemanticEntityType, normalizeRelation } from '../lib/entitySemanticValidator';
import { generateCanonicalSlug } from '../lib/indicTransliteration';

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
  entityType: SemanticEntityType | 'character' | 'project' | 'object';
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
  return generateCanonicalSlug(str);
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
  private inFlightEntityCreations = new Map<string, Promise<MemoryBubbleRecord>>();

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
    // Enforces the Limited Relations Law & Canonical Identity Invariant:
    // - "my father name is Suresh", "mere papa ka naam Suresh hai", "my mother name is Rajeshree"
    // - "mere papa bacho kapde bechte hai", "mere mummy tailor ka shop run karti hai", "papa ko call karna"
    // Always maps kinship vocatives (papa, mummy, dad, mom) to the canonical person entity (Suresh, Rajeshree)
    const isVocativeOrRoleWord = (word?: string): boolean => {
      if (!word || word.trim().length < 2) return true;
      return /^(father|papa|pitaji|dad|baap|mother|mummy|mom|maa|mataji|wife|biwi|patni|husband|pati|son|beta|daughter|beti|sister|behen|brother|bhai|uncle|aunty|bacho|chote|kapde|bechte|tailor|shop|run|doctor|engineer|lawyer|teacher|driver|businessman|officer|clerk|worker)$/i.test(word.trim());
    };

    const familyDeclarationMatch = text.match(/\b(?:my|mere|mera|meri)?\s*(father|papa|pitaji|dad|mother|mummy|mom|maa|mataji|wife|biwi|patni|husband|pati|son|beta|daughter|beti|sister|behen|brother|bhai)\s*(?:(?:'s)?\s*name\s+(?:is|hai)|(?:\s*ka|\s*ki|\s*ke)?\s*(?:name|naam)\s*(?:hai\s+)?)\s*([A-Za-z][A-Za-z0-9_-]{1,30})\b/i) ||
      text.match(/\b(?:my|mere|mera|meri)\s+(father|papa|pitaji|dad|mother|mummy|mom|maa|mataji|wife|biwi|patni|husband|pati|son|beta|daughter|beti|sister|behen|brother|bhai)\s+(?:is|hai)\s+([A-Z][a-z]{1,30})\b/);

    const isFamilyDeclaration = !!(familyDeclarationMatch && !isInvalidEntityName(familyDeclarationMatch[2]) && !isVocativeOrRoleWord(familyDeclarationMatch[2]));
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

      const knownNameFromMem = (nameMem?.value && !isInvalidEntityName(nameMem.value) && !isVocativeOrRoleWord(nameMem.value)) ? capitalizeWords(nameMem.value) : undefined;

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

      if (declaredName && !isVocativeOrRoleWord(declaredName)) {
        if (targetBubble) {
          const targetHasPersonalName = !isVocativeOrRoleWord(targetBubble.label);
          if (!targetHasPersonalName && targetBubble.label !== declaredName) {
            const newSlug = `entity:${normalizeSlug(declaredName)}`;
            await supabaseAdmin
              .from('memory_bubbles')
              .update({ label: declaredName, slug: newSlug, relation_type: canonicalRel, updated_at: new Date().toISOString() })
              .eq('id', targetBubble.id);
            targetBubble.label = declaredName;
            targetBubble.slug = newSlug;
          } else if (targetHasPersonalName && targetBubble.label.toLowerCase() !== declaredName.toLowerCase()) {
            // Register as alias on the existing proven personal entity bubble
            try {
              const canonicalEntityEngine = (await import('./CanonicalEntityEngine')).CanonicalEntityEngine.getInstance();
              await canonicalEntityEngine.registerAlias(userId, targetBubble.id, declaredName);
            } catch (err: any) {
              logger.warn('[CanonicalMemoryTree] Failed to register alias on family bubble', { error: err.message });
            }
          }
          return {
            entityId: targetBubble.slug,
            entityName: targetBubble.label,
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
      const matches: Array<{ bubble: typeof userBubbles[0]; score: number }> = [];
      for (const b of userBubbles) {
        const labelPattern = new RegExp(`\\b${b.label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i');
        if (labelPattern.test(text)) {
          let score = b.label.length;
          if (context?.domainHint && b.domain_key === context.domainHint) score += 20;
          matches.push({ bubble: b, score });
        }
      }
      if (matches.length > 0) {
        // Deterministic evidence sort with immutable UUID tie-breaker (Gate 1 & Gate 10)
        matches.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.bubble.id.localeCompare(b.bubble.id);
        });
        const best = matches[0].bubble;
        return {
          entityId: best.slug,
          entityName: best.label,
          entityType: (best.metadata?.entity_type as any) || 'person',
          domainKey: best.domain_key,
          relationType: best.relation_type || undefined,
          parentBubbleId: best.parent_bubble_id || undefined,
          bubbleId: best.id,
          isNew: false,
          confidence: 0.98,
          authority: 'EXPLICIT_USER',
          temporalState,
          isAmbiguous: false,
        };
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
   * Retrieves the user's grounded self-identity name from profile, user record, or memories.
   */
  async getUserSelfName(userId: string): Promise<string | null> {
    try {
      const [{ data: userProf }, { data: userRec }, { data: prefMem }] = await Promise.all([
        supabaseAdmin.from('profiles').select('preferred_name').eq('id', userId).maybeSingle(),
        supabaseAdmin.from('users').select('name').eq('id', userId).maybeSingle(),
        supabaseAdmin.from('memories').select('value').eq('user_id', userId).eq('key', 'preferred_name').eq('is_archived', false).maybeSingle()
      ]);
      const cand = (userProf?.preferred_name || userRec?.name || prefMem?.value || '').trim();
      return cand || null;
    } catch {
      return null;
    }
  }

  /**
   * Relationship-First Canonical Entity Resolver for Family / Kinship:
   * 1. Eliminates arbitrary PostgreSQL row-order selection (never existingSameRel[0]).
   * 2. Enforces SELF != relative entity invariant: archives any family bubble with user's verified identity name.
   * 3. Ranks candidates by:
   *    - Declared canonical name matching [rel]_name (+100)
   *    - Established semantic relationships in metadata.relationships (+50)
   *    - Memory count and confidence (+20)
   * 4. Automatically converges duplicate bubbles via atomic PostgreSQL RPC `canonical_merge_entities`.
   * 5. Sibling guard: if candidate is a distinct proper name with no alias/nickname proof (e.g. Rahul vs Amit), preserves them as separate entities.
   */
  async resolveCanonicalFamilyBubble(
    userId: string,
    relationType: string,
    candidateName?: string
  ): Promise<{ canonical: MemoryBubbleRecord | null; isNewCandidateAllowed: boolean }> {
    const relClean = relationType.trim().toLowerCase();
    const relTitle = capitalizeWords(relationType);
    const userSelfName = await this.getUserSelfName(userId);

    // 1. Fetch all active family bubbles for this relation
    const { data: allSameRel, error: fetchErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('domain_key', 'family')
      .eq('relation_type', relTitle)
      .eq('is_archived', false);

    if (fetchErr) {
      logger.warn('[CanonicalMemoryTree] Error querying same-relation family bubbles', { error: fetchErr.message });
      return { canonical: null, isNewCandidateAllowed: true };
    }

    let candidates = (allSameRel || []).filter(b => !isInvalidEntityName(b.label));

    // 2. SELF != relative entity invariant (Gate 3):
    if (userSelfName) {
      const lowerSelf = userSelfName.toLowerCase();
      const selfBubbles = candidates.filter(b => b.label.trim().toLowerCase() === lowerSelf);
      for (const sb of selfBubbles) {
        logger.warn(`[CanonicalMemoryTree] Enforcing SELF != relative invariant: archiving erroneous relative bubble "${sb.label}" (${sb.id})`);
        try {
          await supabaseAdmin
            .from('memory_bubbles')
            .update({
              is_archived: true,
              metadata: { ...(sb.metadata || {}), archive_reason: 'SELF_NOT_RELATIVE_ENTITY' },
              updated_at: new Date().toISOString()
            })
            .eq('id', sb.id);
        } catch (archErr: any) {
          logger.warn('[CanonicalMemoryTree] Failed to archive self-identity relative bubble', { error: archErr?.message });
        }
      }
      candidates = candidates.filter(b => b.label.trim().toLowerCase() !== lowerSelf);
    }

    if (candidates.length === 0) {
      return { canonical: null, isNewCandidateAllowed: true };
    }

    // 3. Fetch declared [rel]_name and [rel]_nickname from memories
    const [{ data: nameMem }, { data: nickMem }] = await Promise.all([
      supabaseAdmin.from('memories').select('value, bubble_id').eq('user_id', userId).eq('key', `${relClean}_name`).eq('is_archived', false).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabaseAdmin.from('memories').select('value, bubble_id').eq('user_id', userId).eq('key', `${relClean}_nickname`).eq('is_archived', false).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    ]);

    const declaredCanonicalName = (nameMem?.value && !isInvalidEntityName(nameMem.value)) ? nameMem.value.trim().toLowerCase() : null;
    const declaredNickname = (nickMem?.value && !isInvalidEntityName(nickMem.value)) ? nickMem.value.trim().toLowerCase() : null;

    // 4. Rank candidate bubbles based on evidence
    const scored = candidates.map(b => {
      let score = 0;
      const labelLower = b.label.trim().toLowerCase();
      const aliases: string[] = Array.isArray(b.metadata?.aliases) ? b.metadata.aliases.map((a: string) => a.toLowerCase()) : [];

      // Exact match to declared canonical name in memories
      if (declaredCanonicalName && (labelLower === declaredCanonicalName || b.id === nameMem?.bubble_id)) {
        score += 100;
      }
      // If label is declared nickname, penalize label as canonical compared to real name
      if (declaredNickname && labelLower === declaredNickname) {
        score -= 20;
      }
      // Relationships in metadata (e.g. mother, grandfather, grandmother)
      if (Array.isArray(b.metadata?.relationships) && b.metadata.relationships.length > 0) {
        score += 30 + b.metadata.relationships.length * 10;
      }
      // Has aliases
      if (aliases.length > 0) {
        score += 10;
      }
      // If candidateName matches label or alias
      if (candidateName) {
        const cLower = candidateName.trim().toLowerCase();
        if (labelLower === cLower) score += 50;
        else if (aliases.includes(cLower)) score += 40;
      }
      return { bubble: b, score };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const authRankA = AUTHORITY_RANK[a.bubble.authority as AuthorityLevel] || 0;
      const authRankB = AUTHORITY_RANK[b.bubble.authority as AuthorityLevel] || 0;
      if (authRankB !== authRankA) return authRankB - authRankA;
      return a.bubble.id.localeCompare(b.bubble.id);
    });
    const canonical = scored[0].bubble as MemoryBubbleRecord;

    // 5. Sibling Conflict Guard (Gate 6):
    // Singular roles: wife, husband, father, mother, partner (strictly 1)
    // Multiplicity-capable roles: son, daughter, child, brother, sister
    const isStrictlySingular = ['wife', 'husband', 'father', 'mother', 'partner'].includes(relClean);
    if (!isStrictlySingular && candidateName) {
      const cLower = candidateName.trim().toLowerCase();
      const canonLabelLower = canonical.label.trim().toLowerCase();
      const canonAliases: string[] = Array.isArray(canonical.metadata?.aliases) ? canonical.metadata.aliases.map((a: string) => a.toLowerCase()) : [];

      // If candidateName is neither canonical's label nor an alias:
      const matchesCanonical = cLower === canonLabelLower || canonAliases.includes(cLower);
      const isKnownNickname = (declaredNickname && cLower === declaredNickname) || (declaredCanonicalName && cLower === declaredCanonicalName);
      const canonicalIsProvisionalNickname = Boolean(declaredNickname && canonLabelLower === declaredNickname);

      if (!matchesCanonical && !isKnownNickname) {
        // If the canonical bubble is a provisional nickname bubble, AND there is no conflicting declared real name,
        // then candidateName can be the real name for this person!
        if (canonicalIsProvisionalNickname && !declaredCanonicalName) {
          return { canonical, isNewCandidateAllowed: false };
        }

        // Distinct proper names without alias evidence (e.g. Son A = Rahul, Son B = Amit)
        const isCandidateExistingBubble = candidates.some(b => b.label.trim().toLowerCase() === cLower);
        if (!isCandidateExistingBubble) {
          // This is a new distinct relative! Do NOT arbitrarily merge.
          return { canonical: null, isNewCandidateAllowed: true };
        }
      }
    }

    // 6. Automatically merge any redundant duplicate bubbles for the same canonical person (Gate 4 & 8)
    const duplicates = scored.slice(1).filter(s => {
      const bLower = s.bubble.label.trim().toLowerCase();
      const cLower = canonical.label.trim().toLowerCase();
      const cAliases: string[] = Array.isArray(canonical.metadata?.aliases) ? canonical.metadata.aliases.map((a: string) => a.toLowerCase()) : [];
      return isStrictlySingular || bLower === declaredNickname || cAliases.includes(bLower) || bLower === cLower;
    });

    if (duplicates.length > 0) {
      try {
        const canonicalEntityEngine = (await import('./CanonicalEntityEngine')).CanonicalEntityEngine.getInstance();
        for (const dup of duplicates) {
          if (dup.bubble.id !== canonical.id) {
            logger.info(`[CanonicalMemoryTree] Merging duplicate ${relTitle} bubble "${dup.bubble.label}" (${dup.bubble.id}) into canonical "${canonical.label}" (${canonical.id})`);
            await canonicalEntityEngine.mergeEntities(userId, dup.bubble.id, canonical.id);
          }
        }
        // Refresh canonical
        const { data: refreshed } = await supabaseAdmin.from('memory_bubbles').select('*').eq('id', canonical.id).single();
        if (refreshed) return { canonical: refreshed as MemoryBubbleRecord, isNewCandidateAllowed: false };
      } catch (mergeErr: any) {
        logger.warn('[CanonicalMemoryTree] Duplicate bubble merge non-fatal error', { error: mergeErr?.message });
      }
    }

    return { canonical, isNewCandidateAllowed: false };
  }

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
      entityType?: SemanticEntityType | 'character' | 'project' | 'object';
      domainKey?: LifeDomainKey;
      relationType?: string;
      parentBubbleId?: string;
      slugSuffix?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<MemoryBubbleRecord> {
    const domainKey = params.domainKey || 'family';
    let entityName = (params.entityName || '').trim();

    // Gate 4 (Case E) & Gate 11 (Test 2): Unnamed or role-based family relation entity
    // e.g. "My brother likes coffee" or "My uncle" (name is empty/unspecified or equal to relation)
    const isUnnamedRelation = !entityName || (params.relationType && entityName.toLowerCase() === params.relationType.toLowerCase());
    if (isUnnamedRelation && params.relationType) {
      entityName = capitalizeWords(params.relationType);
    } else {
      // Quality gate: Refuse to persist invalid entity names
      const check = isValidEntityName(entityName, params.entityType);
      if (!check.isValid) {
        logger.warn(`[CanonicalMemoryTree] Blocked invalid entity bubble creation for "${entityName}": ${check.reason}`);
        return this.getOrCreateDomainBubble(userId, domainKey);
      }
    }

    const domainBubble = await this.getOrCreateDomainBubble(userId, domainKey);
    const parentBubbleId = params.parentBubbleId || domainBubble.id;
    const baseSlug = normalizeSlug(entityName);
    const disambiguator = params.slugSuffix ? `_${normalizeSlug(params.slugSuffix)}` : '';
    const slug = `entity:${baseSlug}${disambiguator}`;

    // Gate 7 & Gate 11 (Test 14): Concurrency single-flight deduplication
    const inFlightKey = `${userId}:${parentBubbleId}:${slug}`;
    const existingInFlight = this.inFlightEntityCreations.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const task = this._executeResolveOrCreateEntityBubble(userId, {
      ...params,
      entityName,
      domainKey,
      parentBubbleId,
      slug,
    });
    this.inFlightEntityCreations.set(inFlightKey, task);
    try {
      return await task;
    } finally {
      this.inFlightEntityCreations.delete(inFlightKey);
    }
  }

  private async _executeResolveOrCreateEntityBubble(
    userId: string,
    params: {
      entityName: string;
      entityType?: SemanticEntityType | 'character' | 'project' | 'object';
      domainKey: LifeDomainKey;
      relationType?: string;
      parentBubbleId: string;
      slug: string;
      slugSuffix?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<MemoryBubbleRecord> {
    const { domainKey, parentBubbleId, slug, entityName } = params;

    // Identity Boundary Check: Never create a family bubble with the user's own name (Gate 3)
    if (domainKey === 'family' && params.relationType) {
      const userSelfName = await this.getUserSelfName(userId);
      if (userSelfName && entityName.toLowerCase() === userSelfName.toLowerCase()) {
        logger.warn(`[CanonicalMemoryTree] Blocked creating family relative bubble "${entityName}" matching user's own identity.`);
        try {
          await supabaseAdmin
            .from('memory_bubbles')
            .update({ is_archived: true, metadata: { archive_reason: 'SELF_NOT_RELATIVE_ENTITY' }, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('domain_key', 'family')
            .ilike('label', entityName)
            .eq('is_archived', false);
        } catch {}
        return this.getOrCreateDomainBubble(userId, 'identity');
      }

      // Relationship-First Canonical Resolution & Convergence (Gate 2, 5, 6)
      const { canonical, isNewCandidateAllowed } = await this.resolveCanonicalFamilyBubble(userId, params.relationType, entityName);
      if (canonical && !isNewCandidateAllowed) {
        const cleanCand = entityName.toLowerCase();
        const canonLabel = canonical.label.trim().toLowerCase();
        const canonAliases: string[] = Array.isArray(canonical.metadata?.aliases) ? canonical.metadata.aliases.map((a: string) => a.toLowerCase()) : [];

        if (canonLabel === cleanCand || canonAliases.includes(cleanCand)) {
          return canonical;
        }

        // If candidate is declared real name and canonical bubble was a provisional nickname, promote label!
        const { data: nameMem } = await supabaseAdmin.from('memories').select('value').eq('user_id', userId).eq('key', `${params.relationType.toLowerCase()}_name`).eq('is_archived', false).maybeSingle();
        const isDeclaredRealName = nameMem?.value && nameMem.value.trim().toLowerCase() === cleanCand;

        if (isDeclaredRealName && canonLabel !== cleanCand) {
          logger.info(`[CanonicalMemoryTree] Promoting canonical label from "${canonical.label}" to real name "${entityName}" with old label as alias`);
          const updatedAliases = Array.from(new Set([...canonAliases, canonical.label.trim()]));
          const baseSlug = normalizeSlug(entityName);
          const { data: promoted } = await supabaseAdmin
            .from('memory_bubbles')
            .update({
              label: capitalizeWords(entityName),
              slug: `entity:${baseSlug}`,
              metadata: {
                ...(canonical.metadata || {}),
                aliases: updatedAliases,
                promoted_at: new Date().toISOString()
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', canonical.id)
            .select('*')
            .single();
          if (promoted) return promoted as MemoryBubbleRecord;
        }

        // Register candidate as alias on canonical bubble
        try {
          const canonicalEntityEngine = (await import('./CanonicalEntityEngine')).CanonicalEntityEngine.getInstance();
          await canonicalEntityEngine.registerAlias(userId, canonical.id, entityName);
        } catch (aliasErr: any) {
          logger.warn('[CanonicalMemoryTree] Alias registration non-fatal error', { error: aliasErr.message });
        }
        return canonical;
      }
    }

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
      // Conflict Guard (Gate 4): Check if existing entity's relationship conflicts with requested relationType
      if (params.relationType && existing.relation_type) {
        const existingRelNorm = normalizeRelation(existing.relation_type);
        const newRelNorm = normalizeRelation(params.relationType);
        if (existingRelNorm && newRelNorm && existingRelNorm !== newRelNorm) {
          // Two different people with the same name or different relationships (e.g. Rahul son vs Rahul friend).
          // Do NOT overwrite existing entity relation!
          // Disambiguate by appending relation slug suffix and creating/resolving a distinct entity!
          logger.info(`[CanonicalMemoryTree] Disambiguating distinct entity for "${entityName}": existing has relation "${existing.relation_type}", new has "${params.relationType}"`);
          return this.resolveOrCreateEntityBubble(userId, {
            ...params,
            slugSuffix: newRelNorm,
          });
        }
      }

      // Update relationType if more specific relation provided and previously unset
      if (params.relationType && !existing.relation_type) {
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
        label: capitalizeWords(entityName),
        slug,
        bubble_type: 'entity',
        domain_key: domainKey,
        relation_type: params.relationType || null,
        metadata: {
          entity_type: params.entityType || inferSemanticEntityType(entityName, domainKey, params.relationType),
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

    // Identity boundary: User's own name, preferred name, and full name belong strictly to identity domain
    if (key === 'preferred_name' || key === 'user_name' || key === 'full_name' || key === 'name') {
      return this.getOrCreateDomainBubble(userId, 'identity');
    }

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

      // Relationship-first canonical bubble resolution (Gate 2, Gate 3, Gate 7)
      // When attr is 'nickname', 'alias', or other attributes (age, dob, etc.),
      // val is NOT an entity name candidate; it is the attribute value.
      // Therefore, candidateName should only be passed if attr is 'name' or 'real_name'.
      const isNameAttr = attr === 'name' || attr === 'real_name';
      const { canonical: targetBubble } = await this.resolveCanonicalFamilyBubble(
        userId,
        relTitle,
        isNameAttr ? val : undefined
      );

      if (attr === 'nickname' || attr === 'alias') {
        if (!isInvalidEntityName(val)) {
          if (targetBubble) {
            try {
              const canonicalEntityEngine = (await import('./CanonicalEntityEngine')).CanonicalEntityEngine.getInstance();
              await canonicalEntityEngine.registerAlias(userId, targetBubble.id, val);
            } catch (err: any) {
              logger.warn('[CanonicalMemoryTree] Failed to register alias on family bubble', { error: err.message });
            }
            const { data: refreshed } = await supabaseAdmin
              .from('memory_bubbles')
              .select('*')
              .eq('id', targetBubble.id)
              .single();
            return (refreshed || targetBubble) as MemoryBubbleRecord;
          }

          // If no family bubble exists yet, create provisional entity bubble with this nickname
          return this.resolveOrCreateEntityBubble(userId, {
            entityName: val,
            entityType: 'person',
            domainKey: 'family',
            relationType: relTitle,
          });
        }
      }

      if (attr === 'name' || attr === 'real_name') {
        if (!isInvalidEntityName(val)) {
          if (targetBubble) {
            const cleanVal = val.trim();
            if (targetBubble.label.toLowerCase() === cleanVal.toLowerCase()) {
              return targetBubble as MemoryBubbleRecord;
            }

            // Fact Ownership Correction (Gate 7):
            // Target bubble exists, but its label differs from the real name (e.g. Target is "Tiku", val is "Shreshth")!
            // PROMOTE target bubble label to the real name, and keep the previous label as an alias!
            const oldLabel = targetBubble.label.trim();
            const existingAliases: string[] = Array.isArray(targetBubble.metadata?.aliases) ? targetBubble.metadata.aliases : [];
            const newAliases = Array.from(new Set([...existingAliases, oldLabel]));
            const newSlug = `entity:${normalizeSlug(cleanVal)}`;

            logger.info(`[CanonicalMemoryTree] Promoting family bubble ${targetBubble.id} label from "${oldLabel}" to real name "${cleanVal}" with "${oldLabel}" as alias`);
            const { data: promoted } = await supabaseAdmin
              .from('memory_bubbles')
              .update({
                label: capitalizeWords(cleanVal),
                slug: newSlug,
                metadata: {
                  ...(targetBubble.metadata || {}),
                  aliases: newAliases,
                  canonical_name_promoted_at: new Date().toISOString()
                },
                updated_at: new Date().toISOString()
              })
              .eq('id', targetBubble.id)
              .select('*')
              .single();

            return (promoted || targetBubble) as MemoryBubbleRecord;
          }

          return this.resolveOrCreateEntityBubble(userId, {
            entityName: val,
            entityType: 'person',
            domainKey: 'family',
            relationType: relTitle,
          });
        }
      } else {
        // Attribute stem of family member (e.g. father_business, mother_occupation, son_birth_date, son_age)
        // Attach directly to the canonical entity bubble for this family relation!
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

  /**
   * Resolves or creates a canonical entity bubble for a specific extracted attribute/memory key.
   */
  async resolveEntityBubbleForAttribute(
    userId: string,
    key: string,
    value: string
  ): Promise<MemoryBubbleRecord> {
    return this.resolveOrCreateBubbleForMemory(userId, { key, value });
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
