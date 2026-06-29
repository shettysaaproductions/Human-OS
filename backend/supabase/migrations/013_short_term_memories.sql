-- Migration: 013_short_term_memories

CREATE TABLE IF NOT EXISTS public.short_term_memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    memory TEXT NOT NULL,
    category TEXT,
    emotion TEXT,
    emotion_score INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0.5,
    importance INTEGER DEFAULT 1,
    mention_count INTEGER DEFAULT 1,
    last_mentioned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    source_message_id TEXT, -- uuid or generated ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    context_tags JSONB,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- RLS
ALTER TABLE public.short_term_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own short_term_memories"
    ON public.short_term_memories FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own short_term_memories"
    ON public.short_term_memories FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own short_term_memories"
    ON public.short_term_memories FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own short_term_memories"
    ON public.short_term_memories FOR DELETE
    USING (auth.uid() = user_id);

-- Indexes for fast retrieval and cleanup
CREATE INDEX IF NOT EXISTS idx_stm_user ON public.short_term_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_stm_expires ON public.short_term_memories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stm_importance ON public.short_term_memories(importance DESC, last_mentioned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stm_unique_memory ON public.short_term_memories(user_id, memory);
