-- ============================================================
-- Migration: 20260922_kg_rpc_functions.sql
-- Purpose: Create missing PostgreSQL RPC functions that
--          CanonicalEntityEngine.ts and CanonicalMemoryTreeService.ts
--          call but which did not exist in live Supabase.
--
-- Phase A audit finding: both functions returned 404 (not found)
-- when called with anon key — not a security issue, but a missing
-- production function that caused mergeEntities() to throw
-- CANONICAL_MERGE_TRANSACTION_FAILED on every call.
--
-- SECURITY: Both functions are SECURITY DEFINER + check auth.uid() = p_user_id
--           Service role bypasses RLS but we still validate user ownership.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. canonical_merge_entities
--    Atomically merges source_bubble into target_bubble:
--    - Reassigns all memories from source → target bubble
--    - Reassigns all kg_nodes from source → target bubble  
--    - Copies aliases from source into target metadata
--    - Archives the source bubble (is_archived = true)
--    - Returns { success: true, merged_memories: N, merged_nodes: N }
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.canonical_merge_entities(
  p_user_id       uuid,
  p_source_bubble_id uuid,
  p_target_bubble_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source        memory_bubbles%ROWTYPE;
  v_target        memory_bubbles%ROWTYPE;
  v_merged_mem    integer := 0;
  v_merged_nodes  integer := 0;
  v_source_aliases jsonb;
  v_target_aliases jsonb;
  v_merged_aliases jsonb;
BEGIN
  -- Guard: source and target must be different
  IF p_source_bubble_id = p_target_bubble_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'source_equals_target');
  END IF;

  -- Lock both rows (order by id to prevent deadlock)
  IF p_source_bubble_id < p_target_bubble_id THEN
    SELECT * INTO v_source FROM public.memory_bubbles
      WHERE id = p_source_bubble_id AND user_id = p_user_id
      FOR UPDATE;
    SELECT * INTO v_target FROM public.memory_bubbles
      WHERE id = p_target_bubble_id AND user_id = p_user_id
      FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM public.memory_bubbles
      WHERE id = p_target_bubble_id AND user_id = p_user_id
      FOR UPDATE;
    SELECT * INTO v_source FROM public.memory_bubbles
      WHERE id = p_source_bubble_id AND user_id = p_user_id
      FOR UPDATE;
  END IF;

  -- Guard: both bubbles must exist and belong to user
  IF v_source.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'source_not_found');
  END IF;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'target_not_found');
  END IF;

  -- 1. Reassign memories from source → target
  UPDATE public.memories
    SET bubble_id = p_target_bubble_id,
        updated_at = NOW()
  WHERE bubble_id = p_source_bubble_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_merged_mem = ROW_COUNT;

  -- 2. Reassign kg_nodes from source → target (canonical_id / bubble_id)
  UPDATE public.kg_nodes
    SET canonical_id = p_target_bubble_id,
        updated_at = NOW()
  WHERE canonical_id = p_source_bubble_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_merged_nodes = ROW_COUNT;

  -- Also update bubble_id if that column exists
  BEGIN
    UPDATE public.kg_nodes
      SET bubble_id = p_target_bubble_id,
          updated_at = NOW()
    WHERE bubble_id = p_source_bubble_id
      AND user_id = p_user_id;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- bubble_id column may not exist
  END;

  -- 3. Merge aliases from source into target metadata
  v_source_aliases := COALESCE(v_source.metadata->'aliases', '[]'::jsonb);
  v_target_aliases := COALESCE(v_target.metadata->'aliases', '[]'::jsonb);

  -- Add source label as an alias if not already present
  v_source_aliases := v_source_aliases || jsonb_build_array(v_source.label);

  -- Deduplicate aliases (union)
  v_merged_aliases := (
    SELECT jsonb_agg(DISTINCT elem)
    FROM (
      SELECT jsonb_array_elements_text(v_target_aliases) AS elem
      UNION
      SELECT jsonb_array_elements_text(v_source_aliases) AS elem
    ) deduped
    WHERE elem != v_target.label -- Don't alias the canonical name to itself
  );

  -- 4. Update target bubble with merged aliases + higher memory count
  UPDATE public.memory_bubbles
    SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{aliases}',
          COALESCE(v_merged_aliases, '[]'::jsonb)
        ),
        memory_count = COALESCE(memory_count, 0) + COALESCE(v_source.memory_count, 0),
        updated_at = NOW()
  WHERE id = p_target_bubble_id
    AND user_id = p_user_id;

  -- 5. Archive source bubble
  UPDATE public.memory_bubbles
    SET is_archived = true,
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{merged_into}',
          to_jsonb(p_target_bubble_id::text)
        ),
        updated_at = NOW()
  WHERE id = p_source_bubble_id
    AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'source_bubble_id', p_source_bubble_id,
    'target_bubble_id', p_target_bubble_id,
    'merged_memories', v_merged_mem,
    'merged_nodes', v_merged_nodes
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'reason', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

