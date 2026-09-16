/**
 * MemoryInvariantAuditor.ts
 *
 * Reusable production invariant checker for Nova's hierarchical memory graph.
 * Enforces graph integrity across bubbles, memories, reminders, and cross-user boundaries.
 */

import { supabaseAdmin } from '../lib/supabase';

export interface InvariantAnomaly {
  code: string;
  severity: 'P0' | 'P1' | 'P2';
  entity: 'memory_bubbles' | 'memories' | 'reminders' | 'working_memory';
  entityId: string;
  userId: string;
  message: string;
  details?: Record<string, any>;
}

export interface InvariantAuditReport {
  timestamp: string;
  totalCheckedUsers: number;
  anomalies: InvariantAnomaly[];
  passed: boolean;
  summary: {
    orphanBubbles: number;
    cycles: number;
    duplicateEntities: number;
    orphanMemories: number;
    orphanReminders: number;
    crossUserReferences: number;
    archivedTreatedAsCurrent: number;
    supersededTreatedAsCurrent: number;
    staleProposals: number;
  };
}

export class MemoryInvariantAuditor {
  private static instance: MemoryInvariantAuditor;

  static getInstance(): MemoryInvariantAuditor {
    if (!this.instance) {
      this.instance = new MemoryInvariantAuditor();
    }
    return this.instance;
  }

