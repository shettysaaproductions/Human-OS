-- ─────────────────────────────────────────────────────────────────
-- COMPLETELY WIPE ALL TABLES (Human OS v3)
-- Run this script to drop all tables. 
-- You will see that all tables disappear from the Supabase dashboard.
-- ─────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.memories CASCADE;
DROP TABLE IF EXISTS public.memory_events CASCADE;
DROP TABLE IF EXISTS public.working_memory CASCADE;
DROP TABLE IF EXISTS public.episodic_memories CASCADE;
DROP TABLE IF EXISTS public.kg_nodes CASCADE;
DROP TABLE IF EXISTS public.kg_edges CASCADE;
DROP TABLE IF EXISTS public.emotional_states CASCADE;
DROP TABLE IF EXISTS public.reflections CASCADE;
DROP TABLE IF EXISTS public.memory_access_log CASCADE;
DROP TABLE IF EXISTS public.background_jobs CASCADE;
DROP TABLE IF EXISTS public.failed_jobs CASCADE;
DROP TABLE IF EXISTS public.processed_jobs CASCADE;
DROP TABLE IF EXISTS public.agent_metrics CASCADE;
DROP TABLE IF EXISTS public.conversation_sessions CASCADE;
DROP TABLE IF EXISTS public.query_metrics CASCADE;
