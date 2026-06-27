-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS v3.1 - MIGRATION 005 (Optimized RPC Memory Search)
-- Shifts memory scoring natively to PostgreSQL
-- Adds: confidence ranking, type weighting, retrieval_count, GIN index
-- ─────────────────────────────────────────────────────────────────

-- 1. Add retrieval_count column
ALTER TABLE public.memories ADD COLUMN IF NOT EXISTS retrieval_count INTEGER DEFAULT 0;

-- 2. Add GIN full-text search index for high-performance relevance lookups
CREATE INDEX IF NOT EXISTS idx_memories_fts 
  ON public.memories USING GIN (to_tsvector('english', key || ' ' || value));

-- 3. Create the optimized retrieval RPC function
DROP FUNCTION IF EXISTS search_relevant_memories(uuid, text, integer);

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
        -- Importance Score (25%)
        (LEAST(100.0, GREATEST(1.0, m.importance::numeric)) / 100.0) * 0.25 +
        
        -- Relevance Score (25%)
        (
          CASE WHEN v_has_query THEN
            LEAST(1.0, ts_rank(to_tsvector('english', m.key || ' ' || m.value), v_tsquery))
          ELSE 0.0 END
        ) * 0.25 +
        
        -- Confidence Score (10%)
        COALESCE(m.confidence, 0.8) * 0.10 +
        
        -- Memory Type Weighting (10%)
        (CASE m.memory_type 
          WHEN 'core' THEN 1.0 
          WHEN 'goals' THEN 0.8 
          WHEN 'preferences' THEN 0.7 
          WHEN 'family' THEN 0.6 
          ELSE 0.5 
         END) * 0.10 +
        
        -- Recency Score (10%)
        GREATEST(0.0, 1.0 - (EXTRACT(EPOCH FROM (now() - COALESCE(m.last_accessed_at, m.created_at))) / 86400.0) / 30.0) * 0.10 +
        
        -- Frequency Score (10%)
        (LEAST(10.0, GREATEST(1.0, COALESCE(m.frequency, 1)::numeric)) / 10.0) * 0.10 +
        
        -- Emotional Score (10%)
        (LEAST(10.0, ABS(COALESCE(m.emotional_weight, 0)::numeric)) / 10.0) * 0.10
      )::numeric AS calc_score
    FROM public.memories m
    WHERE m.user_id = p_user_id
      AND m.is_archived = false
    ORDER BY calc_score DESC, m.importance DESC
    LIMIT p_limit
  ),
  updated_memories AS (
    UPDATE public.memories m
    SET retrieval_count = COALESCE(m.retrieval_count, 0) + 1,
        last_accessed_at = now()
    FROM ranked_memories rm
    WHERE m.id = rm.id
    RETURNING 
      m.id, m.key, m.value, m.importance, m.confidence, m.frequency, 
      m.emotional_weight, m.memory_type, rm.calc_score AS score
  )
  SELECT 
    um.id, um.key, um.value, um.importance, um.confidence, um.frequency, 
    um.emotional_weight, um.memory_type, um.score,
    (
      SELECT ARRAY_AGG(word)
      FROM unnest(string_to_array(lower(p_query), ' ')) AS word
      WHERE lower(um.key || ' ' || um.value) LIKE '%' || word || '%' AND length(word) > 3
    ) AS matched_keywords
  FROM updated_memories um
  ORDER BY um.score DESC;
END;
$$ LANGUAGE plpgsql;
