/**
 * AccountLifecycleService.ts — Phase 2F-E Canonical Account Lifecycle & Deletion Engine
 *
 * Responsibilities:
 * 1. Single authoritative entry point for complete, deterministic, irreversible account eradication ("Mark Dead").
 * 2. Exhaustive 32-table deletion inventory executed in strict topological dependency order.
 * 3. Primary Key fix: Deletes from `profiles` using `.eq('id', userId)` (NOT `user_id`).
 * 4. Safe detection and auditable cleanup of confirmed zombie/orphan accounts (profiles without auth.users records).
 * 5. Cache invalidation and verification logging.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';

export interface TableCleanupResult {
  table: string;
  deletedCount: number;
  status: 'ok' | 'error' | 'skipped';
  error?: string;
}

export interface AccountDeletionResult {
  success: boolean;
  userId: string;
  authDeleted: boolean;
  profileDeleted: boolean;
  tablesCleaned: Record<string, number>;
  errors: string[];
  durationMs: number;
}

export interface ZombieScanResult {
  totalProfiles: number;
  activeLinkedCount: number;
  zombieCount: number;
  zombieProfiles: Array<{
    id: string;
    preferredName: string | null;
    onboardingCompleted: boolean;
    createdAt?: string;
    ownedRowCounts: Record<string, number>;
  }>;
}

export class AccountLifecycleService {
  /**
   * Complete inventory of user-owned application/cognitive tables
   * in strict topological deletion order (child tables first).
   */
  public static readonly USER_OWNED_TABLES: Array<{ table: string; userColumn: string }> = [
    // 1. Knowledge Graph (edges first, then nodes)
    { table: 'kg_edges', userColumn: 'user_id' },
    { table: 'kg_nodes', userColumn: 'user_id' },

    // 2. Guardian System (repairs -> anomalies -> runs)
    { table: 'nova_guardian_repairs', userColumn: 'user_id' },
    { table: 'nova_guardian_anomalies', userColumn: 'user_id' },
    { table: 'nova_guardian_runs', userColumn: 'user_id' },

    // 3. Cognitive Doubts & Concurrency Leases
    { table: 'nova_cognitive_doubts', userColumn: 'user_id' },
    { table: 'candidate_synthesis_claims', userColumn: 'user_id' },

    // 4. Autonomous Actions & Life Threads (actions first, then threads)
    { table: 'nova_actions', userColumn: 'user_id' },
    { table: 'life_threads', userColumn: 'user_id' },

    // 5. Scheduled Events, Followups & Reminders
    { table: 'nova_followups', userColumn: 'user_id' },
    { table: 'reminders', userColumn: 'user_id' },
    { table: 'nova_agenda', userColumn: 'user_id' },
    { table: 'nova_outreach_log', userColumn: 'user_id' },
    { table: 'user_routines', userColumn: 'user_id' },
    { table: 'nova_corrections_log', userColumn: 'user_id' },
    { table: 'action_idempotency', userColumn: 'user_id' },

    // 6. User Experience, Moments & Feedback
    { table: 'user_moments', userColumn: 'user_id' },
    { table: 'user_moment_preferences', userColumn: 'user_id' },
    { table: 'user_presence', userColumn: 'user_id' },
    { table: 'user_feedback', userColumn: 'user_id' },
    { table: 'reflections', userColumn: 'user_id' },
    { table: 'emotional_states', userColumn: 'user_id' },

    // 7. Conversations & Sessions
    { table: 'conversation_sessions', userColumn: 'user_id' },
    { table: 'chat_history', userColumn: 'user_id' },

    // 8. Cognitive Memories
    { table: 'short_term_memories', userColumn: 'user_id' },
    { table: 'working_memory', userColumn: 'user_id' },
    { table: 'episodic_memories', userColumn: 'user_id' },
    { table: 'memory_access_log', userColumn: 'user_id' },
    { table: 'memory_events', userColumn: 'user_id' },
    { table: 'memories', userColumn: 'user_id' },

    // 9. Core Profile (PK is 'id', NOT 'user_id')
    { table: 'profiles', userColumn: 'id' },
  ];

  /**
   * Nuclear Account Deletion ("Mark Dead").
   * Authoritative, irreversible eradication of an account and all its user-owned data.
   */
  public async deleteAccount(userId: string): Promise<AccountDeletionResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const tablesCleaned: Record<string, number> = {};
    let authDeleted = false;
    let profileDeleted = false;

    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new Error('Cannot delete account: invalid or empty userId');
    }

    const cleanUserId = userId.trim();
    logger.info('[AccountLifecycle] Initiating complete account eradication', { userId: cleanUserId });

    // ── STEP 1: Disassociate Telemetry Events (SET NULL for anonymized retention) ──
    try {
      await supabaseAdmin
        .from('telemetry_events')
        .update({ user_id: null })
        .eq('user_id', cleanUserId);
    } catch (e: any) {
      logger.warn('[AccountLifecycle] Telemetry anonymization notice', { error: e.message });
    }

    // ── STEP 2: Delete All User-Scoped Application & Cognitive Tables ──────────────
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      try {
        const { count, error } = await supabaseAdmin
          .from(item.table)
          .delete({ count: 'exact' })
          .eq(item.userColumn, cleanUserId);

        if (error) {
          const errMsg = `Failed to delete from ${item.table}: ${error.message}`;
          logger.error(`[AccountLifecycle] ${errMsg}`);
          errors.push(errMsg);
          tablesCleaned[item.table] = 0;
        } else {
          tablesCleaned[item.table] = count || 0;
          if (item.table === 'profiles' && (count || 0) > 0) {
            profileDeleted = true;
          }
        }
      } catch (tableErr: any) {
        const errMsg = `Exception deleting from ${item.table}: ${tableErr.message}`;
        logger.error(`[AccountLifecycle] ${errMsg}`);
        errors.push(errMsg);
        tablesCleaned[item.table] = 0;
      }
    }

    // ── STEP 3: Delete Auth User from Supabase Auth ────────────────────────────────
    try {
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(cleanUserId);
      if (authErr) {
        // If the auth user was already deleted, treat as success
        if (authErr.message?.includes('User not found') || (authErr as any).status === 404) {
          authDeleted = true;
        } else {
          const errMsg = `Failed to delete auth user identity: ${authErr.message}`;
          logger.error(`[AccountLifecycle] ${errMsg}`);
          errors.push(errMsg);
        }
      } else {
        authDeleted = true;
      }
    } catch (authException: any) {
      const errMsg = `Exception during auth user deletion: ${authException.message}`;
      logger.error(`[AccountLifecycle] ${errMsg}`);
      errors.push(errMsg);
    }

    // ── STEP 4: Invalidate In-Memory Caches ─────────────────────────────────────────
    try {
      cache.invalidate(`profile:${cleanUserId}`);
      cache.invalidate(`memories:${cleanUserId}`);
    } catch (cacheErr: any) {
      logger.warn('[AccountLifecycle] Cache invalidation notice', { error: cacheErr.message });
    }

    const durationMs = Date.now() - startTime;
    const isSuccess = errors.length === 0 && authDeleted;

    logger.info('[AccountLifecycle] Account eradication completed', {
      userId: cleanUserId,
      success: isSuccess,
      authDeleted,
      profileDeleted,
      totalTablesCleaned: Object.keys(tablesCleaned).length,
      durationMs,
      errorCount: errors.length,
    });

    return {
      success: isSuccess,
      userId: cleanUserId,
      authDeleted,
      profileDeleted,
      tablesCleaned,
      errors,
      durationMs,
    };
  }

  /**
   * Scans production database for confirmed zombie profiles
   * (profiles where profile.id does not exist in auth.users).
   * Strictly READ-ONLY.
   */
  public async scanZombieProfiles(): Promise<ZombieScanResult> {
    // 1. Fetch all auth users
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authErr) throw new Error(`Failed to list auth users: ${authErr.message}`);

    const activeAuthUserIds = new Set((authData?.users || []).map(u => u.id));

    // 2. Fetch all profiles
    const { data: profiles, error: profErr } = await supabaseAdmin.from('profiles').select('*');
    if (profErr) throw new Error(`Failed to list profiles: ${profErr.message}`);

    const allProfiles = profiles || [];
    const zombieList: ZombieScanResult['zombieProfiles'] = [];
    let activeLinkedCount = 0;

    for (const p of allProfiles) {
      if (activeAuthUserIds.has(p.id)) {
        activeLinkedCount++;
      } else {
        zombieList.push({
          id: p.id,
          preferredName: p.preferred_name || null,
          onboardingCompleted: p.onboarding_completed || false,
          createdAt: p.created_at || undefined,
          ownedRowCounts: {},
        });
      }
    }

    if (zombieList.length > 0) {
      const zombieIds = zombieList.map(z => z.id);
      const zombieMap = new Map(zombieList.map(z => [z.id, z]));

      // Query each table once for all zombie IDs in parallel
      await Promise.all(
        AccountLifecycleService.USER_OWNED_TABLES.map(async item => {
          if (item.table === 'profiles') return;
          try {
            const { data: rows } = await supabaseAdmin
              .from(item.table)
              .select(item.userColumn)
              .in(item.userColumn, zombieIds);

            if (rows && rows.length > 0) {
              for (const r of rows as any[]) {
                const uid = r[item.userColumn];
                if (uid && zombieMap.has(uid)) {
                  const z = zombieMap.get(uid)!;
                  z.ownedRowCounts[item.table] = (z.ownedRowCounts[item.table] || 0) + 1;
                }
              }
            }
          } catch {
            // Ignore missing table during scan
          }
        })
      );
    }

    return {
      totalProfiles: allProfiles.length,
      activeLinkedCount,
      zombieCount: zombieList.length,
      zombieProfiles: zombieList,
    };
  }

  /**
   * Controlled, safe purging of confirmed zombie account residue.
   * Only deletes records belonging to a profile ID verified NOT to exist in auth.users.
   */
  public async purgeConfirmedZombie(zombieProfileId: string): Promise<AccountDeletionResult> {
    // Defense-in-depth: Verify that this ID is NOT in auth.users
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(zombieProfileId);
    if (authUser?.user) {
      throw new Error(`CRITICAL ABORT: Refusing to purge ${zombieProfileId} because it is an ACTIVE auth user!`);
    }

    // Execute safe application-level eradication of zombie residue
    return this.deleteAccount(zombieProfileId);
  }
}

export const accountLifecycleService = new AccountLifecycleService();