  /**
   * Runs the full suite of invariant checks across all or a specific user.
   */
  async runAudit(targetUserId?: string): Promise<InvariantAuditReport> {
    const anomalies: InvariantAnomaly[] = [];
    const now = new Date().toISOString();

    // 1. Fetch bubbles
    let bubbleQuery = supabaseAdmin.from('memory_bubbles').select('*');
    if (targetUserId) bubbleQuery = bubbleQuery.eq('user_id', targetUserId);
    const { data: bubbles, error: bErr } = await bubbleQuery;
    if (bErr) throw bErr;
    const bubbleList = bubbles || [];

    // 2. Fetch memories
    let memQuery = supabaseAdmin.from('memories').select('id, user_id, bubble_id, is_archived, lifecycle_state, key, value');
    if (targetUserId) memQuery = memQuery.eq('user_id', targetUserId);
    const { data: memories, error: mErr } = await memQuery;
    if (mErr) throw mErr;
    const memList = memories || [];

    // 3. Fetch reminders
    let remQuery = supabaseAdmin.from('reminders').select('id, user_id, bubble_id, text, status');
    if (targetUserId) remQuery = remQuery.eq('user_id', targetUserId);
    const { data: reminders, error: rErr } = await remQuery;
    if (rErr) throw rErr;
    const remList = reminders || [];

    // Index bubbles
    const bubbleById = new Map<string, any>();
    for (const b of bubbleList) bubbleById.set(b.id, b);

    // ── Check 1: Orphan Bubbles & Missing Parents ──────────────────────────────
    let orphanBubbles = 0;
    for (const b of bubbleList) {
      if (!b.is_archived && b.parent_bubble_id) {
        const parent = bubbleById.get(b.parent_bubble_id);
        if (!parent || parent.is_archived) {
          orphanBubbles++;
          anomalies.push({
            code: 'INV-001-ORPHAN-BUBBLE',
            severity: 'P0',
            entity: 'memory_bubbles',
            entityId: b.id,
            userId: b.user_id,
            message: `Active bubble '${b.label}' (${b.slug}) references missing or archived parent '${b.parent_bubble_id}'`,
          });
        }
      }
    }

    // ── Check 2: Cycle Detection in Bubble Hierarchy ───────────────────────────
    let cycles = 0;
    for (const b of bubbleList) {
      if (b.parent_bubble_id) {
        const visited = new Set<string>();
        let curr = b;
        while (curr && curr.parent_bubble_id) {
          if (visited.has(curr.id)) {
            cycles++;
            anomalies.push({
              code: 'INV-002-CYCLE-DETECTED',
              severity: 'P0',
              entity: 'memory_bubbles',
              entityId: b.id,
              userId: b.user_id,
              message: `Cycle detected starting at bubble '${b.label}' (${b.id})`,
            });
            break;
          }
          visited.add(curr.id);
          curr = bubbleById.get(curr.parent_bubble_id);
        }
      }
    }

    // ── Check 3: Duplicate Active Entities ─────────────────────────────────────
    let duplicateEntities = 0;
    const activeEntityMap = new Map<string, string>();
    for (const b of bubbleList) {
      if (!b.is_archived) {
        const key = `${b.user_id}:${b.parent_bubble_id || 'root'}:${b.slug}`;
        if (activeEntityMap.has(key)) {
          duplicateEntities++;
          anomalies.push({
            code: 'INV-003-DUPLICATE-ENTITY',
            severity: 'P0',
            entity: 'memory_bubbles',
            entityId: b.id,
            userId: b.user_id,
            message: `Duplicate active entity bubble with key '${key}'`,
            details: { firstId: activeEntityMap.get(key), duplicateId: b.id },
          });
        } else {
          activeEntityMap.set(key, b.id);
        }
      }
    }

    // ── Check 4: Orphan Memories ───────────────────────────────────────────────
    let orphanMemories = 0;
    for (const m of memList) {
      if (m.bubble_id) {
        const bubble = bubbleById.get(m.bubble_id);
        if (!bubble) {
          orphanMemories++;
          anomalies.push({
            code: 'INV-004-ORPHAN-MEMORY',
            severity: 'P1',
            entity: 'memories',
            entityId: m.id,
            userId: m.user_id,
            message: `Memory '${m.key}' references non-existent bubble '${m.bubble_id}'`,
          });
        }
      }
    }

    // ── Check 5: Orphan Reminders ──────────────────────────────────────────────
    let orphanReminders = 0;
    for (const r of remList) {
      if (r.bubble_id) {
        const bubble = bubbleById.get(r.bubble_id);
        if (!bubble) {
          orphanReminders++;
          anomalies.push({
            code: 'INV-005-ORPHAN-REMINDER',
            severity: 'P1',
            entity: 'reminders',
            entityId: r.id,
            userId: r.user_id,
            message: `Reminder '${r.text}' references non-existent bubble '${r.bubble_id}'`,
          });
        }
      }
    }

    // ── Check 6: Cross-User References ─────────────────────────────────────────
    let crossUserReferences = 0;
    for (const m of memList) {
      if (m.bubble_id) {
        const bubble = bubbleById.get(m.bubble_id);
        if (bubble && bubble.user_id !== m.user_id) {
          crossUserReferences++;
          anomalies.push({
            code: 'INV-006-CROSS-USER-REFERENCE',
            severity: 'P0',
            entity: 'memories',
            entityId: m.id,
            userId: m.user_id,
            message: `Memory user '${m.user_id}' does not match bubble user '${bubble.user_id}'`,
          });
        }
      }
    }

    // ── Check 7: Lifecycle Invariants ──────────────────────────────────────────
    let archivedTreatedAsCurrent = 0;
    let supersededTreatedAsCurrent = 0;

    for (const m of memList) {
      if (m.is_archived && m.lifecycle_state === 'CURRENT') {
        archivedTreatedAsCurrent++;
        anomalies.push({
          code: 'INV-007-ARCHIVED-CURRENT-CONFLICT',
          severity: 'P1',
          entity: 'memories',
          entityId: m.id,
          userId: m.user_id,
          message: `Memory is marked archived but has lifecycle_state = 'CURRENT'`,
        });
      }
      if (!m.is_archived && m.lifecycle_state === 'SUPERSEDED') {
        supersededTreatedAsCurrent++;
        anomalies.push({
          code: 'INV-008-SUPERSEDED-ACTIVE-CONFLICT',
          severity: 'P1',
          entity: 'memories',
          entityId: m.id,
          userId: m.user_id,
          message: `Memory is marked active (is_archived = false) but has lifecycle_state = 'SUPERSEDED'`,
        });
      }
    }

    // ── Check 8: Stale Relocation Proposals ─────────────────────────────────────
    let staleProposals = 0;
    let wmQuery = supabaseAdmin.from('working_memory').select('*').like('key', '__pending_branch_relocation:%');
    if (targetUserId) wmQuery = wmQuery.eq('user_id', targetUserId);
    const { data: wmRows } = await wmQuery;

    for (const wm of wmRows || []) {
      const ageMs = Date.now() - new Date(wm.created_at).getTime();
      if (ageMs > 30 * 60 * 1000) {
        staleProposals++;
        anomalies.push({
          code: 'INV-009-STALE-PROPOSAL',
          severity: 'P2',
          entity: 'working_memory',
          entityId: wm.id,
          userId: wm.user_id,
          message: `Stale pending branch relocation proposal found (age: ${Math.round(ageMs / 60000)} mins)`,
        });
      }
    }

    const uniqueUsers = new Set([...bubbleList.map(b => b.user_id), ...memList.map(m => m.user_id)]);

    const passed = anomalies.filter(a => a.severity === 'P0').length === 0;

    return {
      timestamp: now,
      totalCheckedUsers: uniqueUsers.size,
      anomalies,
      passed,
      summary: {
        orphanBubbles,
        cycles,
        duplicateEntities,
        orphanMemories,
        orphanReminders,
        crossUserReferences,
        archivedTreatedAsCurrent,
        supersededTreatedAsCurrent,
        staleProposals,
      },
    };
  }
}

export const memoryInvariantAuditor = MemoryInvariantAuditor.getInstance();
