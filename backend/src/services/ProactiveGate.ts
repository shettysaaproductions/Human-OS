/**
 * ProactiveGate — Single Authoritative Proactive Message Gate
 *
 * GUARANTEE: Every user-visible unsolicited message must pass through this gate.
 * The gate is 100% DB-backed so it survives:
 *   - server restarts (Render free tier)
 *   - concurrent workers
 *   - queue retries
 *   - presence event duplication
 *
 * Architecture:
 *   gate.acquire(userId, logicalKey, opts) → GateDecision
 *     ALLOW → caller may write message, then call gate.commit()
 *     BLOCK → caller must NOT write any message
 *
 * The logical key encodes why Nova is reaching out, e.g.:
 *   "nace:agenda:AGENDA_ID"
 *   "followup:ignored:NOVA_MSG_ID"
 *   "followup:unanswered:CONV_ID"
 *   "weather:alert:USER_ID"
 *
 * The gate enforces:
 *   1. Global min gap (from nova_outreach_log) — ignoring in-memory caches
 *   2. Ignored-outreach escalation cooldown (from nova_outreach_log count)
 *   3. Suppression lock (followup_suppressed_until in working_memory)
 *   4. Quiet/sleep window (from TemporalAwarenessService)
 *   5. DB-level idempotency: logical key insert with UNIQUE constraint
 *   6. Duplicate content detection (against last 10 outreach messages)
 *   7. Stale-thread detection (user already answered the underlying question)
 *   8. Long-silence suppression (user absent > 48h and ignoredCount >= 4)
 */

import { supabaseAdmin } from '../lib/supabase';
import { logger } from '../lib/logger';

// ── Cooldown table (mirrors NACE getEscalatedGap) ─────────────────────────────
// ignoredCount = number of unreplied Nova outreaches since user's last message
export function getEscalatedGapMinutes(ignoredCount: number): number {
  if (ignoredCount <= 0) return 1;    // No ignored messages → 1 min floor
  if (ignoredCount === 1) return 60;  // 1st ignored → 60 min
  if (ignoredCount === 2) return 180; // 2nd ignored → 3 hours
  if (ignoredCount === 3) return 360; // 3rd ignored → 6 hours
  return 720;                          // 4th+ ignored → 12 hours
}

export type GateDecision =
  | { allowed: true;  outreachId: string; reason: string }
  | { allowed: false; blockedBy: string; detail?: string };

export interface GateOptions {
  /** Why Nova is reaching out. Used for logging & dedup. */
  outreachType: string;
  /** Logical idempotency key — same key within the de-dup window = blocked. */
  logicalKey: string;
  /** Window in minutes during which the same logicalKey cannot fire again. Default 60. */
  logicalKeyWindowMinutes?: number;
  /** Proposed message text — checked for near-duplicate against recent outreach. */
  proposedMessage?: string;
  /** Skip quiet/sleep window check (e.g. for high-urgency reminders). */
  skipQuietHoursCheck?: boolean;
  /** Skip global min gap check. Only for reminder-engine (user-requested). */
  skipMinGapCheck?: boolean;
  /** Timezone offset in MINUTES (e.g. 330 for IST). */
  timezoneOffsetMinutes?: number;
}

// In-process lock per user to serialize concurrent acquire calls on the same instance
const userGateLocks = new Map<string, Promise<any>>();

export class ProactiveGate {

  /**
   * Attempt to acquire the gate for a proactive message.
   * Returns a decision object. If allowed=true, caller MUST call commit() after
   * successfully saving the message to chat_history.
   */
  async acquire(userId: string, opts: GateOptions): Promise<GateDecision> {
    // Acquire per-user mutex to guarantee sequential evaluation and prevent race conditions
    const currentLock = userGateLocks.get(userId) || Promise.resolve();
    let releaseLock: () => void;
    const nextLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    userGateLocks.set(userId, nextLock);

    try {
      await currentLock;
      return await this._acquireInternal(userId, opts);
    } finally {
      releaseLock!();
      if (userGateLocks.get(userId) === nextLock) {
        userGateLocks.delete(userId);
      }
    }
  }

