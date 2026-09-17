/**
 * CanonicalGraphService.ts — Authoritative Knowledge Graph Service (Phase 2)
 *
 * ARCHITECTURAL INVARIANTS:
 * 1. ONE CANONICAL GRAPH: Directly visualizes memory_bubbles (entities) and memories (attributes).
 * 2. ZERO HARDCODED NAMES: No regexes or special cases for "Sakshi", "Shreshth", "Ijaz", etc.
 * 3. GALAXY IS A VIEW: Provides clean graph data with typed edges and explicit hierarchy.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';
import {
  LifeDomainKey,
  DOMAIN_TAXONOMY,
  DynamicKgNode,
  DynamicKgEdge,
  DynamicKgResult,
} from '../lib/memoryDomains';

export class CanonicalGraphService {
  private static instance: CanonicalGraphService;

  static getInstance(): CanonicalGraphService {
    if (!CanonicalGraphService.instance) {
      CanonicalGraphService.instance = new CanonicalGraphService();
    }
    return CanonicalGraphService.instance;
  }

  /**
   * Builds the canonical Knowledge Graph strictly from memory_bubbles and memories.
   */
  async getCanonicalKnowledgeGraph(userId: string, preferredName?: string): Promise<DynamicKgResult> {
    const nodes: DynamicKgNode[] = [];
    const edges: DynamicKgEdge[] = [];
    const nodeIds = new Set<string>();

    const cleanUserName = (preferredName || 'You')
      .replace(/^Prefers to be called\s+/i, '')
      .replace(/\.$/, '')
      .trim();

    // ── 1. Central Self Node (Level 0) ─────────────────────────────────────────
    const coreNodeId = 'user-core';
    const coreNode: DynamicKgNode = {
      id: coreNodeId,
      name: cleanUserName,
      entity_type: 'self',
      department: 'identity',
      color: '#8B5CF6',
      radius: 30,
      value: `Central Self & Consciousness: ${cleanUserName}`,
      isHub: true,
      emoji: '🧠',
      hierarchyLevel: 1,
      treePath: [cleanUserName],
    };
    nodes.push(coreNode);
    nodeIds.add(coreNodeId);

    // ── 2. Department Hub Nodes (Level 1 - Main Trunks) ────────────────────────
    const DEPT_KEYS: LifeDomainKey[] = ['family', 'work', 'goals', 'lifestyle', 'identity'];
    for (const d of DEPT_KEYS) {
      const meta = DOMAIN_TAXONOMY[d];
      const deptNodeId = `dept-${d}`;
      const deptNode: DynamicKgNode = {
        id: deptNodeId,
        name: meta.title,
        entity_type: 'department',
        department: d,
        color: meta.color,
        radius: 24,
        value: meta.description,
        isDepartment: true,
        emoji: meta.emoji,
        parentEntityId: coreNodeId,
        hierarchyLevel: 1,
        treePath: [cleanUserName, meta.title],
      };
      nodes.push(deptNode);
      nodeIds.add(deptNodeId);

      // Edge from Core to Department Trunk
      edges.push({
        id: `edge-core-${d}`,
        source: coreNodeId,
        target: deptNodeId,
        relation: 'HAS_DEPARTMENT',
        color: 'rgba(255,255,255,0.25)',
        weight: 3,
        edgeType: 'DEPARTMENT_BRANCH',
        explanation: `Main trunk connecting consciousness to ${meta.title}`,
      });
    }

    // ── 3. Fetch Canonical Entity Bubbles & Memories in Parallel ───────────────
    const [
      { data: bubbles, error: bubbleErr },
      { data: memories, error: memErr },
    ] = await Promise.all([
      supabaseAdmin
        .from('memory_bubbles')
        .select('id, label, slug, bubble_type, domain_key, relation_type, parent_bubble_id, metadata, updated_at')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type, bubble_id, confidence, updated_at, lifecycle_state')
        .eq('user_id', userId)
        .eq('is_archived', false)
        .neq('lifecycle_state', 'SUPERSEDED')
        .neq('lifecycle_state', 'INVALIDATED'),
    ]);

    if (bubbleErr) {
      logger.error('[CanonicalGraphService] Error fetching memory_bubbles', { error: bubbleErr.message, userId });
    }
    if (memErr) {
      logger.error('[CanonicalGraphService] Error fetching memories', { error: memErr.message, userId });
    }

    const bubbleMap = new Map<string, any>();
    const bubbleNodeIdMap = new Map<string, string>(); // bubbleId -> nodeId

    // ── 4. Build Level 2 Entity Branches (Two-Pass Deterministic Registration) ──
    const validBubbles = bubbles || [];

    // Pass 1: Index all bubbles into bubbleMap and bubbleNodeIdMap first
    // Ensures parent_bubble_id resolution never depends on database return order!
    for (const b of validBubbles) {
      if (b.bubble_type === 'domain') continue; // Domains already created as trunks
      bubbleMap.set(b.id, b);
      bubbleNodeIdMap.set(b.id, `bubble-${b.id}`);
    }

    // Pass 2: Build entity nodes and deterministic hierarchy edges
    for (const b of validBubbles) {
      if (b.bubble_type === 'domain') continue;

      const domain: LifeDomainKey = (b.domain_key && DEPT_KEYS.includes(b.domain_key as any))
        ? (b.domain_key as LifeDomainKey)
        : 'lifestyle';
      const meta = DOMAIN_TAXONOMY[domain];

      const entityNodeId = bubbleNodeIdMap.get(b.id)!;
      const relationLabel = b.relation_type ? ` · ${b.relation_type}` : '';
      const entityDisplayName = b.relation_type ? `${b.label} (${b.relation_type})` : b.label;

      // Determine parent node deterministically from Pass 1 map
      let parentNodeId = `dept-${domain}`;
      if (b.parent_bubble_id && bubbleNodeIdMap.has(b.parent_bubble_id)) {
        parentNodeId = bubbleNodeIdMap.get(b.parent_bubble_id)!;
      }

      const entityType = (b.metadata as any)?.entity_type || (b.bubble_type as any) || 'entity';

      const entityNode: DynamicKgNode = {
        id: entityNodeId,
        name: entityDisplayName,
        entity_type: entityType,
        department: domain,
        color: meta.color,
        radius: 20,
        value: `${b.label}${relationLabel}`,
        raw_key: b.slug,
        emoji: this.getEntityEmoji(b.relation_type, domain, entityType),
        parentEntityId: parentNodeId,
        hierarchyLevel: parentNodeId.startsWith('dept-') ? 2 : 3,
        treePath: [cleanUserName, meta.title, b.label],
      };

      nodes.push(entityNode);
      nodeIds.add(entityNodeId);

      // Edge from Trunk (or parent entity) to Entity
      edges.push({
        id: `edge-${parentNodeId}-${entityNodeId}`,
        source: parentNodeId,
        target: entityNodeId,
        relation: b.relation_type ? `${b.relation_type.toUpperCase().replace(/\s+/g, '_')}_BRANCH` : 'ENTITY_BRANCH',
        color: meta.color,
        weight: 2,
        edgeType: 'ENTITY_BRANCH',
        explanation: `${b.label} in ${meta.title}`,
      });
    }

    // ── 4b. Cross-Entity Semantic Relationship Edges (Neural Bridges) ─────────
    for (const b of validBubbles) {
      const meta = (b.metadata as Record<string, any>) || {};
      const relationships = Array.isArray(meta.relationships) ? meta.relationships : [];
      const sourceNodeId = `bubble-${b.id}`;

      for (const rel of relationships) {
        if (rel.targetEntityId && bubbleNodeIdMap.has(rel.targetEntityId)) {
          const targetNodeId = bubbleNodeIdMap.get(rel.targetEntityId)!;
          const edgeId = `edge-rel-${b.id}-${rel.targetEntityId}`;
          const reciprocalId = `edge-rel-${rel.targetEntityId}-${b.id}`;
          if (!edges.some((e) => e.id === edgeId || e.id === reciprocalId)) {
            edges.push({
              id: edgeId,
              source: sourceNodeId,
              target: targetNodeId,
              relation: rel.relationType ? rel.relationType.toUpperCase().replace(/\s+/g, '_') : 'RELATED_TO',
              color: '#EC4899',
              weight: 2,
              isCrossDomain: true,
              edgeType: 'NEURAL_BRIDGE',
              explanation: `${b.label} is ${rel.relationType} to ${rel.targetEntityName || 'entity'}`,
            });
          }
        }
      }
    }

    // ── 5. Build Level 3 Attribute Stems (Linked Memories) ──────────────────────
    const validMemories = memories || [];
    for (const m of validMemories) {
      if (!m.value || !m.key) continue;

      let parentNodeId: string;
      let hierarchyLevel: 1 | 2 | 3;
      let edgeType: DynamicKgEdge['edgeType'];
      let domain: LifeDomainKey;

      if (m.bubble_id && bubbleNodeIdMap.has(m.bubble_id)) {
        // Linked to specific entity bubble
        parentNodeId = bubbleNodeIdMap.get(m.bubble_id)!;
        hierarchyLevel = 3;
        edgeType = 'ATTRIBUTE_STEM';
        const parentBubble = bubbleMap.get(m.bubble_id);
        domain = (parentBubble?.domain_key as LifeDomainKey) || 'lifestyle';
      } else {
        // Direct user memory (attached to department trunk)
        domain = (m.memory_type && DEPT_KEYS.includes(m.memory_type as any))
          ? (m.memory_type as LifeDomainKey)
          : 'identity';
        parentNodeId = `dept-${domain}`;
        hierarchyLevel = 2;
        edgeType = 'ATTRIBUTE_STEM';
      }

      const meta = DOMAIN_TAXONOMY[domain] || DOMAIN_TAXONOMY.lifestyle;
      const stemNodeId = `mem-${m.id}`;

      // Clean attribute predicate for display
      const predicate = this.extractPredicateName(m.key);
      const stemDisplayName = this.formatStemName(predicate, m.value);

      const stemNode: DynamicKgNode = {
        id: stemNodeId,
        name: stemDisplayName,
        entity_type: 'attribute',
        department: domain,
        color: meta.color,
        radius: 14,
        value: m.value,
        raw_key: m.key,
        emoji: this.getAttributeEmoji(predicate, domain),
        parentEntityId: parentNodeId,
        hierarchyLevel,
        treePath: [cleanUserName, meta.title, stemDisplayName],
      };

      nodes.push(stemNode);
      nodeIds.add(stemNodeId);

      edges.push({
        id: `edge-${parentNodeId}-${stemNodeId}`,
        source: parentNodeId,
        target: stemNodeId,
        relation: predicate.toUpperCase().replace(/\s+/g, '_'),
        color: meta.color,
        weight: 1,
        edgeType,
        explanation: `${predicate}: ${m.value}`,
      });
    }

    // ── 6. Department Stats ───────────────────────────────────────────────────
    const departments: Record<LifeDomainKey, { count: number; activeThreads: number; label: string; color: string; emoji: string }> = {
      family: { count: 0, activeThreads: 0, label: DOMAIN_TAXONOMY.family.title, color: DOMAIN_TAXONOMY.family.color, emoji: DOMAIN_TAXONOMY.family.emoji },
      work: { count: 0, activeThreads: 0, label: DOMAIN_TAXONOMY.work.title, color: DOMAIN_TAXONOMY.work.color, emoji: DOMAIN_TAXONOMY.work.emoji },
      goals: { count: 0, activeThreads: 0, label: DOMAIN_TAXONOMY.goals.title, color: DOMAIN_TAXONOMY.goals.color, emoji: DOMAIN_TAXONOMY.goals.emoji },
      lifestyle: { count: 0, activeThreads: 0, label: DOMAIN_TAXONOMY.lifestyle.title, color: DOMAIN_TAXONOMY.lifestyle.color, emoji: DOMAIN_TAXONOMY.lifestyle.emoji },
      identity: { count: 0, activeThreads: 0, label: DOMAIN_TAXONOMY.identity.title, color: DOMAIN_TAXONOMY.identity.color, emoji: DOMAIN_TAXONOMY.identity.emoji },
    };

    for (const node of nodes) {
      if (node.department && departments[node.department as LifeDomainKey]) {
        departments[node.department as LifeDomainKey].count++;
      }
    }

    logger.info('[CanonicalGraphService] Canonical knowledge graph constructed', {
      userId,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      entityBubbles: validBubbles.length,
      memoriesLinked: validMemories.filter((m) => m.bubble_id).length,
    });

    const deptList = (Object.entries(departments) as [LifeDomainKey, typeof departments[LifeDomainKey]][]).map(([id, d]) => ({
      id,
      name: d.label,
      emoji: d.emoji,
      color: d.color,
      count: d.count,
    }));

    return {
      nodes,
      edges,
      departments: deptList,
      totalNodes: nodes.length,
      totalEdges: edges.length,
    };
  }

  private extractPredicateName(key: string): string {
    if (key.startsWith('entity:')) {
      const parts = key.split(':');
      return parts.length >= 3 ? parts[2] : parts[parts.length - 1];
    }
    return key.replace(/^[a-z]+_/, '');
  }

  private formatStemName(predicate: string, value: string): string {
    const cleanPred = predicate.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    if (cleanPred.toLowerCase() === 'birthday' || cleanPred.toLowerCase() === 'birth date') {
      return `Birthday: ${value}`;
    }
    if (cleanPred.toLowerCase() === 'company name' || cleanPred.toLowerCase() === 'workplace') {
      return `Works at ${value}`;
    }
    if (cleanPred.toLowerCase() === 'city' || cleanPred.toLowerCase() === 'location') {
      return `Lives in ${value}`;
    }
    if (cleanPred.toLowerCase() === 'nickname') {
      return `Nickname: ${value}`;
    }
    return `${cleanPred}: ${value}`;
  }

  private getEntityEmoji(relation?: string | null, domain?: LifeDomainKey, entityType?: string): string {
    if (entityType === 'pet') return '🐾';
    if (entityType === 'event') return '🎉';
    if (entityType === 'role' || entityType === 'concept') return '💡';
    if (entityType === 'organization') return '🏢';
    if (!relation) {
      return domain ? DOMAIN_TAXONOMY[domain]?.emoji || '🌱' : '🌱';
    }
    const r = relation.toLowerCase();
    if (r.includes('son') || r.includes('daughter') || r.includes('child')) return '👶';
    if (r.includes('wife') || r.includes('husband') || r.includes('partner') || r.includes('spouse')) return '❤️';
    if (r.includes('father') || r.includes('mother') || r.includes('parent')) return '👨‍👩‍👦';
    if (r.includes('brother') || r.includes('sister')) return '🧑‍🤝‍🧑';
    if (r.includes('friend')) return '🤝';
    if (r.includes('colleague') || r.includes('coworker')) return '💼';
    if (r.includes('pet') || r.includes('dog') || r.includes('cat')) return '🐾';
    return '👤';
  }

  private getAttributeEmoji(predicate: string, domain?: LifeDomainKey): string {
    const p = predicate.toLowerCase();
    if (p.includes('birth') || p.includes('dob') || p.includes('bday')) return '🎂';
    if (p.includes('company') || p.includes('work') || p.includes('job') || p.includes('occupation')) return '💼';
    if (p.includes('city') || p.includes('location') || p.includes('live')) return '📍';
    if (p.includes('nick') || p.includes('alias')) return '🏷️';
    if (p.includes('habit') || p.includes('smoke') || p.includes('drink')) return '☕';
    if (p.includes('skill') || p.includes('art') || p.includes('hobby')) return '🎨';
    return domain ? DOMAIN_TAXONOMY[domain]?.emoji || '•' : '•';
  }

  /**
   * Deterministically reconstructs the entire kg_nodes and kg_edges read projection
   * starting from canonical memory_bubbles and their relationships.
   * Leverages the authoritative memory_bubbles.id -> kg_nodes.bubble_id mapping.
   */
  async rebuildProjections(userId: string): Promise<{ nodesCreatedOrUpdated: number; edgesCreatedOrUpdated: number }> {
    logger.info('[CanonicalGraphService] Rebuilding kg_nodes and kg_edges projections from canonical memory_bubbles', { userId });

    // 1. Fetch all active entity & branch bubbles
    const { data: bubbles, error: bErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .in('bubble_type', ['entity', 'branch']);

    if (bErr || !bubbles) {
      logger.error('[CanonicalGraphService] Failed to fetch memory_bubbles for rebuild', { error: bErr?.message, userId });
      return { nodesCreatedOrUpdated: 0, edgesCreatedOrUpdated: 0 };
    }

    let nodesCount = 0;
    let edgesCount = 0;
    const nowIso = new Date().toISOString();
    const bubbleToKgNodeMap = new Map<string, string>(); // bubble.id -> kg_nodes.id

    // 2. Synchronize kg_nodes by bubble_id
    for (const b of bubbles) {
      const { data: existingNode } = await supabaseAdmin
        .from('kg_nodes')
        .select('id')
        .eq('user_id', userId)
        .eq('bubble_id', b.id)
        .maybeSingle();

      const attributes = {
        bubble_id: b.id,
        domain_key: b.domain_key,
        relation_type: b.relation_type,
        aliases: (b.metadata as any)?.aliases || [],
        ...((b.metadata as any)?.attributes || {}),
      };

      const entityType = b.bubble_type === 'entity'
        ? ((b.metadata as any)?.entity_type || 'person')
        : b.bubble_type;

      if (existingNode) {
        await supabaseAdmin
          .from('kg_nodes')
          .update({
            name: b.label,
            entity_type: entityType,
            attributes,
            updated_at: nowIso,
          })
          .eq('id', existingNode.id);
        bubbleToKgNodeMap.set(b.id, existingNode.id);
        nodesCount++;
      } else {
        const { data: insertedNode, error: insErr } = await supabaseAdmin
          .from('kg_nodes')
          .insert({
            user_id: userId,
            bubble_id: b.id,
            name: b.label,
            entity_type: entityType,
            attributes,
          })
          .select('id')
          .single();
        if (!insErr && insertedNode) {
          bubbleToKgNodeMap.set(b.id, insertedNode.id);
          nodesCount++;
        }
      }
    }

    // 3. Stale kg_nodes cleanup: prune any kg_node without a valid active canonical bubble
    const activeBubbleIdSet = new Set(bubbles.map((b) => b.id));
    const { data: currentKgNodes } = await supabaseAdmin
      .from('kg_nodes')
      .select('id, bubble_id')
      .eq('user_id', userId);

    if (currentKgNodes) {
      for (const n of currentKgNodes) {
        if (!n.bubble_id || !activeBubbleIdSet.has(n.bubble_id)) {
          // Prune dangling edges first
          await supabaseAdmin
            .from('kg_edges')
            .delete()
            .eq('user_id', userId)
            .or(`source_node_id.eq.${n.id},target_node_id.eq.${n.id}`);
          // Prune stale node
          await supabaseAdmin
            .from('kg_nodes')
            .delete()
            .eq('id', n.id)
            .eq('user_id', userId);
        }
      }
    }

    // 4. Synchronize kg_edges from metadata.relationships & hierarchy
    const validEdgeIds = new Set<string>();

    for (const b of bubbles) {
      const sourceKgId = bubbleToKgNodeMap.get(b.id);
      if (!sourceKgId) continue;

      const meta = (b.metadata as Record<string, any>) || {};
      const rels = Array.isArray(meta.relationships) ? meta.relationships : [];

      for (const rel of rels) {
        if (!rel.targetEntityId) continue;
        const targetKgId = bubbleToKgNodeMap.get(rel.targetEntityId);
        if (!targetKgId) continue;

        const relType = (rel.relationType || 'RELATED_TO').toUpperCase().replace(/\s+/g, '_');
        const weight = Math.round((rel.confidence || 0.95) * 100);

        // Gate C & I: Query by (source, target, relationType) to preserve multiple relation types
        const { data: existingEdge } = await supabaseAdmin
          .from('kg_edges')
          .select('id')
          .eq('user_id', userId)
          .eq('source_node_id', sourceKgId)
          .eq('target_node_id', targetKgId)
          .eq('relation_type', relType)
          .maybeSingle();

        if (existingEdge) {
          validEdgeIds.add(existingEdge.id);
          await supabaseAdmin
            .from('kg_edges')
            .update({
              weight,
              updated_at: nowIso,
            })
            .eq('id', existingEdge.id);
          edgesCount++;
        } else {
          const { data: insEdge, error: insEdgeErr } = await supabaseAdmin
            .from('kg_edges')
            .insert({
              user_id: userId,
              source_node_id: sourceKgId,
              target_node_id: targetKgId,
              relation_type: relType,
              weight,
            })
            .select('id')
            .single();
          if (!insEdgeErr && insEdge) {
            validEdgeIds.add(insEdge.id);
            edgesCount++;
          }
        }
      }

      // Hierarchy edge to parent entity if parent is also an active entity bubble
      if (b.parent_bubble_id && bubbleToKgNodeMap.has(b.parent_bubble_id)) {
        const parentKgId = bubbleToKgNodeMap.get(b.parent_bubble_id)!;
        const { data: existingHierarchyEdge } = await supabaseAdmin
          .from('kg_edges')
          .select('id')
          .eq('user_id', userId)
          .eq('source_node_id', parentKgId)
          .eq('target_node_id', sourceKgId)
          .eq('relation_type', 'HAS_CHILD')
          .maybeSingle();

        if (existingHierarchyEdge) {
          validEdgeIds.add(existingHierarchyEdge.id);
        } else {
          const { data: insHierEdge, error: insHierErr } = await supabaseAdmin
            .from('kg_edges')
            .insert({
              user_id: userId,
              source_node_id: parentKgId,
              target_node_id: sourceKgId,
              relation_type: 'HAS_CHILD',
              weight: 1,
            })
            .select('id')
            .single();
          if (!insHierErr && insHierEdge) {
            validEdgeIds.add(insHierEdge.id);
            edgesCount++;
          }
        }
      }
    }

    // 5. Stale kg_edges cleanup: prune any edge not in validEdgeIds
    const { data: allUserEdges } = await supabaseAdmin
      .from('kg_edges')
      .select('id')
      .eq('user_id', userId);

    if (allUserEdges) {
      for (const e of allUserEdges) {
        if (!validEdgeIds.has(e.id)) {
          await supabaseAdmin.from('kg_edges').delete().eq('id', e.id);
        }
      }
    }

    this.invalidateGraphCache(userId);
    logger.info('[CanonicalGraphService] Rebuilt projections complete', {
      userId,
      nodesCreatedOrUpdated: nodesCount,
      edgesCreatedOrUpdated: edgesCount,
    });
    return { nodesCreatedOrUpdated: nodesCount, edgesCreatedOrUpdated: edgesCount };
  }

  invalidateGraphCache(userId: string): void {
    const cacheKey = `${userId}:kg`;
    cache.invalidate(cacheKey);
  }
}

export const canonicalGraphService = CanonicalGraphService.getInstance();

