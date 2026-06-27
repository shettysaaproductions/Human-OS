import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { config } from '../config';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { qt } from '../lib/queryTracker';
import { dbHealthService } from '../services/DatabaseHealthService';

export const diagnosticsRouter: import('express').Router = Router();

// ── Main Diagnostics (cached 30s) ─────────────────────────────────────────────
diagnosticsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.id || 'unauthenticated';
    const cacheKey = `diagnostics:counts:${userId}`;
    const ttl = CACHE_TTL.DIAGNOSTICS_MS;

    const cached = cache.get<any>(cacheKey);
    if (cached) {
      res.status(200).json({ ...cached, cache_hit: true });
      return;
    }

    const startTime = Date.now();

    // 1. Supabase connectivity
    let supabaseStatus = 'OK';
    try {
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      if (error) throw error;
    } catch (e) {
      supabaseStatus = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 2. Counts (all run in parallel using exact count mode — no row data returned)
    const [
      { count: memoryCount },
      { count: chatCount },
      { count: kgNodeCount },
      { count: kgEdgeCount },
      { count: episodicCount },
      { count: workingCount },
      { count: emotionalCount }
    ] = await Promise.all([
      qt.track('count_memories', 'memories', () => supabaseAdmin.from('memories').select('*', { count: 'exact', head: true })),
      qt.track('count_chat', 'chat_history', () => supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true })),
      qt.track('count_kg_nodes', 'kg_nodes', () => supabaseAdmin.from('kg_nodes').select('*', { count: 'exact', head: true })),
      qt.track('count_kg_edges', 'kg_edges', () => supabaseAdmin.from('kg_edges').select('*', { count: 'exact', head: true })),
      qt.track('count_episodic', 'episodic_memories', () => supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true })),
      qt.track('count_working_memory', 'working_memory', () => supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true })),
      qt.track('count_emotional', 'emotional_states', () => supabaseAdmin.from('emotional_states').select('*', { count: 'exact', head: true })),
    ]);

    const payload = {
      environment: config.server.nodeEnv,
      user_id: userId,
      jwt_status: 'Valid',
      metrics: {
        chat_message_count: chatCount || 0,
        semantic_memory_count: memoryCount || 0,
        kg_node_count: kgNodeCount || 0,
        kg_edge_count: kgEdgeCount || 0,
        episodic_memory_count: episodicCount || 0,
        working_memory_count: workingCount || 0,
        emotional_state_count: emotionalCount || 0,
      },
      status: {
        supabase: supabaseStatus,
        nvidia_api: config.nvidia.apiKey ? 'Configured' : 'Missing Key',
        render: 'OK',
        degraded_mode: config.db.degradedMode,
      },
      cache: cache.stats(),
      egress: {
        estimated_mb: qt.estimatedEgressMb(),
        estimated_saved_mb: qt.estimatedEgressSavedMb(),
        warning_threshold_mb: config.db.egressWarningThresholdMb,
      },
      latency_ms: Date.now() - startTime,
      cache_hit: false,
    };

    cache.set(cacheKey, payload, ttl, CACHE_NS.DIAGNOSTICS);
    res.status(200).json(payload);
  } catch (err) {
    next(err);
  }
});

// ── Queue Health ───────────────────────────────────────────────────────────────
diagnosticsRouter.get('/queue', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [
      { count: pendingCount },
      { count: runningCount },
      { count: failedCount },
      { count: processedCount }
    ] = await Promise.all([
      qt.track('count_pending_jobs', 'background_jobs', () => supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending')),
      qt.track('count_running_jobs', 'background_jobs', () => supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'running')),
      qt.track('count_failed_jobs', 'failed_jobs', () => supabaseAdmin.from('failed_jobs').select('*', { count: 'exact', head: true })),
      qt.track('count_processed_jobs', 'processed_jobs', () => supabaseAdmin.from('processed_jobs').select('*', { count: 'exact', head: true })),
    ]);

    // Use DB-side aggregate instead of fetching 100 rows
    let avgData = null;
    try {
      const result = await supabaseAdmin.rpc('get_avg_job_processing_ms').maybeSingle();
      avgData = result.data;
    } catch {
      // ignore
    }
    const avgProcessingTimeMs = (avgData as any)?.avg_ms ?? 0;

    res.status(200).json({
      queue_health: {
        pending_jobs: pendingCount || 0,
        running_jobs: runningCount || 0,
        failed_jobs: failedCount || 0,
        processed_jobs: processedCount || 0,
        avg_processing_time_ms: avgProcessingTimeMs,
      }
    });
  } catch (err) {
    next(err);
  }
});

// ── DB Health ─────────────────────────────────────────────────────────────────
diagnosticsRouter.get('/health', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const report = await dbHealthService.check();
    res.status(200).json(report);
  } catch (err) {
    next(err);
  }
});

// ── Alerts ────────────────────────────────────────────────────────────────────
diagnosticsRouter.get('/alerts', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const alerts = dbHealthService.getAlertHistory();
    res.status(200).json({ alerts, count: alerts.length });
  } catch (err) {
    next(err);
  }
});

// ── Query Metrics (last 50 slow queries) ─────────────────────────────────────
diagnosticsRouter.get('/queries', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin
      .from('query_metrics')
      .select('query_name, table_name, duration_ms, rows_returned, estimated_bytes, created_at')
      .order('duration_ms', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.status(200).json({ queries: data || [], count: data?.length || 0 });
  } catch (err) {
    next(err);
  }
});
