import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const memoryDebugRouter: import('express').Router = Router();

/**
 * GET /memory/debug/stats
 * Returns statistics about the stored memories for the hardcoded user.
 */
memoryDebugRouter.get('/stats', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;
    const { data, error } = await supabaseAdmin
      .from('memories')
      .select('memory_type')
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message);
    }

    const memories = data || [];
    const stats: Record<string, number> = {
      preference: 0,
      interest: 0,
      goal: 0,
      biography: 0,
      relationship: 0,
      fact: 0
    };

    memories.forEach((mem) => {
      if (stats[mem.memory_type] !== undefined) {
        stats[mem.memory_type]++;
      }
    });

    res.status(200).json({
      total_memories: memories.length,
      by_type: stats
    });
  } catch (err) {
    logger.error('Failed to fetch debug stats', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

/**
 * GET /memory/debug
 * Returns all memories for the hardcoded user.
 */
memoryDebugRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;
    const { data, error } = await supabaseAdmin
      .from('memories')
      .select('*')
      .eq('user_id', userId)
      .order('importance', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    res.status(200).json({ memories: data || [] });
  } catch (err) {
    logger.error('Failed to fetch debug memories', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

/**
 * DELETE /memory/debug
 * Deletes all memories for the hardcoded user.
 */
memoryDebugRouter.delete('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user!.id;
    const { error } = await supabaseAdmin
      .from('memories')
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message);
    }

    res.status(200).json({ message: 'All memories deleted.' });
  } catch (err) {
    logger.error('Failed to delete debug memories', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
