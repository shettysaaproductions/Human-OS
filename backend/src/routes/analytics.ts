import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

export const analyticsRouter = Router();

// GET /analytics/memories
analyticsRouter.get('/memories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 1. Total memories
    const { count, error: countError } = await supabaseAdmin
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) throw countError;

    // 2. Categories breakdown
    // In a production app, we'd use a view or RPC for GROUP BY, but we can aggregate here for MVP
    const { data: allMemories, error: memoriesError } = await supabaseAdmin
      .from('memories')
      .select('id, memory_type, created_at, key, value, importance')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (memoriesError) throw memoriesError;

    const categories = (allMemories || []).reduce((acc: any, mem: any) => {
      const type = mem.memory_type || 'uncategorized';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    // 3. Recent memories
    const recent = (allMemories || []).slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        totalMemories: count || 0,
        categories,
        recentMemories: recent
      }
    });
  } catch (err) {
    logger.error('Failed to fetch memory analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/emotions
analyticsRouter.get('/emotions', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: states, error } = await supabaseAdmin
      .from('emotional_states')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    res.status(200).json({
      success: true,
      data: {
        graph: states || [],
        dominantEmotions: [], // Compute in MVP
        trends: []
      }
    });
  } catch (err) {
    logger.error('Failed to fetch emotion analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/goals
analyticsRouter.get('/goals', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: goals, error } = await supabaseAdmin
      .from('kg_nodes')
      .select('*')
      .eq('user_id', userId)
      .eq('entity_type', 'goal')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json({
      success: true,
      data: {
        activeGoals: goals || [],
        completedGoals: [], // Add status to attributes if needed
        timeline: []
      }
    });
  } catch (err) {
    logger.error('Failed to fetch goal analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/timeline
analyticsRouter.get('/timeline', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Fetch episodic memories
    const { data: episodic, error: episodicError } = await supabaseAdmin
      .from('episodic_memories')
      .select('id, summary, emotion, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (episodicError) throw episodicError;

    // Fetch moments
    const { data: moments, error: momentsError } = await supabaseAdmin
      .from('user_moments')
      .select('id, title, body, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (momentsError) throw momentsError;
    
    // Combine and sort
    const combined = [
      ...(episodic || []).map((e: any) => ({ ...e, type: 'episodic' })),
      ...(moments || []).map((m: any) => ({ ...m, type: 'moment' }))
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.status(200).json({
      success: true,
      data: combined
    });
  } catch (err) {
    logger.error('Failed to fetch timeline analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/kg
analyticsRouter.get('/kg', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: nodes, error: nodesError } = await supabaseAdmin
      .from('kg_nodes')
      .select('*')
      .eq('user_id', userId)
      .limit(100);

    if (nodesError) throw nodesError;

    const { data: edges, error: edgesError } = await supabaseAdmin
      .from('kg_edges')
      .select('*')
      .eq('user_id', userId)
      .limit(100);

    if (edgesError) throw edgesError;

    res.status(200).json({
      success: true,
      data: {
        nodes: nodes || [],
        edges: edges || []
      }
    });
  } catch (err) {
    logger.error('Failed to fetch kg analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/founder
analyticsRouter.get('/founder', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Total users
    const { count: usersCount } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // 2. Total memories
    const { count: memoriesCount } = await supabaseAdmin
      .from('memories')
      .select('*', { count: 'exact', head: true });

    // 3. Moments generated
    const { count: momentsCount } = await supabaseAdmin
      .from('user_moments')
      .select('*', { count: 'exact', head: true });

    // 4. Reflections
    const { count: reflectionsCount } = await supabaseAdmin
      .from('reflections')
      .select('*', { count: 'exact', head: true });

    res.status(200).json({
      success: true,
      data: {
        totalUsers: usersCount || 0,
        totalMemories: memoriesCount || 0,
        momentsGenerated: momentsCount || 0,
        reflectionsGenerated: reflectionsCount || 0,
        aiCosts: 0.0, // Placeholder
        systemHealth: 'online'
      }
    });
  } catch (err) {
    logger.error('Failed to fetch founder analytics', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
