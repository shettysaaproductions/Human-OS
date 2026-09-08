-- 062_account_tombstones_and_triggers.sql — Enforce TOCTOU Account Deletion Tombstones and Triggers

-- 1. Create the account_tombstones table
CREATE TABLE IF NOT EXISTS public.account_tombstones (
  user_id UUID PRIMARY KEY,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.account_tombstones ENABLE ROW LEVEL SECURITY;

-- 3. Grant privileges to ensure PostgREST and service_role can access
GRANT ALL PRIVILEGES ON TABLE public.account_tombstones TO postgres, anon, authenticated, service_role;

-- 4. Explicit RLS policy for service_role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'account_tombstones' 
      AND policyname = 'Service role full access on account_tombstones'
  ) THEN
    CREATE POLICY "Service role full access on account_tombstones"
      ON public.account_tombstones
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 5. Trigger function to enforce tombstones on user-owned tables
CREATE OR REPLACE FUNCTION public.enforce_account_tombstone()
RETURNS TRIGGER AS $$
DECLARE
  uid UUID;
BEGIN
  EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) USING NEW INTO uid;
  IF uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.account_tombstones WHERE user_id = uid) THEN
    RAISE EXCEPTION 'ACCOUNT_TOMBSTONE_VIOLATION: Cannot write data for deleted user %', uid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Attach triggers to all 34 user-owned tables safely
DO $$
DECLARE
  tables_and_cols TEXT[][] := ARRAY[
    ['kg_edges', 'user_id'],
    ['kg_nodes', 'user_id'],
    ['nova_guardian_repairs', 'user_id'],
    ['nova_guardian_anomalies', 'user_id'],
    ['nova_guardian_runs', 'user_id'],
    ['watchtower_timing_logs', 'user_id'],
    ['watchtower_attention_decisions', 'user_id'],
    ['watchtower_cognitive_signals', 'user_id'],
    ['nova_cognitive_doubts', 'user_id'],
    ['candidate_synthesis_claims', 'user_id'],
    ['nova_actions', 'user_id'],
    ['life_threads', 'user_id'],
    ['nova_followups', 'user_id'],
    ['reminders', 'user_id'],
    ['nova_agenda', 'user_id'],
    ['nova_outreach_log', 'user_id'],
    ['user_routines', 'user_id'],
    ['nova_corrections_log', 'user_id'],
    ['action_idempotency', 'user_id'],
    ['user_moments', 'user_id'],
    ['user_moment_preferences', 'user_id'],
    ['user_presence', 'user_id'],
    ['user_feedback', 'user_id'],
    ['reflections', 'user_id'],
    ['emotional_states', 'user_id'],
    ['conversation_sessions', 'user_id'],
    ['chat_history', 'user_id'],
    ['short_term_memories', 'user_id'],
    ['working_memory', 'user_id'],
    ['episodic_memories', 'user_id'],
    ['memory_access_log', 'user_id'],
    ['memory_events', 'user_id'],
    ['memories', 'user_id'],
    ['profiles', 'id']
  ];
  t_name TEXT;
  c_name TEXT;
  trig_name TEXT;
BEGIN
  FOR i IN 1..array_length(tables_and_cols, 1) LOOP
    t_name := tables_and_cols[i][1];
    c_name := tables_and_cols[i][2];
    trig_name := 'tr_enforce_tombstone_' || t_name;

    -- Only attach if table and column exist
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = t_name AND column_name = c_name
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trig_name, t_name);
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_account_tombstone(%L)', trig_name, t_name, c_name);
    END IF;
  END LOOP;
END $$;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
