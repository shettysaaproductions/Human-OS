/**
 * Server entry point.
 *
 * Responsibilities:
 * 1. Validate environment variables (via config import — throws on bad config).
 * 2. Create the Express app.
 * 3. Start listening on the configured port.
 * 4. Handle uncaught exceptions and unhandled rejections gracefully.
 */

import { createApp } from './app';
import { config } from './config';
import { logger } from './lib/logger';
import { startWorkers } from './workers/queueWorker';
import { momentEngineService } from './services/MomentEngineService';
import { reflectionScheduler } from './services/ReflectionSchedulerService';
import { reminderSchedulerService } from './services/ReminderSchedulerService';
import { shortTermMemoryCleanupService } from './services/ShortTermMemoryCleanupService';
import { chatHistoryPruningService } from './services/ChatHistoryPruningService';
import { novaFollowupService } from './services/NovaFollowupService';
import { novaConsciousnessEngine } from './services/NovaConsciousnessEngine';
import { selfImprovementService } from './services/NovaSelfImprovementService';
import { promptBuilder } from './services/promptBuilder';

// ── Boot sequence ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  logger.info('Starting HumanOS backend...', {
    version: config.server.appVersion,
    environment: config.server.nodeEnv,
  });

  // ── Push notification environment check ──────────────────────────────────
  // This MUST log on every boot so Render logs immediately reveal if push
  // notifications will silently fail due to a missing access token.
  if (!process.env.EXPO_ACCESS_TOKEN) {
    logger.error('⚠️ EXPO_ACCESS_TOKEN is NOT set! Push notifications will FAIL silently. Add it to Render environment variables.');
  } else {
    logger.info('✅ EXPO_ACCESS_TOKEN is configured', {
      tokenPreview: process.env.EXPO_ACCESS_TOKEN.substring(0, 8) + '...',
    });
  }

  // Load autonomous behavioral patches into memory before accepting traffic
  await promptBuilder.loadPatches();

  // Record server boot time for Nova's coma awareness
  // Nova tracks when she was online/offline to avoid pretending she was 'thinking' during downtime
  try {
    await (await import('./lib/supabase')).supabaseAdmin.from('nova_scan_checkpoints').insert({
      scan_type: 'server_boot',
      last_scanned_at: new Date().toISOString(),
      messages_scanned: 0,
      flaws_found: 0,
      patches_applied: 0
    });
    logger.info('[UPTIME] Server boot recorded — Nova is awake.');
  } catch (uptimeErr) {
    logger.warn('[UPTIME] Failed to record boot time (non-critical)', {
      error: uptimeErr instanceof Error ? uptimeErr.message : String(uptimeErr)
    });
  }

  // Initialize Background Queue Workers
  // DISABLE_REFLECTIONS=true → skip all background workers for debugging
  if (process.env.DISABLE_REFLECTIONS !== 'true') {
    startWorkers();
  } else {
    logger.warn('[DEBUG] DISABLE_REFLECTIONS=true — background queue workers NOT started');
  }

  // DISABLE_REFLECTIONS=true → skip all scheduled reflection/reminder/moment workers
  if (process.env.DISABLE_REFLECTIONS !== 'true') {
    // Start Moment Engine Scheduler (runs once every 24 hours)
    const momentInterval = setInterval(async () => {
      try {
        logger.info('Scheduler: Triggering daily Moment Engine checks...');
        await momentEngineService.runEngineForAllUsers();
      } catch (err) {
        logger.error('Error in Moment Engine scheduled run', { error: err instanceof Error ? err.message : String(err) });
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
    if (momentInterval.unref) momentInterval.unref();

    // Reminders + Nova Follow-up Polling Engine (throttled to 30s to prevent token starvation)
    const remindersInterval = setInterval(async () => {
      try {
        await reminderSchedulerService.checkAndFireReminders();
        await novaFollowupService.checkAndFireFollowups();
        // Unanswered & ignored checks are throttled/lightweight
        await novaFollowupService.checkUnansweredConversations();
      } catch (err) {
        logger.error('Error in scheduled reminders check run', { error: err instanceof Error ? err.message : String(err) });
      }
    }, 30 * 1000); // 30 seconds
    if (remindersInterval.unref) remindersInterval.unref();

    // NACE: Nova Autonomous Consciousness Engine (runs every 3 minutes for responsiveness)
    // Initial pulse fires 30s after boot so Nova is active immediately
    setTimeout(async () => {
      try {
        logger.info('[BOOT] Initial NACE pulse running...');
        await novaConsciousnessEngine.pulse();
      } catch (e) {
        logger.warn('[BOOT] Initial NACE pulse failed (non-critical)', { error: e });
      }
    }, 30 * 1000);

    const naceInterval = setInterval(async () => {
      try {
        logger.info('Scheduler: Triggering NACE pulse...');
        await novaConsciousnessEngine.pulse();
        await novaConsciousnessEngine.expireOldAgendaItems();
      } catch (err) {
        logger.error('Error in NACE pulse', { error: err instanceof Error ? err.message : String(err) });
      }
    }, 3 * 60 * 1000); // NACE pulse every 3 minutes
    if (naceInterval.unref) naceInterval.unref();

    // Jarvis Protocol: Proactive Environment Monitoring (Runs every 3 hours)
    const weatherWatcherInterval = setInterval(async () => {
      try {
        const { supabaseAdmin } = await import('./lib/supabase');
        const { weatherWatcherService } = await import('./services/WeatherWatcherService');
        // Fetch users active in the last 7 days to avoid wasting API calls on abandoned accounts
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: users } = await supabaseAdmin.from('profiles').select('id').gte('updated_at', sevenDaysAgo);
        
        if (users) {
          logger.info(`[Scheduler] Running weather checks for ${users.length} active users`);
          for (const user of users) {
            await weatherWatcherService.checkWeatherForUser(user.id);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Sleep 2s to respect API rate limits
          }
        }
      } catch (err) {
        logger.error('Error in WeatherWatcher cron', { error: err instanceof Error ? err.message : String(err) });
      }
    }, 3 * 60 * 60 * 1000); // 3 hours
    if (weatherWatcherInterval.unref) weatherWatcherInterval.unref();

    // NACE Habit Trigger Sync (runs every 6 hours — creates agenda items from routines)
    const habitInterval = setInterval(async () => {
      try {
        await novaConsciousnessEngine.syncHabitTriggers();
      } catch (err) {
        logger.error('Error in habit trigger sync', { error: err instanceof Error ? err.message : String(err) });
      }
    }, 6 * 60 * 60 * 1000); // 6 hours
    if (habitInterval.unref) habitInterval.unref();

    // Daily Reflection + Memory Pruning Scheduler (runs once per day)
    const dailyReflectionInterval = setInterval(async () => {
      try {
        logger.info('Scheduler: Triggering daily reflections...');
        await reflectionScheduler.runDailyForAllUsers();
        await shortTermMemoryCleanupService.run();
        
        const { thoughtPruningService } = await import('./services/ThoughtPruningService');
        await thoughtPruningService.pruneOldThoughts();
      } catch (err) {
        logger.error('Error in daily scheduled run', { error: err instanceof Error ? err.message : String(err) });
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
    if (dailyReflectionInterval.unref) dailyReflectionInterval.unref();

    // Nightly chat history pruning + self-improvement — guaranteed to run ONCE per
    // day when the clock is in the 2–4am window. A separate hourly check (instead of
    // gating on the 24h interval) is required because the 24h interval fires relative
    // to boot time: if the server booted at, say, 14:00, `new Date().getHours() === 2`
    // would never be true and the maintenance would silently never run.
    let lastNightlyMaintenanceDate: string | null = null;
    // Weekly long-term memory decay (low-importance memories auto-archived). Tracked
    // separately so it runs during a nightly window but only ONCE per week — decaying
    // on every single night would over-archive memories that simply weren't accessed
    // in a 7-day stretch.
    let lastMemoryDecayDate: string | null = null;
    const nightlyMaintenanceInterval = setInterval(async () => {
      const now = new Date();
      const hour = now.getHours();
      const today = now.toISOString().split('T')[0];
      if (hour >= 2 && hour < 4 && lastNightlyMaintenanceDate !== today) {
        lastNightlyMaintenanceDate = today;
        try {
          logger.info('Scheduler: Triggering nightly chat history pruning and autonomous self-improvement...');
          await chatHistoryPruningService.runAll();
          await selfImprovementService.runReview();

          // Weekly memory decay — free-tier hygiene: never let unimportant long-term
          // memories pile up forever. Runs at most once per 7 days (guarded by date).
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          if (!lastMemoryDecayDate || lastMemoryDecayDate <= sevenDaysAgo) {
            lastMemoryDecayDate = today;
            const { memoryDecayService } = await import('./services/MemoryDecayService');
            const archived = await memoryDecayService.processWeeklyDecay();
            logger.info('Scheduler: Weekly memory decay complete', { archived });
          }
        } catch (err) {
          logger.error('Error in nightly maintenance run', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }, 60 * 60 * 1000); // check every hour
    if (nightlyMaintenanceInterval.unref) nightlyMaintenanceInterval.unref();

    // Weekly Reflection Scheduler (runs on Sundays)
    const weeklyReflectionInterval = setInterval(async () => {
      const day = new Date().getDay();
      if (day === 0) { // Sunday
        try {
          logger.info('Scheduler: Triggering weekly reflections...');
          await reflectionScheduler.runWeeklyForAllUsers();
        } catch (err) {
          logger.error('Error in weekly reflection scheduled run', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }, 24 * 60 * 60 * 1000); // Check daily, run on Sunday
    if (weeklyReflectionInterval.unref) weeklyReflectionInterval.unref();
  } else {
    logger.warn('[DEBUG] DISABLE_REFLECTIONS=true — all reflection/reminder/moment schedulers NOT started');
  }

  const app = createApp();

  const server = app.listen(config.server.port, () => {
    logger.info(`Server is running`, {
      port: config.server.port,
      environment: config.server.nodeEnv,
    });
    logger.info('Endpoints ready', {
      health: `GET  http://localhost:${config.server.port}/health`,
      chatTest: `POST http://localhost:${config.server.port}/chat/test`,
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  // Render sends SIGTERM before stopping a service — we want to finish
  // in-flight requests before closing.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit if connections don't drain within 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);

    // Record shutdown time for Nova's coma awareness (best effort — non-blocking)
    void (async () => {
      try {
        const { supabaseAdmin: sb } = await import('./lib/supabase');
        await sb.from('nova_scan_checkpoints').insert({
          scan_type: 'server_shutdown',
          last_scanned_at: new Date().toISOString(),
          messages_scanned: 0,
          flaws_found: 0,
          patches_applied: 0
        });
        logger.info('[UPTIME] Shutdown recorded — Nova is going to sleep.');
      } catch { /* Best effort */ }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── Safety nets ───────────────────────────────────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  logger.error('Uncaught exception — shutting down', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection — shutting down', {
    reason: String(reason),
  });
  process.exit(1);
});

main().catch((err: Error) => {
  logger.error('Failed to start server', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
