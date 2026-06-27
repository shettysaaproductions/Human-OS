/**
 * DegradedModeService
 *
 * When Supabase is offline or DATABASE_DEGRADED_MODE=true:
 *  1. Chat still works — last N messages kept in-process memory.
 *  2. DB writes are queued to disk (degraded_queue.jsonl) instead of dropped.
 *  3. On DB recovery, the queue is drained automatically.
 */

import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

// Location of the persisted write queue
const QUEUE_FILE = path.join(process.cwd(), 'degraded_queue.jsonl');

export interface DegradedWrite {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'upsert';
  data: Record<string, any>;
  filter?: { column: string; value: any };
  queuedAt: string;
}

// In-memory conversation buffer (last 20 messages per user, keyed by userId)
const conversationBuffer = new Map<string, Array<{ role: string; content: string }>>();
const MAX_BUFFER_MESSAGES = 20;

class DegradedModeService {
  private draining = false;

  // ── Conversation Buffer ────────────────────────────────────────

  appendMessage(userId: string, role: string, content: string): void {
    const existing = conversationBuffer.get(userId) || [];
    existing.push({ role, content });
    if (existing.length > MAX_BUFFER_MESSAGES) {
      existing.shift(); // Drop oldest
    }
    conversationBuffer.set(userId, existing);
  }

  getRecentMessages(userId: string): Array<{ role: string; content: string }> {
    return conversationBuffer.get(userId) || [];
  }

  // ── Write Queue ────────────────────────────────────────────────

  /**
   * Enqueue a write to disk so it can be drained later.
   */
  enqueue(write: Omit<DegradedWrite, 'id' | 'queuedAt'>): void {
    const record: DegradedWrite = {
      ...write,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: new Date().toISOString(),
    };

    try {
      fs.appendFileSync(QUEUE_FILE, JSON.stringify(record) + '\n', 'utf-8');
      logger.warn(`DegradedMode: queued ${write.operation} on ${write.table}`, { id: record.id });
    } catch (err) {
      logger.error('DegradedMode: failed to persist write to disk', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * Returns the number of pending writes in the queue file.
   */
  queueSize(): number {
    try {
      if (!fs.existsSync(QUEUE_FILE)) return 0;
      const lines = fs.readFileSync(QUEUE_FILE, 'utf-8').split('\n').filter(l => l.trim());
      return lines.length;
    } catch {
      return 0;
    }
  }

  /**
   * Drain the disk queue — called when DB comes back online.
   */
  async drain(): Promise<{ success: number; failed: number }> {
    if (this.draining) {
      logger.info('DegradedMode: drain already in progress, skipping');
      return { success: 0, failed: 0 };
    }
    this.draining = true;

    let success = 0;
    let failed = 0;

    try {
      if (!fs.existsSync(QUEUE_FILE)) {
        logger.info('DegradedMode: no queue file, nothing to drain');
        return { success: 0, failed: 0 };
      }

      const raw = fs.readFileSync(QUEUE_FILE, 'utf-8');
      const lines = raw.split('\n').filter(l => l.trim());
      
      if (lines.length === 0) return { success: 0, failed: 0 };

      logger.info(`DegradedMode: draining ${lines.length} queued writes`);

      const failedLines: string[] = [];

      for (const line of lines) {
        try {
          const write: DegradedWrite = JSON.parse(line);
          
          if (write.operation === 'insert') {
            const { error } = await supabaseAdmin.from(write.table).insert(write.data);
            if (error) throw error;
          } else if (write.operation === 'update' && write.filter) {
            const { error } = await supabaseAdmin.from(write.table)
              .update(write.data)
              .eq(write.filter.column, write.filter.value);
            if (error) throw error;
          }

          success++;
        } catch (err) {
          logger.error('DegradedMode: failed to drain write', { error: err instanceof Error ? err.message : String(err), line });
          failedLines.push(line);
          failed++;
        }
      }

      // Rewrite file with only the failed lines
      if (failedLines.length > 0) {
        fs.writeFileSync(QUEUE_FILE, failedLines.join('\n') + '\n', 'utf-8');
      } else {
        fs.unlinkSync(QUEUE_FILE); // Clean up
      }

      logger.info(`DegradedMode: drain complete`, { success, failed });
    } catch (err) {
      logger.error('DegradedMode: drain error', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.draining = false;
    }

    return { success, failed };
  }
}

export const degradedMode = new DegradedModeService();
