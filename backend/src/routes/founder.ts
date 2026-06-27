import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';

export const founderRouter = Router();

const CACHE_TTL = 60; // seconds

// GET /analytics/overview — high-level system snapshot
founderRouter.get('/overview', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'founder:overview';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.status(200).json({ success: true, data: cached, cached: true }); return; }

    const [usersRes, memoriesRes, momentsRes, reflectionsRes, episodicRes, sessionsRes] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('memories').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('reflections').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('conversation_sessions').select('*', { count: 'exact', head: true }),
    ]);

    // DAU: users active today
    const today = new Date().toISOString().split('T')[0];
    const { count: dauCount } = await supabaseAdmin
      .from('conversation_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('session_date', today)
      .gt('message_count', 0);

    const data = {
      totalUsers: usersRes.count || 0,
      totalMemories: memoriesRes.count || 0,
      momentsGenerated: momentsRes.count || 0,
      reflectionsGenerated: reflectionsRes.count || 0,
      episodicMemories: episodicRes.count || 0,
      totalSessions: sessionsRes.count || 0,
      dau: dauCount || 0,
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to fetch overview', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/system — background job & database health
founderRouter.get('/system', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'founder:system';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.status(200).json({ success: true, data: cached, cached: true }); return; }

    const [pendingJobsRes, failedJobsRes] = await Promise.all([
      supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('failed_jobs').select('*', { count: 'exact', head: true }),
    ]);

    // Recent errors in last 24 hours
    const since24h = new Date(Date.now() - 86400000).toISOString();
    const { count: recentFailures } = await supabaseAdmin
      .from('failed_jobs')
      .select('*', { count: 'exact', head: true })
      .gte('failed_at', since24h);

    const data = {
      pendingJobs: pendingJobsRes.count || 0,
      totalFailedJobs: failedJobsRes.count || 0,
      failedJobsLast24h: recentFailures || 0,
      systemHealth: (failedJobsRes.count || 0) > 50 ? 'degraded' : 'online',
      timestamp: new Date().toISOString(),
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to fetch system stats', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/costs — AI usage & cost estimation
founderRouter.get('/costs', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'founder:costs';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.status(200).json({ success: true, data: cached, cached: true }); return; }

    // Total tokens used from agent_metrics
    const { data: metrics } = await supabaseAdmin
      .from('agent_metrics')
      .select('tokens_used, status, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);

    const totalTokens = (metrics || []).reduce((sum, m) => sum + (m.tokens_used || 0), 0);
    const successCount = (metrics || []).filter(m => m.status === 'success').length;
    const failCount = (metrics || []).filter(m => m.status === 'failure').length;

    // Rough cost estimate: NVIDIA NIM pricing ~$0.000002 per token
    const estimatedCostUsd = totalTokens * 0.000002;

    // Token usage this week
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const weekMetrics = (metrics || []).filter(m => m.created_at >= weekAgo);
    const weekTokens = weekMetrics.reduce((sum, m) => sum + (m.tokens_used || 0), 0);

    const data = {
      totalTokens,
      weeklyTokens: weekTokens,
      estimatedTotalCostUsd: Number(estimatedCostUsd.toFixed(4)),
      estimatedWeeklyCostUsd: Number((weekTokens * 0.000002).toFixed(4)),
      successfulRequests: successCount,
      failedRequests: failCount,
      successRate: metrics && metrics.length > 0 ? `${((successCount / metrics.length) * 100).toFixed(1)}%` : '0%',
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to fetch cost stats', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /analytics/telemetry — moment + reflection performance
founderRouter.get('/telemetry', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'founder:telemetry';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.status(200).json({ success: true, data: cached, cached: true }); return; }

    const [momentsOpened, momentsDismissed, momentsGenerated, dailyRef, weeklyRef] = await Promise.all([
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true }).eq('status', 'opened'),
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true }).eq('status', 'dismissed'),
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('reflections').select('*', { count: 'exact', head: true }).eq('reflection_type', 'daily'),
      supabaseAdmin.from('reflections').select('*', { count: 'exact', head: true }).eq('reflection_type', 'weekly'),
    ]);

    const totalMoments = momentsGenerated.count || 0;
    const openedCount = momentsOpened.count || 0;
    const dismissedCount = momentsDismissed.count || 0;
    const openRate = totalMoments > 0 ? `${((openedCount / totalMoments) * 100).toFixed(1)}%` : '0%';
    const dismissRate = totalMoments > 0 ? `${((dismissedCount / totalMoments) * 100).toFixed(1)}%` : '0%';

    const data = {
      moments: {
        total: totalMoments,
        opened: openedCount,
        dismissed: dismissedCount,
        openRate,
        dismissRate,
      },
      reflections: {
        daily: dailyRef.count || 0,
        weekly: weeklyRef.count || 0,
        total: (dailyRef.count || 0) + (weeklyRef.count || 0),
      },
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to fetch telemetry', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