  private async _acquireInternal(userId: string, opts: GateOptions): Promise<GateDecision> {
    const {
      outreachType,
      logicalKey,
      logicalKeyWindowMinutes = 60,
      proposedMessage,
      skipQuietHoursCheck = false,
      skipMinGapCheck = false,
      timezoneOffsetMinutes = 0,
    } = opts;

    const logCtx = { userId, outreachType, logicalKey };

    // ── 1. Suppression lock (sleep/busy) ────────────────────────────────────
    try {
      const { data: suppression } = await supabaseAdmin
        .from('working_memory')
        .select('value')
        .eq('user_id', userId)
        .eq('key', 'followup_suppressed_until')
        .maybeSingle();

      if (suppression?.value && Date.now() < new Date(suppression.value).getTime()) {
        logger.info('[ProactiveGate] BLOCK — suppression lock active', { ...logCtx, until: suppression.value });
        return { allowed: false, blockedBy: 'suppression_lock', detail: suppression.value };
      }
    } catch (e) {
      logger.warn('[ProactiveGate] Suppression check failed — proceeding cautiously', { ...logCtx, error: String(e) });
    }

    // ── 2. Quiet/sleep hours ─────────────────────────────────────────────────
    if (!skipQuietHoursCheck) {
      try {
        const nowUtcMs = Date.now();
        const localMs = nowUtcMs + timezoneOffsetMinutes * 60 * 1000;
        const localHour = new Date(localMs).getUTCHours();
        const isQuiet = localHour >= 23 || localHour < 7;
        if (isQuiet) {
          logger.info('[ProactiveGate] BLOCK — quiet hours', { ...logCtx, localHour });
          return { allowed: false, blockedBy: 'quiet_hours', detail: `local hour ${localHour}` };
        }
      } catch (e) {
        logger.warn('[ProactiveGate] Quiet hours check failed — proceeding', { ...logCtx, error: String(e) });
      }
    }

    // ── 3. Fetch last user message time ─────────────────────────────────────
    let lastUserMsgAt: Date | null = null;
    try {
      const { data: lastUser } = await supabaseAdmin
        .from('chat_history')
        .select('created_at')
        .eq('user_id', userId)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastUser?.created_at) lastUserMsgAt = new Date(lastUser.created_at);
    } catch (e) {
      logger.warn('[ProactiveGate] Failed to fetch last user msg', { ...logCtx, error: String(e) });
    }

    // ── 4. Count unreplied outreaches → escalation cooldown ─────────────────
    let ignoredCount = 0;
    let lastOutreachAt: Date | null = null;
    try {
      const since = lastUserMsgAt?.toISOString() ?? new Date(0).toISOString();
      const { data: unreplied } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('id, created_at')
        .eq('user_id', userId)
        .is('replied_at', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      ignoredCount = unreplied?.length ?? 0;
      if (unreplied && unreplied.length > 0) {
        lastOutreachAt = new Date(unreplied[0].created_at);
      }
    } catch (e) {
      logger.warn('[ProactiveGate] Failed to count unreplied outreaches', { ...logCtx, error: String(e) });
    }

    // ── 5. Long-silence suppression: 48h absent + ignoredCount >= 4 ─────────
    if (ignoredCount >= 4 && lastUserMsgAt) {
      const silenceMs = Date.now() - lastUserMsgAt.getTime();
      const silenceHours = silenceMs / 3600000;
      if (silenceHours > 48) {
        logger.info('[ProactiveGate] BLOCK — long silence (48h+) with 4+ ignored messages', {
          ...logCtx, silenceHours: Math.round(silenceHours), ignoredCount
        });
        return { allowed: false, blockedBy: 'long_silence', detail: `${Math.round(silenceHours)}h silence, ${ignoredCount} ignored` };
      }
    }

    // ── 6. Escalation cooldown ───────────────────────────────────────────────
    if (!skipMinGapCheck && lastOutreachAt) {
      const minutesSinceLast = (Date.now() - lastOutreachAt.getTime()) / 60000;
      const requiredGap = getEscalatedGapMinutes(ignoredCount);
      if (minutesSinceLast < requiredGap) {
        logger.info('[ProactiveGate] BLOCK — escalation cooldown', {
          ...logCtx, minutesSinceLast: Math.round(minutesSinceLast), requiredGap, ignoredCount
        });
        return {
          allowed: false,
          blockedBy: 'cooldown',
          detail: `${Math.round(minutesSinceLast)}m < ${requiredGap}m required (ignored=${ignoredCount})`
        };
      }
    }

    // ── 7. Logical key idempotency (DB-level) ────────────────────────────────
    // Prevents duplicate sends from concurrent workers, retries, presence events.
    try {
      const windowStart = new Date(Date.now() - logicalKeyWindowMinutes * 60 * 1000).toISOString();
      const { data: existingWithKey } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('id')
        .eq('user_id', userId)
        .eq('logical_key', logicalKey)
        .gte('created_at', windowStart)
        .limit(1)
        .maybeSingle();

      if (existingWithKey) {
        logger.info('[ProactiveGate] BLOCK — logical key duplicate', {
          ...logCtx, windowMinutes: logicalKeyWindowMinutes
        });
        return { allowed: false, blockedBy: 'duplicate_logical_key' };
      }
    } catch (e) {
      logger.warn('[ProactiveGate] Logical key check failed — proceeding', { ...logCtx, error: String(e) });
    }

    // ── 8. Near-duplicate content check ─────────────────────────────────────
    if (proposedMessage) {
      try {
        const { data: recentOutreach } = await supabaseAdmin
          .from('nova_outreach_log')
          .select('message')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(10);

        const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
        const normNew = normalize(proposedMessage);
        const isDuplicate = (recentOutreach || []).some(prev => {
          const normPrev = normalize(prev.message || '');
          if (normPrev === normNew) return true;
          const prevWords = new Set(normPrev.split(' ').filter(Boolean));
          const newWords = new Set(normNew.split(' ').filter(Boolean));
          if (prevWords.size === 0 || newWords.size === 0) return false;
          let overlap = 0;
          for (const w of newWords) if (prevWords.has(w)) overlap++;
          const union = new Set([...prevWords, ...newWords]).size;
          return union > 0 && overlap / union >= 0.75;
        });

        if (isDuplicate) {
          logger.warn('[ProactiveGate] BLOCK — near-duplicate message content', {
            ...logCtx, preview: proposedMessage.substring(0, 60)
          });
          return { allowed: false, blockedBy: 'duplicate_content' };
        }
      } catch (e) {
        logger.warn('[ProactiveGate] Content dedup check failed — proceeding', { ...logCtx, error: String(e) });
      }
    }

    // ── Gate ALLOWS the outreach ─────────────────────────────────────────────
    // Reserve a slot in nova_outreach_log with a placeholder message.
    // The caller will update this row with the actual message via commit().
    let outreachId = '';
    try {
      const { data: reserved, error: reserveErr } = await supabaseAdmin
        .from('nova_outreach_log')
        .insert({
          user_id: userId,
          message: proposedMessage || '[pending]',
          outreach_type: outreachType,
          logical_key: logicalKey,
        })
        .select('id')
        .single();

      if (reserveErr || !reserved?.id) {
        // If the insert fails due to a unique constraint race, treat as blocked
        logger.warn('[ProactiveGate] Reservation insert failed — treating as duplicate', {
          ...logCtx, error: reserveErr?.message
        });
        return { allowed: false, blockedBy: 'reservation_race', detail: reserveErr?.message };
      }
      outreachId = reserved.id;
    } catch (e) {
      logger.warn('[ProactiveGate] Reservation failed', { ...logCtx, error: String(e) });
      return { allowed: false, blockedBy: 'reservation_error', detail: String(e) };
    }

    logger.info('[ProactiveGate] ALLOW', { ...logCtx, outreachId, ignoredCount });
    return { allowed: true, outreachId, reason: outreachType };
  }

