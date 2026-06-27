-- Human OS v3 Additions (Queue & Logging)

-- 1. Create missing indexes for fast user isolation
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON public.memories(user_id);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_user_id ON public.kg_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_user_id ON public.kg_edges(user_id);
CREATE INDEX IF NOT EXISTS idx_episodic_user_id ON public.episodic_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_working_memory_user_id ON public.working_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_emotional_states_user_id ON public.emotional_states(user_id);
CREATE INDEX IF NOT EXISTS idx_reflections_user_id ON public.reflections(user_id);

-- 2. Memory Access Log (for future Ranking Algorithm)
CREATE TABLE IF NOT EXISTS memory_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  memory_id UUID NOT NULL,
  accessed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_user ON memory_access_log(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log(memory_id);

-- 3. Queue Architecture Tables
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
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

-- 4. Idempotency Tracking
CREATE TABLE IF NOT EXISTS processed_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  message_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(agent_name, message_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_jobs_message ON processed_jobs(message_id);
