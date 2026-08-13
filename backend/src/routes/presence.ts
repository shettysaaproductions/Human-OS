import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

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
    }

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('Error in POST /presence', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
