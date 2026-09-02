-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 056: Concurrency-safe canonicalization
--
-- Ensures atomic_canonicalize_memory is genuinely concurrency-safe for two
-- different aliases resolving to the same canonical key.
--
-- INVARIANTS:
-- 1. Serialize by (user_id, canonical_key) via pg_advisory_xact_lock
-- 2. Exactly one CURRENT canonical representation
-- 3. All aliases archived with superseded_by link
-- 4. History preserved (no physical DELETE)
-- 5. Handles unique_violation race gracefully
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION atomic_canonicalize_memory(
  p_user_id UUID,
  p_alias_memory_id UUID,
  p_canonical_key TEXT,
  p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  v_alias_user_id UUID;
  v_alias_key TEXT;
  v_alias_value TEXT;
  v_alias_importance INT;
  v_alias_confidence NUMERIC;
  v_alias_emotional_weight INT;
  v_alias_memory_type TEXT;
  v_alias_source_message TEXT;
  v_alias_source_message_id UUID;
  v_alias_source_authority TEXT;
  v_alias_protection_source TEXT;
  v_alias_is_protected BOOLEAN;
  v_alias_source_references JSONB;
  v_alias_compression_status TEXT;
  v_alias_valid_from TIMESTAMPTZ;
  v_alias_valid_until TIMESTAMPTZ;
  v_alias_temporal_precision TEXT;
  v_alias_temporal_metadata JSONB;
  v_canonical_id UUID;
  v_new_id UUID;
BEGIN
  -- Serialize all canonicalizations for the same (user_id, canonical_key).
  -- This prevents two concurrent alias reconciliations (e.g. moms_name and
  -- mom_name both -> mother_name) from both passing the "no canonical exists"
  -- check and racing to INSERT two CURRENT rows.
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_canonical_key));

  -- 1. Fetch and lock the alias row
  SELECT user_id, key, value, importance, confidence, emotional_weight,
         memory_type, source_message, source_message_id, source_authority,
         protection_source, is_protected, source_references, compression_status,
         valid_from, valid_until, temporal_precision, temporal_metadata
    INTO v_alias_user_id, v_alias_key, v_alias_value, v_alias_importance, v_alias_confidence,
         v_alias_emotional_weight, v_alias_memory_type, v_alias_source_message,
         v_alias_source_message_id, v_alias_source_authority, v_alias_protection_source,
         v_alias_is_protected, v_alias_source_references, v_alias_compression_status,
         v_alias_valid_from, v_alias_valid_until, v_alias_temporal_precision, v_alias_temporal_metadata
  FROM memories
  WHERE id = p_alias_memory_id
    AND user_id = p_user_id
    AND key != p_canonical_key
    AND is_archived = false
  FOR UPDATE;

  IF v_alias_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_FOUND', 'detail', 'alias memory not found or already archived');
  END IF;

  IF v_alias_user_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'USER_MISMATCH');
  END IF;

  -- 2. Check if canonical key already has a CURRENT row (locked)
  SELECT id INTO v_canonical_id
  FROM memories
  WHERE user_id = p_user_id
    AND key = p_canonical_key
    AND is_archived = false
    AND (lifecycle_state = 'CURRENT' OR lifecycle_state IS NULL)
  FOR UPDATE;

  IF v_canonical_id IS NOT NULL THEN
    -- Canonical CURRENT exists: archive alias only, preserve history
    UPDATE memories
    SET is_archived = true,
        lifecycle_state = 'SUPERSEDED',
        superseded_at = NOW(),
        supersession_reason = p_reason,
        superseded_by = v_canonical_id,
        updated_at = NOW()
    WHERE id = p_alias_memory_id;

    RETURN jsonb_build_object('success', true, 'action', 'archived_alias', 'canonical_id', v_canonical_id);
  END IF;

  -- 3. No canonical CURRENT: insert canonical CURRENT, then archive alias.
  -- Wrapped in exception handler for defense-in-depth: if a concurrent writer
  -- slipped through (e.g. via upsertMemory path bypassing this RPC), the
  -- partial unique index idx_memories_user_current_key will raise
  -- unique_violation. Handle it by archiving the alias against the winner.
  BEGIN
    INSERT INTO memories (
      user_id, key, value, memory_type, is_archived,
      importance, confidence, emotional_weight, source_message, source_message_id, source_authority,
      lifecycle_state, is_protected, protection_source, protected_at,
      source_references, compression_status,
      valid_from, valid_until, temporal_precision, temporal_metadata
    ) VALUES (
      p_user_id, p_canonical_key, v_alias_value, v_alias_memory_type, false,
      v_alias_importance, v_alias_confidence, v_alias_emotional_weight,
      v_alias_source_message, v_alias_source_message_id, v_alias_source_authority,
      'CURRENT', v_alias_is_protected, v_alias_protection_source, CASE WHEN v_alias_is_protected THEN NOW() ELSE NULL END,
      v_alias_source_references, v_alias_compression_status,
      v_alias_valid_from, v_alias_valid_until, v_alias_temporal_precision, v_alias_temporal_metadata
    ) RETURNING id INTO v_new_id;
  EXCEPTION WHEN unique_violation THEN
    -- Another transaction inserted the canonical CURRENT concurrently.
    -- Fetch the winner and archive alias against it.
    SELECT id INTO v_canonical_id
    FROM memories
    WHERE user_id = p_user_id
      AND key = p_canonical_key
      AND is_archived = false
      AND (lifecycle_state = 'CURRENT' OR lifecycle_state IS NULL)
    LIMIT 1;

    IF v_canonical_id IS NOT NULL THEN
      UPDATE memories
      SET is_archived = true,
          lifecycle_state = 'SUPERSEDED',
          superseded_at = NOW(),
          supersession_reason = p_reason,
          superseded_by = v_canonical_id,
          updated_at = NOW()
      WHERE id = p_alias_memory_id;

      RETURN jsonb_build_object('success', true, 'action', 'archived_alias', 'canonical_id', v_canonical_id, 'detail', 'race_recovered_via_unique_violation');
    ELSE
      RETURN jsonb_build_object('success', false, 'reason', 'CONCURRENT_RACE', 'detail', 'unique_violation but no canonical found');
    END IF;
  END;

  -- Archive alias with link to new canonical
  UPDATE memories
  SET is_archived = true,
      lifecycle_state = 'SUPERSEDED',
      superseded_at = NOW(),
      supersession_reason = p_reason,
      superseded_by = v_new_id,
      updated_at = NOW()
  WHERE id = p_alias_memory_id;

  RETURN jsonb_build_object('success', true, 'action', 'created_canonical', 'canonical_id', v_new_id, 'archived_alias_id', p_alias_memory_id);
END;
$$ LANGUAGE plpgsql;
