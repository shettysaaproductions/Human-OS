import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { config } from '../config';
import { cache, CACHE_NS, CACHE_TTL } from '../lib/cache';
import { qt } from '../lib/queryTracker';
import { dbHealthService } from '../services/DatabaseHealthService';
import { extractKeywords } from '../utils/nlp';
import { chatHistoryPruningService } from '../services/ChatHistoryPruningService';

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

// ── Memory Scoring Diagnostics ────────────────────────────────────────────────
diagnosticsRouter.get('/memory', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.id || req.query.user_id as string;
    const query = req.query.q as string;

    if (!userId || !query) {
      res.status(400).json({ error: 'Missing user_id or q (query) parameter' });
      return;
    }

    const keywords = extractKeywords(query);
    const searchStr = keywords.join(' ');

    const { data, error } = await supabaseAdmin.rpc('search_relevant_memories', {
      p_user_id: userId,
      p_query: searchStr,
      p_limit: 10
    });

    if (error) {
      throw new Error(error.message);
    }

    const results = (data || []).map((m: any) => ({
      id: m.id,
      key: m.key,
      value: m.value,
      type: m.memory_type,
      final_score: m.score,
      explanation: {
        importance: m.score_importance,
        relevance: m.score_relevance,
        confidence: m.score_confidence,
        memory_type: m.score_type,
        recency: m.score_recency,
        frequency: m.score_frequency,
        emotional: m.score_emotion
      },
      matched_keywords: m.matched_keywords
    }));

    res.status(200).json({
      query: searchStr,
      extracted_keywords: keywords,
      results
    });
  } catch (err) {
    next(err);
  }
});

// ── Manual Prune History (Founder Dashboard / Emergency) ──────────────────────
// POST /admin/diagnostics/prune-history
// Body: { user_id?: string }  — omit to prune ALL users
diagnosticsRouter.post('/prune-history', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const targetUserId = req.body?.user_id as string | undefined;

    if (targetUserId) {
      const result = await chatHistoryPruningService.pruneUser(targetUserId);
      res.status(200).json({ mode: 'single_user', result });
    } else {
      // Run for all users — fire and respond immediately so the HTTP call doesn't time out
      chatHistoryPruningService.processCompaction().catch((err: any) => {
        console.error('[Manual Prune] Error during processCompaction:', err);
      });
      res.status(202).json({
        mode: 'all_users',
        message: 'Pruning job started in background. Check server logs for progress.',
      });
    }
  } catch (err) {
    next(err);
  }
});

// ── Push Notification Diagnostic (Live End-to-End Test) ───────────────────────
// GET /admin/diagnostics/push-diagnostic?user_id=<optional>
// Checks EXPO_ACCESS_TOKEN, reads push_token from DB, sends a test push,
// and returns the raw Expo response inline so you can see exactly what happens.
diagnosticsRouter.get('/push-diagnostic', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.query.user_id as string || (req as any).user?.id;
    const checks: Record<string, any> = {};

    // 1. Check EXPO_ACCESS_TOKEN
    const expoToken = process.env.EXPO_ACCESS_TOKEN;
    checks.expo_access_token = expoToken
      ? { status: 'OK', preview: expoToken.substring(0, 8) + '...' }
      : { status: 'MISSING', message: 'EXPO_ACCESS_TOKEN is not set in environment. Push will fail with FCM V1.' };

    // 2. Check user push_token in DB
    let pushToken: string | null = null;
    if (userId) {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('push_token')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        checks.db_push_token = { status: 'ERROR', message: error.message };
      } else if (!data?.push_token) {
        checks.db_push_token = { status: 'MISSING', message: 'No push_token found in profiles for this user. The app may not have registered yet.' };
      } else {
        pushToken = data.push_token;
        checks.db_push_token = { status: 'OK', tokenPreview: pushToken!.substring(0, 30) + '...' };
      }
    } else {
      checks.db_push_token = { status: 'SKIPPED', message: 'No user_id provided — cannot check DB token.' };
    }

    // 3. Send a test push if we have both tokens
    if (expoToken && pushToken) {
      try {
        const testPayload = [{
          to: pushToken,
          title: '🔔 Push Test',
          body: 'If you see this, push notifications are working!',
          sound: 'default' as const,
          channelId: 'nova_messages',
          priority: 'high' as const,
          ttl: 60,
          data: { type: 'push_diagnostic_test' },
        }];

        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${expoToken}`,
          },
          body: JSON.stringify(testPayload),
          signal: AbortSignal.timeout(8000),
        });

        const result = await response.json();
        checks.test_push = {
          status: response.ok ? 'SENT' : 'FAILED',
          http_status: response.status,
          expo_response: result,
        };
      } catch (pushErr) {
        checks.test_push = {
          status: 'ERROR',
          message: pushErr instanceof Error ? pushErr.message : String(pushErr),
        };
      }
    } else {
      checks.test_push = {
        status: 'SKIPPED',
        reason: !expoToken ? 'Missing EXPO_ACCESS_TOKEN' : 'Missing push_token in DB',
      };
    }

    // 4. Overall verdict
    const allOk = checks.expo_access_token?.status === 'OK' &&
                  checks.db_push_token?.status === 'OK' &&
                  checks.test_push?.status === 'SENT';

    res.status(200).json({
      overall: allOk ? '✅ PUSH WORKING' : '❌ PUSH HAS ISSUES — see checks below',
      checks,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
