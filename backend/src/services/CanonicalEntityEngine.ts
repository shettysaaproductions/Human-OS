/**
 * CanonicalEntityEngine.ts — Authoritative Entity Resolution, Alias Merging & Convergence Engine
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ONE CANONICAL ENTITY MODEL: Exactly ONE entity bubble per real-world subject.
 * 2. ORDER-INDEPENDENT CONVERGENCE: Permutations of facts and aliases converge to the same graph.
 * 3. SAFE RECONCILIATION: Merges provisional entities without losing facts or destroying evidence.
 * 4. STRICT FACT OWNERSHIP: All persistent facts belong to the resolved entity, never to domains.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';
import { isValidEntityName, isValidMemoryAttributeValue, inferSemanticEntityType } from '../lib/entitySemanticValidator';
import { generateCanonicalSlug, transliterateIndic } from '../lib/indicTransliteration';
import { canonicalMemoryTreeService } from './CanonicalMemoryTreeService';
import { memoryRepository } from './memoryRepository';
import { NovaProvenance } from '../pipeline/NovaEvent';
import { NovaPipelineContext } from '../pipeline/NovaContext';

export interface ResolvedCanonicalEntity {
  id: string;               // UUID of memory_bubbles row
  slug: string;             // e.g. "entity:shreshth"
  name: string;             // e.g. "Shreshth"
  entityType: string;       // "person" | "pet" | "organization" | "place" | "venture"
  relationToUser?: string;  // e.g. "Son", "Wife", "Friend"
  domainKey: string;        // "family", "work", "lifestyle", "goals", "identity"
  parentBubbleId?: string | null;
  aliases: string[];        // e.g. ["Tiku", "Tuku"]
  attributes: Record<string, string>;
  isNew: boolean;
}

export interface CanonicalRelationship {
  relationshipId: string;       // deterministic key: `${sourceEntityId}:${targetEntityId}:${relationType.toLowerCase()}`
  targetEntityId: string;
  targetEntityName: string;
  relationType: string;
  inverseRelationType?: string;
  confidence: number;
  status: 'active' | 'archived' | 'superseded';
  validFrom?: string;
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
  provenance?: {
    source: 'user_chat' | 'user_voice' | 'system_inference' | 'manual';
    turnId?: string;
    timestamp: string;
  };
}

export const INVERSE_RELATIONS: Record<string, string> = {
  father: 'child',
  mother: 'child',
  parent: 'child',
  son: 'parent',
  daughter: 'parent',
  child: 'parent',
  husband: 'wife',
  wife: 'husband',
  spouse: 'spouse',
  friend: 'friend',
  colleague: 'colleague',
  coworker: 'coworker',
  manager: 'report',
  boss: 'employee',
  mentor: 'mentee',
  brother: 'sibling',
  sister: 'sibling',
  sibling: 'sibling',
};

export class CanonicalEntityEngine {
  private static instance: CanonicalEntityEngine;
  private static _mergeLocks = new Map<string, Promise<void>>();

  static getInstance(): CanonicalEntityEngine {
    if (!CanonicalEntityEngine.instance) {
      CanonicalEntityEngine.instance = new CanonicalEntityEngine();
    }
    return CanonicalEntityEngine.instance;
  }

  /**
   * Normalizes an entity name to a canonical slug format.
   * Multi-script aware: Devanagari "साक्षी" and Latin "Sakshi" normalize to "sakshi".
   * Never produces an empty slug.
   */
  normalizeSlug(name: string): string {
    return generateCanonicalSlug(name);
  }

  /**
   * Resolves a name, nickname, alias, or kinship reference to an existing canonical entity.
   * Does NOT perform full database scans — uses indexed candidate retrieval.
   * Multi-script aware: seamlessly connects across Devanagari and Latin forms.
   */
  async resolveEntity(
    userId: string,
    nameOrAlias: string,
    context?: NovaPipelineContext
  ): Promise<ResolvedCanonicalEntity | null> {
    const raw = (nameOrAlias || '').trim();
    if (!raw) return null;
    const clean = raw.toLowerCase().replace(/^(?:my|mera|meri|mere)\s+/i, '').trim();
    const cleanSlug = `entity:${this.normalizeSlug(clean)}`;
    const transliteratedClean = transliterateIndic(clean).toLowerCase();

    // 1. Check conversational context focus (0 DB latency)
    if (context?.entityFocus) {
      const active = context.entityFocus.activeEntity;
      if (active) {
        if (
          active.name.toLowerCase() === clean ||
          transliterateIndic(active.name).toLowerCase() === transliteratedClean ||
          active.relationToUser?.toLowerCase() === clean ||
          active.aliases.some((a) => {
            const al = a.toLowerCase();
            return al === clean || al === transliteratedClean || transliterateIndic(al).toLowerCase() === transliteratedClean;
          })
        ) {
          return this.hydrateEntityFromBubbleId(userId, active.id);
        }
      }
      for (const recent of context.entityFocus.recentEntities) {
        if (
          recent.name.toLowerCase() === clean ||
          transliterateIndic(recent.name).toLowerCase() === transliteratedClean ||
          recent.relationToUser?.toLowerCase() === clean ||
          recent.aliases.some((a) => {
            const al = a.toLowerCase();
            return al === clean || al === transliteratedClean || transliterateIndic(al).toLowerCase() === transliteratedClean;
          })
        ) {
          return this.hydrateEntityFromBubbleId(userId, recent.id);
        }
      }
    }

    // 2. Query memory_bubbles by slug or label (indexed)
    try {
      const { data: directMatches } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .eq('bubble_type', 'entity')
        .or(`slug.eq.${cleanSlug},label.ilike.${clean},label.ilike.${transliteratedClean}`)
        .limit(5);

      if (directMatches && directMatches.length > 0) {
        return this.formatCanonicalEntity(directMatches[0], false);
      }

      // 3. Search inside metadata.aliases JSON array (indexed candidate retrieval)
      const { data: aliasMatches } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .eq('bubble_type', 'entity')
        .contains('metadata', { aliases: [clean] })
        .limit(5);

      if (aliasMatches && aliasMatches.length > 0) {
        return this.formatCanonicalEntity(aliasMatches[0], false);
      }

      // 4. Case-insensitive alias scan across recent entities with multi-script phonetic matching
      const { data: recentBubbles } = await supabaseAdmin
        .from('memory_bubbles')
        .select('*')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .eq('bubble_type', 'entity')
        .order('updated_at', { ascending: false })
        .limit(30);

      if (recentBubbles) {
        for (const b of recentBubbles) {
          const meta = (b.metadata as Record<string, unknown>) || {};
          const aliases: string[] = Array.isArray(meta.aliases) ? (meta.aliases as string[]) : [];
          if (aliases.some((a) => {
            const lowerA = a.toLowerCase();
            return (
              lowerA === clean ||
              lowerA === transliteratedClean ||
              this.normalizeSlug(lowerA) === this.normalizeSlug(clean) ||
              transliterateIndic(lowerA).toLowerCase() === transliteratedClean
            );
          })) {
            return this.formatCanonicalEntity(b, false);
          }
          if (b.relation_type && b.relation_type.toLowerCase() === clean) {
            return this.formatCanonicalEntity(b, false);
          }
        }
      }

      return null;
    } catch (err: any) {
      logger.warn('[CanonicalEntityEngine] Resolution error (non-fatal)', { error: err.message, userId });
      return null;
    }
  }

  /**
   * Resolves an entity or creates it canonically if not yet present.
   */
  async createOrResolveEntity(
    userId: string,
    entityName: string,
    relationType?: string,
    domainKey: string = 'family',
    context?: NovaPipelineContext
  ): Promise<ResolvedCanonicalEntity> {
    const existing = await this.resolveEntity(userId, entityName, context);
    if (existing) {
      // Update relation if more specific
      if (relationType && !existing.relationToUser) {
        await supabaseAdmin
          .from('memory_bubbles')
          .update({ relation_type: relationType, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        existing.relationToUser = relationType;
      }
      return existing;
    }

    // Inferred semantic entity type (person, pet, event, role, concept, organization)
    const inferredType = inferSemanticEntityType(entityName, domainKey, relationType);

    // Linguistic validation to prevent rogue verbs/particles
    const check = isValidEntityName(entityName, inferredType);
    if (!check.isValid) {
      logger.warn('[CanonicalEntityEngine] Blocked entity creation for invalid name', {
        name: entityName,
        reason: check.reason,
        userId,
      });
      throw new Error(`INVALID_ENTITY_NAME: ${check.reason}`);
    }

    // Create canonical bubble
    const bubbleRecord = await canonicalMemoryTreeService.resolveOrCreateEntityBubble(
      userId,
      {
        entityName,
        entityType: inferredType,
        relationType: relationType || (inferredType === 'person' ? 'Associate' : undefined),
        domainKey: domainKey as any,
      }
    );

    const formatted = this.formatCanonicalEntity(bubbleRecord, true);
    this.invalidateGraphCache(userId);
    return formatted;
  }

  /**
   * Registers an alias or nickname for an entity.
   * If a provisional entity bubble already exists for the alias, triggers safe entity merging!
   */
  async registerAlias(
    userId: string,
    canonicalEntityId: string,
    aliasName: string
  ): Promise<{ status: 'alias_added' | 'entities_merged' | 'already_exists'; targetEntity: ResolvedCanonicalEntity }> {
    const cleanAlias = (aliasName || '').trim();
    if (!cleanAlias) {
      const target = await this.hydrateEntityFromBubbleId(userId, canonicalEntityId);
      if (!target) throw new Error('TARGET_ENTITY_NOT_FOUND');
      return { status: 'already_exists', targetEntity: target };
    }

    // 1. Fetch Target Canonical Entity Bubble
    const { data: targetBubble, error: targetErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('id', canonicalEntityId)
      .eq('user_id', userId)
      .single();

    if (targetErr || !targetBubble) {
      throw new Error(`TARGET_ENTITY_NOT_FOUND: ${targetErr?.message}`);
    }

    const targetMeta = (targetBubble.metadata as Record<string, unknown>) || {};
    const targetAliases: string[] = Array.isArray(targetMeta.aliases) ? [...(targetMeta.aliases as string[])] : [];

    // 2. Check if a provisional entity bubble already exists for this alias (multi-script aware)
    const aliasSlug = `entity:${this.normalizeSlug(cleanAlias)}`;
    const transliteratedAlias = transliterateIndic(cleanAlias).toLowerCase();
    const { data: candidateSourceBubbles } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .neq('id', canonicalEntityId)
      .or(`slug.eq.${aliasSlug},label.ilike.${cleanAlias},label.ilike.${transliteratedAlias}`);

    if (candidateSourceBubbles && candidateSourceBubbles.length > 0) {
      // ORDER-INDEPENDENCE RECONCILIATION: Merge the provisional alias entity into the canonical entity!
      const sourceBubble = candidateSourceBubbles[0];
      logger.info('[CanonicalEntityEngine] Merging provisional entity into canonical entity', {
        sourceEntity: sourceBubble.label,
        targetEntity: targetBubble.label,
        userId,
      });

      await this.mergeEntities(userId, sourceBubble.id, targetBubble.id);
      const refreshedTarget = await this.hydrateEntityFromBubbleId(userId, targetBubble.id);
      return { status: 'entities_merged', targetEntity: refreshedTarget! };
    }

    // 3. If no separate bubble exists, append alias to metadata
    const exists = targetAliases.some((a) => a.toLowerCase() === cleanAlias.toLowerCase());
    if (!exists) {
      targetAliases.push(cleanAlias);
      await supabaseAdmin
        .from('memory_bubbles')
        .update({
          metadata: {
            ...targetMeta,
            aliases: targetAliases,
            last_reconciled_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', canonicalEntityId);

      this.invalidateGraphCache(userId);
      const refreshedTarget = await this.hydrateEntityFromBubbleId(userId, canonicalEntityId);
      return { status: 'alias_added', targetEntity: refreshedTarget! };
    }

    const refreshedTarget = await this.hydrateEntityFromBubbleId(userId, canonicalEntityId);
    return { status: 'already_exists', targetEntity: refreshedTarget! };
  }

  /**
   * Safely merges sourceEntity into targetEntity without data loss.
   * Exclusively leverages atomic PostgreSQL RPC transaction `canonical_merge_entities` backed by row-level locking.
   * Concurrency is serialized per user in-process while durable transaction isolation is enforced in PostgreSQL.
   */
  async mergeEntities(userId: string, sourceEntityId: string, targetEntityId: string): Promise<void> {
    if (sourceEntityId === targetEntityId) return;

    // Concurrency guard: serialize concurrent merge requests for the same user in-process
    const lockKey = userId;
    const prevLock = CanonicalEntityEngine._mergeLocks.get(lockKey) || Promise.resolve();
    let releaseLock: () => void;
    const currentLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    CanonicalEntityEngine._mergeLocks.set(lockKey, prevLock.then(() => currentLock));

    await prevLock;
    try {
      // Authoritative PostgreSQL RPC transaction
      const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('canonical_merge_entities', {
        p_user_id: userId,
        p_source_bubble_id: sourceEntityId,
        p_target_bubble_id: targetEntityId,
      });

      if (rpcErr) {
        logger.error('[CanonicalEntityEngine] Database RPC merge transaction failed', {
          error: rpcErr.message,
          userId,
          sourceEntityId,
          targetEntityId,
        });
        throw new Error(`CANONICAL_MERGE_TRANSACTION_FAILED: ${rpcErr.message}`);
      }

      if (!rpcRes || !rpcRes.success) {
        throw new Error(`CANONICAL_MERGE_REJECTED: ${JSON.stringify(rpcRes)}`);
      }

      logger.info('[CanonicalEntityEngine] Atomic DB RPC merge completed', { rpcRes, userId });
      this.invalidateGraphCache(userId);
    } finally {
      releaseLock!();
      if (CanonicalEntityEngine._mergeLocks.get(lockKey) === currentLock) {
        CanonicalEntityEngine._mergeLocks.delete(lockKey);
      }
    }
  }


  /**
   * Establishes a first-class semantic relationship between two entities.
   * Updates metadata.relationships on both entities and synchronizes kg_nodes / kg_edges.
   */
  async createOrUpdateRelationship(
    userId: string,
    sourceEntityId: string,
    targetEntityId: string,
    relationType: string,
    inverseRelationType?: string,
    provenance?: { source: 'user_chat' | 'user_voice' | 'system_inference' | 'manual'; turnId?: string; confidence?: number }
  ): Promise<CanonicalRelationship> {
    if (sourceEntityId === targetEntityId) {
      throw new Error('SELF_RELATIONSHIP_NOT_ALLOWED');
    }

    const [
      { data: sourceBubble, error: srcErr },
      { data: targetBubble, error: tgtErr }
    ] = await Promise.all([
      supabaseAdmin.from('memory_bubbles').select('*').eq('id', sourceEntityId).eq('user_id', userId).single(),
      supabaseAdmin.from('memory_bubbles').select('*').eq('id', targetEntityId).eq('user_id', userId).single()
    ]);

    if (srcErr || !sourceBubble || tgtErr || !targetBubble) {
      throw new Error(`ENTITY_NOT_FOUND_FOR_RELATIONSHIP: ${srcErr?.message || tgtErr?.message}`);
    }

    const cleanRelType = relationType.trim().toLowerCase();
    const effectiveInverse = (inverseRelationType?.trim() || INVERSE_RELATIONS[cleanRelType] || '').toLowerCase() || undefined;
    const nowIso = new Date().toISOString();
    const relConfidence = provenance?.confidence ?? 0.95;

    const relationshipId = `${sourceEntityId}:${targetEntityId}:${cleanRelType}`;
    const inverseRelationshipId = effectiveInverse ? `${targetEntityId}:${sourceEntityId}:${effectiveInverse}` : undefined;

    const sourceMeta = (sourceBubble.metadata as Record<string, any>) || {};
    const targetMeta = (targetBubble.metadata as Record<string, any>) || {};

    const sourceRels: CanonicalRelationship[] = Array.isArray(sourceMeta.relationships) ? [...sourceMeta.relationships] : [];
    const targetRels: CanonicalRelationship[] = Array.isArray(targetMeta.relationships) ? [...targetMeta.relationships] : [];

    // Upsert source -> target relationship
    const sRelObj: CanonicalRelationship = {
      relationshipId,
      targetEntityId,
      targetEntityName: targetBubble.label,
      relationType: cleanRelType,
      inverseRelationType: effectiveInverse,
      confidence: relConfidence,
      status: 'active',
      validFrom: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      provenance: {
        source: provenance?.source || 'system_inference',
        turnId: provenance?.turnId,
        timestamp: nowIso,
      },
    };

    const sIdx = sourceRels.findIndex((r) => r.relationshipId === relationshipId || (r.targetEntityId === targetEntityId && r.relationType.toLowerCase() === cleanRelType));
    if (sIdx >= 0) {
      sourceRels[sIdx] = { ...sourceRels[sIdx], ...sRelObj, createdAt: sourceRels[sIdx].createdAt || nowIso };
    } else {
      sourceRels.push(sRelObj);
    }

    // Upsert target -> source relationship if inverse exists
    if (effectiveInverse && inverseRelationshipId) {
      const tRelObj: CanonicalRelationship = {
        relationshipId: inverseRelationshipId,
        targetEntityId: sourceEntityId,
        targetEntityName: sourceBubble.label,
        relationType: effectiveInverse,
        inverseRelationType: cleanRelType,
        confidence: relConfidence,
        status: 'active',
        validFrom: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
        provenance: {
          source: provenance?.source || 'system_inference',
          turnId: provenance?.turnId,
          timestamp: nowIso,
        },
      };
      const tIdx = targetRels.findIndex((r) => r.relationshipId === inverseRelationshipId || (r.targetEntityId === sourceEntityId && r.relationType.toLowerCase() === effectiveInverse));
      if (tIdx >= 0) {
        targetRels[tIdx] = { ...targetRels[tIdx], ...tRelObj, createdAt: targetRels[tIdx].createdAt || nowIso };
      } else {
        targetRels.push(tRelObj);
      }
    }

    // Persist to memory_bubbles
    await Promise.all([
      supabaseAdmin
        .from('memory_bubbles')
        .update({ metadata: { ...sourceMeta, relationships: sourceRels }, updated_at: nowIso })
        .eq('id', sourceEntityId),
      effectiveInverse
        ? supabaseAdmin
            .from('memory_bubbles')
            .update({ metadata: { ...targetMeta, relationships: targetRels }, updated_at: nowIso })
            .eq('id', targetEntityId)
        : Promise.resolve(),
    ]);

    // Synchronize to kg_nodes (with bubble_id) and kg_edges projection
    try {
      let sourceKgId: string | null = null;
      let targetKgId: string | null = null;

      const [
        { data: sNode },
        { data: tNode }
      ] = await Promise.all([
        supabaseAdmin.from('kg_nodes').select('id').eq('user_id', userId).eq('bubble_id', sourceEntityId).maybeSingle(),
        supabaseAdmin.from('kg_nodes').select('id').eq('user_id', userId).eq('bubble_id', targetEntityId).maybeSingle()
      ]);

      if (sNode) {
        sourceKgId = sNode.id;
      } else {
        const { data: insS } = await supabaseAdmin.from('kg_nodes').insert({
          user_id: userId,
          bubble_id: sourceEntityId,
          name: sourceBubble.label,
          entity_type: sourceBubble.bubble_type === 'entity' ? ((sourceBubble.metadata as any)?.entity_type || 'person') : sourceBubble.bubble_type,
          attributes: { bubble_id: sourceEntityId, domain_key: sourceBubble.domain_key },
        }).select('id').single();
        sourceKgId = insS?.id || null;
      }

      if (tNode) {
        targetKgId = tNode.id;
      } else {
        const { data: insT } = await supabaseAdmin.from('kg_nodes').insert({
          user_id: userId,
          bubble_id: targetEntityId,
          name: targetBubble.label,
          entity_type: targetBubble.bubble_type === 'entity' ? ((targetBubble.metadata as any)?.entity_type || 'person') : targetBubble.bubble_type,
          attributes: { bubble_id: targetEntityId, domain_key: targetBubble.domain_key },
        }).select('id').single();
        targetKgId = insT?.id || null;
      }

      if (sourceKgId && targetKgId) {
        const edgeRelType = cleanRelType.toUpperCase().replace(/\s+/g, '_');
        const weight = Math.round(relConfidence * 100);

        const { data: existingEdge } = await supabaseAdmin
          .from('kg_edges')
          .select('id')
          .eq('user_id', userId)
          .eq('source_node_id', sourceKgId)
          .eq('target_node_id', targetKgId)
          .maybeSingle();

        if (existingEdge) {
          await supabaseAdmin
            .from('kg_edges')
            .update({ relation_type: edgeRelType, weight, updated_at: nowIso })
            .eq('id', existingEdge.id);
        } else {
          await supabaseAdmin.from('kg_edges').insert({
            user_id: userId,
            source_node_id: sourceKgId,
            target_node_id: targetKgId,
            relation_type: edgeRelType,
            weight,
          });
        }
      }
    } catch (kgErr: any) {
      logger.warn('[CanonicalEntityEngine] kg projection sync non-fatal warning', { error: kgErr?.message });
    }

    this.invalidateGraphCache(userId);
    logger.info('[CanonicalEntityEngine] Semantic relationship established', {
      source: sourceBubble.label,
      target: targetBubble.label,
      relationType: cleanRelType,
      inverseRelationType: effectiveInverse,
      relationshipId,
      userId,
    });

    return sRelObj;
  }

  /**
   * Attaches an attribute/fact to a canonical entity bubble.
   * Enforces strict entity ownership.
   */
  async attachFactToEntity(
    userId: string,
    entityId: string,
    predicate: string,
    value: string,
    provenance: NovaProvenance
  ): Promise<{ status: string; memoryKey: string }> {
    const check = isValidMemoryAttributeValue(predicate, value);
    if (!check.isValid) {
      logger.warn('[CanonicalEntityEngine] Blocked invalid attribute value', {
        predicate,
        value,
        reason: check.reason,
        userId,
      });
      return { status: 'rejected_invalid_value', memoryKey: predicate };
    }

    const entity = await this.hydrateEntityFromBubbleId(userId, entityId);
    if (!entity) {
      return { status: 'entity_not_found', memoryKey: predicate };
    }

    const canonicalKey = `${entity.slug}:${predicate}`;

    // Upsert into memories table foreign-keyed to bubble_id
    await memoryRepository.upsertMemory(
      userId,
      {
        key: canonicalKey,
        value,
        type: (entity.domainKey as any) || 'family',
        confidence: provenance.confidence || 0.95,
        shouldPersist: true,
        importance: 3,
        source_message_id: provenance.sourceMessageId,
        source_authority: 'explicit_user',
      },
      provenance.evidenceText || value
    );

    // Link bubble_id on the memories row
    await supabaseAdmin
      .from('memories')
      .update({ bubble_id: entityId, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('key', canonicalKey)
      .eq('is_archived', false);

    // Update entity bubble metadata attributes snapshot
    const updatedAttrs = { ...entity.attributes, [predicate]: value };
    await supabaseAdmin
      .from('memory_bubbles')
      .update({
        metadata: {
          aliases: entity.aliases,
          attributes: updatedAttrs,
          last_reconciled_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', entityId);

    this.invalidateGraphCache(userId);
    return { status: 'fact_attached', memoryKey: canonicalKey };
  }

  private async hydrateEntityFromBubbleId(userId: string, bubbleId: string): Promise<ResolvedCanonicalEntity | null> {
    const { data: bubble } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('id', bubbleId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!bubble) return null;
    return this.formatCanonicalEntity(bubble, false);
  }

  private formatCanonicalEntity(bubble: any, isNew: boolean): ResolvedCanonicalEntity {
    const meta = (bubble.metadata as Record<string, unknown>) || {};
    return {
      id: bubble.id,
      slug: bubble.slug,
      name: bubble.label,
      entityType: (meta.entity_type as string) || (bubble.bubble_type === 'entity' ? 'person' : (bubble.bubble_type as any)),
      relationToUser: bubble.relation_type || undefined,
      domainKey: bubble.domain_key,
      parentBubbleId: bubble.parent_bubble_id,
      aliases: Array.isArray(meta.aliases) ? (meta.aliases as string[]) : [],
      attributes: (meta.attributes as Record<string, string>) || {},
      isNew,
    };
  }

  public invalidateGraphCache(userId: string): void {
    const cacheKey = `${userId}:kg`;
    cache.invalidate(cacheKey);
  }
}

export const canonicalEntityEngine = CanonicalEntityEngine.getInstance();
