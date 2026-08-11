-- HUMAN OS -- MIGRATION 026: widen nova_outreach_log.outreach_type CHECK constraint
--
-- The original CHECK only allowed ('agenda_followup','engagement_checkin','mood_checkin',
-- 'life_curiosity'). Two current insert sites use other values:
--   - NovaTriggerEngine  -> 'proactive'
--   - WeatherWatcherService -> 'proactive_weather'
-- Once the code inserts used the correct column (outreach_type), those values would
-- violate the CHECK and be dropped. Widen the constraint to match every insert site.
--
-- Idempotent: drops the constraint only if it exists, then re-creates it.
ALTER TABLE public.nova_outreach_log
  DROP CONSTRAINT IF EXISTS nova_outreach_log_outreach_type_check;

ALTER TABLE public.nova_outreach_log
  ADD CONSTRAINT nova_outreach_log_outreach_type_check
  CHECK (outreach_type IN (
    'agenda_followup',
    'engagement_checkin',
    'mood_checkin',
    'life_curiosity',
    'proactive',
    'proactive_weather'
  ));
