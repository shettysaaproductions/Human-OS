import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const memoryManagementRouter = Router();

// GET /memories — list user's memories with search + filter
memoryManagementRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { search, type, archived, limit = '50', offset = '0' } = req.query;

    let query = supabaseAdmin
      .from('memories')
      .select('id, key, value, memory_type, importance, confidence, frequency, is_archived, created_at, updated_at')
      .eq('user_id', userId)
      .order('importance', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (archived === 'true') {
      query = query.eq('is_archived', true);
    } else {
      query = query.eq('is_archived', false);
    }

    if (type) {
      query = query.eq('memory_type', type as string);
    }

    if (search) {
      query = query.or(`key.ilike.%${search}%,value.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json({ success: true, data: data || [] });
  } catch (err) {
    logger.error('Failed to list memories', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// DELETE /memories/:id — delete a memory
memoryManagementRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { id } = req.params;
    const { error } = await supabaseAdmin
      .from('memories')
      .delete()
      .eq('id', id)
      .eq('user_id', userId); // Ensure ownership

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Failed to delete memory', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// PATCH /memories/:id/archive — archive a memory
memoryManagementRouter.patch('/:id/archive', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { id } = req.params;
    const { archived = true } = req.body;

    const { data, error } = await supabaseAdmin
      .from('memories')
      .update({ is_archived: archived, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, is_archived')
      .maybeSingle();

    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Memory not found' }); return; }

    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to archive memory', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// PATCH /memories/:id — edit a memory's value
memoryManagementRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const { id } = req.params;
    const { value, key } = req.body;

    if (!value && !key) {
      res.status(400).json({ error: 'Provide at least one of: value, key' });
      return;
    }

    const updates: any = { updated_at: new Date().toISOString() };
    if (value) updates.value = value;
    if (key) updates.key = key;

    const { data, error } = await supabaseAdmin
      .from('memories')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, key, value')
      .maybeSingle();

    if (error) throw error;
    if (!data) { res.status(404).json({ error: 'Memory not found' }); return; }

    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to edit memory', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
