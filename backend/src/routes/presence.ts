import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { subconsciousQueue } from '../services/QueueService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, status, timestamp } = req.body;
    
    if (!userId || !status) {
      res.status(400).json({ error: 'Missing userId or status' });
      return;
    }

    const updateData: any = {
      status,
      last_active_at: new Date(timestamp || Date.now()).toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (status === 'typing') {
      updateData.last_typing_at = updateData.last_active_at;
    }

    // Upsert the presence status
    const { error } = await supabaseAdmin
      .from('user_presence')
      .upsert({ user_id: userId, ...updateData }, { onConflict: 'user_id' });

    if (error) {
      logger.error('Failed to update user presence', { error: error.message, userId });
      res.status(500).json({ error: 'Failed to update presence' });
      return;
    }

    // Capture history to understand behavior patterns (online -> offline -> typing etc)
    const { data: latestHistory } = await supabaseAdmin
      .from('user_presence_history')
      .select('status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let shouldInsertHistory = true;
    if (latestHistory) {
      const isSameStatus = latestHistory.status === status;
      const msSinceLast = Date.now() - new Date(latestHistory.created_at).getTime();
      const isRecent = msSinceLast < 5 * 60 * 1000; // 5 minutes
      
      if (isSameStatus && isRecent) {
        shouldInsertHistory = false;
      }
    }

    if (shouldInsertHistory) {
      await supabaseAdmin
        .from('user_presence_history')
        .insert({
          user_id: userId,
          status,
          created_at: updateData.last_active_at
        });

      // Detect session start (transition to online)
      if (status === 'online') {
        const prevOffline = !latestHistory || latestHistory.status !== 'online';
        if (prevOffline) {
          // Fire-and-forget background job for session cognition via subconsciousQueue
          subconsciousQueue.add('session_start_cognition', { user_id: userId, timestamp: updateData.last_active_at })
            .catch((err) => logger.error('[Presence] Failed to queue session cognition', { error: err?.message }));
        }
      }

      // Detect "silent visit" (online -> offline/away transition without a message)
      if (status === 'offline' || status === 'away') {
        const prevOnline = latestHistory?.status === 'online';
        if (prevOnline) {
          const sessionStart = new Date(latestHistory.created_at).toISOString();
          
          // Did user send a message during this session?
          const { data: msgDuringSession } = await supabaseAdmin
            .from('chat_history')
            .select('id')
            .eq('user_id', userId)
            .eq('role', 'user')
            .gte('created_at', sessionStart)
            .limit(1);

          if (!msgDuringSession || msgDuringSession.length === 0) {
            // It's a silent visit! Increment count in working_memory
            const { data: silentVisitWm } = await supabaseAdmin
              .from('working_memory')
              .select('value')
              .eq('user_id', userId)
              .eq('key', 'silent_visit_count')
              .maybeSingle();

            const currentCount = parseInt(silentVisitWm?.value || '0', 10);
            
            await supabaseAdmin.from('working_memory').upsert([
              { user_id: userId, key: 'silent_visit_count', value: String(currentCount + 1), updated_at: new Date().toISOString() },
              { user_id: userId, key: 'last_silent_visit_at', value: updateData.last_active_at, updated_at: new Date().toISOString() }
            ], { onConflict: 'user_id, key' });
            
            logger.info('[Presence] Recorded silent visit', { userId, currentCount: currentCount + 1 });
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Error in POST /presence', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
