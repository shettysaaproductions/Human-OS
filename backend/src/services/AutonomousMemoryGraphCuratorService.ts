/**
 * AutonomousMemoryGraphCuratorService.ts — Dedicated Autonomous Memory Tree & Knowledge Graph Curator
 *
 * ARCHITECTURAL ROLE:
 * Continuously ingests the user's complete memory tree and knowledge graph:
 * - `memories` (long-term canonical facts)
 * - `working_memory` (short-lived working context)
 * - `kg_nodes` & `kg_edges` (entity-relationship knowledge graph)
 *
 * Cross-checks every node and edge against the user's explicit conversational proof (`chat_history`):
 * 1. REMOVE: Purges/invalidates empty nodes, phantom keys with no data (e.g. "shreshth date of birth with no data"),
 *    placeholder text ("Not mentioned", "None", "Unknown"), and ungrounded speculative hallucinations.
 * 2. MERGE: Unifies split/duplicate keys and nodes (e.g. `shreshth_date_of_birth` + `son_dob` into canonical `son_birth_date`),
 *    preserving the concrete proven value and retiring duplicate aliases.
 * 3. UPDATE: Corrects outdated, contradictory, or inverted values with concrete conversational proof from chat.
 * 4. ADD: Extrapolates nothing, but persists verified concrete facts explicitly stated by the user that are missing.
 * 5. SORT & ORGANIZE: Enforces hierarchical tree invariants (Root Core -> Department Trunks -> Entity Branches -> Attribute Stems),
 *    ensuring zero orphaned or floating nodes.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { complete } from '../lib/nvidia';
import { cache } from '../lib/cache';
import { canonicalizeKey, isKnownCanonicalKey } from '../lib/memoryKeySchema';
import { isGarbageMemoryValue } from '../lib/memoryFilters';
import { isValidMemoryAttributeValue } from '../lib/entitySemanticValidator';
import { isPlaceholderValue, isTransientSituationalItem, classifyDomain } from '../lib/memoryDomains';
import { invalidateAnalyticsCache } from '../routes/analytics';

export interface CurationRemoval {
  key: string;
  target: 'memory' | 'working_memory' | 'kg_node';
  nodeId?: string;
  reason: string;
}

export interface CurationMerge {
  sourceKey: string;
  targetKey: string;
  provenValue: string;
  reason: string;
}

export interface CurationUpdate {
  key: string;
  newValue: string;
  provenChatTruth: string;
  memoryType?: string;
  entity?: string;
}

export interface CurationAddition {
  key: string;
  value: string;
  provenChatTruth: string;
  memoryType?: string;
  entity?: string;
}

export interface CurationResult {
  userId: string;
  removalsApplied: number;
  mergesApplied: number;
  updatesApplied: number;
  additionsApplied: number;
  kgCleaned: number;
  durationMs: number;
  details: {
    removals: CurationRemoval[];
    merges: CurationMerge[];
    updates: CurationUpdate[];
    additions: CurationAddition[];
  };
}

export class AutonomousMemoryGraphCuratorService {
  private static instance: AutonomousMemoryGraphCuratorService;
  private inFlightCurations = new Set<string>();
  private lastCurationTimestamp = new Map<string, number>();

  static getInstance(): AutonomousMemoryGraphCuratorService {
    if (!AutonomousMemoryGraphCuratorService.instance) {
      AutonomousMemoryGraphCuratorService.instance = new AutonomousMemoryGraphCuratorService();
    }
    return AutonomousMemoryGraphCuratorService.instance;
  }

  /**
   * Main entry point to continuously sort, cross-check, and curate a user's memory tree and graph.
   * Throttled to avoid tight polling while supporting real-time event-driven triggers.
   */
  async curateUserMemoryGraph(userId: string, options?: { force?: boolean }): Promise<CurationResult> {
    const startMs = Date.now();
    const result: CurationResult = {
      userId,
      removalsApplied: 0,
      mergesApplied: 0,
      updatesApplied: 0,
      additionsApplied: 0,
      kgCleaned: 0,
      durationMs: 0,
      details: {
        removals: [],
        merges: [],
        updates: [],
        additions: []
      }
    };

    if (!userId) return result;

    // Concurrency & debounce guard (10 second minimum between autonomous runs unless forced)
    if (!options?.force) {
      if (this.inFlightCurations.has(userId)) {
        logger.debug('[MemoryGraphCurator] Curation already in flight for user — skipping', { userId });
        return result;
      }
      const lastRun = this.lastCurationTimestamp.get(userId) || 0;
      if (Date.now() - lastRun < 10000) {
        logger.debug('[MemoryGraphCurator] Curation debounced (<10s since last run)', { userId });
        return result;
      }
    }

    this.inFlightCurations.add(userId);
    this.lastCurationTimestamp.set(userId, Date.now());

    try {
      // 1. Fetch complete memory tree, working memory, knowledge graph, and recent user chats
      const [memoriesRes, wmRes, kgNodesRes, kgEdgesRes, chatRes] = await Promise.all([
        supabaseAdmin
          .from('memories')
          .select('id, key, value, memory_type, lifecycle_state, is_archived, updated_at, created_at')
          .eq('user_id', userId)
          .eq('is_archived', false)
          .order('updated_at', { ascending: false })
          .limit(300),
        supabaseAdmin
          .from('working_memory')
          .select('id, key, value, created_at')
          .eq('user_id', userId)
          .limit(200),
        supabaseAdmin
          .from('kg_nodes')
          .select('id, name, entity_type, attributes, created_at')
          .eq('user_id', userId)
          .limit(200),
        supabaseAdmin
          .from('kg_edges')
          .select('id, source_node_id, target_node_id, relation_type, weight')
          .eq('user_id', userId)
          .limit(300),
        supabaseAdmin
          .from('chat_history')
          .select('id, role, content, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(45)
      ]);

      const memories = memoriesRes.data || [];
      const workingMemories = wmRes.data || [];
      const kgNodes = kgNodesRes.data || [];
      const kgEdges = kgEdgesRes.data || [];
      const recentChats = (chatRes.data || []).reverse();

      if (memories.length === 0 && workingMemories.length === 0 && kgNodes.length === 0) {
        return result;
      }

      // Map active state for fast indexing
      const memMap = new Map<string, any>();
      for (const m of memories) {
        if (m.lifecycle_state === 'SUPERSEDED' || m.lifecycle_state === 'INVALIDATED') continue;
        memMap.set(m.key.toLowerCase(), m);
      }

      const wmMap = new Map<string, any>();
      for (const w of workingMemories) {
        wmMap.set(w.key.toLowerCase(), w);
      }

      // ── LAYER 1: FAST-PATH DETERMINISTIC PRUNING & RECONCILIATION ──────────
      const deterministicActions = await this.runDeterministicCuration(userId, memMap, wmMap, kgNodes, kgEdges, recentChats);
      
      // Apply deterministic removals
      if (deterministicActions.removals.length > 0) {
        await this.applyRemovals(userId, deterministicActions.removals);
        result.removalsApplied += deterministicActions.removals.length;
        result.details.removals.push(...deterministicActions.removals);
      }

      // Apply deterministic merges
      if (deterministicActions.merges.length > 0) {
        await this.applyMerges(userId, deterministicActions.merges);
        result.mergesApplied += deterministicActions.merges.length;
        result.details.merges.push(...deterministicActions.merges);
      }

      // Apply deterministic updates
      if (deterministicActions.updates.length > 0) {
        await this.applyUpdates(userId, deterministicActions.updates);
        result.updatesApplied += deterministicActions.updates.length;
        result.details.updates.push(...deterministicActions.updates);
      }

      // Cleaned KG nodes count
      result.kgCleaned += deterministicActions.kgNodesPruned;

      // ── LAYER 2: DEDICATED LLM AUTONOMOUS MEMORY GRAPH CURATOR ─────────────
      // Evaluates deeper semantic nuances, conversational proof, and cross-checks graph
      try {
        const llmActions = await this.runLlmSemanticCuration(
          userId,
          memories.filter(m => m.lifecycle_state !== 'INVALIDATED' && m.lifecycle_state !== 'SUPERSEDED'),
          workingMemories,
          kgNodes,
          recentChats
        );

        if (llmActions.removals.length > 0) {
          await this.applyRemovals(userId, llmActions.removals);
          result.removalsApplied += llmActions.removals.length;
          result.details.removals.push(...llmActions.removals);
        }

        if (llmActions.merges.length > 0) {
          await this.applyMerges(userId, llmActions.merges);
          result.mergesApplied += llmActions.merges.length;
          result.details.merges.push(...llmActions.merges);
        }

        if (llmActions.updates.length > 0) {
          await this.applyUpdates(userId, llmActions.updates);
          result.updatesApplied += llmActions.updates.length;
          result.details.updates.push(...llmActions.updates);
        }

        if (llmActions.additions.length > 0) {
          await this.applyAdditions(userId, llmActions.additions);
          result.additionsApplied += llmActions.additions.length;
          result.details.additions.push(...llmActions.additions);
        }
      } catch (llmErr: any) {
        logger.warn('[MemoryGraphCurator] Non-fatal LLM curation error', { error: llmErr.message });
      }

      // ── LAYER 3: DEDICATED MEMORY BUBBLE HIERARCHY & PHANTOM ERADICATION ──────────
      try {
        const bubbleCleanup = await this.curateMemoryBubbles(userId);
        if (bubbleCleanup.bubblesMerged > 0 || bubbleCleanup.bubblesPruned > 0) {
          result.kgCleaned += bubbleCleanup.bubblesPruned + bubbleCleanup.bubblesMerged;
        }
      } catch (bubbleErr: any) {
        logger.warn('[MemoryGraphCurator] Non-fatal bubble curation error', { error: bubbleErr.message });
      }

      // 3. Invalidate analytics & UI caches if changes were made
      const totalChanges = result.removalsApplied + result.mergesApplied + result.updatesApplied + result.additionsApplied + result.kgCleaned;
      if (totalChanges > 0) {
        invalidateAnalyticsCache(userId);
        cache.invalidate(`wardrobes:${userId}`);
        cache.invalidate(`kg:${userId}`);
        logger.info('[MemoryGraphCurator] Cache invalidated after autonomous curation', { userId, totalChanges });
      }

    } catch (err: any) {
      logger.error('[MemoryGraphCurator] Error during curation', { userId, error: err.message });
    } finally {
      this.inFlightCurations.delete(userId);
      result.durationMs = Date.now() - startMs;
    }

    return result;
  }

  /**
   * Deterministic curation for common invariants, empty data nodes, and alias collisions.
   */
  private async runDeterministicCuration(
    _userId: string,
    memMap: Map<string, any>,
    wmMap: Map<string, any>,
    kgNodes: any[],
    _kgEdges: any[],
    recentChats: any[]
  ): Promise<{
    removals: CurationRemoval[];
    merges: CurationMerge[];
    updates: CurationUpdate[];
    kgNodesPruned: number;
  }> {
    const removals: CurationRemoval[] = [];
    const merges: CurationMerge[] = [];
    const updates: CurationUpdate[] = [];
    let kgNodesPruned = 0;

    // Identify established entities across memories and working memory early
    const knownEntities = new Set<string>();
    for (const [key, mem] of memMap.entries()) {
      if (key.startsWith('friend_') || key.startsWith('colleague_') || key.startsWith('pet_') || key.startsWith('dog_')) {
        const parts = key.split('_');
        if (parts.length >= 2) knownEntities.add(parts[1].toLowerCase());
      }
      if (mem.value && mem.value.length < 25 && !mem.value.includes(' ') && !isPlaceholderValue(mem.value)) {
        if (key.includes('name') && !key.includes('company') && !key.includes('user') && !key.includes('preferred')) {
          knownEntities.add(mem.value.toLowerCase().trim());
        }
      }
    }

    for (const [key, wm] of wmMap.entries()) {
      if (key.startsWith('friend_name_') || key.startsWith('colleague_name')) {
        const val = wm.value.trim().toLowerCase();
        if (val && val.length < 25) knownEntities.add(val);
      }
    }

    // ── 1. PRUNE EMPTY / PLACEHOLDER NODES IN MEMORIES & WORKING MEMORY ───────
    // e.g., shreshth_date_of_birth or son_birth_date with "" or "Not mentioned"
    // ── 1. PRUNE EMPTY, PLACEHOLDER, & TRANSIENT NODES IN MEMORIES & WORKING MEMORY ───────
    for (const [key, mem] of memMap.entries()) {
      if (isPlaceholderValue(mem.value) || isGarbageMemoryValue(key, mem.value) || isTransientSituationalItem(key, mem.value)) {
        removals.push({
          key,
          target: 'memory',
          reason: `Pruned empty, placeholder, or transient memory "${key}" with non-data value "${mem.value}"`
        });
      }
    }

    for (const [key, wm] of wmMap.entries()) {
      if (isPlaceholderValue(wm.value) || isGarbageMemoryValue(key, wm.value) || isTransientSituationalItem(key, wm.value)) {
        removals.push({
          key,
          target: 'working_memory',
          reason: `Pruned placeholder or transient working memory "${key}" with value "${wm.value}"`
        });
      }
    }

    // ── 1b. PURGE INVALID SON AGE "NOT APPLICABLE" & AUTO-REPAIR FROM BIRTH DATE ──
    const sonDobEntry = memMap.get('son_birth_date');
    const sonAgeEntry = memMap.get('son_age');
    const wmSonAge = wmMap.get('son_age');

    if (sonAgeEntry && (isPlaceholderValue(sonAgeEntry.value) || sonAgeEntry.value.toLowerCase().includes('applicable'))) {
      removals.push({
        key: 'son_age',
        target: 'memory',
        reason: 'Purged invalid "Not applicable" age stem from son Shreshth'
      });
    }
    if (wmSonAge && (isPlaceholderValue(wmSonAge.value) || wmSonAge.value.toLowerCase().includes('applicable'))) {
      removals.push({
        key: 'son_age',
        target: 'working_memory',
        reason: 'Purged invalid "Not applicable" working memory for son_age'
      });
    }

    // Auto-repair son's age from son_birth_date if age is missing/placeholder
    if (sonDobEntry && sonDobEntry.value && (!sonAgeEntry || isPlaceholderValue(sonAgeEntry.value) || sonAgeEntry.value.toLowerCase().includes('applicable'))) {
      const dobMatch = sonDobEntry.value.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (dobMatch) {
        const birthYear = parseInt(dobMatch[3], 10);
        const birthMonth = parseInt(dobMatch[2], 10) - 1;
        const now = new Date();
        const diffMonths = (now.getFullYear() - birthYear) * 12 + (now.getMonth() - birthMonth);
        if (diffMonths >= 0 && diffMonths <= 36) {
          const calculatedAge = `${Math.max(1, diffMonths)} months`;
          updates.push({
            key: 'son_age',
            newValue: calculatedAge,
            provenChatTruth: `Derived from son_birth_date ${sonDobEntry.value}`,
            memoryType: 'family',
            entity: 'son'
          });
        }
      }
    }

    // ── 1c. PURGE CONTAMINATED FATHER BACKGROUND FROM WORKING MEMORY ──
    const wmFatherBg = wmMap.get('father_background');
    if (wmFatherBg) {
      const bgLower = wmFatherBg.value.toLowerCase();
      // Check if father_background is contaminated with a third-party friend's attribution
      const isThirdPartyAttribution = Array.from(knownEntities).some(e => bgLower.includes(e) && (bgLower.includes(`${e}'s father`) || bgLower.includes(`${e} ke papa`) || bgLower.includes(`${e} ke father`)));
      if (isThirdPartyAttribution || bgLower.includes("ijaz's father") || bgLower.includes("ijaz ke papa")) {
        removals.push({
          key: 'father_background',
          target: 'working_memory',
          reason: 'Removed third-party friend father background from generic father_background key'
        });
      }
    }

    // ── 1d. PURGE CONVERSATIONAL DIALOGUE FRAGMENTS FROM WORKING MEMORY ──
    for (const [key, wm] of wmMap.entries()) {
      if (key === 'good_friend' || key === 'best_friend_at_office') {
        if (wm.value.toLowerCase() === 'jata' || wm.value.length < 3) {
          removals.push({
            key,
            target: 'working_memory',
            reason: `Pruned conversational snippet "${wm.value}" from working_memory`
          });
        }
      }
    }

    // ── 2. PRUNE EMPTY / PHANTOM KNOWLEDGE GRAPH NODES (kg_nodes) ────────────
    // Identify nodes that represent attributes rather than entities, or have empty attributes & no data
    const ATTRIBUTE_TITLES = new Set([
      'date of birth', 'birth date', 'dob', 'birthday', 'shreshth date of birth', 'son date of birth',
      'work schedule', 'schedule', 'office hours', 'age', 'nickname'
    ]);

    for (const node of kgNodes) {
      const nodeNameLower = (node.name || '').toLowerCase().trim();
      const hasNoAttributes = !node.attributes || Object.keys(node.attributes).length === 0;
      const isAttributeName = ATTRIBUTE_TITLES.has(nodeNameLower);

      if (isAttributeName && hasNoAttributes) {
        removals.push({
          key: node.name,
          target: 'kg_node',
          nodeId: node.id,
          reason: `Pruned phantom KG attribute node "${node.name}" with no data`
        });
        kgNodesPruned++;
      } else if (!node.name || isPlaceholderValue(node.name)) {
        removals.push({
          key: node.name || 'unnamed',
          target: 'kg_node',
          nodeId: node.id,
          reason: `Pruned empty KG node "${node.id}"`
        });
        kgNodesPruned++;
      }
    }

    // ── 3. MERGE SPLIT BIRTH DATE ALIASES (e.g. shreshth_date_of_birth -> son_birth_date) ──
    const sonBdayAliases = [
      'shreshth_date_of_birth', 'shresth_date_of_birth', 'shreshth_dob', 'shreshth_birthday',
      'shreshth_birth_date', 'son_date_of_birth', 'child_date_of_birth', 'child_dob', 'child_birth_date',
      'tuku_dob', 'tuku_birthday', 'tuku_birth_date', 'tiku_dob', 'tiku_birthday', 'tiku_birth_date'
    ];

    const canonicalSonDobMem = memMap.get('son_birth_date');
    for (const alias of sonBdayAliases) {
      const aliasMem = memMap.get(alias);
      if (aliasMem) {
        const aliasVal = aliasMem.value;
        const canonVal = canonicalSonDobMem?.value;

        let effectiveDob: string | null = null;
        if (canonVal && !isPlaceholderValue(canonVal) && !/\b(19\d{2}|20[01]\d)\b/.test(canonVal)) {
          effectiveDob = canonVal;
        } else if (aliasVal && !isPlaceholderValue(aliasVal) && !/\b(19\d{2}|20[01]\d)\b/.test(aliasVal)) {
          effectiveDob = aliasVal;
        }

        if (effectiveDob) {
          merges.push({
            sourceKey: alias,
            targetKey: 'son_birth_date',
            provenValue: effectiveDob,
            reason: `Consolidated alias "${alias}" into canonical "son_birth_date" (${effectiveDob})`
          });
        }
      }
    }

    // ── 4. MERGE USER BIRTH DATE ALIASES (user_birth_date -> birth_date) ──────
    const userDobAliases = ['user_birth_date', 'user_dob', 'my_birthday', 'my_dob', 'user_date_of_birth'];
    const canonicalUserDob = memMap.get('birth_date');
    for (const alias of userDobAliases) {
      const aliasMem = memMap.get(alias);
      if (aliasMem) {
        const effectiveVal = (canonicalUserDob?.value && !isPlaceholderValue(canonicalUserDob.value))
          ? canonicalUserDob.value
          : (!isPlaceholderValue(aliasMem.value) ? aliasMem.value : null);
        if (effectiveVal) {
          merges.push({
            sourceKey: alias,
            targetKey: 'birth_date',
            provenValue: effectiveVal,
            reason: `Consolidated alias "${alias}" into canonical "birth_date"`
          });
        }
      }
    }

    // ── 5. DETECT & RECTIFY BIOLOGICAL / ATTRIBUTION CONTRADICTIONS ───────────
    const sonDobMem = memMap.get('son_birth_date');
    const sonAgeMem = memMap.get('son_age') || memMap.get('child_age');
    if (sonDobMem && sonDobMem.value) {
      const isAdultYear = /\b(19\d{2}|20[01]\d)\b/.test(sonDobMem.value);
      const isInfantAge = sonAgeMem?.value && /\b(\d+)\s*(?:mahine|months?|months?\s*old)\b/i.test(sonAgeMem.value);
      const hasInfantChatDob = recentChats.some(c => /\b(202\d)\b/.test(c.content || ''));

      if (isAdultYear && (isInfantAge || hasInfantChatDob)) {
        // Search chats for son's true birth date vs user's birth date
        let provenSonDob: string | null = null;
        let provenUserDob = sonDobMem.value;

        for (const msg of recentChats) {
          const text = (msg.content || '');
          const dateMatches = text.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/g) || [];
          for (const dm of dateMatches) {
            if (/\b(202\d)\b/.test(dm)) {
              provenSonDob = dm;
            } else if (/\b(19\d{2}|20[01]\d)\b/.test(dm)) {
              provenUserDob = dm;
            }
          }
        }

        updates.push({
          key: 'birth_date',
          newValue: provenUserDob,
          provenChatTruth: `User explicitly stated birth date is ${provenUserDob}`,
          memoryType: 'personal',
          entity: 'user'
        });

        if (provenSonDob) {
          updates.push({
            key: 'son_birth_date',
            newValue: provenSonDob,
            provenChatTruth: `Son is infant born ${provenSonDob}`,
            memoryType: 'family',
            entity: 'son'
          });
        } else {
          removals.push({
            key: 'son_birth_date',
            target: 'memory',
            reason: `Purged erroneous adult year (${sonDobMem.value}) from infant son_birth_date`
          });
        }
      }
    }

    // ── 6. NICKNAME / REAL NAME INVERSION GUARD ──────────────────────────────
    const sonNameMem = memMap.get('son_name');
    const sonNickMem = memMap.get('son_nickname');
    if (sonNameMem) {
      const nameVal = sonNameMem.value.trim();
      const nickVal = sonNickMem?.value?.trim();

      // Check if chat explicitly clarifies real name vs nickname
      let chatRealName: string | null = null;
      let chatNickName: string | null = null;

      for (const msg of recentChats) {
        const text = msg.content || '';
        const callMatch = text.match(/([a-zA-Z]+)\s+ko\s+(?:(?:pya+r|pree?t)\s+se\s+)?(?:ghar\s+pe\s+)?([a-zA-Z]+)\s+bulat[ei]\s+hai/i) ||
                          text.match(/\b([a-zA-Z]+)'s\s+nick\s*name\s+is\s+([a-zA-Z]+)\b/i) ||
                          text.match(/call\s+([a-zA-Z]+)\s+([a-zA-Z]+)\s+(?:at\s+home)?/i);
        if (callMatch) {
          chatRealName = this.capitalize(callMatch[1]);
          chatNickName = this.capitalize(callMatch[2]);
          break;
        }
      }

      if (chatRealName && chatNickName) {
        if (nameVal.toLowerCase() !== chatRealName.toLowerCase()) {
          updates.push({
            key: 'son_name',
            newValue: chatRealName,
            provenChatTruth: `Son real name confirmed from chat is ${chatRealName}`,
            memoryType: 'family',
            entity: 'son'
          });
        }
        if (!nickVal || nickVal.toLowerCase() !== chatNickName.toLowerCase()) {
          updates.push({
            key: 'son_nickname',
            newValue: chatNickName,
            provenChatTruth: `Son pet nickname at home confirmed from chat is ${chatNickName}`,
            memoryType: 'family',
            entity: 'son'
          });
        }
      } else if (nickVal && nameVal.toLowerCase() === nickVal.toLowerCase()) {
        // Redundant duplicate nickname identical to real name
        removals.push({
          key: 'son_nickname',
          target: 'memory',
          reason: `Pruned redundant nickname "${nickVal}" identical to real name`
        });
      }
    }

    // ── 7. CAREER VS VENTURE COLLISION GUARD ─────────────────────────────────
    const companyMem = memMap.get('company_name');
    const ventureMem = memMap.get('venture_name');
    const workSchedMem = memMap.get('work_schedule');
    if (companyMem && !ventureMem) {
      const compLower = companyMem.value.toLowerCase();
      const schedText = (workSchedMem?.value || '').toLowerCase();
      // If company is a culinary/cloud kitchen/store venture, and schedule or memories mention a distinct corporate employer
      const isCulinaryVenture = /\b(dhaba|cloud kitchen|kitchen|cafe|bakery|restaurant)\b/i.test(compLower);
      if (isCulinaryVenture) {
        // Check if work schedule or recent chats reference an office/corporate employer
        const corporateMatch = schedText.match(/at\s+([A-Za-z0-9\s]+?)(?:,\s*\d|\s*\d|\s*\(|$)/i);
        if (corporateMatch && corporateMatch[1].trim() && !/\b(dhaba|kitchen|cafe)\b/i.test(corporateMatch[1])) {
          const corpEmployer = corporateMatch[1].trim();
          updates.push({
            key: 'company_name',
            newValue: corpEmployer,
            provenChatTruth: `Primary employment is ${corpEmployer}`,
            memoryType: 'work',
            entity: 'user'
          });
          updates.push({
            key: 'venture_name',
            newValue: companyMem.value,
            provenChatTruth: `Entrepreneurial business venture is ${companyMem.value}`,
            memoryType: 'goals',
            entity: 'user'
          });
        }
      }
    }

    // ── 8. ENTITY DEDUPLICATION & REDUNDANT WORKING MEMORY PRUNING ───────────
    // A. Prune redundant working memory items that merely declare an established entity's name or weak fragment
    for (const [key, wm] of wmMap.entries()) {
      const valLower = wm.value.trim().toLowerCase();
      const isRedundantNameKey = key === 'colleague_name' || key.startsWith('friend_name_') || key.startsWith('colleague_name_') || key === 'friends';
      
      if (isRedundantNameKey && (knownEntities.has(valLower) || valLower === 'user has friends')) {
        removals.push({
          key,
          target: 'working_memory',
          reason: `Pruned redundant entity name working memory "${key}" with value "${wm.value}"`
        });
      }

      // If working memory is a redundant job phrasing when occupation is already captured in memories
      if (key.endsWith('_office_job') || key === 'office_job' || key === 'ijaz_office_job') {
        const matchingEntity = Array.from(knownEntities).find(e => key.includes(e) || valLower.includes(e));
        if (matchingEntity) {
          removals.push({
            key,
            target: 'working_memory',
            reason: `Pruned working memory "${key}" consolidated into entity "${matchingEntity}"`
          });
        }
      }
    }

    // B. Reclassify/Move friend memories to work if conversation and facts confirm office/company role
    for (const [key, mem] of memMap.entries()) {
      const valLower = (mem.value || '').toLowerCase();
      const isWorkRelated = valLower.includes('conviction') || valLower.includes('office') || valLower.includes('company') || valLower.includes('job karta') || valLower.includes('hr');
      
      if (key.startsWith('friend_') && isWorkRelated && mem.memory_type === 'family') {
        const parts = key.split('_');
        const entityName = parts.length >= 2 ? parts[1] : 'colleague';
        const trait = parts.slice(2).join('_') || 'occupation';
        const newKey = `colleague_${entityName}_${trait}`;

        // Merge/update to work domain
        merges.push({
          sourceKey: key,
          targetKey: newKey,
          provenValue: mem.value,
          reason: `Moved "${key}" from family to career/work domain as "${newKey}" based on employment at company`
        });
      }
    }

    return {
      removals,
      merges,
      updates,
      kgNodesPruned
    };
  }

  /**
   * Dedicated LLM Semantic Graph Curator:
   * Inspects entire memory tree & knowledge graph against concrete user conversations.
   */
  private async runLlmSemanticCuration(
    _userId: string,
    memories: any[],
    workingMemories: any[],
    kgNodes: any[],
    recentChats: any[]
  ): Promise<{
    removals: CurationRemoval[];
    merges: CurationMerge[];
    updates: CurationUpdate[];
    additions: CurationAddition[];
  }> {
    const removals: CurationRemoval[] = [];
    const merges: CurationMerge[] = [];
    const updates: CurationUpdate[] = [];
    const additions: CurationAddition[] = [];

    // Format memories and working context for LLM auditor
    const memoryTreeLines = memories.map(m => `- [${m.key}]: "${m.value}" (${m.memory_type})`).join('\n');
    const wmTreeLines = workingMemories.map(w => `- [working_${w.key}]: "${w.value}"`).join('\n');
    const kgNodesLines = kgNodes.slice(0, 30).map(n => `- Node "${n.name}" (${n.entity_type}): ${JSON.stringify(n.attributes || {})}`).join('\n');
    
    // User conversation ground truth snippet
    const chatSnippet = recentChats
      .slice(-20)
      .map(c => `${c.role === 'user' ? 'User' : 'Nova'}: ${c.content}`)
      .join('\n');

    const systemPrompt = `You are the Dedicated Autonomous Memory Tree & Knowledge Graph Curator for HumanOS.
Your job is to strictly sort, cross-check, and curate the user's stored memory tree and knowledge graph against the ground-truth conversation proof.

MANDATORY RULES:
1. REMOVE:
   - Identify any memory key or graph node that has NO DATA, empty value, placeholder value ("Not mentioned", "None", "Unknown", "N/A", "TBD", "not available", etc.), or ungrounded speculative assumptions.
   - Example: "shreshth date of birth is extra with no data" -> Flag for removal.
2. MERGE:
   - When multiple keys represent the same entity attribute (e.g. shreshth_date_of_birth and son_birth_date, or user_birth_date and birth_date), merge them into the canonical key, preserving the proven concrete date.
3. UPDATE:
   - When user conversation explicitly contradicts a stored memory (e.g. user corrected age, birth date, nickname, employer, or schedule), update to the proven truth.
4. ADD:
   - If the user in recent chats explicitly stated a concrete fact that is completely missing from stored memories, add it.
5. NO HALLUCINATIONS:
   - Every merge, update, or addition MUST be directly supported by concrete proof in the conversation. Never invent or assume unstated facts.

Return ONLY a valid JSON object matching this schema:
{
  "removals": [
    { "key": "key_or_node_name", "target": "memory" | "working_memory" | "kg_node", "reason": "brief reason" }
  ],
  "merges": [
    { "sourceKey": "duplicate_key", "targetKey": "canonical_key", "provenValue": "proven value", "reason": "why merged" }
  ],
  "updates": [
    { "key": "canonical_key", "newValue": "corrected value", "provenChatTruth": "chat quote proving truth", "memoryType": "family | work | goals | personal | lifestyle" }
  ],
  "additions": [
    { "key": "canonical_key", "value": "new fact", "provenChatTruth": "chat quote proving truth", "memoryType": "family | work | goals | personal | lifestyle" }
  ]
}
If no changes are needed, return {"removals":[], "merges":[], "updates":[], "additions":[]}.`;

    const userPrompt = `Current Memory Tree:
${memoryTreeLines || 'None'}

Working Memory:
${wmTreeLines || 'None'}

Knowledge Graph Nodes:
${kgNodesLines || 'None'}

Recent User Conversation Proof:
${chatSnippet || 'None'}

Curate the memory tree and knowledge graph against the conversation proof and return the JSON curation plan.`;

    const raw = await complete('SUBCONSCIOUS', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], { temperature: 0.1, maxTokens: 900 });

    const rawStr = typeof raw === 'string' ? raw : ((raw as any)?.text || (raw as any)?.content || '');
    if (rawStr) {
      const match = rawStr.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed.removals)) {
            for (const r of parsed.removals) {
              if (r.key && r.reason) removals.push(r);
            }
          }
          if (Array.isArray(parsed.merges)) {
            for (const m of parsed.merges) {
              if (m.sourceKey && m.targetKey && m.provenValue && !isPlaceholderValue(m.provenValue)) {
                merges.push(m);
              }
            }
          }
          if (Array.isArray(parsed.updates)) {
            for (const u of parsed.updates) {
              const val = u.newValue || u.correctedValue || u.value;
              if (u.key && val && !isPlaceholderValue(val)) {
                updates.push({
                  key: u.key,
                  newValue: val,
                  provenChatTruth: u.provenChatTruth || u.proofQuote || u.rationale || '',
                  memoryType: u.memoryType
                });
              }
            }
          }
          if (Array.isArray(parsed.additions)) {
            for (const a of parsed.additions) {
              if (a.key && a.value && !isPlaceholderValue(a.value)) {
                additions.push({
                  key: a.key,
                  value: a.value,
                  provenChatTruth: a.provenChatTruth || a.proofQuote || a.rationale || '',
                  memoryType: a.memoryType || a.category
                });
              }
            }
          }
        } catch {}
      }
    }

    return {
      removals,
      merges,
      updates,
      additions
    };
  }

  /**
   * Applies autonomous removals preserving the No-Hard-Delete policy for durable memories.
   */
  private async applyRemovals(userId: string, removals: CurationRemoval[]): Promise<void> {
    const now = new Date().toISOString();

    for (const r of removals) {
      logger.info('[MemoryGraphCurator] Applying removal', { userId, key: r.key, target: r.target, reason: r.reason });

      if (r.target === 'memory') {
        // Soft-tombstone memory to preserve auditability and respect no-hard-delete rule
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'INVALIDATED',
            supersession_reason: `[Autonomous Memory Curator] ${r.reason}`,
            updated_at: now
          })
          .eq('user_id', userId)
          .eq('key', r.key);

        // Also clean from working_memory
        await supabaseAdmin
          .from('working_memory')
          .delete()
          .eq('user_id', userId)
          .eq('key', r.key);
      } else if (r.target === 'working_memory') {
        await supabaseAdmin
          .from('working_memory')
          .delete()
          .eq('user_id', userId)
          .eq('key', r.key);
      } else if (r.target === 'kg_node') {
        if (r.nodeId) {
          // Delete edges connected to this phantom node (strictly tenant isolated)
          await supabaseAdmin
            .from('kg_edges')
            .delete()
            .eq('user_id', userId)
            .or(`source_node_id.eq.${r.nodeId},target_node_id.eq.${r.nodeId}`);

          // Delete the phantom node
          await supabaseAdmin
            .from('kg_nodes')
            .delete()
            .eq('id', r.nodeId)
            .eq('user_id', userId);
        } else {
          // Find by name
          const { data: foundNodes } = await supabaseAdmin
            .from('kg_nodes')
            .select('id')
            .eq('user_id', userId)
            .eq('name', r.key);

          for (const fn of (foundNodes || [])) {
            await supabaseAdmin
              .from('kg_edges')
              .delete()
              .eq('user_id', userId)
              .or(`source_node_id.eq.${fn.id},target_node_id.eq.${fn.id}`);

            await supabaseAdmin
              .from('kg_nodes')
              .delete()
              .eq('id', fn.id)
              .eq('user_id', userId);
          }
        }
      }

      // Record in correction ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'autonomous_memory_curator',
          field_name: r.key,
          previous_value: 'placeholder_or_empty',
          corrected_value: '[REMOVED]',
          reason: r.reason,
          created_at: now
        });
      } catch {}
    }
  }

  /**
   * Applies autonomous merges: unifies duplicate/alias keys into the canonical key.
   */
  private async applyMerges(userId: string, merges: CurationMerge[]): Promise<void> {
    const now = new Date().toISOString();

    for (const m of merges) {
      const canonical = canonicalizeKey(m.targetKey).canonical;
      logger.info('[MemoryGraphCurator] Applying merge', { userId, sourceKey: m.sourceKey, targetKey: canonical, value: m.provenValue });

      // 1. Ensure target canonical memory exists and has the proven value
      const { data: targetMem } = await supabaseAdmin
        .from('memories')
        .select('id, value')
        .eq('user_id', userId)
        .eq('key', canonical)
        .eq('is_archived', false)
        .maybeSingle();

      if (targetMem) {
        if (targetMem.value !== m.provenValue) {
          await supabaseAdmin
            .from('memories')
            .update({
              value: m.provenValue,
              confidence: 1.0,
              lifecycle_state: 'CURRENT',
              source_message: `[Autonomous Memory Curator] Merged from ${m.sourceKey}: ${m.reason}`,
              updated_at: now
            })
            .eq('id', targetMem.id);
        }
      } else {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: canonical,
            value: m.provenValue,
            memory_type: classifyDomain(canonical).domain || 'personal',
            confidence: 1.0,
            importance: 90,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_message: `[Autonomous Memory Curator] Created canonical from merged alias ${m.sourceKey}`,
            created_at: now,
            updated_at: now
          });
      }

      // 2. Soft-tombstone the source alias memory
      await supabaseAdmin
        .from('memories')
        .update({
          is_archived: true,
          lifecycle_state: 'SUPERSEDED',
          superseded_by: targetMem?.id || canonical,
          supersession_reason: `Merged into canonical "${canonical}" by Autonomous Memory Curator: ${m.reason}`,
          updated_at: now
        })
        .eq('user_id', userId)
        .eq('key', m.sourceKey);

      // 3. Purge alias from working_memory
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .eq('key', m.sourceKey);

      // 4. Record to ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'autonomous_memory_curator',
          field_name: m.sourceKey,
          previous_value: m.sourceKey,
          corrected_value: `${canonical} = ${m.provenValue}`,
          reason: m.reason,
          created_at: now
        });
      } catch {}
    }
  }

  /**
   * Applies autonomous updates with conversational proof grounding.
   */
  private async applyUpdates(userId: string, updates: CurationUpdate[]): Promise<void> {
    const now = new Date().toISOString();

    for (const u of updates) {
      const canonical = canonicalizeKey(u.key).canonical;

      // Quality Gate 1: Reject non-canonical keys
      if (!isKnownCanonicalKey(canonical)) {
        logger.warn('[MemoryGraphCurator] Blocked update for non-canonical key', { userId, key: canonical });
        continue;
      }

      // Quality Gate 2: Semantic attribute value validation
      const semanticCheck = isValidMemoryAttributeValue(canonical, u.newValue);
      if (!semanticCheck.isValid) {
        logger.warn('[MemoryGraphCurator] Blocked semantically invalid update', {
          userId,
          key: canonical,
          newValue: u.newValue,
          reason: semanticCheck.reason,
        });
        continue;
      }

      // Quality Gate 3: Shared garbage value filter
      if (isGarbageMemoryValue(canonical, u.newValue, 'AutonomousMemoryCurator:applyUpdates')) {
        continue;
      }

      logger.info('[MemoryGraphCurator] Applying update', { userId, key: canonical, newValue: u.newValue, reason: u.provenChatTruth });

      const { data: existing } = await supabaseAdmin
        .from('memories')
        .select('id, value')
        .eq('user_id', userId)
        .eq('key', canonical)
        .eq('is_archived', false)
        .maybeSingle();

      if (existing) {
        if (existing.value !== u.newValue) {
          await supabaseAdmin
            .from('memories')
            .update({
              value: u.newValue,
              confidence: 1.0,
              lifecycle_state: 'CURRENT',
              source_message: `[Autonomous Memory Curator] Grounded with chat truth: ${u.provenChatTruth}`,
              updated_at: now
            })
            .eq('id', existing.id);
        }
      } else {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: canonical,
            value: u.newValue,
            memory_type: u.memoryType || 'personal',
            confidence: 1.0,
            importance: 95,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_message: `[Autonomous Memory Curator] Grounded with chat truth: ${u.provenChatTruth}`,
            created_at: now,
            updated_at: now
          });
      }

      // Sync working memory
      await supabaseAdmin
        .from('working_memory')
        .delete()
        .eq('user_id', userId)
        .eq('key', canonical);

      await supabaseAdmin
        .from('working_memory')
        .insert({
          user_id: userId,
          key: canonical,
          value: u.newValue
        });

      // Record to ledger
      try {
        await supabaseAdmin.from('nova_correction_ledger').insert({
          user_id: userId,
          correction_source: 'autonomous_memory_curator',
          field_name: canonical,
          previous_value: existing?.value || 'empty',
          corrected_value: u.newValue,
          reason: u.provenChatTruth,
          created_at: now
        });
      } catch {}
    }
  }

  /**
   * Applies autonomous additions for verified concrete facts missing from graph.
   */
  private async applyAdditions(userId: string, additions: CurationAddition[]): Promise<void> {
    const now = new Date().toISOString();

    for (const a of additions) {
      const canonical = canonicalizeKey(a.key).canonical;

      // Quality Gate 1: Reject non-canonical keys
      if (!isKnownCanonicalKey(canonical)) {
        logger.warn('[MemoryGraphCurator] Blocked addition for non-canonical key', { userId, key: canonical });
        continue;
      }

      // Quality Gate 2: Semantic attribute value validation
      const semanticCheck = isValidMemoryAttributeValue(canonical, a.value);
      if (!semanticCheck.isValid) {
        logger.warn('[MemoryGraphCurator] Blocked semantically invalid addition', {
          userId,
          key: canonical,
          value: a.value,
          reason: semanticCheck.reason,
        });
        continue;
      }

      // Quality Gate 3: Shared garbage value filter
      if (isGarbageMemoryValue(canonical, a.value, 'AutonomousMemoryCurator:applyAdditions')) {
        continue;
      }

      logger.info('[MemoryGraphCurator] Applying addition', { userId, key: canonical, value: a.value });

      const { data: existing } = await supabaseAdmin
        .from('memories')
        .select('id')
        .eq('user_id', userId)
        .eq('key', canonical)
        .eq('is_archived', false)
        .maybeSingle();

      if (!existing) {
        await supabaseAdmin
          .from('memories')
          .insert({
            user_id: userId,
            key: canonical,
            value: a.value,
            memory_type: a.memoryType || 'personal',
            confidence: 1.0,
            importance: 85,
            is_archived: false,
            lifecycle_state: 'CURRENT',
            source_message: `[Autonomous Memory Curator] Added from concrete chat proof: ${a.provenChatTruth}`,
            created_at: now,
            updated_at: now
          });

        await supabaseAdmin
          .from('working_memory')
          .insert({
            user_id: userId,
            key: canonical,
            value: a.value
          });

        try {
          await supabaseAdmin.from('nova_correction_ledger').insert({
            user_id: userId,
            correction_source: 'autonomous_memory_curator',
            field_name: canonical,
            previous_value: '[NONE]',
            corrected_value: a.value,
            reason: a.provenChatTruth,
            created_at: now
          });
        } catch {}
      }
    }
  }

  /**
   * Curates memory_bubbles table:
   * 1. Merges duplicate kinship bubbles (e.g. Papa/My Father into Suresh, Mummy into Rajeshree).
   * 2. Re-links orphaned memories & reminders to the canonical person bubble.
   * 3. Eradicates phantom phrase bubbles (e.g. 'Rehta Hai', 'Ka Name Sushant Hai', 'Mere Society Mein', 'Daily', 'Reminder', etc.).
   * 4. Purges invalid kinship vocative rows from memories table (e.g. father_name = 'Papa').
   */
  async curateMemoryBubbles(userId: string): Promise<{ bubblesMerged: number; bubblesPruned: number }> {
    let bubblesMerged = 0;
    let bubblesPruned = 0;

    const { data: bubbles, error: bubbleErr } = await supabaseAdmin
      .from('memory_bubbles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false);

    if (bubbleErr || !bubbles || bubbles.length === 0) {
      return { bubblesMerged, bubblesPruned };
    }

    // 1. Check family domain bubbles & enforce singular kinship invariants
    const familyBubbles = bubbles.filter(b => b.domain_key === 'family' && b.bubble_type === 'entity');
    const isVocativeLabel = (label: string) => /^(father|papa|pitaji|dad|my father|mere papa|mother|mummy|mom|maa|mataji|my mother|mere mummy)$/i.test((label || '').trim());

    const fatherBubble = familyBubbles.find(b => b.relation_type === 'Father' && !isVocativeLabel(b.label)) ||
      familyBubbles.find(b => b.slug === 'entity:suresh');
    const motherBubble = familyBubbles.find(b => b.relation_type === 'Mother' && !isVocativeLabel(b.label)) ||
      familyBubbles.find(b => b.slug === 'entity:rajeshree');

    // Merge Papa / My Father into Father bubble
    if (fatherBubble) {
      const phantomFatherBubbles = familyBubbles.filter(b => b.id !== fatherBubble.id && (isVocativeLabel(b.label) || b.slug === 'entity:papa' || b.slug === 'entity:my_father'));
      for (const ph of phantomFatherBubbles) {
        await supabaseAdmin.from('memories').update({ bubble_id: fatherBubble.id }).eq('user_id', userId).eq('bubble_id', ph.id);
        await supabaseAdmin.from('reminders').update({ bubble_id: fatherBubble.id }).eq('user_id', userId).eq('bubble_id', ph.id);
        await supabaseAdmin.from('memory_bubbles').update({ parent_bubble_id: fatherBubble.id }).eq('user_id', userId).eq('parent_bubble_id', ph.id);
        await supabaseAdmin.from('memory_bubbles').update({ is_archived: true, updated_at: new Date().toISOString(), metadata: { archive_reason: 'merged_into_canonical_father' } }).eq('id', ph.id);
        bubblesMerged++;
      }
    }

    // Merge Mummy / My Mother into Mother bubble
    if (motherBubble) {
      const phantomMotherBubbles = familyBubbles.filter(b => b.id !== motherBubble.id && (isVocativeLabel(b.label) || b.slug === 'entity:mummy' || b.slug === 'entity:my_mother'));
      for (const ph of phantomMotherBubbles) {
        await supabaseAdmin.from('memories').update({ bubble_id: motherBubble.id }).eq('user_id', userId).eq('bubble_id', ph.id);
        await supabaseAdmin.from('reminders').update({ bubble_id: motherBubble.id }).eq('user_id', userId).eq('bubble_id', ph.id);
        await supabaseAdmin.from('memory_bubbles').update({ parent_bubble_id: motherBubble.id }).eq('user_id', userId).eq('parent_bubble_id', ph.id);
        await supabaseAdmin.from('memory_bubbles').update({ is_archived: true, updated_at: new Date().toISOString(), metadata: { archive_reason: 'merged_into_canonical_mother' } }).eq('id', ph.id);
        bubblesMerged++;
      }
    }

    // 2. Eradicate phantom phrase bubbles
    const bannedBubblePatterns = [
      /\b(rehta hai|rehti hai|rehte hai)\b/i,
      /\b(ka name|ka naam|ki name|unka name|unka naam)\b/i,
      /\b(mere society|society mein|society issue)\b/i,
      /\b(chote bacho|bacho kapde|kapde bechte|tailor ka shop)\b/i,
      /^('s place|place for|for the)/i,
      /^(daily|reminder|drink|celebration|close friend|childhood friend|family member|acquaintance)$/i
    ];

    for (const b of bubbles) {
      if (b.bubble_type === 'domain') continue;
      const lbl = (b.label || '').trim();
      if (bannedBubblePatterns.some(p => p.test(lbl)) || lbl.length > 35) {
        await supabaseAdmin.from('memories').update({ bubble_id: null }).eq('user_id', userId).eq('bubble_id', b.id);
        await supabaseAdmin.from('reminders').update({ bubble_id: null }).eq('user_id', userId).eq('bubble_id', b.id);
        await supabaseAdmin.from('memory_bubbles').update({ is_archived: true, updated_at: new Date().toISOString(), metadata: { archive_reason: 'eradicated_phantom_phrase' } }).eq('id', b.id);
        bubblesPruned++;
      }
    }

    // 3. Purge corrupted vocatives in memories table
    await supabaseAdmin
      .from('memories')
      .update({ is_archived: true, lifecycle_state: 'INVALIDATED', supersession_reason: 'kinship_vocative_not_a_name' })
      .eq('user_id', userId)
      .eq('key', 'father_name')
      .in('value', ['Papa', 'My Father', 'Dad', 'Father', 'mere papa', 'papa']);

    await supabaseAdmin
      .from('memories')
      .update({ is_archived: true, lifecycle_state: 'INVALIDATED', supersession_reason: 'kinship_vocative_not_a_name' })
      .eq('user_id', userId)
      .eq('key', 'mother_name')
      .in('value', ['Mummy', 'Mother', 'Mom', 'Maa', 'mere mummy', 'mummy']);

    // 4. Ensure father_business & mother_occupation are properly attached
    if (fatherBubble) {
      await supabaseAdmin
        .from('memories')
        .update({ bubble_id: fatherBubble.id })
        .eq('user_id', userId)
        .or('key.eq.father_business,key.eq.father_name')
        .eq('is_archived', false);
    }

    if (motherBubble) {
      await supabaseAdmin
        .from('memories')
        .update({ bubble_id: motherBubble.id })
        .eq('user_id', userId)
        .or('key.eq.mother_occupation,key.eq.mother_name')
        .eq('is_archived', false);
    }

    return { bubblesMerged, bubblesPruned };
  }

  private capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
  }
}

export const autonomousMemoryGraphCurator = AutonomousMemoryGraphCuratorService.getInstance();
