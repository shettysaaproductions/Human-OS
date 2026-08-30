-- ============================================================
-- 044_p2b_cognitive_doubts.sql
-- Human-OS Phase 2B: Cognitive Doubt + Clarification Subsystem
-- ============================================================

CREATE TABLE IF NOT EXISTS public.nova_cognitive_doubts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'identity_gap',
        'contradiction_ambiguity',
        'intent_uncertainty',
        'temporal_conflict',
        'schedule_gap',
        'entity_resolution'
    )),
    question TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
    urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high', 'critical')),
    priority TEXT NOT NULL DEFAULT 'NEXT' CHECK (priority IN ('NOW', 'NEXT', 'LATER', 'BACKGROUND')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open',
        'eligible_for_clarification',
        'presented',
        'waiting_for_user',
        'resolved',
        'dismissed',
        'expired',
        'human_review'
    )),
    fingerprint TEXT NOT NULL,
    presentation_count INTEGER NOT NULL DEFAULT 0,
    last_presented_at TIMESTAMPTZ,
    resolution_turn_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
    CONSTRAINT uq_nova_cognitive_doubts_user_fingerprint UNIQUE (user_id, fingerprint)
);

-- Performance and query indexes
CREATE INDEX IF NOT EXISTS idx_cognitive_doubts_user_status 
    ON public.nova_cognitive_doubts (user_id, status);

CREATE INDEX IF NOT EXISTS idx_cognitive_doubts_user_category 
    ON public.nova_cognitive_doubts (user_id, category);

CREATE INDEX IF NOT EXISTS idx_cognitive_doubts_fingerprint 
    ON public.nova_cognitive_doubts (fingerprint);

CREATE INDEX IF NOT EXISTS idx_cognitive_doubts_expires_at 
    ON public.nova_cognitive_doubts (expires_at) 
    WHERE status IN ('open', 'eligible_for_clarification', 'presented', 'waiting_for_user');

COMMENT ON TABLE public.nova_cognitive_doubts IS 
    'Phase 2B: Epistemic uncertainty records representing knowledge gaps, ambiguities, and contradictions requiring natural user clarification.';
