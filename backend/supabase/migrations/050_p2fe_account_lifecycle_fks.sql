-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 050: Phase 2F-E Account Lifecycle & Foreign Key Integrity
--
-- PURPOSE:
-- 1. Add ON DELETE CASCADE foreign key constraints from auth.users(id) to all
--    user-owned cognitive and operational tables.
-- 2. Bind public.profiles(id) directly to auth.users(id) ON DELETE CASCADE.
-- 3. Upgrade legacy NO ACTION foreign keys (nova_agenda, user_routines, etc.)
--    to ON DELETE CASCADE.
-- 4. Preserve SET NULL anonymization for telemetry_events.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  -- 1. profiles -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_profiles_auth_users' AND table_name = 'profiles'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT fk_profiles_auth_users
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 2. memories -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_memories_auth_users' AND table_name = 'memories'
  ) THEN
    ALTER TABLE public.memories
      ADD CONSTRAINT fk_memories_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 3. working_memory -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_working_memory_auth_users' AND table_name = 'working_memory'
  ) THEN
    ALTER TABLE public.working_memory
      ADD CONSTRAINT fk_working_memory_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 4. episodic_memories -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_episodic_memories_auth_users' AND table_name = 'episodic_memories'
  ) THEN
    ALTER TABLE public.episodic_memories
      ADD CONSTRAINT fk_episodic_memories_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 5. chat_history -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_chat_history_auth_users' AND table_name = 'chat_history'
  ) THEN
    ALTER TABLE public.chat_history
      ADD CONSTRAINT fk_chat_history_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 6. nova_cognitive_doubts -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_cognitive_doubts_auth_users' AND table_name = 'nova_cognitive_doubts'
  ) THEN
    ALTER TABLE public.nova_cognitive_doubts
      ADD CONSTRAINT fk_cognitive_doubts_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 7. kg_nodes -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kg_nodes_auth_users' AND table_name = 'kg_nodes'
  ) THEN
    ALTER TABLE public.kg_nodes
      ADD CONSTRAINT fk_kg_nodes_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 8. kg_edges -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_kg_edges_auth_users' AND table_name = 'kg_edges'
  ) THEN
    ALTER TABLE public.kg_edges
      ADD CONSTRAINT fk_kg_edges_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 9. emotional_states -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_emotional_states_auth_users' AND table_name = 'emotional_states'
  ) THEN
    ALTER TABLE public.emotional_states
      ADD CONSTRAINT fk_emotional_states_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 10. reflections -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_reflections_auth_users' AND table_name = 'reflections'
  ) THEN
    ALTER TABLE public.reflections
      ADD CONSTRAINT fk_reflections_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 11. conversation_sessions -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_conv_sessions_auth_users' AND table_name = 'conversation_sessions'
  ) THEN
    ALTER TABLE public.conversation_sessions
      ADD CONSTRAINT fk_conv_sessions_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 12. memory_events -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_memory_events_auth_users' AND table_name = 'memory_events'
  ) THEN
    ALTER TABLE public.memory_events
      ADD CONSTRAINT fk_memory_events_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 13. memory_access_log -> auth.users(id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_memory_access_log_auth_users' AND table_name = 'memory_access_log'
  ) THEN
    ALTER TABLE public.memory_access_log
      ADD CONSTRAINT fk_memory_access_log_auth_users
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  -- 14. Upgrade NO ACTION FKs on legacy tables to ON DELETE CASCADE
  -- nova_agenda
  ALTER TABLE public.nova_agenda
    DROP CONSTRAINT IF EXISTS nova_agenda_user_id_fkey,
    ADD CONSTRAINT fk_nova_agenda_auth_users
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  -- nova_outreach_log
  ALTER TABLE public.nova_outreach_log
    DROP CONSTRAINT IF EXISTS nova_outreach_log_user_id_fkey,
    ADD CONSTRAINT fk_nova_outreach_log_auth_users
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  -- user_routines
  ALTER TABLE public.user_routines
    DROP CONSTRAINT IF EXISTS user_routines_user_id_fkey,
    ADD CONSTRAINT fk_user_routines_auth_users
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  -- nova_corrections_log
  ALTER TABLE public.nova_corrections_log
    DROP CONSTRAINT IF EXISTS nova_corrections_log_user_id_fkey,
    ADD CONSTRAINT fk_nova_corrections_log_auth_users
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

  -- user_presence
  ALTER TABLE public.user_presence
    DROP CONSTRAINT IF EXISTS user_presence_user_id_fkey,
    ADD CONSTRAINT fk_user_presence_auth_users
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

END $$;
