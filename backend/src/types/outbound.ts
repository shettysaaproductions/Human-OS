/**
 * outbound.ts -- Canonical Outbound Source Vocabulary
 *
 * Every engine that can produce an outbound message must identify itself
 * using one of these values. This is stored in outbound_intents.source_engine.
 *
 * Rules:
 *  - Add new sources here before using them in any engine.
 *  - Never use a raw string literal for sourceEngine in OutboundDispatcherService.dispatch().
 *  - 'OTHER' is a catch-all for migration/testing; production engines must use a specific value.
 */
export type OutboundSource =
  | 'NACE'           // NovaConsciousnessEngine -- scheduled proactive outreach
  | 'WATCHTOWER'     // WatchtowerProactiveIntegrationService -- attention-driven outreach
  | 'FOLLOWUP'       // NovaFollowupService -- post-conversation follow-up
  | 'REMINDER'       // ReminderSchedulerService -- user-requested reminder delivery
  | 'WEATHER'        // WeatherWatcherService -- proactive weather alerts
  | 'TRIGGER_ENGINE' // NovaTriggerEngine -- presence-timing adapter
  | 'OTHER';         // Legacy / test use only
