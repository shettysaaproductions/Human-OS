-- ─────────────────────────────────────────────────────────────────
-- HUMAN OS v3.1 - MIGRATION 011 (Milestone Memories)
-- Upgrades RPC search_relevant_memories to include score components
-- and proper weighting for 'child', 'milestone', and 'family' types.
-- ─────────────────────────────────────────────────────────────────

-- Drop the old function first since we are changing the RETURN TABLE signature
DROP FUNCTION IF EXISTS search_relevant_memories(uuid, text, integer);

-- Create the new optimized retrieval RPC function with debug components
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
  matched_keywords text[],
  -- Diagnostic score components
  score_importance numeric,
  score_relevance numeric,
  score_confidence numeric,
  score_type numeric,
  score_recency numeric,
  score_frequency numeric,
  score_emotion numeric
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
      
      -- 1. Importance Score (25%)
      ((LEAST(100.0, GREATEST(1.0, m.importance::numeric)) / 100.0) * 0.25)::numeric AS c_importance,
      
      -- 2. Relevance Score (25%)
      (
        CASE WHEN v_has_query THEN
          LEAST(1.0, ts_rank(to_tsvector('english', m.key || ' ' || m.value), v_tsquery))
        ELSE 0.0 END
      )::numeric * 0.25 AS c_relevance,
      
      -- 3. Confidence Score (10%)
      (COALESCE(m.confidence, 0.8) * 0.10)::numeric AS c_confidence,
      
      -- 4. Memory Type Weighting (10%)
      (CASE m.memory_type 
        WHEN 'core' THEN 1.0
        WHEN 'child' THEN 1.0
        WHEN 'milestone' THEN 0.95
        WHEN 'family' THEN 0.90
        WHEN 'goals' THEN 0.8 
        WHEN 'preferences' THEN 0.7 
        ELSE 0.5 
       END::numeric) * 0.10 AS c_type,
      
      -- 5. Recency Score (10%)
      (GREATEST(0.0, 1.0 - (EXTRACT(EPOCH FROM (now() - COALESCE(m.last_accessed_at, m.created_at))) / 86400.0) / 30.0) * 0.10)::numeric AS c_recency,
      
      -- 6. Frequency Score (10%)
      ((LEAST(10.0, GREATEST(1.0, COALESCE(m.frequency, 1)::numeric)) / 10.0) * 0.10)::numeric AS c_frequency,
      
      -- 7. Emotional Score (10%)
      ((LEAST(10.0, ABS(COALESCE(m.emotional_weight, 0)::numeric)) / 10.0) * 0.10)::numeric AS c_emotion
    FROM public.memories m
    WHERE m.user_id = p_user_id
      AND m.is_archived = false
  ),
  total_scores AS (
    SELECT 
      r.id,
      r.c_importance,
      r.c_relevance,
      r.c_confidence,
      r.c_type,
      r.c_recency,
      r.c_frequency,
      r.c_emotion,
      (r.c_importance + r.c_relevance + r.c_confidence + r.c_type + r.c_recency + r.c_frequency + r.c_emotion)::numeric AS calc_score
    FROM ranked_memories r
  ),
  top_memories AS (
    SELECT 
      t.id, t.c_importance, t.c_relevance, t.c_confidence, t.c_type, t.c_recency, t.c_frequency, t.c_emotion, t.calc_score, m.importance
    FROM total_scores t
    JOIN public.memories m ON m.id = t.id
    ORDER BY t.calc_score DESC, m.importance DESC
    LIMIT p_limit
  ),
  updated_memories AS (
    UPDATE public.memories m
    SET retrieval_count = COALESCE(m.retrieval_count, 0) + 1,
        last_accessed_at = now()
    FROM top_memories tm
    WHERE m.id = tm.id
    RETURNING 
      m.id, m.key, m.value, m.importance, m.confidence, m.frequency, 
      m.emotional_weight, m.memory_type, tm.calc_score AS score,
      tm.c_importance, tm.c_relevance, tm.c_confidence, tm.c_type, tm.c_recency, tm.c_frequency, tm.c_emotion
  )
  SELECT 
    um.id, um.key, um.value, um.importance, um.confidence, um.frequency, 
    um.emotional_weight, um.memory_type, um.score,
    (
      SELECT ARRAY_AGG(word)
      FROM unnest(string_to_array(lower(p_query), ' ')) AS word
      WHERE lower(um.key || ' ' || um.value) LIKE '%' || word || '%' AND length(word) > 3
    ) AS matched_keywords,
    um.c_importance AS score_importance,
    um.c_relevance AS score_relevance,
    um.c_confidence AS score_confidence,
    um.c_type AS score_type,
    um.c_recency AS score_recency,
    um.c_frequency AS score_frequency,
    um.c_emotion AS score_emotion
  FROM updated_memories um
  ORDER BY um.score DESC;
END;
$$ LANGUAGE plpgsql;
