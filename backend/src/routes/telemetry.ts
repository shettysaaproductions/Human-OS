import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';

export const telemetryRouter = Router();

// POST /telemetry — record a client-side event (crash, api_failure, etc.)
telemetryRouter.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id ?? null;
    const { event_type, event_data, platform, app_version } = req.body;

    if (!event_type) {
      res.status(400).json({ error: 'event_type is required' });
      return;
    }

    const { error } = await supabaseAdmin
      .from('telemetry_events')
      .insert({ user_id: userId, event_type, event_data: event_data || {}, platform, app_version });

    if (error) throw error;
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error('Failed to store telemetry event', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// GET /admin/errors — aggregate recent errors for the founder dashboard
telemetryRouter.get('/admin/errors', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'telemetry:admin:errors';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.status(200).json({ success: true, data: cached, cached: true }); return; }

    const since24h = new Date(Date.now() - 86400000).toISOString();
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data: events, error } = await supabaseAdmin
      .from('telemetry_events')
      .select('event_type, event_data, platform, created_at')
      .gte('created_at', since7d)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const allEvents = events || [];

    // Aggregate by type
    const typeCounts: Record<string, number> = {};
    allEvents.forEach(e => {
      typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1;
    });

    // Recent 24h errors
    const recent24h = allEvents.filter(e => e.created_at >= since24h);
    const errors24h = recent24h.filter(e =>
      ['crash', 'api_failure', 'memory_error', 'reflection_failure', 'moment_failure'].includes(e.event_type)
    );

    // Recent 10 errors
    const recentErrors = allEvents
      .filter(e => e.event_type !== 'app_open')
      .slice(0, 10);

    const data = {
      period: '7 days',
      totalEvents: allEvents.length,
      byType: typeCounts,
      errors24h: errors24h.length,
      appOpens7d: typeCounts['app_open'] || 0,
      recentErrors,
    };

    cache.set(cacheKey, data, 60);
    res.status(200).json({ success: true, data });
  } catch (err) {
    logger.error('Failed to fetch error telemetry', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