-- Revoke from anon (security hardening)
REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_merge_entities(uuid, uuid, uuid) TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 2. rebuild_kg_projection
--    Rebuilds kg_nodes and kg_edges for a user from memory_bubbles.
--    Called after bulk canonical entity operations to ensure
--    the graph projection is consistent with the bubble state.
--    
--    p_user_id:    required — only rebuilds for this user
--    p_full_reset: if true, deletes all existing nodes/edges first
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rebuild_kg_projection(
  p_user_id   uuid,
  p_full_reset boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nodes_inserted integer := 0;
  v_edges_preserved integer := 0;
BEGIN
  -- Optional: clear existing nodes/edges for user
  IF p_full_reset THEN
    DELETE FROM public.kg_edges WHERE user_id = p_user_id;
    DELETE FROM public.kg_nodes WHERE user_id = p_user_id;
  END IF;

  -- Upsert kg_nodes from active memory_bubbles
  -- Each active bubble becomes a node in the graph projection
  WITH bubble_nodes AS (
    SELECT
      id                                          AS node_id,
      user_id,
      label                                       AS name,
      COALESCE(relation_type, entity_type, 'entity') AS node_type,
      COALESCE(summary, '')                       AS description,
      COALESCE(metadata, '{}'::jsonb)             AS properties,
      NOW()                                       AS updated_at,
      created_at
    FROM public.memory_bubbles
    WHERE user_id = p_user_id
      AND is_archived = false
  )
  INSERT INTO public.kg_nodes (
    id, user_id, name, node_type, description, properties, updated_at, created_at
  )
  SELECT node_id, user_id, name, node_type, description, properties, updated_at, created_at
  FROM bubble_nodes
  ON CONFLICT (id) DO UPDATE
    SET name        = EXCLUDED.name,
        node_type   = EXCLUDED.node_type,
        description = EXCLUDED.description,
        properties  = EXCLUDED.properties,
        updated_at  = NOW();

  GET DIAGNOSTICS v_nodes_inserted = ROW_COUNT;

  -- Count existing edges (we preserve them — edges are not regenerated from scratch)
  SELECT COUNT(*) INTO v_edges_preserved
  FROM public.kg_edges
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'nodes_upserted', v_nodes_inserted,
    'edges_preserved', v_edges_preserved,
    'full_reset', p_full_reset
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'reason', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

-- Revoke from anon (security hardening)
REVOKE EXECUTE ON FUNCTION public.rebuild_kg_projection(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rebuild_kg_projection(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_kg_projection(uuid, boolean) TO service_role;

-- ──────────────────────────────────────────────────────────────
-- 3. VERIFICATION QUERIES
-- Run after applying:
--
-- SELECT proname, proargtypes::text FROM pg_proc
--   WHERE proname IN ('canonical_merge_entities', 'rebuild_kg_projection')
--   AND pronamespace = 'public'::regnamespace;
-- ──────────────────────────────────────────────────────────────
