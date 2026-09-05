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

  public async deleteAccount(userId: string): Promise<AccountDeletionResult> {
    const startTime = Date.now();
    const tablesCleaned: Record<string, number> = {};
    const errors: string[] = [];
    let authDeleted = false;
    let profileDeleted = false;
    const cleanUserId = typeof userId === 'string' ? userId.trim() : '';
    if (!cleanUserId) throw new Error('Cannot delete account: invalid or empty userId');

    logger.info('[AccountLifecycle] Starting COMPLETE account erasure', { userId: cleanUserId });

    // Tombstone first so concurrent application writes are rejected while erasure runs.
    const { error: tombstoneError } = await supabaseAdmin.from('account_tombstones').upsert({
      user_id: cleanUserId,
      deleted_at: new Date().toISOString(),
    });
    if (tombstoneError) {
      return { success: false, userId: cleanUserId, authDeleted: false, profileDeleted: false, tablesCleaned, errors: [`Tombstone creation failed: ${tombstoneError.message}`], durationMs: Date.now() - startTime };
    }

    // Delete every background job owned by this user, regardless of current status.
    try {
      const { data: jobs, error } = await supabaseAdmin.from('background_jobs').select('id, payload');
      if (error) errors.push(`Failed to inspect background_jobs: ${error.message}`);
      for (const job of jobs || []) {
        const payload = job.payload as any;
        if (payload?.userId === cleanUserId || payload?.user_id === cleanUserId) {
          const { error: deleteError } = await supabaseAdmin.from('background_jobs').delete().eq('id', job.id);
          if (deleteError) errors.push(`Failed to delete background job ${job.id}: ${deleteError.message}`);
          else tablesCleaned.background_jobs = (tablesCleaned.background_jobs || 0) + 1;
        }
      }
    } catch (e: any) {
      errors.push(`Background job cleanup failed: ${e?.message || String(e)}`);
    }

    // Delete failed job records whose JSON payload identifies this user.
    try {
      const { data: failedJobs, error } = await supabaseAdmin.from('failed_jobs').select('id, payload');
      if (error) errors.push(`Failed to inspect failed_jobs: ${error.message}`);
      for (const job of failedJobs || []) {
        const payload = job.payload as any;
        if (payload?.userId === cleanUserId || payload?.user_id === cleanUserId) {
          const { error: deleteError } = await supabaseAdmin.from('failed_jobs').delete().eq('id', job.id);
          if (deleteError) errors.push(`Failed to delete failed job ${job.id}: ${deleteError.message}`);
          else tablesCleaned.failed_jobs = (tablesCleaned.failed_jobs || 0) + 1;
        }
      }
    } catch (e: any) {
      errors.push(`Failed job cleanup failed: ${e?.message || String(e)}`);
    }

    // Delete audit entries and processing records tied to this user's chat messages before deleting chats.
    try {
      const { data: chats, error: chatLookupError } = await supabaseAdmin.from('chat_history').select('id').eq('user_id', cleanUserId);
      if (chatLookupError) errors.push(`Failed to inspect chat_history: ${chatLookupError.message}`);
      const chatIds = (chats || []).map((c: any) => c.id);
      if (chatIds.length) {
        const { error } = await supabaseAdmin.from('audit_logs').delete().in('source_message_id', chatIds);
        if (error) errors.push(`Failed to delete audit_logs: ${error.message}`);
        else tablesCleaned.audit_logs = chatIds.length;

        const { error: tombstoneRowsError } = await supabaseAdmin.from('tombstones').delete().in('id', chatIds);
        if (tombstoneRowsError) errors.push(`Failed to delete message tombstones: ${tombstoneRowsError.message}`);
        else tablesCleaned.tombstones = chatIds.length;

        const messageIds = chatIds.map(String);
        const { data: processedRows, error: processedLookupError } = await supabaseAdmin
          .from('processed_jobs')
          .select('id, message_id')
          .in('message_id', messageIds);
        if (processedLookupError) errors.push(`Failed to inspect processed_jobs: ${processedLookupError.message}`);
        for (const row of processedRows || []) {
          const { error: deleteError } = await supabaseAdmin.from('processed_jobs').delete().eq('id', row.id);
          if (deleteError) errors.push(`Failed to delete processed job ${row.id}: ${deleteError.message}`);
          else tablesCleaned.processed_jobs = (tablesCleaned.processed_jobs || 0) + 1;
        }
      }
    } catch (e: any) {
      errors.push(`Chat-linked cleanup failed: ${e?.message || String(e)}`);
    }

    // Delete JSON-owned recovery payloads.
    try {
      const { data: archives, error: archiveLookupError } = await supabaseAdmin.from('recovery_archive').select('id, original_payload');
      if (archiveLookupError) errors.push(`Failed to inspect recovery_archive: ${archiveLookupError.message}`);
      for (const row of archives || []) {
        const payload = row.original_payload as any;
        if (payload?.userId === cleanUserId || payload?.user_id === cleanUserId) {
          const { error: deleteError } = await supabaseAdmin.from('recovery_archive').delete().eq('id', row.id);
          if (deleteError) errors.push(`Failed to delete recovery archive row ${row.id}: ${deleteError.message}`);
          else tablesCleaned.recovery_archive = (tablesCleaned.recovery_archive || 0) + 1;
        }
      }
    } catch (e: any) {
      errors.push(`Recovery archive cleanup failed: ${e?.message || String(e)}`);
    }

    // Delete every directly user-owned table. Do NOT anonymize telemetry: this is a full wipe.
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      await this.deleteRows(item.table, item.userColumn, cleanUserId, tablesCleaned, errors);
      if (item.table === 'profiles') profileDeleted = (tablesCleaned[item.table] || 0) > 0;
    }

    // Verify that no directly user-owned rows survived. Never report success if residue remains.
    for (const item of AccountLifecycleService.USER_OWNED_TABLES) {
      try {
        const { count, error } = await supabaseAdmin.from(item.table).select(item.userColumn, { count: 'exact', head: true }).eq(item.userColumn, cleanUserId);
        if (error) errors.push(`Verification failed for ${item.table}: ${error.message}`);
        else if ((count || 0) > 0) errors.push(`Deletion verification found ${count} surviving row(s) in ${item.table}`);
      } catch (e: any) {
        errors.push(`Verification exception for ${item.table}: ${e?.message || String(e)}`);
      }
    }

    // Verify indirect stores as well before removing the auth identity.
    try {
      const { data: jobs, error } = await supabaseAdmin.from('background_jobs').select('id, payload');
      if (error) errors.push(`Verification failed for background_jobs: ${error.message}`);
      else if ((jobs || []).some((job: any) => {
        const p = job.payload as any;
        return p?.userId === cleanUserId || p?.user_id === cleanUserId;
      })) errors.push('Deletion verification found surviving user-owned row(s) in background_jobs');

      const { data: failedJobs, error: failedError } = await supabaseAdmin.from('failed_jobs').select('id, payload');
      if (failedError) errors.push(`Verification failed for failed_jobs: ${failedError.message}`);
      else if ((failedJobs || []).some((job: any) => {
        const p = job.payload as any;
        return p?.userId === cleanUserId || p?.user_id === cleanUserId;
      })) errors.push('Deletion verification found surviving user-owned row(s) in failed_jobs');

      const { data: remainingChats, error: chatError } = await supabaseAdmin.from('chat_history').select('id').eq('user_id', cleanUserId);
      if (chatError) errors.push(`Verification failed for chat_history links: ${chatError.message}`);
      else {
        const remainingIds = (remainingChats || []).map((c: any) => String(c.id));
        if (remainingIds.length) errors.push('Deletion verification found surviving chat rows before processed_jobs verification');
        else {
          const { data: processed, error: processedError } = await supabaseAdmin.from('processed_jobs').select('id, message_id');
          if (processedError) errors.push(`Verification failed for processed_jobs: ${processedError.message}`);
          else {
            const userMessageIds = new Set(remainingIds);
            if ((processed || []).some((row: any) => userMessageIds.has(String(row.message_id)))) errors.push('Deletion verification found surviving user-owned row(s) in processed_jobs');
          }
        }
      }
    } catch (e: any) {
      errors.push(`Indirect deletion verification failed: ${e?.message || String(e)}`);
    }

    // Remove auth identity only after application data has been erased and verified.
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
    logger.info('[AccountLifecycle] COMPLETE account erasure finished', { userId: cleanUserId, success, authDeleted, profileDeleted, errorCount: errors.length, durationMs: Date.now() - startTime });
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