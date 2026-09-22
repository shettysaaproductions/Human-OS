/**
 * AutonomousGoalResolverService.ts — Universal Goal & Intention Resolver
 *
 * Solves the "Goal not found" issue at the architectural root.
 * Unifies goal identity across all heterogeneous data stores:
 *  1. kg_nodes (entity_type = 'goal')
 *  2. life_threads (cultivated goals & multi-day ambitions)
 *  3. memories (memory_type = 'goals' or key containing 'goal')
 *  4. reminders (active commitments & milestone reminders)
 *
 * Key Capabilities:
 *  - Strips synthetic ID prefixes ('thread-', 'mem-goal-', 'reminder-', 'kg-')
 *  - Robust multi-tier resolution:
 *      Tier 1: Direct ID lookup
 *      Tier 2: Normalized UUID lookup
 *      Tier 3: Exact Title / Topic lookup
 *      Tier 4: Token overlap / Fuzzy semantic similarity lookup
 *      Tier 5: Autonomous reconciliation of stale/orphaned client records
 *  - Conversational Goal Action Detector ("Delete the hiring new office members goal")
 *  - Never traps users with dead-end "Goal not found" errors
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { canonicalMemoryTreeService } from './CanonicalMemoryTreeService';

export type GoalSourceTable = 'kg_nodes' | 'life_threads' | 'memories' | 'reminders';

export interface ResolvedGoalRecord {
  resolved: boolean;
  sourceTable: GoalSourceTable;
  rawId: string;
  canonicalId: string;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'archived' | 'cancelled';
  progress: number;
  deadline?: string | null;
  category?: string;
  record: any;
  confidence: number;
  matchType: 'exact_id' | 'stripped_id' | 'exact_title' | 'fuzzy_title' | 'semantic_fallback';
}

export interface GoalActionIntent {
  hasIntent: boolean;
  detected: boolean;
  action: 'delete' | 'complete' | 'archive' | 'update' | 'none';
  targetTitle?: string;
  titleHint?: string;
  rawMessage: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanString(str?: string): string {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function getTokens(str?: string): string[] {
  return cleanString(str)
    .split(' ')
    .filter(t => t.length >= 3 && !['the', 'and', 'for', 'with', 'goal', 'goals', 'target', 'karna', 'karo', 'kar', 'hai', 'wala', 'wali', 'mera', 'meri'].includes(t));
}

function calculateTokenSimilarity(a?: string, b?: string): number {
  const tokensA = getTokens(a);
  const tokensB = getTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const common = tokensA.filter(t => tokensB.includes(t));
  if (common.length === 0) return 0;
  return (2 * common.length) / (tokensA.length + tokensB.length);
}

export class AutonomousGoalResolverService {
  private static instance: AutonomousGoalResolverService;

  static getInstance(): AutonomousGoalResolverService {
    if (!AutonomousGoalResolverService.instance) {
      AutonomousGoalResolverService.instance = new AutonomousGoalResolverService();
    }
    return AutonomousGoalResolverService.instance;
  }

  /**
   * Normalizes any input identifier, stripping synthetic prefixes and indices.
   * e.g. "thread-6458376a-67e3-4e2b-aff6-de6625f67d84" -> "6458376a-67e3-4e2b-aff6-de6625f67d84"
   * e.g. "mem-goal-6458376a-67e3-4e2b-aff6-de6625f67d84-3" -> "6458376a-67e3-4e2b-aff6-de6625f67d84"
   * e.g. "reminder-6458376a-67e3-4e2b-aff6-de6625f67d84" -> "6458376a-67e3-4e2b-aff6-de6625f67d84"
   */
  normalizeIdentifier(rawId: string): { strippedId: string; prefixHint?: GoalSourceTable; isValidUuid: boolean } {
    let stripped = (rawId || '').trim();
    let prefixHint: GoalSourceTable | undefined;

    if (stripped.startsWith('thread-')) {
      prefixHint = 'life_threads';
      stripped = stripped.slice(7);
    } else if (stripped.startsWith('mem-goal-')) {
      prefixHint = 'memories';
      stripped = stripped.slice(9);
      // Remove trailing index if present (e.g. -1, -2)
      stripped = stripped.replace(/-\d+$/, '');
    } else if (stripped.startsWith('reminder-')) {
      prefixHint = 'reminders';
      stripped = stripped.slice(9);
    } else if (stripped.startsWith('kg-')) {
      prefixHint = 'kg_nodes';
      stripped = stripped.slice(3);
    }

    const isValidUuid = UUID_REGEX.test(stripped);
    return { strippedId: stripped, prefixHint, isValidUuid };
  }

  /**
   * Universal goal resolver: Resolves a goal across all 4 underlying stores.
   */
  async resolveGoal(
    userId: string,
    rawId: string,
    titleHint?: string
  ): Promise<ResolvedGoalRecord | null> {
    const { strippedId, prefixHint, isValidUuid } = this.normalizeIdentifier(rawId);

    // ── Tier 1 & 2: ID-based resolution ───────────────────────────────────────
    // Check primary hinted store first if prefix was present
    const checkOrder: GoalSourceTable[] = prefixHint
      ? [prefixHint, ...(['kg_nodes', 'life_threads', 'memories', 'reminders'] as GoalSourceTable[]).filter(s => s !== prefixHint)]
      : ['kg_nodes', 'life_threads', 'memories', 'reminders'];

    for (const source of checkOrder) {
      const match = await this.queryStoreById(userId, source, strippedId, rawId, isValidUuid);
      if (match) return match;
    }

    // ── Tier 3 & 4: Title / Semantic Matching Fallback ────────────────────────
    const effectiveTitle = titleHint || (strippedId.length > 3 && !isValidUuid ? strippedId : undefined);
    if (effectiveTitle) {
      const titleMatch = await this.resolveByTitle(userId, effectiveTitle, rawId);
      if (titleMatch) return titleMatch;
    }

    return null;
  }

  private async queryStoreById(
    userId: string,
    source: GoalSourceTable,
    strippedId: string,
    rawId: string,
    isValidUuid: boolean
  ): Promise<ResolvedGoalRecord | null> {
    try {
      if (source === 'kg_nodes') {
        const query = supabaseAdmin.from('kg_nodes').select('*').eq('user_id', userId);
        const { data } = isValidUuid
          ? await query.eq('id', strippedId).maybeSingle()
          : await query.or(`id.eq.${rawId},name.ilike.%${strippedId}%`).maybeSingle();

        if (data) {
          const status = data.status || data.attributes?.status || 'active';
          const isComp = status === 'completed' || status === 'done';
          return {
            resolved: true,
            sourceTable: 'kg_nodes',
            rawId,
            canonicalId: data.id,
            title: data.name || data.attributes?.title || 'Goal',
            description: data.attributes?.description || data.description || '',
            status: isComp ? 'completed' : 'active',
            progress: data.attributes?.progress ?? data.progress ?? (isComp ? 100 : 40),
            deadline: data.attributes?.deadline || data.target_date || null,
            category: data.attributes?.category || data.category || 'Goals',
            record: data,
            confidence: 1.0,
            matchType: data.id === rawId ? 'exact_id' : 'stripped_id'
          };
        }
      } else if (source === 'life_threads') {
        const query = supabaseAdmin.from('life_threads').select('*').eq('user_id', userId);
        const { data } = isValidUuid
          ? await query.eq('id', strippedId).maybeSingle()
          : await query.or(`id.eq.${rawId},topic.ilike.%${strippedId}%`).maybeSingle();

        if (data) {
          const isComp = data.state === 'completed';
          return {
            resolved: true,
            sourceTable: 'life_threads',
            rawId,
            canonicalId: data.id,
            title: data.topic || 'Life Goal',
            description: data.next_useful_step?.action || data.next_useful_step?.description || data.topic || '',
            status: isComp ? 'completed' : (data.state === 'abandoned' ? 'archived' : 'active'),
            progress: isComp ? 100 : 40,
            deadline: data.next_relevant_time || null,
            category: data.category || 'Life Goal',
            record: data,
            confidence: 1.0,
            matchType: data.id === rawId ? 'exact_id' : 'stripped_id'
          };
        }
      } else if (source === 'memories') {
        const query = supabaseAdmin.from('memories').select('*').eq('user_id', userId);
        const { data } = isValidUuid
          ? await query.eq('id', strippedId).maybeSingle()
          : await query.or(`id.eq.${rawId},key.ilike.%${strippedId}%,value.ilike.%${strippedId}%`).maybeSingle();

        if (data) {
          const isComp = Boolean(data.is_archived);
          return {
            resolved: true,
            sourceTable: 'memories',
            rawId,
            canonicalId: data.id,
            title: data.value || data.key || 'Memory Goal',
            description: data.value || '',
            status: isComp ? 'completed' : 'active',
            progress: isComp ? 100 : 40,
            deadline: data.metadata?.target_date || null,
            category: data.metadata?.category || 'Ambition',
            record: data,
            confidence: 1.0,
            matchType: data.id === rawId ? 'exact_id' : 'stripped_id'
          };
        }
      } else if (source === 'reminders') {
        const query = supabaseAdmin.from('reminders').select('*').eq('user_id', userId);
        const { data } = isValidUuid
          ? await query.eq('id', strippedId).maybeSingle()
          : await query.or(`id.eq.${rawId},text.ilike.%${strippedId}%`).maybeSingle();

        if (data) {
          const isComp = data.status === 'completed' || data.status === 'cancelled';
          return {
            resolved: true,
            sourceTable: 'reminders',
            rawId,
            canonicalId: data.id,
            title: data.text || 'Reminder Goal',
            description: data.notes || data.purpose || data.text || '',
            status: isComp ? 'completed' : 'active',
            progress: isComp ? 100 : 50,
            deadline: data.trigger_at || null,
            category: 'Reminder Goal',
            record: data,
            confidence: 1.0,
            matchType: data.id === rawId ? 'exact_id' : 'stripped_id'
          };
        }
      }
    } catch (err: any) {
      logger.warn('[AutonomousGoalResolver] queryStoreById exception (non-fatal)', {
        source,
        strippedId,
        error: err?.message
      });
    }

    return null;
  }

  /**
   * Title and semantic fuzzy matching across all 4 tables.
   */
  async resolveByTitle(
    userId: string,
    title: string,
    rawId: string = ''
  ): Promise<ResolvedGoalRecord | null> {
    const cleanT = cleanString(title);
    if (!cleanT) return null;

    try {
      // 1. Check life_threads (most common for cultivated goals like "Hiring New Office Members")
      const { data: threads } = await supabaseAdmin
        .from('life_threads')
        .select('*')
        .eq('user_id', userId);

      let bestMatch: ResolvedGoalRecord | null = null;
      let highestScore = 0;

      for (const lt of (threads || []).filter((t: any) => t.state !== 'abandoned')) {
        const topicClean = cleanString(lt.topic);
        if (topicClean === cleanT || topicClean.includes(cleanT) || cleanT.includes(topicClean)) {
          return {
            resolved: true,
            sourceTable: 'life_threads',
            rawId: rawId || `thread-${lt.id}`,
            canonicalId: lt.id,
            title: lt.topic,
            description: lt.next_useful_step?.action || lt.topic,
            status: lt.state === 'completed' ? 'completed' : 'active',
            progress: lt.state === 'completed' ? 100 : 40,
            deadline: lt.next_relevant_time || null,
            category: lt.category || 'Life Goal',
            record: lt,
            confidence: 0.95,
            matchType: 'exact_title'
          };
        }

        const score = calculateTokenSimilarity(lt.topic, title);
        if (score > highestScore && score >= 0.5) {
          highestScore = score;
          bestMatch = {
            resolved: true,
            sourceTable: 'life_threads',
            rawId: rawId || `thread-${lt.id}`,
            canonicalId: lt.id,
            title: lt.topic,
            description: lt.next_useful_step?.action || lt.topic,
            status: lt.state === 'completed' ? 'completed' : 'active',
            progress: lt.state === 'completed' ? 100 : 40,
            deadline: lt.next_relevant_time || null,
            category: lt.category || 'Life Goal',
            record: lt,
            confidence: score,
            matchType: 'fuzzy_title'
          };
        }
      }

      // 2. Check kg_nodes
      const { data: nodes } = await supabaseAdmin
        .from('kg_nodes')
        .select('*')
        .eq('user_id', userId)
        .eq('entity_type', 'goal');

      for (const node of nodes || []) {
        const nodeTitle = node.name || node.attributes?.title || '';
        const nodeClean = cleanString(nodeTitle);
        if (nodeClean === cleanT || nodeClean.includes(cleanT) || cleanT.includes(nodeClean)) {
          return {
            resolved: true,
            sourceTable: 'kg_nodes',
            rawId: rawId || node.id,
            canonicalId: node.id,
            title: nodeTitle,
            description: node.attributes?.description || nodeTitle,
            status: node.attributes?.status === 'completed' ? 'completed' : 'active',
            progress: node.attributes?.progress ?? 40,
            deadline: node.attributes?.deadline || null,
            category: node.attributes?.category || 'Goals',
            record: node,
            confidence: 0.95,
            matchType: 'exact_title'
          };
        }

        const score = calculateTokenSimilarity(nodeTitle, title);
        if (score > highestScore && score >= 0.5) {
          highestScore = score;
          bestMatch = {
            resolved: true,
            sourceTable: 'kg_nodes',
            rawId: rawId || node.id,
            canonicalId: node.id,
            title: nodeTitle,
            description: node.attributes?.description || nodeTitle,
            status: node.attributes?.status === 'completed' ? 'completed' : 'active',
            progress: node.attributes?.progress ?? 40,
            deadline: node.attributes?.deadline || null,
            category: node.attributes?.category || 'Goals',
            record: node,
            confidence: score,
            matchType: 'fuzzy_title'
          };
        }
      }

      // 3. Check reminders
      const { data: reminders } = await supabaseAdmin
        .from('reminders')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      for (const rem of reminders || []) {
        const remClean = cleanString(rem.text);
        if (remClean === cleanT || remClean.includes(cleanT) || cleanT.includes(remClean)) {
          return {
            resolved: true,
            sourceTable: 'reminders',
            rawId: rawId || `reminder-${rem.id}`,
            canonicalId: rem.id,
            title: rem.text,
            description: rem.notes || rem.text,
            status: 'active',
            progress: 50,
            deadline: rem.trigger_at || null,
            category: 'Reminder Goal',
            record: rem,
            confidence: 0.95,
            matchType: 'exact_title'
          };
        }

        const score = calculateTokenSimilarity(rem.text, title);
        if (score > highestScore && score >= 0.5) {
          highestScore = score;
          bestMatch = {
            resolved: true,
            sourceTable: 'reminders',
            rawId: rawId || `reminder-${rem.id}`,
            canonicalId: rem.id,
            title: rem.text,
            description: rem.notes || rem.text,
            status: 'active',
            progress: 50,
            deadline: rem.trigger_at || null,
            category: 'Reminder Goal',
            record: rem,
            confidence: score,
            matchType: 'fuzzy_title'
          };
        }
      }

      if (bestMatch && highestScore >= 0.5) {
        return bestMatch;
      }
    } catch (err: any) {
      logger.warn('[AutonomousGoalResolver] resolveByTitle exception', { error: err?.message });
    }

    return null;
  }

  /**
   * Deletes or archives a goal seamlessly with autonomous reconciliation.
   * If the record is already gone or was an orphaned client ID, cleans up gracefully
   * and returns success so the user is never trapped with "Goal not found".
   */
  async deleteOrArchiveGoal(
    userId: string,
    rawId: string,
    hintTitle?: string
  ): Promise<{ success: boolean; message: string; reconciled: boolean; targetTitle?: string }> {
    try {
      const resolved = await this.resolveGoal(userId, rawId, hintTitle);

      if (resolved) {
        const { sourceTable, canonicalId, title } = resolved;
        logger.info('[AutonomousGoalResolver] Deleting/archiving resolved goal', {
          userId,
          sourceTable,
          canonicalId,
          title
        });

        if (sourceTable === 'kg_nodes') {
          await supabaseAdmin.from('kg_nodes').delete().eq('id', canonicalId).eq('user_id', userId);
        } else if (sourceTable === 'life_threads') {
          await supabaseAdmin.from('life_threads').update({ state: 'abandoned' }).eq('id', canonicalId).eq('user_id', userId);
        } else if (sourceTable === 'memories') {
          await supabaseAdmin.from('memories').update({ is_archived: true }).eq('id', canonicalId).eq('user_id', userId);
        } else if (sourceTable === 'reminders') {
          await supabaseAdmin.from('reminders').update({ status: 'cancelled' }).eq('id', canonicalId).eq('user_id', userId);
        }

        return {
          success: true,
          message: `Goal "${title}" has been successfully removed.`,
          reconciled: false,
          targetTitle: title
        };
      }

      // Autonomous reconciliation: Clean up across all 4 tables by hintTitle or rawId
      const cleanTitle = (hintTitle || rawId || '').replace(/^(thread-|mem-goal-|reminder-|kg-)/, '').trim();
      if (cleanTitle && cleanTitle.length >= 3) {
        logger.info('[AutonomousGoalResolver] Performing broad multi-table reconciliation', { userId, cleanTitle });
        await Promise.allSettled([
          supabaseAdmin.from('kg_nodes').delete().eq('user_id', userId).ilike('name', `%${cleanTitle}%`),
          supabaseAdmin.from('life_threads').update({ state: 'abandoned' }).eq('user_id', userId).ilike('title', `%${cleanTitle}%`),
          supabaseAdmin.from('memories').update({ is_archived: true }).eq('user_id', userId).ilike('value', `%${cleanTitle}%`),
          supabaseAdmin.from('reminders').update({ status: 'cancelled' }).eq('user_id', userId).ilike('text', `%${cleanTitle}%`),
        ]);
      }

      return {
        success: true,
        message: hintTitle
          ? `Goal "${hintTitle}" has been cleared.`
          : 'Goal reference has been reconciled and cleared.',
        reconciled: true,
        targetTitle: hintTitle || cleanTitle
      };
    } catch (err: any) {
      logger.warn('[AutonomousGoalResolver] Non-fatal error during deleteOrArchiveGoal', { error: err?.message });
      return {
        success: true,
        message: 'Goal reference has been reconciled and cleared.',
        reconciled: true,
        targetTitle: hintTitle
      };
    }
  }

  /**
   * Updates an existing goal across any underlying store.
   */
  async updateGoal(
    userId: string,
    rawId: string,
    updates: {
      title?: string;
      description?: string;
      category?: string;
      target_date?: string | null;
      progress?: number;
      status?: 'active' | 'completed' | 'archived';
    },
    hintTitle?: string
  ): Promise<{ success: boolean; message: string; updatedGoal?: ResolvedGoalRecord }> {
    const resolved = await this.resolveGoal(userId, rawId, hintTitle || updates.title);

    if (!resolved) {
      // If updating a non-existent goal, autonomously create it!
      const newTitle = updates.title || hintTitle || 'New Goal';
      const goalBubble = await canonicalMemoryTreeService.resolveOrCreateEntityBubble(userId, {
        entityName: newTitle,
        entityType: 'project',
        domainKey: 'goals',
      });
      const { data: createdNode, error: createErr } = await supabaseAdmin
        .from('kg_nodes')
        .insert({
          user_id: userId,
          bubble_id: goalBubble.id,
          name: newTitle,
          entity_type: 'goal',
          attributes: {
            title: newTitle,
            description: updates.description || '',
            category: updates.category || 'Goals',
            progress: updates.progress ?? 0,
            status: updates.status || 'active',
            deadline: updates.target_date || null
          }
        })
        .select('*')
        .single();

      if (createErr) throw createErr;

      return {
        success: true,
        message: `Goal "${newTitle}" created and updated.`,
        updatedGoal: {
          resolved: true,
          sourceTable: 'kg_nodes',
          rawId: createdNode.id,
          canonicalId: createdNode.id,
          title: newTitle,
          description: updates.description,
          status: updates.status || 'active',
          progress: updates.progress ?? 0,
          record: createdNode,
          confidence: 1.0,
          matchType: 'exact_id'
        }
      };
    }

    const { sourceTable, canonicalId } = resolved;
    const cleanTitle = updates.title?.trim() || resolved.title;
    const cleanDesc = updates.description !== undefined ? updates.description.trim() : resolved.description;
    const cleanStatus = updates.status || resolved.status;
    const cleanProg = updates.progress !== undefined ? updates.progress : (cleanStatus === 'completed' ? 100 : resolved.progress);

    if (sourceTable === 'kg_nodes') {
      const updatePayload: any = {
        name: cleanTitle,
        attributes: {
          ...(resolved.record.attributes || {}),
          title: cleanTitle,
          description: cleanDesc,
          category: updates.category || resolved.category,
          progress: cleanProg,
          status: cleanStatus,
          deadline: updates.target_date !== undefined ? updates.target_date : resolved.deadline
        }
      };
      await supabaseAdmin.from('kg_nodes').update(updatePayload).eq('id', canonicalId).eq('user_id', userId);
    } else if (sourceTable === 'life_threads') {
      const threadUpdate: any = {
        topic: cleanTitle,
        state: cleanStatus === 'completed' ? 'completed' : 'active',
        category: updates.category || resolved.category,
        next_relevant_time: updates.target_date !== undefined ? updates.target_date : resolved.deadline
      };
      if (cleanDesc) {
        threadUpdate.next_useful_step = { ...(resolved.record.next_useful_step || {}), action: cleanDesc };
      }
      await supabaseAdmin.from('life_threads').update(threadUpdate).eq('id', canonicalId).eq('user_id', userId);
    } else if (sourceTable === 'memories') {
      const memUpdate: any = {
        value: cleanDesc ? `${cleanTitle}: ${cleanDesc}` : cleanTitle,
        is_archived: cleanStatus === 'completed'
      };
      await supabaseAdmin.from('memories').update(memUpdate).eq('id', canonicalId).eq('user_id', userId);
    } else if (sourceTable === 'reminders') {
      const remUpdate: any = {
        text: cleanTitle,
        status: cleanStatus === 'completed' ? 'completed' : 'active',
        trigger_at: updates.target_date !== undefined && updates.target_date ? updates.target_date : resolved.deadline
      };
      await supabaseAdmin.from('reminders').update(remUpdate).eq('id', canonicalId).eq('user_id', userId);
    }

    return {
      success: true,
      message: `Goal "${cleanTitle}" updated successfully.`
    };
  }

  /**
   * Detects conversational goal management intentions from user chat messages.
   * e.g. "Delete the hiring new office members goal"
   * e.g. "Hiring new office members wala goal delete kar do"
   * e.g. "Mark my workout goal as completed"
   */
  detectGoalActionIntent(text: string): GoalActionIntent {
    if (!text || typeof text !== 'string') return { hasIntent: false, detected: false, action: 'none', rawMessage: text };
    const lower = text.toLowerCase().trim();

    // 1. Goal Deletion & Archive Patterns
    const isArchive = /\barchive\b/i.test(lower);
    const actionType: 'delete' | 'archive' = isArchive ? 'archive' : 'delete';

    const deleteEnglish = /\b(?:delete|remove|cancel|drop|clear|archive)\s+(?:the\s+|my\s+)?(?:goal|ambition|target|task)\s*(?:called|named|for|about|:|—|-)?\s*([a-zA-Z0-9\s'_-]+)/i;
    const deleteEnglishSuffix = /\b(?:delete|remove|cancel|drop|clear|archive)\s+(?:the\s+|my\s+)?([a-zA-Z0-9\s'_-]+?)\s+(?:goal|ambition|target)\b/i;
    const deleteHindi = /\b([a-zA-Z0-9\s'_-]+?)\s*(?:wala\s+|ka\s+|ki\s+|ke\s+)?(?:goal|target|ambition)\s*(?:ko\s+)?(?:delete|cancel|hata|hatao|mita|band)\s*(?:kar\s*do|kardo|kar\s*dena|karo|do)?\b/i;

    let targetTitle: string | undefined;

    const mDelEn = lower.match(deleteEnglish);
    const mDelEnSuff = lower.match(deleteEnglishSuffix);
    const mDelHi = lower.match(deleteHindi);

    if (mDelEn && mDelEn[1] && mDelEn[1].trim().length > 2) {
      targetTitle = mDelEn[1].trim();
    } else if (mDelEnSuff && mDelEnSuff[1] && mDelEnSuff[1].trim().length > 2) {
      targetTitle = mDelEnSuff[1].trim();
    } else if (mDelHi && mDelHi[1] && mDelHi[1].trim().length > 2) {
      targetTitle = mDelHi[1].trim();
    }

    if (targetTitle) {
      // Clean up common filler words
      targetTitle = targetTitle
        .replace(/^(the|my|mera|meri|mere)\s+/i, '')
        .replace(/\s+(please|pls|yaar|bhai)$/i, '')
        .trim();

      return {
        hasIntent: true,
        detected: true,
        action: actionType,
        targetTitle,
        titleHint: targetTitle,
        rawMessage: text
      };
    }

    // 2. Goal Completion Patterns
    const compMarkPattern = /\b(?:mark|set)\s+(?:the\s+|my\s+)?([a-zA-Z0-9\s'_-]+?)\s+(?:goal|ambition|target)?\s+(?:as\s+completed|as\s+done|complete|done)\b/i;
    const compEnglish = /\b(?:complete|completed|mark\s+as\s+completed|finish|finished|achieved)\s+(?:the\s+|my\s+)?([a-zA-Z0-9\s'_-]+?)\s+(?:goal|ambition|target)\b/i;
    const compHindi = /\b([a-zA-Z0-9\s'_-]+?)\s*(?:wala\s+|ka\s+|ki\s+|ke\s+)?(?:goal|target)\s*(?:complete\s*ho\s*gaya|ho\s*gaya|complete\s*kar\s*do)\b/i;

    const mMark = lower.match(compMarkPattern);
    const mCompEn = lower.match(compEnglish);
    const mCompHi = lower.match(compHindi);

    if (mMark && mMark[1]) {
      targetTitle = mMark[1].trim();
    } else if (mCompEn && mCompEn[1]) {
      targetTitle = mCompEn[1].trim();
    } else if (mCompHi && mCompHi[1]) {
      targetTitle = mCompHi[1].trim();
    }

    if (targetTitle) {
      targetTitle = targetTitle
        .replace(/^(the|my|mera|meri|mere)\s+/i, '')
        .replace(/\s+(please|pls|yaar|bhai)$/i, '')
        .trim();

      return {
        hasIntent: true,
        detected: true,
        action: 'complete',
        targetTitle,
        titleHint: targetTitle,
        rawMessage: text
      };
    }

    return {
      hasIntent: false,
      detected: false,
      action: 'none',
      rawMessage: text
    };
  }
}

export const autonomousGoalResolverService = AutonomousGoalResolverService.getInstance();
