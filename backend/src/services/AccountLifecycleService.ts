/**
 * Canonical account lifecycle and irreversible deletion service.
 */
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';

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
  /** Every public table currently identified as directly user-owned. */
  public static readonly USER_OWNED_TABLES: Array<{ table: string; userColumn: string }> = [
    { table: 'kg_edges', userColumn: 'user_id' },
    { table: 'kg_nodes', userColumn: 'user_id' },
    { table: 'nova_guardian_repairs', userColumn: 'user_id' },
    { table: 'nova_guardian_anomalies', userColumn: 'user_id' },
    { table: 'nova_guardian_runs', userColumn: 'user_id' },
    { table: 'watchtower_timing_logs', userColumn: 'user_id' },
    { table: 'watchtower_attention_decisions', userColumn: 'user_id' },
    { table: 'watchtower_cognitive_signals', userColumn: 'user_id' },
    { table: 'nova_cognitive_doubts', userColumn: 'user_id' },
    { table: 'candidate_synthesis_claims', userColumn: 'user_id' },
    { table: 'nova_actions', userColumn: 'user_id' },
    { table: 'life_threads', userColumn: 'user_id' },
    { table: 'nova_followups', userColumn: 'user_id' },
    { table: 'reminders', userColumn: 'user_id' },
    { table: 'nova_agenda', userColumn: 'user_id' },
    { table: 'nova_outreach_log', userColumn: 'user_id' },
    { table: 'user_routines', userColumn: 'user_id' },
    { table: 'nova_corrections_log', userColumn: 'user_id' },
    { table: 'action_idempotency', userColumn: 'user_id' },
    { table: 'user_moments', userColumn: 'user_id' },
    { table: 'user_moment_preferences', userColumn: 'user_id' },
    { table: 'user_presence', userColumn: 'user_id' },
    { table: 'user_feedback', userColumn: 'user_id' },
    { table: 'reflections', userColumn: 'user_id' },
    { table: 'emotional_states', userColumn: 'user_id' },
    { table: 'conversation_sessions', userColumn: 'user_id' },
    { table: 'chat_history', userColumn: 'user_id' },
    { table: 'nova_thoughts', userColumn: 'user_id' },
    { table: 'short_term_memories', userColumn: 'user_id' },
    { table: 'working_memory', userColumn: 'user_id' },
    { table: 'episodic_memories', userColumn: 'user_id' },
    { table: 'memory_access_log', userColumn: 'user_id' },
    { table: 'memory_events', userColumn: 'user_id' },
    { table: 'memories', userColumn: 'user_id' },
    { table: 'telemetry_events', userColumn: 'user_id' },
    { table: 'profiles', userColumn: 'id' },
  ];

  private async deleteRows(table: string, column: string, userId: string, tablesCleaned: Record<string, number>, errors: string[]) {
    try {
      const { count, error } = await supabaseAdmin.from(table).delete({ count: 'exact' }).eq(column, userId);
      if (error) {
        errors.push(`Failed to delete from ${table}: ${error.message}`);
        tablesCleaned[table] = 0;
        return;
      }
      tablesCleaned[table] = count || 0;
    } catch (e: any) {
      errors.push(`Exception deleting from ${table}: ${e?.message || String(e)}`);
      tablesCleaned[table] = 0;
    }
  }

  private async deleteJsonOwnedRows(table: string, userId: string, tablesCleaned: Record<string, number>, errors: string[]) {
    for (const key of ['userId', 'user_id']) {
      try {
        const { count, error } = await supabaseAdmin
          .from(table)
          .delete({ count: 'exact' })
          .eq(`original_payload->>${key}`, userId);
        if (error) errors.push(`Failed to delete ${table} rows for ${key}: ${error.message}`);
        else tablesCleaned[table] = (tablesCleaned[table] || 0) + (count || 0);
      } catch (e: any) {
        errors.push(`Exception deleting ${table} rows for ${key}: ${e?.message || String(e)}`);
      }
    }
  }

  private async deleteJobPayloadRows(table: 'background_jobs' | 'failed_jobs', userId: string, tablesCleaned: Record<string, number>, errors: string[]) {
    for (const key of ['userId', 'user_id']) {
      try {
        const { count, error } = await supabaseAdmin
          .from(table)
          .delete({ count: 'exact' })
          .eq(`payload->>${key}`, userId);
        if (error) errors.push(`Failed to delete ${table} rows for ${key}: ${error.message}`);
        else tablesCleaned[table] = (tablesCleaned[table] || 0) + (count || 0);
      } catch (e: any) {
        errors.push(`Exception deleting ${table} rows for ${key}: ${e?.message || String(e)}`);
      }
    }
  }

  public async deleteAccount(userId: string): Promise<AccountDeletionResult> {
    const startTime = Date.now();
    const tablesCleaned: Record<string, number> = {};
    const errors: string[] = [];
    let authDeleted = false;
    let profileDeleted = false;
    const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!cleanUserId) throw new Error('Cannot delete account: invalid or empty userId');

    logger.info('[AccountLifecycle] Starting COMPLETE account erasure', { userId: cleanUserId });

    const { error: tombstoneError } = await supabaseAdmin.from('account_tombstones').upsert({
      user_id: cleanUserId,
      deleted_at: new Date().toISOString(),
    });
    if (tombstoneError) {
      return { success: false, userId: cleanUserId, authDeleted: false, profileDeleted: false, tablesCleaned, errors: [`Tombstone creation failed: ${tombstoneError.message}`], durationMs: Date.now() - startTime };
    }

    // Capture the user's chat IDs before deleting chat_history. These IDs are also the
    // ownership key for audit_logs, tombstones and processed_jobs.
    let userChatIds: string[] = [];
    try {
      const { data: chats, error } = await supabaseAdmin.from('chat_history').select('id').eq('user_id', cleanUserId);
      if (error) errors.push(`Failed to inspect chat_history before indirect cleanup: ${error.message}`);
      else userChatIds = (chats || []).map((c: any) => String(c.id));
    } catch (e: any) {
      errors.push(`Chat ownership lookup failed: ${e?.message || String(e)}`);
    }

    // Delete all user-owned job payloads regardless of status. This avoids leaving
    // completed/failed/pending jobs containing user messages or identifiers.
    await this.deleteJobPayloadRows('background_jobs', cleanUserId, tablesCleaned, errors);
    await this.deleteJobPayloadRows('failed_jobs', cleanUserId, tablesCleaned, errors);

    // Delete message-linked data before deleting chat_history.
    if (userChatIds.length) {
      try {
        const { count, error } = await supabaseAdmin.from('audit_logs').delete({ count: 'exact' }).in('source_message_id', userChatIds);
        if (error) errors.push(`Failed to delete audit_logs: ${error.message}`);
        else tablesCleaned.audit_logs = count || 0;
      } catch (e: any) {
        errors.push(`Audit log cleanup failed: ${e?.message || String(e)}`);
      }

      try {
        const { count, error } = await supabaseAdmin.from('tombstones').delete({ count: 'exact' }).in('id', userChatIds);
        if (error) errors.push(`Failed to delete message tombstones: ${error.message}`);
        else tablesCleaned.tombstones = count || 0;
      } catch (e: any) {
        errors.push(`Message tombstone cleanup failed: ${e?.message || String(e)}`);
      }

      try {
        const { count, error } = await supabaseAdmin.from('processed_jobs').delete({ count: 'exact' }).in('message_id', userChatIds);
        if (error) errors.push(`Failed to delete processed_jobs: ${error.message}`);
        else tablesCleaned.processed_jobs = count || 0;
      } catch (e: any) {
        errors.push(`Processed job cleanup failed: ${e?.message || String(e)}`);
      }
    }

    // Delete recovery payloads without first loading the whole table into memory.
    await this.deleteJsonOwnedRows('recovery_archive', cleanUserId, tablesCleaned, errors);

    // Delete every directly user-owned table. Telemetry is deleted, not anonymized.
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      await this.deleteRows(item.table, item.userColumn, cleanUserId, tablesCleaned, errors);
      if (item.table === 'profiles') profileDeleted = (tablesCleaned[item.table] || 0) > 0;
    }

    // Verify direct ownership by exact user ID.
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      try {
        const { count, error } = await supabaseAdmin.from(item.table).select(item.userColumn, { count: 'exact', head: true }).eq(item.userColumn, cleanUserId);
        if (error) errors.push(`Verification failed for ${item.table}: ${error.message}`);
        else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in ${item.table}`);
      } catch (e: any) {
        errors.push(`Verification exception for ${item.table}: ${e?.message || String(e)}`);
      }
    }

    // Verify indirect ownership using database-side filters, not paginated reads.
    for (const key of ['userId', 'user_id']) {
      for (const table of ['background_jobs', 'failed_jobs'] as const) {
        try {
          const { count, error } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq(`payload->>${key}`, cleanUserId);
          if (error) errors.push(`Verification failed for ${table}/${key}: ${error.message}`);
          else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in ${table}`);
        } catch (e: any) {
          errors.push(`Verification exception for ${table}/${key}: ${e?.message || String(e)}`);
        }

        try {
          const { count, error } = await supabaseAdmin.from('recovery_archive').select('id', { count: 'exact', head: true }).eq(`original_payload->>${key}`, cleanUserId);
          if (error) errors.push(`Verification failed for recovery_archive/${key}: ${error.message}`);
          else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in recovery_archive`);
        } catch (e: any) {
          errors.push(`Verification exception for recovery_archive/${key}: ${e?.message || String(e)}`);
        }
      }
    }

    // Verify processed_jobs against the chat IDs captured before deletion. Do not
    // re-query chat_history after it has been erased, because that would lose the key.
    if (userChatIds.length) {
      try {
        const { count, error } = await supabaseAdmin.from('processed_jobs').select('id', { count: 'exact', head: true }).in('message_id', userChatIds);
        if (error) errors.push(`Verification failed for processed_jobs message links: ${error.message}`);
        else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in processed_jobs`);
      } catch (e: any) {
        errors.push(`Processed job verification exception: ${e?.message || String(e)}`);
      }

      try {
        const { count, error } = await supabaseAdmin.from('audit_logs').select('id', { count: 'exact', head: true }).in('source_message_id', userChatIds);
        if (error) errors.push(`Verification failed for audit_logs message links: ${error.message}`);
        else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in audit_logs`);
      } catch (e: any) {
        errors.push(`Audit log verification exception: ${e?.message || String(e)}`);
      }

      try {
        const { count, error } = await supabaseAdmin.from('tombstones').select('id', { count: 'exact', head: true }).in('id', userChatIds);
        if (error) errors.push(`Verification failed for tombstones: ${error.message}`);
        else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in tombstones`);
      } catch (e: any) {
        errors.push(`Tombstone verification exception: ${e?.message || String(e)}`);
      }
    }

    // Auth deletion is strictly last and is skipped on any cleanup/verification failure.
    if (errors.length === 0) {
      try {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(cleanUserId);
        if (!error || error.message?.includes('User not found') || (error as any).status === 404) authDeleted = true;
        else errors.push(`Failed to delete auth user identity: ${error.message}`);
      } catch (e: any) {
        errors.push(`Exception during auth user deletion: ${e?.message || String(e)}`);
      }
    }

    try {
      cache.invalidate(`profile:${cleanUserId}`);
      cache.invalidate(`memories:${cleanUserId}`);
    } catch (e: any) {
      logger.warn('[AccountLifecycle] Cache invalidation failed', { error: e?.message || String(e) });
    }

    const success = errors.length === 0 && authDeleted;
    logger.info('[AccountLifecycle] COMPLETE account erasure finished', {
      userId: cleanUserId,
      success,
      authDeleted,
      profileDeleted,
      errorCount: errors.length,
      durationMs: Date.now() - startTime,
    });
    return { success, userId: cleanUserId, authDeleted, profileDeleted, tablesCleaned, errors, durationMs: Date.now() - startTime };
  }

  public async scanZombieProfiles(): Promise<ZombieScanResult> {
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authErr) throw new Error(`Failed to list auth users: ${authErr.message}`);
    const activeAuthUserIds = new Set((authData?.users || []).map(u => u.id));
    const { data: profiles, error: profErr } = await supabaseAdmin.from('profiles').select('*');
    if (profErr) throw new Error(`Failed to list profiles: ${profErr.message}`);
    const allProfiles = profiles || [];
    const zombieList: ZombieScanResult['zombieProfiles'] = [];
    let activeLinkedCount = 0;
    for (const p of allProfiles as any[]) {
      if (activeAuthUserIds.has(p.id)) activeLinkedCount++;
      else zombieList.push({ id: p.id, preferredName: p.preferred_name || null, onboardingCompleted: p.onboarding_completed || false, createdAt: p.created_at || undefined, ownedRowCounts: {} });
    }
    const zombieIds = zombieList.map(z => z.id);
    const zombieMap = new Map(zombieList.map(z => [z.id, z]));
    if (zombieIds.length) {
      await Promise.all(AccountLifecycleService.USER_OWNED_TABLES.map(async item => {
        if (item.table === 'profiles') return;
        try {
          const { data: rows } = await supabaseAdmin.from(item.table).select(item.userColumn).in(item.userColumn, zombieIds);
          for (const r of (rows || []) as any[]) {
            const uid = r[item.userColumn];
            if (uid && zombieMap.has(uid)) {
              const z = zombieMap.get(uid)!;
              z.ownedRowCounts[item.table] = (z.ownedRowCounts[item.table] || 0) + 1;
            }
          }
        } catch { /* read-only diagnostic; ignore an unavailable table */ }
      }));
    }
    return { totalProfiles: allProfiles.length, activeLinkedCount, zombieCount: zombieList.length, zombieProfiles: zombieList };
  }

  public async purgeConfirmedZombie(zombieProfileId: string): Promise<AccountDeletionResult> {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(zombieProfileId);
    if (authUser?.user) throw new Error(`CRITICAL ABORT: Refusing to purge ${zombieProfileId} because it is an ACTIVE auth user!`);
    return this.deleteAccount(zombieProfileId);
  }
}

export const accountLifecycleService = new AccountLifecycleService();