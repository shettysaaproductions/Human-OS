import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { subconsciousQueue } from '../services/QueueService';


const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, status, timestamp, timezone } = req.body;
    
    if (!userId || !status) {
      res.status(400).json({ error: 'Missing userId or status' });
      return;
    }

    if (timezone) {
      // Opportunistically update timezone on presence heartbeat
      supabaseAdmin.from('profiles').update({ timezone }).eq('id', userId).then(({ error }) => {
        if (error) logger.warn('Failed to update timezone on presence', { userId, error: error.message });
      });
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
          // Compute away duration so NACE can inject it into the returning-user context
          const awayDurationMinutes = latestHistory?.created_at
            ? Math.round((Date.now() - new Date(latestHistory.created_at).getTime()) / 60000)
            : null;

          // Fire-and-forget background job for session cognition via subconsciousQueue
          // BUG-07: pass trigger + prevStatus + awayDurationMinutes so processUser()
          // can bypass phantom escalation gap and inject returning-user context.
          subconsciousQueue.add('session_start_cognition', {
            user_id: userId,
            timestamp: updateData.last_active_at,
            trigger: 'session_start',
            prevStatus: latestHistory?.status ?? 'offline',
            awayDurationMinutes,
          }).catch((err) => logger.error('[Presence] Failed to queue session cognition', { error: err?.message }));
        }
      }


      // Detect "silent visit" or session end (online → offline/away transition)
      if (status === 'offline' || status === 'away') {
        const prevOnline = latestHistory?.status === 'online';
        if (prevOnline) {
          const sessionStart = new Date(latestHistory.created_at).toISOString();
          const sessionStartSafe = sessionStart.replace(/[^0-9T]/g, '').slice(0, 15); // "20260829T174500"

          // Did user send a message during this session?
          const { data: msgDuringSession } = await supabaseAdmin
            .from('chat_history')
            .select('id')
            .eq('user_id', userId)
            .eq('role', 'user')
            .gte('created_at', sessionStart)
            .limit(1);

          if (!msgDuringSession || msgDuringSession.length === 0) {
            // Silent visit — increment counter
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

          // Amendment 5: Session-end proactive check — idempotent per session.
          // job_id = "session_end:{userId}:{sessionStart}" ensures at most ONE
          // scheduled evaluation per session regardless of how many offline/away
          // events fire. ProactiveGate is NOT bypassed — it evaluates eligibility.
          const sessionAwayMinutes = Math.round(
            (Date.now() - new Date(latestHistory.created_at).getTime()) / 60000
          );
          const INACTIVITY_THRESHOLD_MINUTES = 8;
          if (sessionAwayMinutes >= INACTIVITY_THRESHOLD_MINUTES) {
            const proactiveJobId = `session_end:${userId}:${sessionStartSafe}`;
            subconsciousQueue.add('session_end_proactive_check', {
              user_id: userId,
              session_start: sessionStart,
              awayDurationMinutes: sessionAwayMinutes,
              trigger: 'session_end',
              // Idempotency key: prevents duplicate jobs for the same session
              _idempotency_key: proactiveJobId,
            }).catch((err) =>
              logger.error('[Presence][Amendment5] Failed to queue session_end_proactive_check', {
                userId, error: err?.message
              })
            );
            logger.info('[Presence][Amendment5] session_end_proactive_check queued', {
              userId, sessionAwayMinutes, jobId: proactiveJobId
            });
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
