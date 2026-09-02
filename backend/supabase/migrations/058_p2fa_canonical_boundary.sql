-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 058: Canonical key boundary enforcement
--
-- P0-1 / P0-2: DB mutation boundary must never trust arbitrary p_canonical_key / p_key.
-- Enforces canonicalize_key_sql(p_key) = p_key else ZERO mutation + NON_CANONICAL_KEY.
-- Preserves all 057 deterministic provenance winner logic.
-- ─────────────────────────────────────────────────────────────────────────────

-- Ensure helper exists (idempotent)
CREATE OR REPLACE FUNCTION canonicalize_key_sql(raw_key TEXT) RETURNS TEXT AS $$
DECLARE
  lk TEXT := lower(regexp_replace(COALESCE(raw_key, ''), '['']', '', 'g'));
BEGIN
  CASE lk
    WHEN 'mothers_name' THEN RETURN 'mother_name';
    WHEN 'moms_name' THEN RETURN 'mother_name';
    WHEN 'mom_name' THEN RETURN 'mother_name';
    WHEN 'maa_name' THEN RETURN 'mother_name';
    WHEN 'maa' THEN RETURN 'mother_name';
    WHEN 'mom' THEN RETURN 'mother_name';
    WHEN 'mother' THEN RETURN 'mother_name';
    WHEN 'mummy_name' THEN RETURN 'mother_name';
    WHEN 'mata_name' THEN RETURN 'mother_name';
    WHEN 'maa_ka_naam' THEN RETURN 'mother_name';
    WHEN 'mother_real_name' THEN RETURN 'mother_name';
    WHEN 'mothers_nickname' THEN RETURN 'mother_nickname';
    WHEN 'mom_nickname' THEN RETURN 'mother_nickname';
    WHEN 'moms_nickname' THEN RETURN 'mother_nickname';
    WHEN 'maa_ka_nickname' THEN RETURN 'mother_nickname';
    WHEN 'mummy_ka_nickname' THEN RETURN 'mother_nickname';
    WHEN 'mother_nick_name' THEN RETURN 'mother_nickname';
    WHEN 'mom_nick_name' THEN RETURN 'mother_nickname';
    WHEN 'fathers_name' THEN RETURN 'father_name';
    WHEN 'dads_name' THEN RETURN 'father_name';
    WHEN 'dad_name' THEN RETURN 'father_name';
    WHEN 'papa_name' THEN RETURN 'father_name';
    WHEN 'pita_name' THEN RETURN 'father_name';
    WHEN 'dad' THEN RETURN 'father_name';
    WHEN 'father' THEN RETURN 'father_name';
    WHEN 'papa' THEN RETURN 'father_name';
    WHEN 'baap_name' THEN RETURN 'father_name';
    WHEN 'father_real_name' THEN RETURN 'father_name';
    WHEN 'fathers_nickname' THEN RETURN 'father_nickname';
    WHEN 'dad_nickname' THEN RETURN 'father_nickname';
    WHEN 'dads_nickname' THEN RETURN 'father_nickname';
    WHEN 'papa_ka_nickname' THEN RETURN 'father_nickname';
    WHEN 'father_nick_name' THEN RETURN 'father_nickname';
    WHEN 'dad_nick_name' THEN RETURN 'father_nickname';
    WHEN 'wives_name' THEN RETURN 'wife_name';
    WHEN 'wife' THEN RETURN 'wife_name';
    WHEN 'biwi' THEN RETURN 'wife_name';
    WHEN 'patni' THEN RETURN 'wife_name';
    WHEN 'biwi_name' THEN RETURN 'wife_name';
    WHEN 'patni_name' THEN RETURN 'wife_name';
    WHEN 'spouse_name' THEN RETURN 'wife_name';
    WHEN 'wife_real_name' THEN RETURN 'wife_name';
    WHEN 'wives_nickname' THEN RETURN 'wife_nickname';
    WHEN 'wife_nick_name' THEN RETURN 'wife_nickname';
    WHEN 'biwi_ka_nickname' THEN RETURN 'wife_nickname';
    WHEN 'patni_ka_nickname' THEN RETURN 'wife_nickname';
    WHEN 'spouse_nickname' THEN RETURN 'wife_nickname';
    WHEN 'husbands_name' THEN RETURN 'husband_name';
    WHEN 'husband' THEN RETURN 'husband_name';
    WHEN 'pati' THEN RETURN 'husband_name';
    WHEN 'shauhar' THEN RETURN 'husband_name';
    WHEN 'pati_name' THEN RETURN 'husband_name';
    WHEN 'shauhar_name' THEN RETURN 'husband_name';
    WHEN 'husband_real_name' THEN RETURN 'husband_name';
    WHEN 'husbands_nickname' THEN RETURN 'husband_nickname';
    WHEN 'husband_nick_name' THEN RETURN 'husband_nickname';
    WHEN 'pati_ka_nickname' THEN RETURN 'husband_nickname';
    WHEN 'shauhar_ka_nickname' THEN RETURN 'husband_nickname';
    WHEN 'sons_name' THEN RETURN 'son_name';
    WHEN 'son' THEN RETURN 'son_name';
    WHEN 'beta' THEN RETURN 'son_name';
    WHEN 'beta_name' THEN RETURN 'son_name';
    WHEN 'bete_ka_naam' THEN RETURN 'son_name';
    WHEN 'son_real_name' THEN RETURN 'son_name';
    WHEN 'sons_nickname' THEN RETURN 'son_nickname';
    WHEN 'son_nick_name' THEN RETURN 'son_nickname';
    WHEN 'bete_ka_nickname' THEN RETURN 'son_nickname';
    WHEN 'bete_ka_pyar_ka_naam' THEN RETURN 'son_nickname';
    WHEN 'daughters_name' THEN RETURN 'daughter_name';
    WHEN 'daughter' THEN RETURN 'daughter_name';
    WHEN 'beti' THEN RETURN 'daughter_name';
    WHEN 'beti_name' THEN RETURN 'daughter_name';
    WHEN 'daughter_real_name' THEN RETURN 'daughter_name';
    WHEN 'daughters_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'daughter_nick_name' THEN RETURN 'daughter_nickname';
    WHEN 'beti_ka_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'beti_ka_pyar_ka_naam' THEN RETURN 'daughter_nickname';
    WHEN 'sisters_name' THEN RETURN 'sister_name';
    WHEN 'sister' THEN RETURN 'sister_name';
    WHEN 'behen' THEN RETURN 'sister_name';
    WHEN 'behen_name' THEN RETURN 'sister_name';
    WHEN 'didi_name' THEN RETURN 'sister_name';
    WHEN 'sister_real_name' THEN RETURN 'sister_name';
    WHEN 'sisters_nickname' THEN RETURN 'sister_nickname';
    WHEN 'sister_nick_name' THEN RETURN 'sister_nickname';
    WHEN 'behen_ka_nickname' THEN RETURN 'sister_nickname';
    WHEN 'didi_ka_nickname' THEN RETURN 'sister_nickname';
    WHEN 'brothers_name' THEN RETURN 'brother_name';
    WHEN 'bhai_name' THEN RETURN 'brother_name';
    WHEN 'brother' THEN RETURN 'brother_name';
    WHEN 'bhai' THEN RETURN 'brother_name';
    WHEN 'brother_real_name' THEN RETURN 'brother_name';
    WHEN 'brothers_nickname' THEN RETURN 'brother_nickname';
    WHEN 'brother_nick_name' THEN RETURN 'brother_nickname';
    WHEN 'bhai_ka_nickname' THEN RETURN 'brother_nickname';
    WHEN 'bhaiya_ka_nickname' THEN RETURN 'brother_nickname';
    WHEN 'business_name' THEN RETURN 'company_name';
    WHEN 'company' THEN RETURN 'company_name';
    WHEN 'business' THEN RETURN 'company_name';
    WHEN 'startup_name' THEN RETURN 'company_name';
    WHEN 'firm_name' THEN RETURN 'company_name';
    WHEN 'office_name' THEN RETURN 'company_name';
    WHEN 'workplace_name' THEN RETURN 'company_name';
    WHEN 'birthday' THEN RETURN 'birth_date';
    WHEN 'date_of_birth' THEN RETURN 'birth_date';
    WHEN 'dob' THEN RETURN 'birth_date';
    WHEN 'bday' THEN RETURN 'birth_date';
    WHEN 'janam_din' THEN RETURN 'birth_date';
    WHEN 'child_birthdate' THEN RETURN 'birth_date';
    WHEN 'wedding_date' THEN RETURN 'marriage_date';
    WHEN 'anniversary' THEN RETURN 'marriage_date';
    WHEN 'anniversary_date' THEN RETURN 'marriage_date';
    WHEN 'shadi_date' THEN RETURN 'marriage_date';
    WHEN 'vivah_date' THEN RETURN 'marriage_date';
    WHEN 'name' THEN RETURN 'preferred_name';
    WHEN 'user_name' THEN RETURN 'preferred_name';
    WHEN 'my_name' THEN RETURN 'preferred_name';
    WHEN 'users_name' THEN RETURN 'preferred_name';
    WHEN 'prefer_work_hours' THEN RETURN 'preferred_work_hours';
    WHEN 'prefer_morning_work' THEN RETURN 'preferred_work_hours';
    WHEN 'prefer_evening_work' THEN RETURN 'preferred_work_hours';
    WHEN 'work_hours_preference' THEN RETURN 'preferred_work_hours';
    WHEN 'working_hours_preference' THEN RETURN 'preferred_work_hours';
    WHEN 'preferred_working_hours' THEN RETURN 'preferred_work_hours';
    WHEN 'favorite_color' THEN RETURN 'favourite_color';
    WHEN 'favorite_colour' THEN RETURN 'favourite_color';
    WHEN 'fav_color' THEN RETURN 'favourite_color';
    WHEN 'favourite_colour' THEN RETURN 'favourite_color';
    WHEN 'favorite_beverage' THEN RETURN 'favourite_beverage';
    WHEN 'favorite_drink' THEN RETURN 'favourite_beverage';
    WHEN 'favourite_drink' THEN RETURN 'favourite_beverage';
    WHEN 'favorite_street_food' THEN RETURN 'favourite_street_food';
    WHEN 'favourite_food' THEN RETURN 'favourite_street_food';
    WHEN 'mother_name' THEN RETURN 'mother_name';
    WHEN 'mother_nickname' THEN RETURN 'mother_nickname';
    WHEN 'father_name' THEN RETURN 'father_name';
    WHEN 'father_nickname' THEN RETURN 'father_nickname';
    WHEN 'wife_name' THEN RETURN 'wife_name';
    WHEN 'wife_nickname' THEN RETURN 'wife_nickname';
    WHEN 'husband_name' THEN RETURN 'husband_name';
    WHEN 'husband_nickname' THEN RETURN 'husband_nickname';
    WHEN 'son_name' THEN RETURN 'son_name';
    WHEN 'son_nickname' THEN RETURN 'son_nickname';
    WHEN 'daughter_name' THEN RETURN 'daughter_name';
    WHEN 'daughter_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'sister_name' THEN RETURN 'sister_name';
    WHEN 'sister_nickname' THEN RETURN 'sister_nickname';
    WHEN 'brother_name' THEN RETURN 'brother_name';
    WHEN 'brother_nickname' THEN RETURN 'brother_nickname';
    WHEN 'company_name' THEN RETURN 'company_name';
    WHEN 'birth_date' THEN RETURN 'birth_date';
    WHEN 'marriage_date' THEN RETURN 'marriage_date';
    WHEN 'preferred_name' THEN RETURN 'preferred_name';
    WHEN 'preferred_work_hours' THEN RETURN 'preferred_work_hours';
    WHEN 'favourite_color' THEN RETURN 'favourite_color';
    WHEN 'favourite_beverage' THEN RETURN 'favourite_beverage';
    WHEN 'favourite_street_food' THEN RETURN 'favourite_street_food';
    ELSE RETURN lk;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── atomic_supersede_memory with canonical boundary ────────────────────────
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
  -- P0: Canonical key boundary — must be canonical before any mutation
  IF canonicalize_key_sql(p_key) != p_key THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NON_CANONICAL_KEY', 'detail', 'p_key is not canonical: ' || p_key || ' -> ' || canonicalize_key_sql(p_key));
  END IF;

  IF p_source_message_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id is null');
  END IF;

  BEGIN
    SELECT created_at, role, user_id INTO v_new_message_ts, v_new_source_role, v_new_source_user_id
    FROM chat_history
    WHERE id = p_source_message_id;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'invalid source_message_id format');
  END;

  IF v_new_message_ts IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id not found in chat_history');
  END IF;

  IF v_new_source_user_id IS NULL OR v_new_source_user_id != p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id belongs to different user');
  END IF;

  IF v_new_source_role IS NULL OR v_new_source_role != 'user' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'detail', 'source_message_id is not a user message');
  END IF;

  FOR i IN 1..3 LOOP
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

    IF v_old_id IS NOT NULL THEN
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

      IF v_old_message_ts IS NULL OR v_old_message_id IS NULL
         OR v_old_source_role IS NULL OR v_old_source_role != 'user'
         OR v_old_source_user_id IS NULL OR v_old_source_user_id != p_user_id THEN
        RETURN jsonb_build_object('success', false, 'reason', 'MISSING_PROVENANCE', 'current_id', v_old_id, 'detail', 'existing CURRENT memory provenance cannot be authoritatively resolved');
      END IF;

      IF v_new_message_ts < v_old_message_ts THEN
        RETURN jsonb_build_object('success', false, 'reason', 'STALE_WRITE', 'current_id', v_old_id, 'detail', 'incoming message is older than current memory source');
      END IF;

      IF v_new_message_ts = v_old_message_ts THEN
        IF p_source_message_id::TEXT < v_old_message_id::TEXT THEN
          RETURN jsonb_build_object('success', false, 'reason', 'STALE_WRITE', 'current_id', v_old_id, 'detail', 'equal timestamps, incoming ID is older');
        END IF;
      END IF;

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
      CONTINUE;
    END;

    IF v_old_id IS NOT NULL THEN
      UPDATE memories
      SET superseded_by = v_new_id
      WHERE id = v_old_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'new_id', v_new_id, 'superseded_id', v_old_id);
  END LOOP;

  RETURN jsonb_build_object('success', false, 'reason', 'CONCURRENT_RACE');
