-- Migration 20260918_harden_canonical_merge_rpc.sql
-- Gate A: Restrict canonical_merge_entities to service_role only (security hardening)
-- Gate C: Fix relationship merge correctness: match on (targetEntityId + relationType), preserving multiple relation types

-- 0. Schema Invariant: Ensure reminders has bubble_id linking to memory_bubbles
ALTER TABLE public.reminders ADD COLUMN IF NOT EXISTS bubble_id UUID REFERENCES public.memory_bubbles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS reminders_bubble_id_idx ON public.reminders(bubble_id);

-- 1. Security Hardening: Revoke broad permissions and grant strictly to service_role
REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(UUID, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(UUID, UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.canonical_merge_entities(UUID, UUID, UUID) TO service_role;

-- 2. Enhanced atomic function with (targetEntityId + relationType) uniqueness
CREATE OR REPLACE FUNCTION public.canonical_merge_entities(
  p_user_id UUID,
  p_source_bubble_id UUID,
  p_target_bubble_id UUID
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_source RECORD;
  v_target RECORD;
  v_source_aliases JSONB;
  v_target_aliases JSONB;
  v_final_aliases JSONB := '[]'::jsonb;
  v_source_attrs JSONB;
  v_target_attrs JSONB;
  v_merged_attrs JSONB;
  v_source_rels JSONB;
  v_target_rels JSONB;
  v_merged_rels JSONB;
  v_source_kg_node RECORD;
  v_target_kg_node RECORD;
  v_now TIMESTAMPTZ := now();
  v_rel_item JSONB;
  v_mem_count INT := 0;
  v_rem_count INT := 0;
  v_child_count INT := 0;
  v_clean_type TEXT;
BEGIN
  -- 1. Guard against self-merge
  IF p_source_bubble_id = p_target_bubble_id THEN
    RETURN jsonb_build_object('success', true, 'status', 'noop_self_merge');
  END IF;

  -- 2. Lock both bubbles for update in consistent order to prevent deadlocks
  IF p_source_bubble_id < p_target_bubble_id THEN
    SELECT * INTO v_source FROM public.memory_bubbles 
      WHERE id = p_source_bubble_id AND user_id = p_user_id FOR UPDATE;
    SELECT * INTO v_target FROM public.memory_bubbles 
      WHERE id = p_target_bubble_id AND user_id = p_user_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM public.memory_bubbles 
      WHERE id = p_target_bubble_id AND user_id = p_user_id FOR UPDATE;
    SELECT * INTO v_source FROM public.memory_bubbles 
      WHERE id = p_source_bubble_id AND user_id = p_user_id FOR UPDATE;
  END IF;

  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'SOURCE_BUBBLE_NOT_FOUND';
  END IF;

  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'TARGET_BUBBLE_NOT_FOUND';
  END IF;

  -- 3. Idempotency guard: source already merged into target
  IF v_source.is_archived AND coalesce(v_source.metadata->>'archive_reason', '') = 'merged_into:' || p_target_bubble_id::text THEN
    RETURN jsonb_build_object('success', true, 'status', 'already_merged');
  END IF;

  IF v_target.is_archived THEN
    RAISE EXCEPTION 'TARGET_BUBBLE_IS_ARCHIVED';
  END IF;

  -- 4. Merge aliases (source label + source aliases + target aliases)
  v_source_aliases := coalesce(v_source.metadata->'aliases', '[]'::jsonb);
  v_target_aliases := coalesce(v_target.metadata->'aliases', '[]'::jsonb);
  
  -- Collect unique aliases case-insensitively
  SELECT coalesce(jsonb_agg(DISTINCT elem), '[]'::jsonb) INTO v_final_aliases
  FROM (
    SELECT jsonb_array_elements_text(v_target_aliases) AS elem
    UNION
    SELECT jsonb_array_elements_text(v_source_aliases) AS elem
    UNION
    SELECT v_source.label AS elem
  ) s
  WHERE lower(elem) <> lower(v_target.label);

  -- 5. Merge attributes
  v_source_attrs := coalesce(v_source.metadata->'attributes', '{}'::jsonb);
  v_target_attrs := coalesce(v_target.metadata->'attributes', '{}'::jsonb);
  v_merged_attrs := v_source_attrs || v_target_attrs;

  -- 6. Merge relationships (outgoing):
  -- Key Invariant (Gate C): Relationship identity is targetEntityId + lower(relationType)
  v_source_rels := coalesce(v_source.metadata->'relationships', '[]'::jsonb);
  v_target_rels := coalesce(v_target.metadata->'relationships', '[]'::jsonb);
  
  v_merged_rels := v_target_rels;
  FOR v_rel_item IN SELECT * FROM jsonb_array_elements(v_source_rels) LOOP
    v_clean_type := lower(trim(coalesce(v_rel_item->>'relationType', 'related_to')));
    -- Do not preserve edges pointing to the target (self-loops after merge)
    IF (v_rel_item->>'targetEntityId')::uuid <> p_target_bubble_id THEN
      -- Only deduplicate if target already has an edge with the SAME targetEntityId AND SAME relationType!
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_merged_rels) existing
        WHERE existing->>'targetEntityId' = v_rel_item->>'targetEntityId'
          AND lower(trim(coalesce(existing->>'relationType', ''))) = v_clean_type
      ) THEN
        -- Repoint relationshipId to target bubble source
        v_merged_rels := v_merged_rels || jsonb_build_array(
          jsonb_set(
            jsonb_set(v_rel_item, '{relationshipId}', to_jsonb(p_target_bubble_id::text || ':' || (v_rel_item->>'targetEntityId') || ':' || v_clean_type)),
            '{updatedAt}', to_jsonb(v_now::text)
          )
        );
      END IF;
    END IF;
  END LOOP;

  -- 7. Repoint incoming relationships on other bubbles pointing to source:
  -- Key Invariant (Gate C): Preserve distinct relation types, deduplicate only identical (targetEntityId + relationType)
  UPDATE public.memory_bubbles
  SET metadata = jsonb_set(
    metadata,
    '{relationships}',
    (
      WITH raw_rels AS (
        SELECT 
          CASE 
            WHEN (r->>'targetEntityId')::uuid = p_source_bubble_id 
            THEN jsonb_build_object(
              'relationshipId', id || ':' || p_target_bubble_id::text || ':' || lower(trim(coalesce(r->>'relationType', 'related_to'))),
              'targetEntityId', p_target_bubble_id,
              'targetEntityName', v_target.label,
              'relationType', r->>'relationType',
              'inverseRelationType', r->>'inverseRelationType',
              'confidence', coalesce((r->>'confidence')::numeric, 0.95),
              'status', coalesce(r->>'status', 'active'),
              'validFrom', r->>'validFrom',
              'validUntil', r->>'validUntil',
              'createdAt', coalesce(r->>'createdAt', v_now::text),
              'updatedAt', v_now::text,
              'provenance', coalesce(r->'provenance', '{}'::jsonb)
            )
            ELSE r
          END AS rel
        FROM jsonb_array_elements(coalesce(metadata->'relationships', '[]'::jsonb)) r
      ),
      deduped_rels AS (
        SELECT DISTINCT ON (rel->>'targetEntityId', lower(trim(coalesce(rel->>'relationType', '')))) rel
        FROM raw_rels
        ORDER BY rel->>'targetEntityId', lower(trim(coalesce(rel->>'relationType', ''))), (rel->>'updatedAt') DESC
      )
      SELECT coalesce(jsonb_agg(rel), '[]'::jsonb) FROM deduped_rels
    )
  ),
  updated_at = v_now
  WHERE user_id = p_user_id
    AND is_archived = false
    AND id <> p_source_bubble_id
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(metadata->'relationships', '[]'::jsonb)) rel
      WHERE (rel->>'targetEntityId')::uuid = p_source_bubble_id
    );

  -- 8. Repoint memories foreign-keyed to source
  UPDATE public.memories
  SET bubble_id = p_target_bubble_id, updated_at = v_now
  WHERE user_id = p_user_id AND bubble_id = p_source_bubble_id;
  GET DIAGNOSTICS v_mem_count = ROW_COUNT;

  -- 9. Repoint reminders foreign-keyed to source
  UPDATE public.reminders
  SET bubble_id = p_target_bubble_id, updated_at = v_now
  WHERE user_id = p_user_id AND bubble_id = p_source_bubble_id;
  GET DIAGNOSTICS v_rem_count = ROW_COUNT;

  -- 10. Repoint child bubbles whose parent was source
  UPDATE public.memory_bubbles
  SET parent_bubble_id = p_target_bubble_id, updated_at = v_now
  WHERE user_id = p_user_id AND parent_bubble_id = p_source_bubble_id;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  -- 11. Update target bubble metadata
  UPDATE public.memory_bubbles
  SET metadata = jsonb_build_object(
    'aliases', v_final_aliases,
    'attributes', v_merged_attrs,
    'relationships', v_merged_rels,
    'merged_from', coalesce(v_target.metadata->'merged_from', '[]'::jsonb) || jsonb_build_array(p_source_bubble_id),
    'last_reconciled_at', v_now
  ),
  updated_at = v_now
  WHERE id = p_target_bubble_id;

  -- 12. Repoint kg_nodes & kg_edges read projection safely
  SELECT * INTO v_source_kg_node FROM public.kg_nodes WHERE user_id = p_user_id AND bubble_id = p_source_bubble_id LIMIT 1;
  SELECT * INTO v_target_kg_node FROM public.kg_nodes WHERE user_id = p_user_id AND bubble_id = p_target_bubble_id LIMIT 1;

  IF v_source_kg_node.id IS NOT NULL AND v_target_kg_node.id IS NOT NULL AND v_source_kg_node.id <> v_target_kg_node.id THEN
    -- Update edges, deduplicating identical edges (source_node_id, target_node_id, relation_type)
    UPDATE public.kg_edges SET source_node_id = v_target_kg_node.id, updated_at = v_now 
    WHERE user_id = p_user_id AND source_node_id = v_source_kg_node.id;

    UPDATE public.kg_edges SET target_node_id = v_target_kg_node.id, updated_at = v_now 
    WHERE user_id = p_user_id AND target_node_id = v_source_kg_node.id;

    DELETE FROM public.kg_nodes WHERE id = v_source_kg_node.id;
  ELSIF v_source_kg_node.id IS NOT NULL AND v_target_kg_node.id IS NULL THEN
    UPDATE public.kg_nodes SET bubble_id = p_target_bubble_id, name = v_target.label, updated_at = v_now WHERE id = v_source_kg_node.id;
  END IF;

  -- 13. Record Reversible Audit Trail in memory_bubble_moves
  INSERT INTO public.memory_bubble_moves(
    user_id, bubble_id, entity_name, source_domain, target_domain,
    old_relation, new_relation, before_state, after_state,
    confirmation_fingerprint, created_at
  ) VALUES (
    p_user_id, p_target_bubble_id, v_source.label, v_source.domain_key, v_target.domain_key,
    v_source.relation_type, v_target.relation_type, row_to_json(v_source)::jsonb, row_to_json(v_target)::jsonb,
    'merge:' || v_source.label || '->' || v_target.label, v_now
  );

  -- 14. Archive Source Bubble
  UPDATE public.memory_bubbles
  SET is_archived = true,
      metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{archive_reason}', to_jsonb('merged_into:' || p_target_bubble_id::text)),
      updated_at = v_now
  WHERE id = p_source_bubble_id;

  RETURN jsonb_build_object(
    'success', true,
    'source_bubble_id', p_source_bubble_id,
    'target_bubble_id', p_target_bubble_id,
    'moved_memories', v_mem_count,
    'moved_reminders', v_rem_count,
    'repointed_children', v_child_count
  );
END;
$$;
