-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 055: Atomic Supersession RPC
--
-- PURPOSE: Ensure memory corrections are race-safe and ordered by provenance.
--
-- SAFETY INVARIANTS:
-- 1. Incoming source_message_id MUST resolve to chat_history with role='user'
-- 2. Source must belong to the same user
-- 3. Required provenance fields must exist (created_at)
-- 4. Missing/invalid provenance -> ZERO mutation
-- 5. Older authoritative event -> STALE_WRITE with ZERO mutation
-- 6. Equal timestamps -> deterministic ordering by ID comparison
-- 7. Never resurrect an older event
-- 8. Concurrent writers must never leave two CURRENT rows
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
  v_old_message_id UUID;
  v_old_source_role TEXT;
  v_old_source_user_id UUID;
  v_new_message_ts TIMESTAMPTZ;
  v_new_id UUID;
  v_new_source_role TEXT;
  v_new_source_user_id UUID;
BEGIN
  -- ── PROVENANCE VALIDATION: Incoming source_message_id ─────────────────────
  -- P0-1: Validate that incoming source_message_id resolves to a valid user message

  IF p_source_message_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id is null');
  END IF;

  -- Fetch the chat_history row for the incoming source
  BEGIN
    SELECT created_at, role, user_id INTO v_new_message_ts, v_new_source_role, v_new_source_user_id
    FROM chat_history
    WHERE id = p_source_message_id;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'invalid source_message_id format');
  END;

  -- Validate source exists
  IF v_new_message_ts IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id not found in chat_history');
  END IF;

  -- Validate source belongs to the same user
  IF v_new_source_user_id IS NULL OR v_new_source_user_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id belongs to different user');
  END IF;

  -- Validate source is a user message (not assistant)
  IF v_new_source_role IS NULL OR v_new_source_role != 'user' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id is not a user message');
  END IF;

  -- Handle concurrent inserts with a retry loop
  FOR i IN 1..3 LOOP
    -- 1. Lock the current active memory for this user and key
    v_old_id := NULL;
    v_old_source_id := NULL;
    v_old_message_ts := NULL;
    v_old_message_id := NULL;

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
      -- Get the OLD memory's source message provenance
      BEGIN
        SELECT ch.created_at, ch.id, ch.role, ch.user_id
          INTO v_old_message_ts, v_old_message_id, v_old_source_role, v_old_source_user_id
        FROM chat_history ch
        WHERE ch.id = v_old_source_id::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        v_old_message_ts := NULL;
        v_old_message_id := NULL;
        v_old_source_role := NULL;
        v_old_source_user_id := NULL;
      END;

      -- PROVENANCE FAIL-CLOSED: The existing CURRENT row MUST have resolvable,
      -- same-user, USER-role source with authoritative ordering information.
      -- Never silently continue because timestamps are NULL.
      IF v_old_message_ts IS NULL OR v_old_message_id IS NULL
         OR v_old_source_role IS NULL OR v_old_source_role != 'user'
         OR v_old_source_user_id IS NULL OR v_old_source_user_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'current_id', v_old_id, 'detail', 'existing CURRENT memory provenance cannot be authoritatively resolved');
      END IF;

      -- Stale write check: incoming is OLDER than current
      IF v_new_message_ts < v_old_message_ts THEN
        RETURN jsonb_build_object('success', false, 'reason', 'STALE_WRITE', 'current_id', v_old_id, 'detail', 'incoming message is older than current memory source');
      END IF;

      -- Equal timestamps: deterministic ordering by source_message_id comparison (lexicographic)
      IF v_new_message_ts = v_old_message_ts THEN
        IF p_source_message_id::TEXT < v_old_message_id::TEXT THEN
          -- Incoming has "lower" ID, treat as older -> stale
          RETURN jsonb_build_object('success', false, 'reason', 'STALE_WRITE', 'current_id', v_old_id, 'detail', 'equal timestamps, incoming ID is older');
        END IF;
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

    BEGIN
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
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent insert beat us to it. Loop and retry (which will now find the row in step 1).
      CONTINUE;
    END;

    -- 5. Link old memory to new memory
    IF v_old_id IS NOT NULL THEN
      UPDATE memories
      SET superseded_by = v_new_id
      WHERE id = v_old_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'new_id', v_new_id, 'superseded_id', v_old_id);
  END LOOP;

  -- If we exhausted retries:
  RETURN jsonb_build_object('success', false, 'reason', 'CONCURRENT_RACE');
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER RPC: atomic_archive_memory
--
-- PURPOSE: Safely archive a memory without physical deletion.
-- Used by reconciliation script and CanonicalStateReconciler.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION atomic_archive_memory(
  p_user_id UUID,
  p_memory_id UUID,
  p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  v_memory_user_id UUID;
BEGIN
  -- Verify memory belongs to user
  SELECT user_id INTO v_memory_user_id
  FROM memories
  WHERE id = p_memory_id;

  IF v_memory_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_FOUND');
  END IF;

  IF v_memory_user_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'USER_MISMATCH');
  END IF;

  -- Perform archive
  UPDATE memories
  SET is_archived = true,
      lifecycle_state = COALESCE(lifecycle_state, 'SUPERSEDED'),
      supersession_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_memory_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER RPC: atomic_quarantine_memory
--
-- PURPOSE: Quarantine a malformed/invalid memory.
-- Used by reconciliation script for command-key quarantine.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION atomic_quarantine_memory(
  p_user_id UUID,
  p_memory_id UUID,
  p_reason TEXT
) RETURNS JSONB AS $$
DECLARE
  v_memory_user_id UUID;
BEGIN
  -- Verify memory belongs to user
  SELECT user_id INTO v_memory_user_id
  FROM memories
  WHERE id = p_memory_id;

  IF v_memory_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_FOUND');
  END IF;

  IF v_memory_user_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'USER_MISMATCH');
  END IF;

  -- Perform quarantine (archive + invalidate)
  UPDATE memories
  SET is_archived = true,
      lifecycle_state = 'INVALIDATED',
      supersession_reason = p_reason,
      updated_at = NOW()
  WHERE id = p_memory_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- HELPER RPC: atomic_canonicalize_memory
--
-- PURPOSE: Atomically canonicalize an alias key to its canonical schema equivalent.
-- Used by reconciliation script. Handles in one transaction:
--   1. Lock alias row FOR UPDATE
--   2. Lock/insert canonical CURRENT row
--   3. Archive alias, preserve history, exactly one CURRENT canonical
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

  -- 2. Check if canonical key already has a CURRENT row
  SELECT id INTO v_canonical_id
  FROM memories
  WHERE user_id = p_user_id
    AND key = p_canonical_key
    AND is_archived = false
    AND (lifecycle_state = 'CURRENT' OR lifecycle_state IS NULL)
  FOR NO KEY UPDATE;

  IF v_canonical_id IS NOT NULL THEN
    -- Canonical CURRENT exists: archive alias only
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

  -- 3. No canonical CURRENT: insert canonical CURRENT, then archive alias
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
