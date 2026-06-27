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

    res.status(200).json({
      environment: config.server.nodeEnv,
      user_id: userId,
      jwt_status: 'Valid',
      metrics: {
        memory_count: memoryCount || 0,
        chat_message_count: chatCount || 0,
      },
      status: {
        supabase: supabaseStatus,
        nvidia_api: config.nvidia.apiKey ? 'Configured' : 'Missing Key',
        render: 'OK', // If this endpoint answers, Render is OK
      },
      latency_ms: Date.now() - startTime
    });
  } catch (err) {
    next(err);
  }
});
