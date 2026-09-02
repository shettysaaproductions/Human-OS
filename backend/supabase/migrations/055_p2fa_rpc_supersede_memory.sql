-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 055: Atomic Supersession RPC
--
-- PURPOSE: Ensure memory corrections are race-safe and ordered by provenance.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION atomic_supersede_memory(
  p_user_id UUID,
  p_key TEXT,
  p_new_value TEXT,
  p_memory_type TEXT,
  p_importance INT,
  p_confidence NUMERIC,
  p_emotional_weight INT,
  p_source_message TEXT,
  p_source_message_id UUID,
  p_source_authority TEXT,
  p_is_protected BOOLEAN DEFAULT false,
  p_protection_source TEXT DEFAULT NULL,
  p_source_references JSONB DEFAULT NULL,
  p_compression_status TEXT DEFAULT NULL,
  p_valid_from TIMESTAMPTZ DEFAULT NULL,
  p_valid_until TIMESTAMPTZ DEFAULT NULL,
  p_temporal_precision TEXT DEFAULT NULL,
  p_temporal_metadata JSONB DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_old_id UUID;
  v_old_source_id TEXT;
  v_old_message_ts TIMESTAMPTZ;
  v_new_message_ts TIMESTAMPTZ;
  v_new_id UUID;
BEGIN
  -- 1. Lock the current active memory for this user and key
  SELECT id, source_message_id
  INTO v_old_id, v_old_source_id
  FROM memories
  WHERE user_id = p_user_id
    AND key = p_key
    AND is_archived = false
    AND (lifecycle_state = 'CURRENT' OR lifecycle_state IS NULL)
  FOR UPDATE;

  -- 2. Verify provenance ordering if a current memory exists
  IF v_old_id IS NOT NULL THEN
    -- Get timestamps
    BEGIN
      SELECT created_at INTO v_old_message_ts
      FROM chat_history
      WHERE id = v_old_source_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_old_message_ts := NULL;
    END;

    BEGIN
      SELECT created_at INTO v_new_message_ts
      FROM chat_history
      WHERE id = p_source_message_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_new_message_ts := NULL;
    END;

    -- If the incoming message is OLDER than the current memory's source, ABORT.
    IF v_old_message_ts IS NOT NULL AND v_new_message_ts IS NOT NULL AND v_new_message_ts < v_old_message_ts THEN
      -- Stale write detected. Return null to indicate no mutation.
      RETURN jsonb_build_object('success', false, 'reason', 'STALE_WRITE', 'current_id', v_old_id);
    END IF;

    -- 3. Supersede old memory
    UPDATE memories
    SET is_archived = true,
        lifecycle_state = 'SUPERSEDED',
        superseded_at = NOW(),
        supersession_reason = 'Authoritative correction: superseded by ' || p_source_authority || ' fact',
        updated_at = NOW()
    WHERE id = v_old_id;
  END IF;

  -- 4. Insert new memory
  INSERT INTO memories (
    user_id, key, value, memory_type, is_archived,
    importance, confidence, emotional_weight, source_message, source_message_id, source_authority,
    lifecycle_state, is_protected, protection_source, protected_at,
    source_references, compression_status,
    valid_from, valid_until, temporal_precision, temporal_metadata
  ) VALUES (
    p_user_id, p_key, p_new_value, p_memory_type, false,
    p_importance, p_confidence, p_emotional_weight, p_source_message, p_source_message_id, p_source_authority,
    'CURRENT', p_is_protected, p_protection_source, CASE WHEN p_is_protected THEN NOW() ELSE NULL END,
    p_source_references, p_compression_status,
    p_valid_from, p_valid_until, p_temporal_precision, p_temporal_metadata
  ) RETURNING id INTO v_new_id;

  -- 5. Link old memory to new memory
  IF v_old_id IS NOT NULL THEN
    UPDATE memories
    SET superseded_by = v_new_id
    WHERE id = v_old_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_id', v_new_id, 'superseded_id', v_old_id);
END;
$$ LANGUAGE plpgsql;
