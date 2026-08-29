import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { canonicalizeKey } from '../lib/memoryKeySchema';
import { SourceAuthority } from '../types/memory';

export const analyticsRouter = Router();

const AUTHORITY_RANK: Record<SourceAuthority, number> = {
  subconscious_inference: 1,
  confirmed_memory:       2,
  deterministic:          3,
  explicit_user:          4,
  needs_review:           0,
};

function authorityRank(a?: string | null): number {
  return AUTHORITY_RANK[(a ?? 'subconscious_inference') as SourceAuthority] ?? 1;
}

// GET /analytics/memories — active canonical memories for UI
analyticsRouter.get('/memories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // 1. Fetch all active, non-archived memories
    const { data: allMemories, error: memoriesError } = await supabaseAdmin
      .from('memories')
      .select('id, memory_type, created_at, updated_at, key, value, importance, is_archived, source_authority')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false });

    if (memoriesError) throw memoriesError;

    // 2. Canonicalize aliases and deduplicate semantic concepts
    // Group by canonical key and keep the single active canonical record with highest authority / latest timestamp
    const canonicalMap = new Map<string, any>();
    for (const mem of (allMemories || [])) {
      const { canonical } = canonicalizeKey(mem.key || '');
      const normalizedMem = { ...mem, key: canonical };

      if (!canonicalMap.has(canonical)) {
        canonicalMap.set(canonical, normalizedMem);
      } else {
        const existing = canonicalMap.get(canonical)!;
        const existingRank = authorityRank(existing.source_authority);
        const currentRank = authorityRank(mem.source_authority);
        if (currentRank > existingRank) {
          canonicalMap.set(canonical, normalizedMem);
        } else if (currentRank === existingRank) {
          const existingTime = new Date(existing.updated_at || existing.created_at).getTime();
          const currentTime = new Date(mem.updated_at || mem.created_at).getTime();
          if (currentTime > existingTime) {
            canonicalMap.set(canonical, normalizedMem);
          }
        }
      }
    }

    const uniqueCanonicalMemories = Array.from(canonicalMap.values());

    // 3. Categories breakdown based on active canonical concepts
    const categories = uniqueCanonicalMemories.reduce((acc: any, mem: any) => {
      const type = mem.memory_type || 'uncategorized';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    // 4. Recent memories (sorted by updated_at / created_at desc)
    uniqueCanonicalMemories.sort((a, b) => {
      const tA = new Date(a.updated_at || a.created_at).getTime();
      const tB = new Date(b.updated_at || b.created_at).getTime();
      return tB - tA;
    });

    const recent = uniqueCanonicalMemories.slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        totalMemories: uniqueCanonicalMemories.length,
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
