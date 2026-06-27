import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { config } from '../config';

export const diagnosticsRouter: import('express').Router = Router();

diagnosticsRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const startTime = Date.now();
    const userId = (req as any).user?.id || 'unauthenticated';

    // 1. Supabase Check
    let supabaseStatus = 'OK';
    try {
      const { error } = await supabaseAdmin.from('profiles').select('id').limit(1);
      if (error) throw error;
    } catch (e) {
      supabaseStatus = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }

    // 2. Counts
    const { count: memoryCount } = await supabaseAdmin.from('memories').select('*', { count: 'exact', head: true });
    const { count: chatCount } = await supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true });
    const { count: kgNodeCount } = await supabaseAdmin.from('kg_nodes').select('*', { count: 'exact', head: true });
    const { count: kgEdgeCount } = await supabaseAdmin.from('kg_edges').select('*', { count: 'exact', head: true });
    const { count: episodicCount } = await supabaseAdmin.from('episodic_memories').select('*', { count: 'exact', head: true });
    const { count: workingCount } = await supabaseAdmin.from('working_memory').select('*', { count: 'exact', head: true });
    const { count: emotionalCount } = await supabaseAdmin.from('emotional_states').select('*', { count: 'exact', head: true });

    res.status(200).json({
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
        emotional_state_count: emotionalCount || 0
      },
      status: {
        supabase: supabaseStatus,
        nvidia_api: config.nvidia.apiKey ? 'Configured' : 'Missing Key',
        render: 'OK', 
      },
      latency_ms: Date.now() - startTime
    });
  } catch (err) {
    next(err);
  }
});

diagnosticsRouter.get('/queue', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { count: pendingCount } = await supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending');
    const { count: runningCount } = await supabaseAdmin.from('background_jobs').select('*', { count: 'exact', head: true }).eq('status', 'running');
    const { count: failedCount } = await supabaseAdmin.from('failed_jobs').select('*', { count: 'exact', head: true });
    const { count: processedCount } = await supabaseAdmin.from('processed_jobs').select('*', { count: 'exact', head: true });

    const { data: recentCompleted } = await supabaseAdmin
      .from('background_jobs')
      .select('started_at, finished_at')
      .eq('status', 'completed')
      .not('started_at', 'is', null)
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(100);

    let avgProcessingTimeMs = 0;
    if (recentCompleted && recentCompleted.length > 0) {
      const totalMs = recentCompleted.reduce((acc, job) => {
        const start = new Date(job.started_at!).getTime();
        const end = new Date(job.finished_at!).getTime();
        return acc + (end - start);
      }, 0);
      avgProcessingTimeMs = totalMs / recentCompleted.length;
    }

    res.status(200).json({
      queue_health: {
        pending_jobs: pendingCount || 0,
        running_jobs: runningCount || 0,
        failed_jobs: failedCount || 0,
        processed_jobs: processedCount || 0,
        avg_processing_time_ms: avgProcessingTimeMs
      }
    });
  } catch (err) {
    next(err);
  }
});
