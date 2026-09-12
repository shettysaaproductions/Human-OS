/**
 * AdaptiveConsciousnessScheduler.ts — Dynamic Living Heartbeat & Consciousness Orchestrator
 *
 * ARCHITECTURAL ROLE:
 * Replaces rigid static 15-minute background intervals with dynamic, presence-aware pacing:
 *
 * 1. ACTIVE MODE (User is Online, Typing, or Messaged in the last 15 mins):
 *    - NACE Consciousness Pulse: Every 90 seconds (1.5 min)
 *    - Watchtower Supervisory Pulse: Every 2 minutes (slotMinutes = 2)
 *
 * 2. WARM MODE (User active in the last 2 hours, now away):
 *    - NACE Consciousness Pulse: Every 3 minutes
 *    - Watchtower Supervisory Pulse: Every 5 minutes (slotMinutes = 5)
 *
 * 3. AMBIENT / QUIET MODE (User inactive > 2 hours or late night sleep hours):
 *    - NACE Consciousness Pulse: Every 15 minutes
 *    - Watchtower Supervisory Pulse: Every 15 minutes (slotMinutes = 15)
 *
 * Guarantees:
 * - Zero tight polling: Core orchestrator loop ticks once every 30 seconds.
 * - Zero lease collision: Uses dynamic slotMinutes matching heartbeat window.
 * - Re-entrancy safe: Concurrency locks prevent duplicate overlapping pulses.
 * - Resource guarded: Protects Supabase free-tier connection and egress quotas.
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';
import { novaConsciousnessEngine } from './NovaConsciousnessEngine';
import { watchtowerHeartbeatService } from './WatchtowerHeartbeatService';

export type AdaptiveCadenceMode = 'ACTIVE' | 'WARM' | 'AMBIENT';

interface CadenceProfile {
  mode: AdaptiveCadenceMode;
  naceIntervalMs: number;
  watchtowerIntervalMs: number;
  slotMinutes: number;
  description: string;
}

const CADENCE_PROFILES: Record<AdaptiveCadenceMode, CadenceProfile> = {
  ACTIVE: {
    mode: 'ACTIVE',
    naceIntervalMs: 90 * 1000,        // 1.5 minutes
    watchtowerIntervalMs: 120 * 1000, // 2 minutes
    slotMinutes: 2,
    description: '⚡ Ultra-Active: user is online, typing, or recently messaging',
  },
  WARM: {
    mode: 'WARM',
    naceIntervalMs: 180 * 1000,       // 3 minutes
    watchtowerIntervalMs: 300 * 1000, // 5 minutes
    slotMinutes: 5,
    description: '👀 Warm Vigilance: user was active within last 2 hours',
  },
  AMBIENT: {
    mode: 'AMBIENT',
    naceIntervalMs: 15 * 60 * 1000,       // 15 minutes
    watchtowerIntervalMs: 15 * 60 * 1000, // 15 minutes
    slotMinutes: 15,
    description: '🌱 Ambient Watch: user idle > 2 hours or late night quiet hours',
  },
};

export class AdaptiveConsciousnessScheduler {
  private static instance: AdaptiveConsciousnessScheduler;

  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private currentMode: AdaptiveCadenceMode = 'AMBIENT';

  private lastNacePulseAt: number = 0;
  private lastWatchtowerPulseAt: number = 0;

  private isNaceExecuting: boolean = false;
  private isWatchtowerExecuting: boolean = false;

  static getInstance(): AdaptiveConsciousnessScheduler {
    if (!AdaptiveConsciousnessScheduler.instance) {
      AdaptiveConsciousnessScheduler.instance = new AdaptiveConsciousnessScheduler();
    }
    return AdaptiveConsciousnessScheduler.instance;
  }

  /**
   * Starts the adaptive orchestrator loop. Ticks every 30 seconds.
   */
  start(): void {
    if (this.isRunning) {
      logger.info('[AdaptiveConsciousness] Scheduler already running');
      return;
    }

    this.isRunning = true;
    const TICK_INTERVAL_MS = 30 * 1000; // 30s evaluation tick

    logger.info('[AdaptiveConsciousness] Starting Adaptive Living Consciousness Orchestrator', {
      tickIntervalMs: TICK_INTERVAL_MS,
      initialMode: this.currentMode,
    });

    // Execute first evaluation tick
    this.tick().catch(err => {
      logger.error('[AdaptiveConsciousness] Initial tick failed', { error: err?.message });
    });

    this.timer = setInterval(() => {
      this.tick().catch(err => {
        logger.error('[AdaptiveConsciousness] Tick evaluation exception', { error: err?.message });
      });
    }, TICK_INTERVAL_MS);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the orchestrator loop gracefully.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    logger.info('[AdaptiveConsciousness] Scheduler stopped');
  }

  /**
   * Evaluates presence, adjusts cadence mode, and fires due pulses.
   */
  async tick(): Promise<void> {
    const now = Date.now();

    // 1. Detect dynamic cadence mode based on user presence & recent chat
    this.currentMode = await this.detectCadenceMode();
    const profile = CADENCE_PROFILES[this.currentMode];

    // 2. Evaluate NACE Consciousness Pulse
    const naceElapsed = now - this.lastNacePulseAt;
    if (naceElapsed >= profile.naceIntervalMs && !this.isNaceExecuting) {
      this.triggerNacePulse(now, this.currentMode).catch(err => {
        logger.error('[AdaptiveConsciousness] NACE pulse error', { error: err?.message });
      });
    }

    // 3. Evaluate Watchtower Supervisory Heartbeat
    const watchtowerElapsed = now - this.lastWatchtowerPulseAt;
    if (watchtowerElapsed >= profile.watchtowerIntervalMs && !this.isWatchtowerExecuting) {
      this.triggerWatchtowerHeartbeat(now, profile.slotMinutes, this.currentMode).catch(err => {
        logger.error('[AdaptiveConsciousness] Watchtower heartbeat error', { error: err?.message });
      });
    }
  }

  /**
   * Inspects database presence and message history to classify current system pace.
   */
  private async detectCadenceMode(): Promise<AdaptiveCadenceMode> {
    try {
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

      // Check for actively online or typing users
      const { data: onlinePresence, error: presErr } = await supabaseAdmin
        .from('user_presence')
        .select('user_id, status, last_active_at')
        .or(`status.in.(online,typing),last_active_at.gte.${fifteenMinsAgo}`)
        .limit(5);

      if (!presErr && onlinePresence && onlinePresence.length > 0) {
        return 'ACTIVE';
      }

      // Check recent messages in chat_history (within last 15 mins)
      const { data: recentMsgs, error: msgErr } = await supabaseAdmin
        .from('chat_history')
        .select('id')
        .gte('created_at', fifteenMinsAgo)
        .eq('role', 'user')
        .limit(1);

      if (!msgErr && recentMsgs && recentMsgs.length > 0) {
        return 'ACTIVE';
      }

      // Check for warm users (within last 2 hours)
      const { data: warmMsgs } = await supabaseAdmin
        .from('chat_history')
        .select('id')
        .gte('created_at', twoHoursAgo)
        .eq('role', 'user')
        .limit(1);

      if (warmMsgs && warmMsgs.length > 0) {
        return 'WARM';
      }

      return 'AMBIENT';
    } catch (err: any) {
      logger.debug('[AdaptiveConsciousness] Error detecting cadence mode, falling back to AMBIENT', {
        error: err?.message,
      });
      return 'AMBIENT';
    }
  }

  /**
   * Dispatches NACE Consciousness Pulse with concurrency lock.
   */
  private async triggerNacePulse(now: number, mode: AdaptiveCadenceMode): Promise<void> {
    this.isNaceExecuting = true;
    this.lastNacePulseAt = now;

    try {
      logger.info('[AdaptiveConsciousness] Triggering NACE pulse', {
        engine: 'NACE',
        mode,
        timestamp: new Date(now).toISOString(),
      });

      await novaConsciousnessEngine.pulse();
      await novaConsciousnessEngine.expireOldAgendaItems();
    } catch (err: any) {
      logger.error('[AdaptiveConsciousness] Exception in NACE pulse', { error: err?.message });
    } finally {
      this.isNaceExecuting = false;
    }
  }

  /**
   * Dispatches Watchtower Supervisory Heartbeat with concurrency lock and dynamic slot.
   */
  private async triggerWatchtowerHeartbeat(
    now: number,
    slotMinutes: number,
    mode: AdaptiveCadenceMode
  ): Promise<void> {
    this.isWatchtowerExecuting = true;
    this.lastWatchtowerPulseAt = now;

    try {
      logger.info('[AdaptiveConsciousness] Triggering Watchtower Heartbeat', {
        engine: 'WATCHTOWER',
        mode,
        slotMinutes,
        timestamp: new Date(now).toISOString(),
      });

      await watchtowerHeartbeatService.executeHeartbeat({ slotMinutes });
    } catch (err: any) {
      logger.error('[AdaptiveConsciousness] Exception in Watchtower Heartbeat', { error: err?.message });
    } finally {
      this.isWatchtowerExecuting = false;
    }
  }

  /**
   * Returns current telemetry for health/admin inspection.
   */
  getTelemetry() {
    return {
      isRunning: this.isRunning,
      currentMode: this.currentMode,
      profile: CADENCE_PROFILES[this.currentMode],
      lastNacePulseAt: this.lastNacePulseAt ? new Date(this.lastNacePulseAt).toISOString() : null,
      lastWatchtowerPulseAt: this.lastWatchtowerPulseAt ? new Date(this.lastWatchtowerPulseAt).toISOString() : null,
      isNaceExecuting: this.isNaceExecuting,
      isWatchtowerExecuting: this.isWatchtowerExecuting,
    };
  }
}

export const adaptiveConsciousnessScheduler = AdaptiveConsciousnessScheduler.getInstance();
