import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { semanticTurnAgent } from '../agents/SemanticTurnAgent';

export class SemanticTurnWorker {
  private activeUsers = new Set<string>();
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 1000; // Poll every 1s

  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalId = setInterval(() => this.poll(), this.POLL_INTERVAL);
    logger.info('[SemanticTurnWorker] Started polling for semantic jobs');
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalId) clearInterval(this.intervalId);
    logger.info('[SemanticTurnWorker] Stopped');
  }

  private async poll() {
    try {
      // Find all distinct users that have a pending or stale running semantic job
      // Stale = running for > 60 seconds.
      const sixtySecondsAgo = new Date(Date.now() - 60000).toISOString();
      const { data: users, error } = await supabaseAdmin
        .from('background_jobs')
        .select('payload->>userId')
        .eq('job_type', 'process_semantic_turn')
        .or(`status.eq.pending,and(status.eq.running,started_at.lte.${sixtySecondsAgo})`);

      if (error) {
        logger.error('[SemanticTurnWorker] Error polling users for semantic jobs', { error });
        return;
      }

      if (!users || users.length === 0) return;

      // Extract distinct user IDs
      const distinctUsers = Array.from(new Set(users.map((u: any) => u.userId).filter(Boolean))) as string[];

      for (const userId of distinctUsers) {
        if (!this.activeUsers.has(userId)) {
          this.activeUsers.add(userId);
          // Fire and forget per-user async drain loop
          this.drainUserQueue(userId).catch(e => {
            logger.error(`[SemanticTurnWorker] Unhandled error draining queue for user ${userId}`, { error: e });
          }).finally(() => {
            this.activeUsers.delete(userId);
          });
        }
      }
    } catch (e) {
      logger.error('[SemanticTurnWorker] Fatal polling error', { error: e });
    }
  }

  private async drainUserQueue(userId: string) {
    while (this.isRunning) {
      // 1. Try to claim the next job for this user
      const { data: claimedJobs, error: claimErr } = await supabaseAdmin.rpc('claim_next_background_job_for_user', {
        p_user_id: userId,
        p_job_type: 'process_semantic_turn'
      });

      if (claimErr) {
        logger.error(`[SemanticTurnWorker] Error claiming job for ${userId}`, { error: claimErr.message });
        break;
      }

      if (!claimedJobs || claimedJobs.length === 0) {
        // No more jobs for this user (or another worker claimed them)
        break;
      }

      const job = claimedJobs[0];
      const claimToken = job.claim_token;

      if (!claimToken) {
        logger.error(`[SemanticTurnWorker] Job ${job.id} was claimed but returned no claim_token. DB migration missing?`);
        break;
      }

      let heartbeatInterval: NodeJS.Timeout | undefined;
      try {
        logger.info(`[SemanticTurnWorker] Processing semantic job ${job.id} for user ${userId}`);
        
        // Setup lease heartbeat to prevent >60s jobs from being reclaimed
        heartbeatInterval = setInterval(() => {
          supabaseAdmin.from('background_jobs').update({
            started_at: new Date().toISOString() // refresh lease
          }).eq('id', job.id).eq('claim_token', claimToken).then();
        }, 30000);

        const result = await semanticTurnAgent.processJob(job);
        
        clearInterval(heartbeatInterval);
        
        // Output for synchronous waiters to read
        const output = {
          semanticEvents: result?.semanticEvents || [],
          reminderNote: result?.reminderNote || '',
          reminderCreated: result?.reminderCreated || false
        };

        // Complete job via secure lease token RPC using DB clock_timestamp()
        const { error: completeErr } = await supabaseAdmin.rpc('mark_background_job_completed', {
          p_job_id: job.id,
          p_claim_token: claimToken,
          p_output: output
        });

        if (completeErr) {
          logger.error(`[SemanticTurnWorker] Failed to complete job ${job.id} via RPC (lease expired?)`, { error: completeErr.message });
          // Loop will continue and next claim might reclaim if stale
        } else {
          logger.info(`[SemanticTurnWorker] Successfully completed job ${job.id}`);
        }
      } catch (jobErr: any) {
        if (typeof heartbeatInterval !== 'undefined') clearInterval(heartbeatInterval);
        logger.error(`[SemanticTurnWorker] Job ${job.id} execution failed`, { error: jobErr.message });
        // Mark as failed so it doesn't stay running forever until lease expiration looping
        await supabaseAdmin.from('background_jobs').update({
          status: 'failed',
          error: jobErr.message,
          finished_at: new Date().toISOString() // Just Node time is fine for failures
        }).eq('id', job.id).eq('claim_token', claimToken);
      }
    }
  }
}

export const semanticTurnWorker = new SemanticTurnWorker();