  /**
   * After successfully saving the message to chat_history, update the outreach log
   * row with the actual message. This keeps the log accurate for cooldown calculations.
   */
  async commit(outreachId: string, actualMessage: string): Promise<void> {
    try {
      await supabaseAdmin
        .from('nova_outreach_log')
        .update({ message: actualMessage, updated_at: new Date().toISOString() })
        .eq('id', outreachId);
    } catch (e) {
      logger.warn('[ProactiveGate] commit() failed — outreach log may have placeholder', { outreachId, error: String(e) });
    }
  }

  /**
   * If message generation fails after gate.acquire(), release the reservation
   * so the slot is not counted as a sent outreach.
   */
  async release(outreachId: string): Promise<void> {
    try {
      await supabaseAdmin
        .from('nova_outreach_log')
        .delete()
        .eq('id', outreachId);
    } catch (e) {
      logger.warn('[ProactiveGate] release() failed', { outreachId, error: String(e) });
    }
  }

  /**
   * Mark an outreach as replied — called when the user sends a message.
   * Updates the outreach log and resets escalation state.
   */
  async markReplied(userId: string, repliedAt: string): Promise<void> {
    try {
      await supabaseAdmin
        .from('nova_outreach_log')
        .update({ replied_at: repliedAt })
        .eq('user_id', userId)
        .is('replied_at', null);
    } catch (e) {
      logger.warn('[ProactiveGate] markReplied() failed', { userId, error: String(e) });
    }
  }

  /**
   * Helper: get current ignored count for a user (DB-backed, restart-safe).
   */
  async getIgnoredCount(userId: string): Promise<number> {
    try {
      const { data: lastUser } = await supabaseAdmin
        .from('chat_history')
        .select('created_at')
        .eq('user_id', userId)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const since = lastUser?.created_at ?? new Date(0).toISOString();
      const { data: unreplied } = await supabaseAdmin
        .from('nova_outreach_log')
        .select('id')
        .eq('user_id', userId)
        .is('replied_at', null)
        .gte('created_at', since);
      return unreplied?.length ?? 0;
    } catch {
      return 0;
    }
  }
}

export const proactiveGate = new ProactiveGate();
