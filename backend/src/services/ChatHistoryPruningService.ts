import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

const CHAR_BUDGET = 150_000;    // 1.5 lakh characters per user
const TRIM_TARGET = 120_000;    // Trim back to 120k when limit is hit (30k buffer)
const MAX_MESSAGES = 2_000;     // Hard cap — safety net only
const BATCH_SIZE = 100;         // Delete in batches to avoid timeouts

function shouldExtractMemory(content: string): boolean {
  if (content.length > 25) return true;
  const keywords = ['feel', 'sad', 'happy', 'mad', 'angry', 'wife', 'husband', 'friend',
    'boss', 'office', 'work', 'issue', 'problem', 'task', 'todo', 'buy', 'going', 'went', 'saw', 'met'];
  const lower = content.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

export interface PruneResult {
  userId: string;
  skipped: boolean;
  charsBefore: number;
  charsAfter: number;
  rowsDeleted: number;
  memoriesExtracted: number;
}

export const chatHistoryPruningService = {

  async pruneUser(userId: string): Promise<PruneResult> {
    const { data: rows, error } = await supabaseAdmin
      .from('chat_history')
      .select('id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error || !rows) {
      logger.error('[Pruning] Failed to fetch history', { userId, error: error?.message });
      return { userId, skipped: true, charsBefore: 0, charsAfter: 0, rowsDeleted: 0, memoriesExtracted: 0 };
    }

    const totalChars = rows.reduce((sum, r) => sum + (r.content?.length || 0), 0);
    const totalRows = rows.length;

    if (totalChars <= CHAR_BUDGET && totalRows <= MAX_MESSAGES) {
      return { userId, skipped: true, charsBefore: totalChars, charsAfter: totalChars, rowsDeleted: 0, memoriesExtracted: 0 };
    }

    let runningTotal = totalChars;
    const toDelete: typeof rows = [];

    for (const row of rows) {
      if (runningTotal <= TRIM_TARGET) break;
      toDelete.push(row);
      runningTotal -= (row.content?.length || 0);
    }

    if (toDelete.length === 0) {
      return { userId, skipped: true, charsBefore: totalChars, charsAfter: totalChars, rowsDeleted: 0, memoriesExtracted: 0 };
    }

    let memoriesExtracted = 0;
    const memoriesToInsert: Array<{ user_id: string; memory: string; emotion: string; importance: number; confidence: number }> = [];

    for (let i = 0; i < toDelete.length; i++) {
      const row = toDelete[i];
      if (row.role === 'user' && shouldExtractMemory(row.content)) {
        const next = toDelete[i + 1];
        const novaContext = (next && next.role === 'assistant')
          ? ` | Nova responded: ${next.content.substring(0, 200)}${next.content.length > 200 ? '...' : ''}`
          : '';
        memoriesToInsert.push({
          user_id: userId,
          memory: `[Archived] User said: ${row.content.substring(0, 300)}${row.content.length > 300 ? '...' : ''}${novaContext}`,
          emotion: 'neutral',
          importance: 0.6,
          confidence: 0.75,
        });
        memoriesExtracted++;
      }
    }

    if (memoriesToInsert.length > 0) {
      const { error: memError } = await supabaseAdmin
        .from('short_term_memories')
        .insert(memoriesToInsert);
      if (memError) logger.error('[Pruning] Failed to insert memories', { userId, error: memError.message });
    }

    const deleteIds = toDelete.map(r => r.id);
    let totalDeleted = 0;

    for (let i = 0; i < deleteIds.length; i += BATCH_SIZE) {
      const batch = deleteIds.slice(i, i + BATCH_SIZE);
      const { error: delError } = await supabaseAdmin
        .from('chat_history')
        .delete()
        .in('id', batch);
      if (delError) {
        logger.error('[Pruning] Batch delete failed', { userId, batch: i, error: delError.message });
      } else {
        totalDeleted += batch.length;
      }
    }

    const result: PruneResult = { userId, skipped: false, charsBefore: totalChars, charsAfter: runningTotal, rowsDeleted: totalDeleted, memoriesExtracted };
    logger.info('[Pruning] Completed for user', result);
    return result;
  },

  async runAll(): Promise<void> {
    logger.info('[Pruning] Starting nightly run for all users');
    const { data: users, error } = await supabaseAdmin
      .from('chat_history')
      .select('user_id')
      .order('user_id');

    if (error || !users) {
      logger.error('[Pruning] Failed to get users list', { error: error?.message });
      return;
    }

    const uniqueUserIds = [...new Set(users.map(u => u.user_id))];
    logger.info(`[Pruning] Processing ${uniqueUserIds.length} users`);

    let totalDeleted = 0;
    let totalMemories = 0;

    for (const userId of uniqueUserIds) {
      try {
        const result = await this.pruneUser(userId);
        if (!result.skipped) {
          totalDeleted += result.rowsDeleted;
          totalMemories += result.memoriesExtracted;
        }
      } catch (err) {
        logger.error('[Pruning] Unexpected error for user', { userId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    logger.info('[Pruning] Nightly run complete', {
      usersProcessed: uniqueUserIds.length,
      totalRowsDeleted: totalDeleted,
      totalMemoriesExtracted: totalMemories,
    });
  },
};
