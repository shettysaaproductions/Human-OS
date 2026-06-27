import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const exportRouter = Router();

// GET /memories/export — export all user data as JSON
exportRouter.get('/export', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }

    const [memoriesRes, reflectionsRes, momentsRes] = await Promise.all([
      supabaseAdmin
        .from('memories')
        .select('id, key, value, memory_type, importance, confidence, is_archived, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),

      supabaseAdmin
        .from('reflections')
        .select('id, reflection_type, summary, key_takeaways, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),

      supabaseAdmin
        .from('user_moments')
        .select('id, title, body, moment_type, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    const export_data = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      memories: memoriesRes.data || [],
      reflections: reflectionsRes.data || [],
      moments: momentsRes.data || [],
    };

    // Return summary in API response; full data available for download
    res.status(200).json({
      success: true,
      data: {
        memoriesCount: (memoriesRes.data || []).length,
        reflectionsCount: (reflectionsRes.data || []).length,
        momentsCount: (momentsRes.data || []).length,
        export: export_data
      }
    });
  } catch (err) {
    logger.error('Failed to export user data', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