END;
$$ LANGUAGE plpgsql;

-- ── atomic_canonicalize_memory with canonical boundary + deterministic winner ──
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
  v_alias_source_message_id TEXT;
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
  v_canonical_source_id TEXT;
  v_canonical_msg_ts TIMESTAMPTZ;
  v_canonical_msg_id UUID;
  v_canonical_role TEXT;
  v_canonical_user_id UUID;
  v_new_id UUID;
  best_id UUID;
  best_key TEXT;
  best_value TEXT;
  best_importance INT;
  best_confidence NUMERIC;
  best_emotional_weight INT;
  best_memory_type TEXT;
  best_source_message TEXT;
  best_source_message_id TEXT;
  best_source_authority TEXT;
  best_protection_source TEXT;
  best_is_protected BOOLEAN;
  best_source_references JSONB;
  best_compression_status TEXT;
  best_valid_from TIMESTAMPTZ;
  best_valid_until TIMESTAMPTZ;
  best_temporal_precision TEXT;
  best_temporal_metadata JSONB;
  best_msg_ts TIMESTAMPTZ;
  best_msg_id UUID;
  best_valid BOOLEAN := false;
  best_role TEXT;
  best_user_id UUID;
  canon_valid BOOLEAN := false;
  r RECORD;
  cur_ts TIMESTAMPTZ;
  cur_id UUID;
  cur_role TEXT;
  cur_uid UUID;
  cur_valid BOOLEAN;
  pending_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  -- P0: Canonical key boundary — p_canonical_key must already be canonical
  IF canonicalize_key_sql(p_canonical_key) != p_canonical_key THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NON_CANONICAL_KEY', 'detail', 'p_canonical_key is not canonical: ' || p_canonical_key || ' -> ' || canonicalize_key_sql(p_canonical_key));
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text), hashtext(p_canonical_key));

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
    AND is_archived = false
  FOR UPDATE;

  IF v_alias_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_FOUND', 'detail', 'alias memory not found or already archived');
  END IF;

  IF canonicalize_key_sql(v_alias_key) != p_canonical_key THEN
    RETURN jsonb_build_object('success', false, 'reason', 'KEY_MISMATCH', 'detail', 'alias does not map to canonical');
  END IF;

  SELECT id, source_message_id::TEXT INTO v_canonical_id, v_canonical_source_id
  FROM memories
  WHERE user_id = p_user_id
    AND key = p_canonical_key
    AND is_archived = false
    AND (lifecycle_state = 'CURRENT' OR lifecycle_state IS NULL)
  FOR UPDATE;

  FOR r IN
    SELECT id, key, value, importance, confidence, emotional_weight, memory_type,
           source_message, source_message_id, source_authority, protection_source,
           is_protected, source_references, compression_status,
           valid_from, valid_until, temporal_precision, temporal_metadata
    FROM memories
    WHERE user_id = p_user_id
      AND is_archived = false
      AND key != p_canonical_key
      AND canonicalize_key_sql(key) = p_canonical_key
    FOR UPDATE
  LOOP
    pending_ids := array_append(pending_ids, r.id);
    cur_ts := NULL; cur_id := NULL; cur_role := NULL; cur_uid := NULL; cur_valid := false;
    IF r.source_message_id IS NOT NULL THEN
      BEGIN
        SELECT ch.created_at, ch.id, ch.role, ch.user_id
          INTO cur_ts, cur_id, cur_role, cur_uid
        FROM chat_history ch
        WHERE ch.id = r.source_message_id::UUID;
      EXCEPTION WHEN invalid_text_representation THEN
        cur_ts := NULL; cur_id := NULL; cur_role := NULL; cur_uid := NULL;
      END;
      IF cur_ts IS NOT NULL AND cur_id IS NOT NULL AND cur_role = 'user' AND cur_uid = p_user_id THEN
        cur_valid := true;
      ELSE
        cur_valid := false;
      END IF;
    ELSE
      cur_valid := false;
    END IF;

    IF best_id IS NULL THEN
      best_id := r.id;
      best_key := r.key; best_value := r.value; best_importance := r.importance;
      best_confidence := r.confidence; best_emotional_weight := r.emotional_weight;
      best_memory_type := r.memory_type; best_source_message := r.source_message;
      best_source_message_id := r.source_message_id::TEXT; best_source_authority := r.source_authority;
      best_protection_source := r.protection_source; best_is_protected := r.is_protected;
      best_source_references := r.source_references; best_compression_status := r.compression_status;
      best_valid_from := r.valid_from; best_valid_until := r.valid_until;
      best_temporal_precision := r.temporal_precision; best_temporal_metadata := r.temporal_metadata;
      best_msg_ts := cur_ts; best_msg_id := cur_id; best_valid := cur_valid; best_role := cur_role; best_user_id := cur_uid;
    ELSE
      IF cur_valid AND NOT best_valid THEN
        best_id := r.id;
        best_key := r.key; best_value := r.value; best_importance := r.importance;
        best_confidence := r.confidence; best_emotional_weight := r.emotional_weight;
        best_memory_type := r.memory_type; best_source_message := r.source_message;
        best_source_message_id := r.source_message_id::TEXT; best_source_authority := r.source_authority;
        best_protection_source := r.protection_source; best_is_protected := r.is_protected;
        best_source_references := r.source_references; best_compression_status := r.compression_status;
        best_valid_from := r.valid_from; best_valid_until := r.valid_until;
        best_temporal_precision := r.temporal_precision; best_temporal_metadata := r.temporal_metadata;
        best_msg_ts := cur_ts; best_msg_id := cur_id; best_valid := cur_valid;
      ELSIF cur_valid = best_valid THEN
        IF cur_valid THEN
          IF cur_ts > best_msg_ts THEN
            best_id := r.id;
            best_key := r.key; best_value := r.value; best_importance := r.importance;
            best_confidence := r.confidence; best_emotional_weight := r.emotional_weight;
            best_memory_type := r.memory_type; best_source_message := r.source_message;
            best_source_message_id := r.source_message_id::TEXT; best_source_authority := r.source_authority;
            best_protection_source := r.protection_source; best_is_protected := r.is_protected;
            best_source_references := r.source_references; best_compression_status := r.compression_status;
            best_valid_from := r.valid_from; best_valid_until := r.valid_until;
            best_temporal_precision := r.temporal_precision; best_temporal_metadata := r.temporal_metadata;
            best_msg_ts := cur_ts; best_msg_id := cur_id; best_valid := cur_valid;
          ELSIF cur_ts = best_msg_ts AND cur_id::TEXT > best_msg_id::TEXT THEN
            best_id := r.id;
            best_key := r.key; best_value := r.value; best_importance := r.importance;
            best_confidence := r.confidence; best_emotional_weight := r.emotional_weight;
            best_memory_type := r.memory_type; best_source_message := r.source_message;
            best_source_message_id := r.source_message_id::TEXT; best_source_authority := r.source_authority;
            best_protection_source := r.protection_source; best_is_protected := r.is_protected;
            best_source_references := r.source_references; best_compression_status := r.compression_status;
            best_valid_from := r.valid_from; best_valid_until := r.valid_until;
            best_temporal_precision := r.temporal_precision; best_temporal_metadata := r.temporal_metadata;
            best_msg_ts := cur_ts; best_msg_id := cur_id; best_valid := cur_valid;
          END IF;
        ELSE
          IF r.id::TEXT > best_id::TEXT THEN
            best_id := r.id;
            best_key := r.key; best_value := r.value; best_importance := r.importance;
            best_confidence := r.confidence; best_emotional_weight := r.emotional_weight;
            best_memory_type := r.memory_type; best_source_message := r.source_message;
            best_source_message_id := r.source_message_id::TEXT; best_source_authority := r.source_authority;
            best_protection_source := r.protection_source; best_is_protected := r.is_protected;
            best_source_references := r.source_references; best_compression_status := r.compression_status;
            best_valid_from := r.valid_from; best_valid_until := r.valid_until;
            best_temporal_precision := r.temporal_precision; best_temporal_metadata := r.temporal_metadata;
            best_msg_ts := cur_ts; best_msg_id := cur_id; best_valid := cur_valid;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  IF best_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'NOT_FOUND', 'detail', 'no pending aliases for canonical');
  END IF;

  IF v_canonical_id IS NOT NULL THEN
    BEGIN
      SELECT ch.created_at, ch.id, ch.role, ch.user_id
        INTO v_canonical_msg_ts, v_canonical_msg_id, v_canonical_role, v_canonical_user_id
      FROM chat_history ch
      WHERE ch.id = v_canonical_source_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_canonical_msg_ts := NULL; v_canonical_msg_id := NULL; v_canonical_role := NULL; v_canonical_user_id := NULL;
    END;
    IF v_canonical_msg_ts IS NOT NULL AND v_canonical_msg_id IS NOT NULL AND v_canonical_role = 'user' AND v_canonical_user_id = p_user_id THEN
      canon_valid := true;
    ELSE
      canon_valid := false;
    END IF;
  END IF;

  IF v_canonical_id IS NOT NULL THEN
    DECLARE
      should_replace BOOLEAN := false;
    BEGIN
      IF best_valid AND NOT canon_valid THEN
        should_replace := true;
      ELSIF best_valid AND canon_valid THEN
        IF best_msg_ts > v_canonical_msg_ts THEN
          should_replace := true;
        ELSIF best_msg_ts = v_canonical_msg_ts AND best_msg_id::TEXT > v_canonical_msg_id::TEXT THEN
          should_replace := true;
        END IF;
      END IF;

      IF should_replace THEN
        BEGIN
          INSERT INTO memories (
            user_id, key, value, memory_type, is_archived,
            importance, confidence, emotional_weight, source_message, source_message_id, source_authority,
            lifecycle_state, is_protected, protection_source, protected_at,
            source_references, compression_status,
            valid_from, valid_until, temporal_precision, temporal_metadata
          ) VALUES (
            p_user_id, p_canonical_key, best_value, best_memory_type, false,
            best_importance, best_confidence, best_emotional_weight,
            best_source_message, best_source_message_id::UUID, best_source_authority,
            'CURRENT', best_is_protected, best_protection_source, CASE WHEN best_is_protected THEN NOW() ELSE NULL END,
            best_source_references, best_compression_status,
            best_valid_from, best_valid_until, best_temporal_precision, best_temporal_metadata
          ) RETURNING id INTO v_new_id;
        EXCEPTION WHEN unique_violation THEN
          SELECT id INTO v_new_id FROM memories WHERE user_id=p_user_id AND key=p_canonical_key AND is_archived=false AND (lifecycle_state='CURRENT' OR NULL) LIMIT 1;
          UPDATE memories SET is_archived=true, lifecycle_state='SUPERSEDED', superseded_at=NOW(), supersession_reason=p_reason, superseded_by=v_new_id, updated_at=NOW()
          WHERE id = ANY(pending_ids);
          RETURN jsonb_build_object('success', true, 'action', 'archived_alias', 'canonical_id', v_new_id, 'detail', 'race_recovered_replace');
        END;

        UPDATE memories SET is_archived=true, lifecycle_state='SUPERSEDED', superseded_at=NOW(), supersession_reason=p_reason, superseded_by=v_new_id, updated_at=NOW()
        WHERE id = v_canonical_id;

        UPDATE memories SET is_archived=true, lifecycle_state='SUPERSEDED', superseded_at=NOW(), supersession_reason=p_reason, superseded_by=v_new_id, updated_at=NOW()
        WHERE id = ANY(pending_ids);

        RETURN jsonb_build_object('success', true, 'action', 'replaced_canonical', 'canonical_id', v_new_id, 'old_canonical_id', v_canonical_id, 'winner_alias_id', best_id);
      ELSE
        UPDATE memories SET is_archived=true, lifecycle_state='SUPERSEDED', superseded_at=NOW(), supersession_reason=p_reason, superseded_by=v_canonical_id, updated_at=NOW()
        WHERE id = ANY(pending_ids);

        RETURN jsonb_build_object('success', true, 'action', 'archived_alias', 'canonical_id', v_canonical_id);
      END IF;
    END;
  ELSE
    BEGIN
      INSERT INTO memories (
        user_id, key, value, memory_type, is_archived,
        importance, confidence, emotional_weight, source_message, source_message_id, source_authority,
        lifecycle_state, is_protected, protection_source, protected_at,
        source_references, compression_status,
        valid_from, valid_until, temporal_precision, temporal_metadata
      ) VALUES (
        p_user_id, p_canonical_key, best_value, best_memory_type, false,
        best_importance, best_confidence, best_emotional_weight,
        best_source_message, best_source_message_id::UUID, best_source_authority,
        'CURRENT', best_is_protected, best_protection_source, CASE WHEN best_is_protected THEN NOW() ELSE NULL END,
        best_source_references, best_compression_status,
        best_valid_from, best_valid_until, best_temporal_precision, best_temporal_metadata
      ) RETURNING id INTO v_new_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_new_id FROM memories WHERE user_id=p_user_id AND key=p_canonical_key AND is_archived=false AND (lifecycle_state='CURRENT' OR NULL) LIMIT 1;
      UPDATE memories SET is_archived=true, lifecycle_state='SUPERSEDED', superseded_at=NOW(), supersession_reason=p_reason, superseded_by=v_new_id, updated_at=NOW()
      WHERE id = ANY(pending_ids);
      RETURN jsonb_build_object('success', true, 'action', 'archived_alias', 'canonical_id', v_new_id, 'detail', 'race_recovered_create');
    END;

    UPDATE memories SET is_archived=true, lifecycle_state='SUPERSEDED', superseded_at=NOW(), supersession_reason=p_reason, superseded_by=v_new_id, updated_at=NOW()
    WHERE id = ANY(pending_ids);

    RETURN jsonb_build_object('success', true, 'action', 'created_canonical', 'canonical_id', v_new_id, 'winner_alias_id', best_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
