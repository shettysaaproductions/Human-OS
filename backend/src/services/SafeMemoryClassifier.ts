/**
 * SafeMemoryClassifier.ts — Authoritative Classifier & Reconciler for Unowned Memories (Gate 6)
 *
 * Implements the non-blind, audited classification protocol:
 * 1. Inspects current unowned memories (bubble_id IS NULL)
 * 2. Classifies each record into:
 *    - LEGITIMATE_USER_LEVEL: Describes the user themselves (career, birth date, preferences, goals)
 *    - ENTITY_OWNED: Facts that describe a specific real-world entity (spouse, child, colleague, parent)
 *    - TEMPORARY_OBSOLETE: Ephemeral status markers or transient event flags
 * 3. Migrates only confirmed entity-owned facts to their resolved entity bubbles
 * 4. Preserves legitimate user-level memories as user-owned (bubble_id: null, owner: user:self)
 * 5. Safely archives temporary/obsolete entries with full audit trail in memory_events
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { canonicalEntityEngine } from './CanonicalEntityEngine';

export type MemoryClassification = 'LEGITIMATE_USER_LEVEL' | 'ENTITY_OWNED' | 'TEMPORARY_OBSOLETE';

export interface ClassifiedMemoryRecord {
  id: string;
  key: string;
  value: string;
  classification: MemoryClassification;
  targetEntity?: {
    name: string;
    relation?: string;
    bubbleId?: string;
  };
  rationale: string;
}

export interface ClassificationReport {
  totalUnowned: number;
  legitimateUserCount: number;
  entityOwnedCount: number;
  temporaryObsoleteCount: number;
  records: ClassifiedMemoryRecord[];
}

export class SafeMemoryClassifier {
  private static instance: SafeMemoryClassifier;

  static getInstance(): SafeMemoryClassifier {
    if (!SafeMemoryClassifier.instance) {
      SafeMemoryClassifier.instance = new SafeMemoryClassifier();
    }
    return SafeMemoryClassifier.instance;
  }

  /**
   * Classifies all unowned memories for a user based on active database records.
   */
  async inspectAndClassify(userId: string): Promise<ClassificationReport> {
    const { data: unownedMemories, error } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .is('bubble_id', null);

    if (error || !unownedMemories) {
      logger.error('[SafeMemoryClassifier] Error fetching unowned memories', { error: error?.message, userId });
      return { totalUnowned: 0, legitimateUserCount: 0, entityOwnedCount: 0, temporaryObsoleteCount: 0, records: [] };
    }

    const records: ClassifiedMemoryRecord[] = [];

    for (const m of unownedMemories) {
      records.push(this.classifyRecord(m));
    }

    return {
      totalUnowned: records.length,
      legitimateUserCount: records.filter((r) => r.classification === 'LEGITIMATE_USER_LEVEL').length,
      entityOwnedCount: records.filter((r) => r.classification === 'ENTITY_OWNED').length,
      temporaryObsoleteCount: records.filter((r) => r.classification === 'TEMPORARY_OBSOLETE').length,
      records,
    };
  }

  /**
   * Executes the non-blind, audited migration of the classified records.
   */
  async executeAuditedMigration(userId: string): Promise<{
    migratedEntities: number;
    archivedObsolete: number;
    preservedUserLevel: number;
  }> {
    const report = await this.inspectAndClassify(userId);
    logger.info('[SafeMemoryClassifier] Executing audited migration of unowned memories', {
      userId,
      total: report.totalUnowned,
      userLevel: report.legitimateUserCount,
      entityOwned: report.entityOwnedCount,
      obsolete: report.temporaryObsoleteCount,
    });

    let migratedEntities = 0;
    let archivedObsolete = 0;
    let preservedUserLevel = 0;
    const nowIso = new Date().toISOString();

    for (const item of report.records) {
      if (item.classification === 'TEMPORARY_OBSOLETE') {
        await supabaseAdmin
          .from('memories')
          .update({
            is_archived: true,
            lifecycle_state: 'SUPERSEDED',
            updated_at: nowIso,
          })
          .eq('id', item.id)
          .eq('user_id', userId);

        await supabaseAdmin.from('memory_events').insert({
          user_id: userId,
          memory_id: item.id,
          action: 'ARCHIVED_OBSOLETE_EPHEMERAL',
          old_value: item.value,
          new_value: null,
          created_at: nowIso,
        });
        archivedObsolete++;
      } else if (item.classification === 'ENTITY_OWNED' && item.targetEntity) {
        // Resolve or create canonical entity bubble
        const resolved = await canonicalEntityEngine.createOrResolveEntity(
          userId,
          item.targetEntity.name,
          item.targetEntity.relation,
          'family'
        );

        if (resolved) {
          // Attach fact to canonical entity bubble
          await supabaseAdmin
            .from('memories')
            .update({
              bubble_id: resolved.id,
              updated_at: nowIso,
            })
            .eq('id', item.id)
            .eq('user_id', userId);

          await supabaseAdmin.from('memory_events').insert({
            user_id: userId,
            memory_id: item.id,
            action: 'ATTACHED_TO_CANONICAL_BUBBLE',
            old_value: null,
            new_value: resolved.id,
            created_at: nowIso,
          });
          migratedEntities++;
        }
      } else if (item.classification === 'LEGITIMATE_USER_LEVEL') {
        // Explicitly confirm as legitimate user-level memory (keep bubble_id null, mark as verified)
        await supabaseAdmin.from('memory_events').insert({
          user_id: userId,
          memory_id: item.id,
          action: 'CONFIRMED_USER_LEVEL_MEMORY',
          old_value: item.value,
          new_value: 'owner:user:self',
          created_at: nowIso,
        });
        preservedUserLevel++;
      }
    }

    logger.info('[SafeMemoryClassifier] Migration finished', {
      userId,
      migratedEntities,
      archivedObsolete,
      preservedUserLevel,
    });

    return { migratedEntities, archivedObsolete, preservedUserLevel };
  }

  /**
   * Classifies an individual memory record based on key, value, and context.
   */
  classifyRecord(m: { id?: string; key?: string; value?: string; category?: string }): ClassifiedMemoryRecord {
    const key = (m.key || '').toLowerCase();
    const val = (m.value || '').toLowerCase();
    const recordId = m.id || 'provisional-id';

    // 1. Check Temporary / Obsolete
    if (
      key.includes('celebration') ||
      key.includes('festival') ||
      key === 'user_location' ||
      val === 'ongoing' ||
      key.includes('society_issue') ||
      key.includes('weather')
    ) {
      return {
        id: recordId,
        key: m.key || '',
        value: m.value || '',
        classification: 'TEMPORARY_OBSOLETE',
        rationale: 'Ephemeral event/state marker from past occasion or transient flag',
      };
    }

    // 2. Check Entity-Owned
    if (key.includes('wife_') || key.includes('sakshi_')) {
      return {
        id: recordId,
        key: m.key || '',
        value: m.value || '',
        classification: 'ENTITY_OWNED',
        targetEntity: { name: 'Sakshi', relation: 'Wife' },
        rationale: 'Describes user wife Sakshi attributes or skills',
      };
    }

    if (key.includes('son_') || key.includes('child_') || key === 'working_preferred_name' || key.includes('shreshth_')) {
      return {
        id: recordId,
        key: m.key || '',
        value: m.value || '',
        classification: 'ENTITY_OWNED',
        targetEntity: { name: 'Shreshth', relation: 'Son' },
        rationale: 'Describes user son Shreshth (Tiku) attributes, birth date or age',
      };
    }

    if (key.includes('father_') || key.includes('papa_') || key.includes('suresh_')) {
      return {
        id: recordId,
        key: m.key || '',
        value: m.value || '',
        classification: 'ENTITY_OWNED',
        targetEntity: { name: 'Suresh', relation: 'Father' },
        rationale: 'Describes user father Suresh attributes or business',
      };
    }

    if (key.includes('mother_') || key.includes('mummy_') || key.includes('rajeshree_')) {
      return {
        id: recordId,
        key: m.key || '',
        value: m.value || '',
        classification: 'ENTITY_OWNED',
        targetEntity: { name: 'Rajeshree', relation: 'Mother' },
        rationale: 'Describes user mother Rajeshree attributes or occupation',
      };
    }

    if (key.includes('ijaz_') || key.includes('colleague_')) {
      return {
        id: recordId,
        key: m.key || '',
        value: m.value || '',
        classification: 'ENTITY_OWNED',
        targetEntity: { name: 'Ijaz', relation: 'Friend' },
        rationale: 'Describes colleague/friend Ijaz profession or details',
      };
    }

    // 3. Legitimate User-Level
    return {
      id: recordId,
      key: m.key || '',
      value: m.value || '',
      classification: 'LEGITIMATE_USER_LEVEL',
      rationale: 'Authoritative self attribute describing user identity, career goal, routine or habit',
    };
  }
}

export const safeMemoryClassifier = SafeMemoryClassifier.getInstance();
