import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { cache } from '../lib/cache';

export const betaAnalyticsRouter = Router();

const CACHE_TTL = 120; // 2 min cache on all beta analytics

// ── Helper ───────────────────────────────────────────────────────────────────
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/beta/overview — single call for the full dashboard
// ─────────────────────────────────────────────────────────────────────────────
betaAnalyticsRouter.get('/overview', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'beta:overview';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    const [
      { count: totalUsers },
      { count: dauCount },
      { count: wauCount },
      { count: totalMessages },
      { count: momentsOpened },
      { count: momentsDismissed },
      { count: totalMoments },
      { count: crashes24h },
      { count: apiFailures24h },
      { count: feedbackCount },
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('conversation_sessions').select('*', { count: 'exact', head: true })
        .gte('session_date', new Date().toISOString().split('T')[0]),
      supabaseAdmin.from('conversation_sessions').select('*', { count: 'exact', head: true })
        .gte('session_date', daysAgo(7).split('T')[0]),
      supabaseAdmin.from('chat_history').select('*', { count: 'exact', head: true })
        .eq('role', 'user'),
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true })
        .eq('status', 'opened'),
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true })
        .eq('status', 'dismissed'),
      supabaseAdmin.from('user_moments').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('telemetry_events').select('*', { count: 'exact', head: true })
        .eq('event_type', 'crash').gte('created_at', daysAgo(1)),
      supabaseAdmin.from('telemetry_events').select('*', { count: 'exact', head: true })
        .eq('event_type', 'api_failure').gte('created_at', daysAgo(1)),
      supabaseAdmin.from('user_feedback').select('*', { count: 'exact', head: true }),
    ]);

    const totalMomentsNum = totalMoments || 0;
    const openRate = totalMomentsNum > 0
      ? `${Math.round(((momentsOpened || 0) / totalMomentsNum) * 100)}%`
      : '0%';

    const data = {
      users: {
        total: totalUsers || 0,
        dau: dauCount || 0,
        wau: wauCount || 0,
      },
      engagement: {
        totalMessages: totalMessages || 0,
        avgMessagesPerUser: totalUsers ? Math.round((totalMessages || 0) / totalUsers) : 0,
      },
      moments: {
        total: totalMomentsNum,
        opened: momentsOpened || 0,
        dismissed: momentsDismissed || 0,
        openRate,
      },
      health: {
        crashes24h: crashes24h || 0,
        apiFailures24h: apiFailures24h || 0,
      },
      feedback: {
        total: feedbackCount || 0,
      },
      generatedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('beta/overview failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/beta/retention — D1, D7 retention cohorts
// ─────────────────────────────────────────────────────────────────────────────
betaAnalyticsRouter.get('/retention', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'beta:retention';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    // Get all profiles with their created_at date
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from('profiles')
      .select('id, created_at')
      .order('created_at', { ascending: true });

    if (profilesError) throw profilesError;
    const users = profiles || [];

    // Get all session dates per user
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('conversation_sessions')
      .select('user_id, session_date, message_count')
      .gt('message_count', 0);

    if (sessionsError) throw sessionsError;

    // Build a set of (userId, date) pairs for quick lookup
    const activeDays = new Map<string, Set<string>>();
    (sessions || []).forEach((s: any) => {
      if (!activeDays.has(s.user_id)) activeDays.set(s.user_id, new Set());
      activeDays.get(s.user_id)!.add(s.session_date);
    });

    // Compute D1 and D7 retention
    let d1Eligible = 0, d1Retained = 0;
    let d7Eligible = 0, d7Retained = 0;

    users.forEach((user: any) => {
      const signupDate = new Date(user.created_at);
    const d1Date = new Date(signupDate.getTime() + 86400000).toISOString().split('T')[0];
      const d7Date = new Date(signupDate.getTime() + 7 * 86400000).toISOString().split('T')[0];
      const today = new Date().toISOString().split('T')[0];

      const userDays = activeDays.get(user.id) || new Set();

      // Only count cohorts where enough time has passed
      if (d1Date <= today) {
        d1Eligible++;
        if (userDays.has(d1Date)) d1Retained++;
      }
      if (d7Date <= today) {
        d7Eligible++;
        if (userDays.has(d7Date)) d7Retained++;
      }
    });

    // DAU trend — last 14 days
    const dauTrend: Array<{ date: string; users: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const count = new Set(
        (sessions || []).filter((s: any) => s.session_date === d).map((s: any) => s.user_id)
      ).size;
      dauTrend.push({ date: d, users: count });
    }

    const data = {
      d1: {
        eligible: d1Eligible,
        retained: d1Retained,
        rate: d1Eligible > 0 ? `${Math.round((d1Retained / d1Eligible) * 100)}%` : 'N/A',
      },
      d7: {
        eligible: d7Eligible,
        retained: d7Retained,
        rate: d7Eligible > 0 ? `${Math.round((d7Retained / d7Eligible) * 100)}%` : 'N/A',
      },
      dauTrend,
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('beta/retention failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/beta/crashes — crash analytics from telemetry_events
// ─────────────────────────────────────────────────────────────────────────────
betaAnalyticsRouter.get('/crashes', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'beta:crashes';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    const { data: events, error } = await supabaseAdmin
      .from('telemetry_events')
      .select('event_type, event_data, platform, app_version, created_at')
      .in('event_type', ['crash', 'api_failure', 'memory_error', 'reflection_failure', 'moment_failure'])
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    const all = events || [];

    // Group by type
    const byType: Record<string, number> = {};
    all.forEach((e: any) => { byType[e.event_type] = (byType[e.event_type] || 0) + 1; });

    // Group by platform
    const byPlatform: Record<string, number> = {};
    all.forEach((e: any) => {
      if (e.platform) byPlatform[e.platform] = (byPlatform[e.platform] || 0) + 1;
    });

    // Last 24h vs last 7d
    const since24h = daysAgo(1);
    const errors24h = all.filter((e: any) => e.created_at >= since24h).length;

    // Recent 10 errors
    const recent = all.slice(0, 10).map((e: any) => ({
      type: e.event_type,
      platform: e.platform,
      version: e.app_version,
      time: e.created_at,
      data: e.event_data,
    }));

    const data = {
      total7d: all.length,
      errors24h,
      byType,
      byPlatform,
      recent,
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('beta/crashes failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/beta/feedback-analytics — sentiment, ratings, types
// ─────────────────────────────────────────────────────────────────────────────
betaAnalyticsRouter.get('/feedback-analytics', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'beta:feedback';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    const { data: feedback, error } = await supabaseAdmin
      .from('user_feedback')
      .select('feedback_type, message, rating, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const all = feedback || [];
    const byType: Record<string, number> = {};
    let ratingSum = 0, ratingCount = 0;
    all.forEach((f: any) => {
      byType[f.feedback_type] = (byType[f.feedback_type] || 0) + 1;
      if (f.rating) { ratingSum += f.rating; ratingCount++; }
    });

    // Group ratings distribution 1-5
    const ratingDist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    all.forEach((f: any) => { if (f.rating) ratingDist[String(f.rating)]++; });

    // Recent quotes (emotional_reaction type, last 5)
    const quotes = all
      .filter((f: any) => f.feedback_type === 'emotional_reaction' && f.message)
      .slice(0, 5)
      .map((f: any) => ({ message: f.message, rating: f.rating, date: f.created_at }));

    // Recent bugs
    const bugs = all
      .filter((f: any) => f.feedback_type === 'bug')
      .slice(0, 5)
      .map((f: any) => ({ message: f.message, date: f.created_at }));

    const data = {
      total: all.length,
      byType,
      avgRating: ratingCount > 0 ? (ratingSum / ratingCount).toFixed(1) : null,
      ratingCount,
      ratingDistribution: ratingDist,
      recentQuotes: quotes,
      recentBugs: bugs,
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('beta/feedback-analytics failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/beta/moment-analytics — moment engagement deep-dive
// ─────────────────────────────────────────────────────────────────────────────
betaAnalyticsRouter.get('/moment-analytics', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'beta:moments';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    const { data: moments, error } = await supabaseAdmin
      .from('user_moments')
      .select('moment_type, status, title, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    const all = moments || [];
    const total = all.length;

    // Status breakdown
    const byStatus: Record<string, number> = {};
    all.forEach((m: any) => { byStatus[m.status] = (byStatus[m.status] || 0) + 1; });

    // Type breakdown
    const byType: Record<string, number> = {};
    all.forEach((m: any) => { byType[m.moment_type] = (byType[m.moment_type] || 0) + 1; });

    // Open rate per type
    const openByType: Record<string, { total: number; opened: number; rate: string }> = {};
    all.forEach((m: any) => {
      if (!openByType[m.moment_type]) openByType[m.moment_type] = { total: 0, opened: 0, rate: '0%' };
      openByType[m.moment_type].total++;
      if (m.status === 'opened') openByType[m.moment_type].opened++;
    });
    Object.keys(openByType).forEach(t => {
      const { total: t2, opened } = openByType[t];
      openByType[t].rate = t2 > 0 ? `${Math.round((opened / t2) * 100)}%` : '0%';
    });

    // Daily trend last 7 days
    const dailyTrend: Array<{ date: string; generated: number; opened: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
      const dayMoments = all.filter((m: any) => m.created_at.startsWith(d));
      dailyTrend.push({
        date: d,
        generated: dayMoments.length,
        opened: dayMoments.filter((m: any) => m.status === 'opened').length,
      });
    }

    const openRate = total > 0 ? `${Math.round(((byStatus['opened'] || 0) / total) * 100)}%` : '0%';

    const data = {
      total,
      openRate,
      byStatus,
      byType,
      openRateByType: openByType,
      dailyTrend,
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('beta/moment-analytics failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /admin/beta/feature-usage — which screens/features are used most
// ─────────────────────────────────────────────────────────────────────────────
betaAnalyticsRouter.get('/feature-usage', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cacheKey = 'beta:feature-usage';
    const cached = cache.get<any>(cacheKey);
    if (cached) { res.json({ success: true, data: cached, cached: true }); return; }

    const { data: events, error } = await supabaseAdmin
      .from('telemetry_events')
      .select('event_type, event_data, user_id')
      .gte('created_at', daysAgo(7));

    if (error) throw error;

    const all = events || [];

    // Count screen_view events by screen name
    const screenViews: Record<string, number> = {};
    all.forEach((e: any) => {
      if (e.event_type === 'screen_view' && e.event_data?.screen) {
        const screen = e.event_data.screen;
        screenViews[screen] = (screenViews[screen] || 0) + 1;
      }
    });

    // Sort screens by views
    const topScreens = Object.entries(screenViews)
      .sort(([, a], [, b]) => b - a)
      .map(([screen, views]) => ({ screen, views }));

    // Unique users per feature (from event_data.screen)
    const uniqueUsersByScreen: Record<string, Set<string>> = {};
    all.forEach((e: any) => {
      if (e.event_type === 'screen_view' && e.event_data?.screen && e.user_id) {
        const screen = e.event_data.screen;
        if (!uniqueUsersByScreen[screen]) uniqueUsersByScreen[screen] = new Set();
        uniqueUsersByScreen[screen].add(e.user_id);
      }
    });
    const uniqueUsers = Object.fromEntries(
      Object.entries(uniqueUsersByScreen).map(([s, set]) => [s, set.size])
    );

    const data = {
      period: '7 days',
      topScreens,
      uniqueUsersByScreen: uniqueUsers,
      totalEvents: all.length,
    };

    cache.set(cacheKey, data, CACHE_TTL);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('beta/feature-usage failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
});
