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

// GET /analytics/memories — three-layer Brain view:
//   currentMemories  = canonical CURRENT, not archived/superseded
//   workingContext   = ephemeral working_memory rows still in scope
//   archivedMemories = superseded/archived history (provenance display)
analyticsRouter.get('/memories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const now = new Date().toISOString();

    // ── 1. Fetch all non-archived memories for canonical CURRENT layer ────────
    // Bounded at 500 (invariant: ~22 canonical keys per user — well within limit)
    const { data: activeMemories, error: activeErr } = await supabaseAdmin
      .from('memories')
      .select('id, memory_type, created_at, updated_at, key, value, importance, is_archived, source_authority, lifecycle_state')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('importance', { ascending: false })
      .limit(500);

    if (activeErr) throw activeErr;

    // ── 2. Canonicalize + deduplicate: keep highest-authority CURRENT per key ─
    const canonicalMap = new Map<string, any>();
    for (const mem of (activeMemories || [])) {
      // Exclude superseded/invalidated rows that slipped past is_archived flag
      if (mem.lifecycle_state === 'SUPERSEDED' || mem.lifecycle_state === 'INVALIDATED') continue;

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

    // Sort by importance desc, then updated_at desc
    const currentMemories = Array.from(canonicalMap.values()).sort((a, b) => {
      if ((b.importance || 0) !== (a.importance || 0)) return (b.importance || 0) - (a.importance || 0);
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });

    // ── 3. thisWeekCount — computed from the FULL canonical set, not a slice ──
    // Uses updated_at (reinforcement timestamp), falls back to created_at when null.
    const oneWeekAgo = Date.now() - 7 * 86400000;
    const thisWeekCount = currentMemories.filter(m => {
      const ts = m.updated_at ?? m.created_at;
      return ts && new Date(ts).getTime() >= oneWeekAgo;
    }).length;

    // ── 4. Categories — from canonical current set ────────────────────────────
    const categories = currentMemories.reduce((acc: Record<string, number>, mem) => {
      const type = mem.memory_type || 'uncategorized';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    // ── 5. Working context — ephemeral working_memory rows still in scope ─────
    // Convention (canonical from CognitiveContextService):
    //   - NULL expires_at = never expires = displayable
    //   - expires_at set AND < now = expired = excluded
    //   - promotion_status SUPERSEDED or INVALIDATED = excluded
    const { data: wmRows, error: wmErr } = await supabaseAdmin
      .from('working_memory')
      .select('id, key, value, created_at, promotion_status, expires_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (wmErr) {
      logger.warn('[Analytics/memories] Working memory fetch failed — returning empty', { error: wmErr.message });
    }

    const SYSTEM_WM_KEYS = new Set([
      'nova_ignored_deferred_count',
      'ignore_escalation_count',
      'followup_suppressed_until',
      'silent_visit_count',
      'last_proactive_content',
      'user_busy_until',
      'last_curiosity_topic',
    ]);

    const workingContext = (wmRows || []).filter((wm: any) =>
      wm.promotion_status !== 'SUPERSEDED' &&
      wm.promotion_status !== 'INVALIDATED' &&
      (!wm.expires_at || wm.expires_at > now) && // NULL = never expires
      !wm.key.startsWith('__sys_') &&
      !wm.key.startsWith('_') &&
      !SYSTEM_WM_KEYS.has(wm.key) &&
      !wm.key.includes('counter') &&
      !wm.key.includes('count') &&
      !wm.key.includes('suppressed') &&
      wm.key !== 'birth_date' // birth_date belongs strictly in semantic memories, not ephemeral working context
    );

    // ── 6. Archived/history layer — superseded + archived for provenance ──────
    const { data: archivedRows, error: archErr } = await supabaseAdmin
      .from('memories')
      .select('id, memory_type, created_at, updated_at, key, value, importance, is_archived, source_authority, lifecycle_state')
      .eq('user_id', userId)
      .or('is_archived.eq.true,lifecycle_state.in.(SUPERSEDED,INVALIDATED)')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (archErr) {
      logger.warn('[Analytics/memories] Archived memories fetch failed — returning empty', { error: archErr.message });
    }

    // Canonicalize keys for display but do NOT deduplicate — show full provenance history
    const archivedMemories = (archivedRows || []).map((mem: any) => {
      const { canonical } = canonicalizeKey(mem.key || '');
      return { ...mem, key: canonical };
    });

    res.status(200).json({
      success: true,
      data: {
        currentMemories,
        workingContext,
        archivedMemories,
        totalCount: currentMemories.length,
        categories,
        thisWeekCount,
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
