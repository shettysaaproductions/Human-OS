-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS v3 - FULL DATABASE CREATION SCRIPT
-- Run this script in the Supabase SQL Editor to create all tables
-- and indexes required for the application.
-- ─────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────
-- PART 1: Core Memories (from 001_create_memories.sql)
-- ─────────────────────────────────────────────────────────────────
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  memory_type text not null,
  key text not null,
  value text not null,
  importance integer default 5,
  confidence numeric default 0.8,
  is_user_confirmed boolean default false,
  source_message text,
  last_accessed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_memories_user_id on memories(user_id);
create index idx_memories_type on memories(memory_type);
create index idx_memories_key on memories(key);

create table memory_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid,
  user_id uuid not null,
  action text not null,
  old_value text,
  new_value text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────
-- PART 2: Advanced Memory Types & Schema (from 002_v3_schema.sql)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE memories ADD COLUMN frequency INTEGER DEFAULT 1;
ALTER TABLE memories ADD COLUMN emotional_weight INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN is_archived BOOLEAN DEFAULT false;

CREATE TABLE working_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_working_memory_user ON working_memory(user_id);

CREATE TABLE episodic_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  summary TEXT NOT NULL,
  emotion TEXT,
  emotional_valence INTEGER DEFAULT 0,
  source_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_episodic_user ON episodic_memories(user_id);

CREATE TABLE kg_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  attributes JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kg_nodes_user ON kg_nodes(user_id);

CREATE TABLE kg_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source_node_id UUID REFERENCES kg_nodes(id) ON DELETE CASCADE,
  target_node_id UUID REFERENCES kg_nodes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  weight INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_kg_edges_user ON kg_edges(user_id);
CREATE INDEX idx_kg_edges_source ON kg_edges(source_node_id);

CREATE TABLE emotional_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  mood TEXT NOT NULL,
  intensity INTEGER DEFAULT 5,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_emotional_states_user ON emotional_states(user_id);

CREATE TABLE reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  reflection_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_takeaways JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_reflections_user ON reflections(user_id);

-- ─────────────────────────────────────────────────────────────────
-- PART 3: Queue & Logging Infrastructure (from 003_v3_additions.sql)
-- ─────────────────────────────────────────────────────────────────
-- (Indexes that may already exist, but safe to run with IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON public.memories(user_id);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_user_id ON public.kg_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_user_id ON public.kg_edges(user_id);
CREATE INDEX IF NOT EXISTS idx_episodic_user_id ON public.episodic_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_working_memory_user_id ON public.working_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_emotional_states_user_id ON public.emotional_states(user_id);
CREATE INDEX IF NOT EXISTS idx_reflections_user_id ON public.reflections(user_id);

CREATE TABLE IF NOT EXISTS memory_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  memory_id UUID NOT NULL,
  accessed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_user ON memory_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log(memory_id);

CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  payload JSONB NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_background_jobs_status ON background_jobs(status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_type ON background_jobs(job_type);

CREATE TABLE IF NOT EXISTS failed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  error TEXT,
  failed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_name, message_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_jobs_message ON processed_jobs(message_id);

CREATE TABLE IF NOT EXISTS agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  execution_time_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_metrics_name ON agent_metrics(agent_name);

CREATE TABLE IF NOT EXISTS conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  message_count INTEGER DEFAULT 0,
  summary TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_user ON conversation_sessions(user_id);

-- ─────────────────────────────────────────────────────────────────
-- PART 4: Indexes & Metrics (from 004_indexes.sql)
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversation_sessions_date
  ON public.conversation_sessions(user_id, session_date);

CREATE INDEX IF NOT EXISTS idx_working_memory_expires
  ON public.working_memory(user_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_background_jobs_status
  ON public.background_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_processed_jobs_agent_message
  ON public.processed_jobs(agent_name, message_id);

CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_name
  ON public.agent_metrics(agent_name, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_key
  ON public.memories(user_id, key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_nodes_user_name
  ON public.kg_nodes(user_id, name);

CREATE TABLE IF NOT EXISTS public.query_metrics (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_name   TEXT        NOT NULL,
  table_name   TEXT        NOT NULL,
  duration_ms  INTEGER     NOT NULL,
  rows_returned INTEGER    NOT NULL DEFAULT 0,
  estimated_bytes INTEGER  NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_metrics_name
  ON public.query_metrics(query_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_metrics_created
  ON public.query_metrics(created_at DESC);

-- ─────────────────────────────────────────────────────────────────
-- PART 5: Optimizations (from 005_rpc_search_memories.sql)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS retrieval_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_memories_fts 
  ON public.memories USING GIN (to_tsvector('english', key || ' ' || value));

CREATE OR REPLACE FUNCTION search_relevant_memories(
  p_user_id uuid,
  p_query text,
  p_limit integer default 3
)
RETURNS TABLE (
  id uuid,
  key text,
  value text,
  importance integer,
  confidence numeric,
  frequency integer,
  emotional_weight integer,
  memory_type text,
  score numeric,
  matched_keywords text[]
) AS $$
DECLARE
  v_tsquery tsquery;
  v_has_query boolean;
BEGIN
  IF p_query IS NULL OR trim(p_query) = '' THEN
    v_has_query := false;
  ELSE
    v_has_query := true;
    v_tsquery := websearch_to_tsquery('english', p_query);
  END IF;

  RETURN QUERY
  WITH ranked_memories AS (
    SELECT 
      m.id,
      (
        (LEAST(100.0, GREATEST(1.0, m.importance::numeric)) / 100.0) * 0.25 +
        (CASE WHEN v_has_query THEN LEAST(1.0, ts_rank(to_tsvector('english', m.key || ' ' || m.value), v_tsquery)) ELSE 0.0 END) * 0.25 +
        COALESCE(m.confidence, 0.8) * 0.10 +
        (CASE m.memory_type WHEN 'core' THEN 1.0 WHEN 'goals' THEN 0.8 WHEN 'preferences' THEN 0.7 WHEN 'family' THEN 0.6 ELSE 0.5 END) * 0.10 +
        GREATEST(0.0, 1.0 - (EXTRACT(EPOCH FROM (now() - COALESCE(m.last_accessed_at, m.created_at))) / 86400.0) / 30.0) * 0.10 +
        (LEAST(10.0, GREATEST(1.0, COALESCE(m.frequency, 1)::numeric)) / 10.0) * 0.10 +
        (LEAST(10.0, ABS(COALESCE(m.emotional_weight, 0)::numeric)) / 10.0) * 0.10
      )::numeric AS calc_score
    FROM public.memories m
    WHERE m.user_id = p_user_id AND m.is_archived = false
    ORDER BY calc_score DESC, m.importance DESC
    LIMIT p_limit
  ),
  updated_memories AS (
    UPDATE public.memories m
    SET retrieval_count = COALESCE(m.retrieval_count, 0) + 1,
        last_accessed_at = now()
    FROM ranked_memories rm
    WHERE m.id = rm.id
    RETURNING m.id, m.key, m.value, m.importance, m.confidence, m.frequency, m.emotional_weight, m.memory_type, rm.calc_score AS score
  )
  SELECT 
    um.id, um.key, um.value, um.importance, um.confidence, um.frequency, um.emotional_weight, um.memory_type, um.score,
    (
      SELECT ARRAY_AGG(word)
      FROM unnest(string_to_array(lower(p_query), ' ')) AS word
      WHERE lower(um.key || ' ' || um.value) LIKE '%' || word || '%' AND length(word) > 3
    ) AS matched_keywords
  FROM updated_memories um
  ORDER BY um.score DESC;
END;
$$ LANGUAGE plpgsql;
