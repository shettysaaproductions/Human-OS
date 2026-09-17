/**
 * ContextualEntityResolver.ts — Contextual Entity & Reference Resolution Engine (Phase 1)
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. CONTEXT CONTINUITY: Preserves conversational subject so "he", "his", "Tiku", "my son",
 *    "that place", "there" resolve to the correct entity in the existing graph.
 * 2. ENTITY OWNERSHIP: Every fact resolves to the entity it describes; domains are namespaces,
 *    never owners of entity-specific attributes.
 * 3. NO FULL-DATABASE SCANS: Candidate retrieval is strictly bounded and indexed.
 * 4. FACT / EVENT / ENTITY DISTINCTION: Discriminated typing prevents rogue nouns/verbs.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { isValidEntityName, isValidMemoryAttributeValue } from '../lib/entitySemanticValidator';
import { FactOrEntityKind, NovaProvenance } from './NovaEvent';
import { ContextEntity, EntityFocusState, NovaPipelineContext, ContextResolver } from './NovaContext';
import { MemoryEffect } from './NovaPipelineModule';

export interface SemanticTurnUnit {
  kind: FactOrEntityKind;
  subjectEntityId: string;
  subjectEntityName: string;
  predicate?: string;
  value?: string;
  relationType?: string;
  parentEntityId?: string;
  domainKey?: string;
  confidence: number;
  temporalState: 'PAST' | 'CURRENT' | 'FUTURE' | 'UNKNOWN';
  rawQuote: string;
}

export interface ContextualResolutionResult {
  primarySubjectId: string;
  primarySubjectName: string;
  detectedEntities: ContextEntity[];
  semanticUnits: SemanticTurnUnit[];
  memoryEffects: MemoryEffect[];
  updatedFocus: EntityFocusState;
  isAmbiguous: boolean;
  ambiguityReason?: string;
}

export class ContextualEntityResolver {
  private static instance: ContextualEntityResolver;

  static getInstance(): ContextualEntityResolver {
    if (!ContextualEntityResolver.instance) {
      ContextualEntityResolver.instance = new ContextualEntityResolver();
    }
    return ContextualEntityResolver.instance;
  }

  /**
   * Bounded indexed candidate retrieval from memory_bubbles.
   * NEVER performs a full-table scan.
   */
  async fetchIndexedCandidates(userId: string, tokens: string[]): Promise<ContextEntity[]> {
    if (!userId || !tokens || tokens.length === 0) return [];

    try {
      const cleanTokens = tokens
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 2 && isValidEntityName(t, 'person'));

      if (cleanTokens.length === 0) return [];

      // Query indexed slug or label using bounded candidate search
      const orConditions = cleanTokens
        .slice(0, 5)
        .map((t) => `slug.ilike.%${t}%,label.ilike.%${t}%`)
        .join(',');

      const { data, error } = await supabaseAdmin
        .from('memory_bubbles')
        .select('id, label, slug, bubble_type, domain_key, relation_type, parent_bubble_id, metadata')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .or(orConditions)
        .limit(10); // Strictly bounded limit

      if (error || !data) {
        return [];
      }

      return data.map((row: any) => {
        const meta = row.metadata || {};
        return {
          id: row.slug || `entity:${row.id}`,
          name: row.label,
          entityType: row.bubble_type === 'entity' ? 'person' : (row.bubble_type as any),
          relationToUser: row.relation_type,
          gender: meta.gender,
          aliases: Array.isArray(meta.aliases) ? meta.aliases : [],
          parentBubbleId: row.parent_bubble_id,
          domainKey: row.domain_key,
          lastMentionedAt: row.updated_at || new Date().toISOString(),
          mentionCount: meta.mention_count || 1,
        };
      });
    } catch (err: any) {
      logger.warn('[ContextualEntityResolver] Candidate query error (non-fatal)', { error: err.message });
      return [];
    }
  }

  /**
   * Main contextual resolution pass on a conversational turn.
   */
  resolveTurn(text: string, context: NovaPipelineContext): ContextualResolutionResult {
    const raw = (text || '').trim();
    const focus = context.entityFocus;
    const candidates = context.candidates?.entities || [];
    const provenance: NovaProvenance = {
      source: 'chat',
      sourceMessageId: context.turnId,
      timestamp: new Date().toISOString(),
      confidence: 1.0,
      acquisitionMode: 'user_stated',
      evidenceText: raw,
    };

    const detectedEntities: ContextEntity[] = [];
    const semanticUnits: SemanticTurnUnit[] = [];
    const memoryEffects: MemoryEffect[] = [];

    // Default subject: User identity
    let primarySubjectId = 'user:self';
    let primarySubjectName = context.userProfile?.preferredName || 'User';

    // ── 1. Check Pronoun & Contextual Reference ("he", "his", "she", "her", "that place")
    const pronounMatch = raw.match(/\b(he|him|his|she|her|woh|usne|uska|uski|that\s+place|there)\b/i);
    let antecedentEntity: ContextEntity | null = null;
    if (pronounMatch) {
      antecedentEntity = ContextResolver.resolvePronoun(pronounMatch[1], focus);
      if (antecedentEntity) {
        primarySubjectId = antecedentEntity.id;
        primarySubjectName = antecedentEntity.name;
        detectedEntities.push(antecedentEntity);
      }
    }

    // ── 2. Check Kinship / Alias Reference ("my son", "Tiku", "my wife", "mere papa")
    const kinshipMatch = raw.match(/\b(?:my|mera|meri|mere)\s+(son|beta|wife|biwi|patni|husband|pati|father|papa|dad|pitaji|mother|mom|maa|mataji|brother|bhai|sister|behen|friend|dost|dog|cat|pet)\b/i);
    if (kinshipMatch) {
      const relation = kinshipMatch[1].toLowerCase();
      const resolved = ContextResolver.resolveAliasOrRelation(relation, focus, candidates);
      if (resolved) {
        antecedentEntity = resolved;
        primarySubjectId = resolved.id;
        primarySubjectName = resolved.name;
        detectedEntities.push(resolved);
      } else {
        // Known relation but entity bubble not created yet — stage entity creation
        const entitySlug = `entity:person_${relation}`;
        const stagedEntity: ContextEntity = {
          id: entitySlug,
          name: this.capitalize(relation),
          entityType: ['dog', 'cat', 'pet'].includes(relation) ? 'pet' : 'person',
          relationToUser: relation,
          aliases: [],
          domainKey: ['dog', 'cat', 'pet'].includes(relation) ? 'lifestyle' : 'family',
          lastMentionedAt: new Date().toISOString(),
          mentionCount: 1,
        };
        detectedEntities.push(stagedEntity);
        primarySubjectId = stagedEntity.id;
        primarySubjectName = stagedEntity.name;

        memoryEffects.push({
          kind: 'ENTITY',
          action: 'create',
          subjectEntityId: stagedEntity.id,
          subjectEntityName: stagedEntity.name,
          domainKey: stagedEntity.domainKey,
          relationType: relation,
          provenance,
          confidence: 0.9,
        });
      }
    }

    // ── 3. Check Explicit Third-Party Possessive ("Ejaz's father", "Sushant ki biwi")
    const possMatch = raw.match(/\b([a-zA-Z]+)(?:'s|\s+(?:ke|ki|ka))\s+(father|mother|dad|mom|papa|maa|wife|biwi|husband|pati|brother|bhai|sister|behen|son|beta|dog|pet)\b/i);
    if (possMatch && !/^(?:my|mera|meri|mere|user)$/i.test(possMatch[1])) {
      const ownerName = this.capitalize(possMatch[1]);
      const relation = possMatch[2].toLowerCase();

      if (isValidEntityName(ownerName, 'person')) {
        const ownerId = `entity:person_${ownerName.toLowerCase()}`;
        const derivedId = `${ownerId}_${relation}`;
        const derivedName = `${ownerName}'s ${relation}`;

        const ownerEntity: ContextEntity = {
          id: ownerId,
          name: ownerName,
          entityType: 'person',
          relationToUser: 'associate_or_friend',
          aliases: [],
          domainKey: 'family',
          lastMentionedAt: new Date().toISOString(),
          mentionCount: 1,
        };
        const derivedEntity: ContextEntity = {
          id: derivedId,
          name: derivedName,
          entityType: ['dog', 'pet'].includes(relation) ? 'pet' : 'person',
          relationToUser: `third_party_${relation}`,
          aliases: [],
          parentBubbleId: ownerId,
          domainKey: 'family',
          lastMentionedAt: new Date().toISOString(),
          mentionCount: 1,
        };

        detectedEntities.push(ownerEntity, derivedEntity);
        primarySubjectId = derivedId;
        primarySubjectName = derivedName;

        memoryEffects.push(
          {
            kind: 'ENTITY',
            action: 'create',
            subjectEntityId: ownerId,
            subjectEntityName: ownerName,
            domainKey: 'family',
            relationType: 'associate_or_friend',
            provenance,
            confidence: 0.95,
          },
          {
            kind: 'ENTITY',
            action: 'create',
            subjectEntityId: derivedId,
            subjectEntityName: derivedName,
            domainKey: 'family',
            relationType: relation,
            parentBubbleId: ownerId,
            provenance,
            confidence: 0.95,
          }
        );
      }
    }

    // ── 4. Extract Attributes / Facts and enforce Strict Entity Ownership
    // Facts MUST be owned by primarySubjectId, NEVER by a domain namespace.
    this.extractFacts(raw, primarySubjectId, primarySubjectName, provenance, semanticUnits, memoryEffects);

    // ── 5. Update Entity Focus State
    let updatedFocus = focus;
    if (detectedEntities.length > 0) {
      const focal = detectedEntities[detectedEntities.length - 1];
      updatedFocus = ContextResolver.updateFocus(focus, focal);
    }

    return {
      primarySubjectId,
      primarySubjectName,
      detectedEntities,
      semanticUnits,
      memoryEffects,
      updatedFocus,
      isAmbiguous: false,
    };
  }

  /**
   * Deterministic attribute and fact extraction with quality validation.
   */
  private extractFacts(
    text: string,
    subjectEntityId: string,
    subjectEntityName: string,
    provenance: NovaProvenance,
    semanticUnits: SemanticTurnUnit[],
    memoryEffects: MemoryEffect[]
  ): void {
    // Career / Workplace: "works at Google", "kaam karta hai Microsoft me", "Navy me tha"
    const militaryMatch = text.match(/\b(?:was\s+in\s+the|served\s+in\s+the|in\s+the)\s+(navy|army|air\s*force|military)\b/i) ||
      text.match(/\b(navy|army|air\s*force)\s+me\s+(?:the|tha)\b/i);
    if (militaryMatch) {
      const branch = this.capitalize(militaryMatch[1]);
      this.pushAttribute(
        'military_service',
        branch,
        subjectEntityId,
        subjectEntityName,
        'PAST',
        text,
        provenance,
        semanticUnits,
        memoryEffects
      );
      return;
    }

    const workMatch = text.match(/\b(?:works\s+at|working\s+at|kaam\s+karta\s+hai|kaam\s+karti\s+hai)\s+([a-zA-Z0-9\s]+?)(?:\s+me|\s+as|\.|$)/i);
    if (workMatch) {
      const company = workMatch[1].trim();
      if (isValidMemoryAttributeValue('company_name', company)) {
        this.pushAttribute(
          'company_name',
          this.capitalize(company),
          subjectEntityId,
          subjectEntityName,
          'CURRENT',
          text,
          provenance,
          semanticUnits,
          memoryEffects
        );
      }
    }

    // Location / Residence: "lives in Dubai", "rehta hai Mumbai me"
    const locMatch = text.match(/\b(?:lives\s+in|living\s+in|shifted\s+to|moved\s+to)\s+([a-zA-Z\s]+?)(?:\s+with|\.|$)/i);
    if (locMatch) {
      const city = locMatch[1].trim();
      if (isValidMemoryAttributeValue('city', city)) {
        this.pushAttribute(
          'city',
          this.capitalize(city),
          subjectEntityId,
          subjectEntityName,
          'CURRENT',
          text,
          provenance,
          semanticUnits,
          memoryEffects
        );
      }
    }
  }

  private pushAttribute(
    predicate: string,
    value: string,
    subjectEntityId: string,
    subjectEntityName: string,
    temporalState: 'PAST' | 'CURRENT' | 'FUTURE' | 'UNKNOWN',
    rawQuote: string,
    provenance: NovaProvenance,
    semanticUnits: SemanticTurnUnit[],
    memoryEffects: MemoryEffect[]
  ): void {
    semanticUnits.push({
      kind: 'ATTRIBUTE',
      subjectEntityId,
      subjectEntityName,
      predicate,
      value,
      confidence: 0.95,
      temporalState,
      rawQuote,
    });

    memoryEffects.push({
      kind: 'ATTRIBUTE',
      action: 'update',
      subjectEntityId,
      subjectEntityName,
      predicate,
      value,
      provenance,
      confidence: 0.95,
    });
  }

  private capitalize(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}

export const contextualEntityResolver = ContextualEntityResolver.getInstance();
