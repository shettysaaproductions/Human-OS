/**
 * engineExecution.ts — Canonical structured result for all Nova proactive engines.
 *
 * Every engine that runs on a schedule or wake signal MUST emit one of these at the
 * end of each execution cycle. This gives a unified, parseable log record for
 * observability (Render log search, alerting, Engine Execution Matrix).
 *
 * Rules:
 *  - outcome='healthy'           → ran, all decisions resolved (dispatched or gate-suppressed normally)
 *  - outcome='healthy_suppressed' → ran, 0 dispatches, but suppression was the correct result
 *                                   (e.g. NACE skipping active user, WATCHTOWER lease ALREADY_COMPLETED)
 *  - outcome='partial'           → ran, some users/items processed, some skipped due to errors
 *  - outcome='failed'            → run aborted by unhandled exception
 *
 * IMPORTANT: `runId` for schedulers is a correlation-only log ID, NOT a durable
 * outbound identity. It must never be used as an idempotencyKey.
 */
export type EngineId =
  | 'NACE'           // NovaConsciousnessEngine — scheduled autonomous outreach
  | 'WATCHTOWER'     // WatchtowerHeartbeatService — supervisory cognition pulse
  | 'FOLLOWUP'       // NovaFollowupService — post-conversation follow-up
  | 'REMINDER'       // ReminderSchedulerService — user-requested reminders
  | 'WEATHER'        // WeatherWatcherService — proactive weather alerts
  | 'TRIGGER_ENGINE'; // NovaTriggerEngine — event-driven presence adapter

export type EngineOutcome =
  | 'healthy'
  | 'healthy_suppressed'
  | 'partial'
  | 'failed';

export interface EngineExecutionResult {
  /** Canonical engine identifier — matches OutboundSource. */
  engine: EngineId;
  /** Correlation-only log identifier for this run (NOT a durable outbound key). */
  runId: string;
  /** ISO timestamp when this engine cycle started. */
  startedAt: string;
  /** ISO timestamp when this engine cycle completed (or failed). */
  completedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Number of users or items evaluated this cycle. */
  usersEvaluated: number;
  /** Number of users or items that passed all eligibility checks. */
  usersEligible: number;
  /** Number of OutboundIntents actually dispatched (Dispatcher.dispatch called). */
  intentsDispatched: number;
  /** Number of dispatch attempts suppressed by gate, quiet hours, or cooldown. */
  intentsSuppressed: number;
  /** Number of dispatch attempts that resulted in a transient or terminal failure. */
  intentsFailed: number;
  /** Overall health classification for this run. */
  outcome: EngineOutcome;
  /**
   * Structured suppression reason counters.
   * Keys are suppression reason strings (e.g. 'quiet_hours', 'min_gap', 'cooldown', 'active_user').
   * Values are occurrence counts.
   */
  suppressionReasons: Record<string, number>;
  /** Additional engine-specific context (non-critical, for debugging). */
  metadata?: Record<string, any>;
}
