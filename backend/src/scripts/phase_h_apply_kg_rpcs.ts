import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

// Real kg_nodes columns: id, user_id, name, entity_type, attributes, created_at, updated_at, bubble_id
// Real memory_bubbles columns: id, user_id, parent_bubble_id, label, slug, bubble_type, domain_key,
//                               relation_type, metadata, is_archived, created_at, updated_at

const SQL = `
-- Correct rebuild_kg_projection using actual schema
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
  v_nodes_upserted integer := 0;
  v_edges_preserved integer := 0;
BEGIN
  -- Optional: clear existing nodes/edges for user
  IF p_full_reset THEN
    DELETE FROM public.kg_edges WHERE user_id = p_user_id;
    DELETE FROM public.kg_nodes WHERE user_id = p_user_id;
  END IF;

  -- Upsert kg_nodes from active memory_bubbles
  -- Each active bubble becomes/refreshes a node in the graph projection
  INSERT INTO public.kg_nodes (
    id,
    user_id,
    name,
    entity_type,
    attributes,
    bubble_id,
    created_at,
    updated_at
  )
  SELECT
    gen_random_uuid()                                       AS id,
    mb.user_id,
    mb.label                                                AS name,
    COALESCE(mb.relation_type, mb.bubble_type, 'entity')   AS entity_type,
    COALESCE(mb.metadata, '{}'::jsonb)                      AS attributes,
    mb.id                                                   AS bubble_id,
    mb.created_at,
    NOW()
  FROM public.memory_bubbles mb
  WHERE mb.user_id = p_user_id
    AND mb.is_archived = false
    AND NOT EXISTS (
      SELECT 1 FROM public.kg_nodes kn
      WHERE kn.bubble_id = mb.id AND kn.user_id = p_user_id
    )
  ON CONFLICT DO NOTHING;

  -- Update existing nodes from their bubble
  UPDATE public.kg_nodes kn
    SET name        = mb.label,
        entity_type = COALESCE(mb.relation_type, mb.bubble_type, kn.entity_type),
        attributes  = COALESCE(mb.metadata, '{}'::jsonb),
        updated_at  = NOW()
  FROM public.memory_bubbles mb
  WHERE kn.bubble_id = mb.id
    AND kn.user_id = p_user_id
    AND mb.user_id = p_user_id
    AND mb.is_archived = false;

  GET DIAGNOSTICS v_nodes_upserted = ROW_COUNT;

  -- Count existing edges (preserved, not regenerated)
  SELECT COUNT(*) INTO v_edges_preserved
  FROM public.kg_edges
  WHERE user_id = p_user_id;

  RETURN jsonb_build_object(
    'success',         true,
    'user_id',         p_user_id,
    'nodes_upserted',  v_nodes_upserted,
    'edges_preserved', v_edges_preserved,
    'full_reset',      p_full_reset
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',   false,
    'reason',    SQLERRM,
    'sqlstate',  SQLSTATE
  );
END;
$$;

-- Security: anon and authenticated cannot call directly
REVOKE EXECUTE ON FUNCTION public.rebuild_kg_projection(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rebuild_kg_projection(uuid, boolean) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.rebuild_kg_projection(uuid, boolean) TO service_role;

-- Also update canonical_merge_entities to use correct schema (bubble_id not canonical_id)
CREATE OR REPLACE FUNCTION public.canonical_merge_entities(
  p_user_id          uuid,
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
      WHERE id = p_source_bubble_id AND user_id = p_user_id FOR UPDATE;
    SELECT * INTO v_target FROM public.memory_bubbles
      WHERE id = p_target_bubble_id AND user_id = p_user_id FOR UPDATE;
  ELSE
    SELECT * INTO v_target FROM public.memory_bubbles
      WHERE id = p_target_bubble_id AND user_id = p_user_id FOR UPDATE;
    SELECT * INTO v_source FROM public.memory_bubbles
      WHERE id = p_source_bubble_id AND user_id = p_user_id FOR UPDATE;
  END IF;

  -- Guard: both bubbles must exist and belong to user
  IF v_source.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'source_not_found');
  END IF;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'target_not_found');
  END IF;

  -- 1. Reassign memories from source bubble → target bubble
  UPDATE public.memories
    SET bubble_id  = p_target_bubble_id,
        updated_at = NOW()
  WHERE bubble_id = p_source_bubble_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_merged_mem = ROW_COUNT;

  -- 2. Reassign kg_nodes from source bubble → target bubble
  UPDATE public.kg_nodes
    SET bubble_id  = p_target_bubble_id,
        updated_at = NOW()
  WHERE bubble_id = p_source_bubble_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_merged_nodes = ROW_COUNT;

  -- 3. Merge aliases: source label + source aliases → target metadata.aliases
  v_source_aliases := COALESCE(v_source.metadata->'aliases', '[]'::jsonb);
  v_target_aliases := COALESCE(v_target.metadata->'aliases', '[]'::jsonb);
  -- Add source label as an alias
  v_source_aliases := v_source_aliases || jsonb_build_array(v_source.label);
  -- Deduplicate (union, exclude canonical name)
  SELECT jsonb_agg(DISTINCT elem)
  INTO v_merged_aliases
  FROM (
    SELECT jsonb_array_elements_text(v_target_aliases) AS elem
    UNION
    SELECT jsonb_array_elements_text(v_source_aliases) AS elem
  ) deduped
  WHERE elem != v_target.label;

  -- 4. Update target bubble metadata with merged aliases
  UPDATE public.memory_bubbles
    SET metadata   = jsonb_set(
                       COALESCE(metadata, '{}'::jsonb),
                       '{aliases}',
                       COALESCE(v_merged_aliases, '[]'::jsonb)
                     ),
        updated_at = NOW()
  WHERE id = p_target_bubble_id
    AND user_id = p_user_id;

  -- 5. Archive source bubble
  UPDATE public.memory_bubbles
    SET is_archived = true,
        metadata    = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{merged_into}',
                        to_jsonb(p_target_bubble_id::text)
                      ),
        updated_at  = NOW()
  WHERE id = p_source_bubble_id
    AND user_id = p_user_id;

  RETURN jsonb_build_object(
    'success',          true,
    'source_bubble_id', p_source_bubble_id,
    'target_bubble_id', p_target_bubble_id,
    'merged_memories',  v_merged_mem,
    'merged_nodes',     v_merged_nodes
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success',  false,
    'reason',   SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.canonical_merge_entities(uuid, uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.canonical_merge_entities(uuid, uuid, uuid) TO service_role;
`;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('✅ Connected');

  try {
    await c.query(SQL);
    console.log('✅ KG RPC functions applied (canonical_merge_entities + rebuild_kg_projection)');
  } catch (e: any) {
    console.error('❌ Failed:', e.message);
    process.exit(1);
  }

  // Verify both exist
  const after = await c.query(`
    SELECT proname, pg_get_function_arguments(oid) as args
    FROM pg_proc 
    WHERE proname IN ('canonical_merge_entities', 'rebuild_kg_projection')
    AND pronamespace = 'public'::regnamespace
    ORDER BY proname
  `);
  for (const row of after.rows) {
    console.log(`✅ FUNCTION ${row.proname}(${row.args}) — EXISTS`);
  }

  // Quick smoke test rebuild_kg_projection on real user
  const { rows: users } = await c.query(
    `SELECT DISTINCT user_id FROM public.memory_bubbles WHERE is_archived = false LIMIT 1`
  );
  if (users.length > 0) {
    const testUser = users[0].user_id;
    const res = await c.query(
      `SELECT public.rebuild_kg_projection($1, false) AS result`, [testUser]
    );
    console.log('✅ rebuild_kg_projection smoke test:', JSON.stringify(res.rows[0].result));
  }

  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
