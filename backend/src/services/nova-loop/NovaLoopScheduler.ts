/**
 * NovaLoopScheduler.ts — Offline Background Runner for Nova Loop
 *
 * Runs completely decoupled from the live conversation path.
 * Periodically triggers NovaLoopScanner to consume new chat batches,
 * detect conversational defects, and maintain checkpoint advancement.
 */

import { Client } from 'pg';
import { logger } from '../../lib/logger';
import { config } from '../../config';
import { novaLoopScanner, ScanBatchResult } from './NovaLoopScanner';

export class NovaLoopScheduler {
  private static readonly ADVISORY_LOCK_ID = 847291;
  private timer: NodeJS.Timeout | null = null;
  private bootTimeout: NodeJS.Timeout | null = null;
  private isScanning = false;
  private isRunning = false;
  private readonly DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Acquire PostgreSQL session-level advisory lock across distributed instances.
   */
  private async acquireDistributedLock(): Promise<Client | null> {
    const dbUrl = config.db?.databaseUrl;
    if (!dbUrl) return null;

    try {
      const client = new Client({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
      });
      await client.connect();

      const res = await client.query(`SELECT pg_try_advisory_lock(${NovaLoopScheduler.ADVISORY_LOCK_ID}) AS acquired`);
      const acquired = Boolean(res.rows[0]?.acquired);
      if (!acquired) {
        await client.end().catch(() => {});
        return null;
      }
      return client;
    } catch (err: any) {
      logger.warn('[NovaLoopScheduler] Failed to connect for distributed advisory lock; using local mutex', { error: err?.message });
      return null;
    }
  }

  /**
   * Release PostgreSQL advisory lock and terminate client connection.
   */
  private async releaseDistributedLock(client: Client | null): Promise<void> {
    if (!client) return;
    try {
      await client.query(`SELECT pg_advisory_unlock(${NovaLoopScheduler.ADVISORY_LOCK_ID})`);
    } catch (err: any) {
      logger.warn('[NovaLoopScheduler] Error unlocking distributed lock', { error: err?.message });
    } finally {
      await client.end().catch(() => {});
    }
  }

  /**
   * Start scheduled background execution.
   */
  start(intervalMs: number = this.DEFAULT_INTERVAL_MS): void {
    if (this.isRunning) return;

    if (process.env.DISABLE_NOVA_LOOP === 'true' || process.env.NOVA_LOOP_ENABLED === 'false') {
      logger.info('[NovaLoopScheduler] Nova Loop is disabled by environment configuration (DISABLE_NOVA_LOOP=true)');
      return;
    }

    this.isRunning = true;
    logger.info('[NovaLoopScheduler] Starting offline engineering audit loop', { intervalMs });

    // Initial delayed tick to allow system boot
    this.bootTimeout = setTimeout(() => {
      if (this.isRunning) this.runOnce().catch(err => logger.error('[NovaLoopScheduler] Run error', { error: err?.message }));
    }, 5000);

    this.timer = setInterval(() => {
      this.runOnce().catch(err => logger.error('[NovaLoopScheduler] Scheduled run error', { error: err?.message }));
    }, intervalMs);
  }

  /**
   * Stop background scheduler.
   */
  stop(): void {
    this.isRunning = false;
    if (this.bootTimeout) {
      clearTimeout(this.bootTimeout);
      this.bootTimeout = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[NovaLoopScheduler] Stopped');
  }

  /**
   * Execute a single scan pass with re-entrancy and distributed lock protection.
   */
  async runOnce(batchSize: number = 50): Promise<ScanBatchResult | null> {
    if (this.isScanning) {
      logger.debug('[NovaLoopScheduler] Previous scan still in progress, skipping tick');
      return null;
    }

    this.isScanning = true;
    let lockClient: Client | null = null;
    const hasDbUrl = Boolean(config.db?.databaseUrl);

    try {
      if (hasDbUrl) {
        lockClient = await this.acquireDistributedLock();
        if (!lockClient) {
          logger.debug('[NovaLoopScheduler] Another instance holds the advisory lock, skipping scan pass');
          return null;
        }
      }

      const result = await novaLoopScanner.scanNextBatch(batchSize);
      if (result.messagesProcessed > 0) {
        logger.info('[NovaLoopScheduler] Offline scan pass completed', {
          messagesProcessed: result.messagesProcessed,
          incidentsFound: result.incidentsFound,
          cursor: result.cursorAdvancedTo
        });
      }
      return result;
    } catch (err: any) {
      logger.error('[NovaLoopScheduler] Scan execution failed', { error: err?.message });
      throw err;
    } finally {
      if (lockClient) {
        await this.releaseDistributedLock(lockClient);
      }
      this.isScanning = false;
    }
  }
}

export const novaLoopScheduler = new NovaLoopScheduler();
