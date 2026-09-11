-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 067: Entity-Scoped Memories & Semantic Correction Ledger
--
-- 1. Updates `is_canonical_key_sql` and `canonicalize_key_sql` to:
--    - Permit entity-scoped canonical keys: `entity:<subject_id>:<predicate>`
--    - Support family occupations and friend names (father_occupation, wife_occupation, etc.)
--    - Correct `child_birthdate` mapping to `son_birth_date` (never `birth_date`)
-- 2. Creates `nova_correction_ledger` to record first-class semantic corrections,
--    enabling durable provenance, entity repair, and graph synchronization.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Authoritative canonical membership set ────────────────────────────────
CREATE OR REPLACE FUNCTION is_canonical_key_sql(key TEXT) RETURNS BOOLEAN AS $$
DECLARE
  lk TEXT := lower(trim(regexp_replace(COALESCE(key,''), '['']', '', 'g')));
BEGIN
  -- Entity-scoped keys: entity:<subject_id>:<predicate>
  IF lk ~ '^entity:[a-z0-9_]+:[a-z0-9_]+$' THEN
    RETURN TRUE;
  END IF;

  RETURN lk IN (
    'mother_name','mother_nickname','mother_occupation',
    'father_name','father_nickname','father_occupation',
    'wife_name','wife_nickname','wife_occupation','wife_cooking_skill','wife_nail_art_skill',
    'husband_name','husband_nickname','husband_occupation',
    'son_name','son_nickname','son_age','son_birth_date',
    'daughter_name','daughter_nickname','daughter_age',
    'sister_name','sister_nickname','sister_occupation',
    'brother_name','brother_nickname','brother_occupation',
    'friend_name',
    'company_name','venture_name',
    'birth_date','wife_birth_date',
    'marriage_date',
    'preferred_name',
    'preferred_work_hours',
    'favourite_color','favourite_beverage','favourite_street_food',
    'passions',
    'goals',
    'family_details',
    'important_facts',
    'work_schedule',
    'pet_name','partner_name','workout_routine','diet_preference','sleep_schedule','education_degree'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 2. Canonical key resolution / normalization helper ────────────────────────
CREATE OR REPLACE FUNCTION canonicalize_key_sql(raw_key TEXT) RETURNS TEXT AS $$
DECLARE
  lk TEXT := lower(regexp_replace(COALESCE(raw_key, ''), '['']', '', 'g'));
BEGIN
  -- Entity-scoped keys pass through as canonical
  IF lk ~ '^entity:[a-z0-9_]+:[a-z0-9_]+$' THEN
    RETURN lk;
  END IF;

  CASE lk
    -- Mother
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
    WHEN 'mothers_occupation' THEN RETURN 'mother_occupation';
    WHEN 'mom_occupation' THEN RETURN 'mother_occupation';
    WHEN 'moms_occupation' THEN RETURN 'mother_occupation';
    WHEN 'maa_ka_kaam' THEN RETURN 'mother_occupation';
    WHEN 'mother_profession' THEN RETURN 'mother_occupation';
    WHEN 'mother_job' THEN RETURN 'mother_occupation';
    WHEN 'moms_job' THEN RETURN 'mother_occupation';

    -- Father
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
    WHEN 'fathers_occupation' THEN RETURN 'father_occupation';
    WHEN 'dad_occupation' THEN RETURN 'father_occupation';
    WHEN 'dads_occupation' THEN RETURN 'father_occupation';
    WHEN 'papa_ka_kaam' THEN RETURN 'father_occupation';
    WHEN 'father_profession' THEN RETURN 'father_occupation';
    WHEN 'father_job' THEN RETURN 'father_occupation';
    WHEN 'dads_job' THEN RETURN 'father_occupation';

    -- Wife
    WHEN 'wives_name' THEN RETURN 'wife_name';
    WHEN 'wife' THEN RETURN 'wife_name';
    WHEN 'biwi' THEN RETURN 'wife_name';
    WHEN 'patni' THEN RETURN 'wife_name';
    WHEN 'biwi_name' THEN RETURN 'wife_name';
    WHEN 'patni_name' THEN RETURN 'wife_name';
    WHEN 'spouse_name' THEN RETURN 'wife_name';
    WHEN 'wife_real_name' THEN RETURN 'wife_name';
    WHEN 'sakshi' THEN RETURN 'wife_name';
    WHEN 'wife_sakshi' THEN RETURN 'wife_name';
    WHEN 'biwi_sakshi' THEN RETURN 'wife_name';
    WHEN 'wives_nickname' THEN RETURN 'wife_nickname';
    WHEN 'wife_nick_name' THEN RETURN 'wife_nickname';
    WHEN 'biwi_ka_nickname' THEN RETURN 'wife_nickname';
    WHEN 'patni_ka_nickname' THEN RETURN 'wife_nickname';
    WHEN 'spouse_nickname' THEN RETURN 'wife_nickname';
    WHEN 'wifes_occupation' THEN RETURN 'wife_occupation';
    WHEN 'wife_profession' THEN RETURN 'wife_occupation';
    WHEN 'wife_job' THEN RETURN 'wife_occupation';
    WHEN 'biwi_ka_kaam' THEN RETURN 'wife_occupation';
    WHEN 'wife_nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'last_year_nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'self_taught_nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'self_taught' THEN RETURN 'wife_nail_art_skill';
    WHEN 'beautiful_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'wife_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'wife_passion_nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'purchased_nail_art_kit' THEN RETURN 'wife_nail_art_skill';
    WHEN 'learned_nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'enjoyed_nail_art' THEN RETURN 'wife_nail_art_skill';
    WHEN 'wife_cooking' THEN RETURN 'wife_cooking_skill';
    WHEN 'likes_wifes_cooking' THEN RETURN 'wife_cooking_skill';
    WHEN 'wifes_cooking' THEN RETURN 'wife_cooking_skill';
    WHEN 'cooking_talent' THEN RETURN 'wife_cooking_skill';

    -- Husband
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
    WHEN 'husbands_occupation' THEN RETURN 'husband_occupation';
    WHEN 'husband_profession' THEN RETURN 'husband_occupation';
    WHEN 'husband_job' THEN RETURN 'husband_occupation';
    WHEN 'pati_ka_kaam' THEN RETURN 'husband_occupation';

    -- Son
    WHEN 'sons_name' THEN RETURN 'son_name';
    WHEN 'son' THEN RETURN 'son_name';
    WHEN 'beta' THEN RETURN 'son_name';
    WHEN 'beta_name' THEN RETURN 'son_name';
    WHEN 'bete_ka_naam' THEN RETURN 'son_name';
    WHEN 'son_real_name' THEN RETURN 'son_name';
    WHEN 'shreshth' THEN RETURN 'son_name';
    WHEN 'shresth' THEN RETURN 'son_name';
    WHEN 'sons_nickname' THEN RETURN 'son_nickname';
    WHEN 'son_nick_name' THEN RETURN 'son_nickname';
    WHEN 'bete_ka_nickname' THEN RETURN 'son_nickname';
    WHEN 'bete_ka_pyar_ka_naam' THEN RETURN 'son_nickname';
    WHEN 'bete_ka_nick_name' THEN RETURN 'son_nickname';
    WHEN 'tiku' THEN RETURN 'son_nickname';
    WHEN 'tiku_nickname' THEN RETURN 'son_nickname';
    WHEN 'son_tiku' THEN RETURN 'son_nickname';
    WHEN 'tuku' THEN RETURN 'son_nickname';
    WHEN 'tuku_nickname' THEN RETURN 'son_nickname';
    WHEN 'son_tuku' THEN RETURN 'son_nickname';
    WHEN 'shreshth_tuku' THEN RETURN 'son_nickname';
    WHEN 'tuku_shreshth' THEN RETURN 'son_nickname';
    WHEN 'shreshth_nickname' THEN RETURN 'son_nickname';
    WHEN 'shreshth_nick_name' THEN RETURN 'son_nickname';
    WHEN 'son_shreshth_nickname' THEN RETURN 'son_nickname';
    WHEN 'baby_nickname' THEN RETURN 'son_nickname';
    WHEN 'child_nickname' THEN RETURN 'son_nickname';
    WHEN 'family_nickname' THEN RETURN 'son_nickname';
    WHEN 'sons_age' THEN RETURN 'son_age';
    WHEN 'beta_age' THEN RETURN 'son_age';
    WHEN 'bete_ki_umar' THEN RETURN 'son_age';
    WHEN 'bete_ki_age' THEN RETURN 'son_age';
    WHEN 'child_age' THEN RETURN 'son_age';
    WHEN 'son_dob' THEN RETURN 'son_birth_date';
    WHEN 'sons_birthday' THEN RETURN 'son_birth_date';
    WHEN 'sons_birth_date' THEN RETURN 'son_birth_date';
    WHEN 'son_birthday' THEN RETURN 'son_birth_date';
    WHEN 'sons_dob' THEN RETURN 'son_birth_date';
    WHEN 'child_birth_date' THEN RETURN 'son_birth_date';
    WHEN 'child_dob' THEN RETURN 'son_birth_date';
    WHEN 'child_birthday' THEN RETURN 'son_birth_date';
    WHEN 'child_birthdate' THEN RETURN 'son_birth_date';
    WHEN 'tiku_birthday' THEN RETURN 'son_birth_date';
    WHEN 'tiku_dob' THEN RETURN 'son_birth_date';
    WHEN 'tiku_birth_date' THEN RETURN 'son_birth_date';
    WHEN 'tuku_birthday' THEN RETURN 'son_birth_date';
    WHEN 'tuku_dob' THEN RETURN 'son_birth_date';
    WHEN 'tuku_birth_date' THEN RETURN 'son_birth_date';
    WHEN 'shreshth_birthday' THEN RETURN 'son_birth_date';
    WHEN 'shreshth_dob' THEN RETURN 'son_birth_date';
    WHEN 'shreshth_birth_date' THEN RETURN 'son_birth_date';
    WHEN 'shreshth_bday' THEN RETURN 'son_birth_date';
    WHEN 'bete_ka_bday' THEN RETURN 'son_birth_date';
    WHEN 'bete_ka_birthday' THEN RETURN 'son_birth_date';
    WHEN 'bete_ki_date_of_birth' THEN RETURN 'son_birth_date';
    WHEN 'son_bday' THEN RETURN 'son_birth_date';
    WHEN 'son_date_of_birth' THEN RETURN 'son_birth_date';

    -- Daughter
    WHEN 'daughters_name' THEN RETURN 'daughter_name';
    WHEN 'daughter' THEN RETURN 'daughter_name';
    WHEN 'beti' THEN RETURN 'daughter_name';
    WHEN 'beti_name' THEN RETURN 'daughter_name';
    WHEN 'daughter_real_name' THEN RETURN 'daughter_name';
    WHEN 'daughters_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'daughter_nick_name' THEN RETURN 'daughter_nickname';
    WHEN 'beti_ka_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'beti_ka_pyar_ka_naam' THEN RETURN 'daughter_nickname';
    WHEN 'daughters_age' THEN RETURN 'daughter_age';
    WHEN 'beti_age' THEN RETURN 'daughter_age';
    WHEN 'beti_ki_umar' THEN RETURN 'daughter_age';
    WHEN 'beti_ki_age' THEN RETURN 'daughter_age';

    -- Sister
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
    WHEN 'sisters_occupation' THEN RETURN 'sister_occupation';
    WHEN 'sister_profession' THEN RETURN 'sister_occupation';
    WHEN 'sister_job' THEN RETURN 'sister_occupation';
    WHEN 'behen_ka_kaam' THEN RETURN 'sister_occupation';

    -- Brother
    WHEN 'brothers_name' THEN RETURN 'brother_name';
    WHEN 'bhai_name' THEN RETURN 'brother_name';
    WHEN 'brother' THEN RETURN 'brother_name';
    WHEN 'bhai' THEN RETURN 'brother_name';
    WHEN 'brother_real_name' THEN RETURN 'brother_name';
    WHEN 'brothers_nickname' THEN RETURN 'brother_nickname';
    WHEN 'brother_nick_name' THEN RETURN 'brother_nickname';
    WHEN 'bhai_ka_nickname' THEN RETURN 'brother_nickname';
    WHEN 'bhaiya_ka_nickname' THEN RETURN 'brother_nickname';
    WHEN 'brothers_occupation' THEN RETURN 'brother_occupation';
    WHEN 'brother_profession' THEN RETURN 'brother_occupation';
    WHEN 'brother_job' THEN RETURN 'brother_occupation';
    WHEN 'bhai_ka_kaam' THEN RETURN 'brother_occupation';

    -- Friend
    WHEN 'friends_name' THEN RETURN 'friend_name';
    WHEN 'friend' THEN RETURN 'friend_name';
    WHEN 'dost_ka_naam' THEN RETURN 'friend_name';
    WHEN 'dost' THEN RETURN 'friend_name';

    -- Company & Venture
    WHEN 'business_name' THEN RETURN 'company_name';
    WHEN 'company' THEN RETURN 'company_name';
    WHEN 'business' THEN RETURN 'company_name';
    WHEN 'firm_name' THEN RETURN 'company_name';
    WHEN 'office_name' THEN RETURN 'company_name';
    WHEN 'workplace_name' THEN RETURN 'company_name';
    WHEN 'current_company' THEN RETURN 'company_name';
    WHEN 'business_venture' THEN RETURN 'venture_name';
    WHEN 'cloud_kitchen_business' THEN RETURN 'venture_name';
    WHEN 'cloud_kitchen' THEN RETURN 'venture_name';
    WHEN 'food_venture' THEN RETURN 'venture_name';
    WHEN 'side_venture' THEN RETURN 'venture_name';
    WHEN 'side_business' THEN RETURN 'venture_name';
    WHEN 'entrepreneurial_venture' THEN RETURN 'venture_name';
    WHEN 'dhaba_venture' THEN RETURN 'venture_name';
    WHEN 'shettys_dhaba_venture' THEN RETURN 'venture_name';

    -- Dates
    WHEN 'birthday' THEN RETURN 'birth_date';
    WHEN 'date_of_birth' THEN RETURN 'birth_date';
    WHEN 'dob' THEN RETURN 'birth_date';
    WHEN 'bday' THEN RETURN 'birth_date';
    WHEN 'janam_din' THEN RETURN 'birth_date';
    WHEN 'user_birth_date' THEN RETURN 'birth_date';
    WHEN 'user_dob' THEN RETURN 'birth_date';
    WHEN 'my_birthday' THEN RETURN 'birth_date';
    WHEN 'my_dob' THEN RETURN 'birth_date';

    WHEN 'wife_dob' THEN RETURN 'wife_birth_date';
    WHEN 'wifes_birthday' THEN RETURN 'wife_birth_date';
    WHEN 'wifes_birth_date' THEN RETURN 'wife_birth_date';
    WHEN 'wife_birthday' THEN RETURN 'wife_birth_date';
    WHEN 'wifes_dob' THEN RETURN 'wife_birth_date';
    WHEN 'sakshi_birthday' THEN RETURN 'wife_birth_date';
    WHEN 'sakshi_dob' THEN RETURN 'wife_birth_date';
    WHEN 'sakshi_birth_date' THEN RETURN 'wife_birth_date';
    WHEN 'biwi_ka_bday' THEN RETURN 'wife_birth_date';
    WHEN 'wife_bday' THEN RETURN 'wife_birth_date';

    WHEN 'wedding_date' THEN RETURN 'marriage_date';
    WHEN 'anniversary' THEN RETURN 'marriage_date';
    WHEN 'anniversary_date' THEN RETURN 'marriage_date';
    WHEN 'shadi_date' THEN RETURN 'marriage_date';
    WHEN 'vivah_date' THEN RETURN 'marriage_date';

    -- User preferred name
    WHEN 'name' THEN RETURN 'preferred_name';
    WHEN 'user_name' THEN RETURN 'preferred_name';
    WHEN 'my_name' THEN RETURN 'preferred_name';
    WHEN 'users_name' THEN RETURN 'preferred_name';
    WHEN 'full_name' THEN RETURN 'preferred_name';
    WHEN 'user_full_name' THEN RETURN 'preferred_name';
    WHEN 'my_full_name' THEN RETURN 'preferred_name';
    WHEN 'mera_full_name' THEN RETURN 'preferred_name';
    WHEN 'mera_naam' THEN RETURN 'preferred_name';
    WHEN 'mera_pura_naam' THEN RETURN 'preferred_name';

    -- Preferences
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

    -- Onboarding domains
    WHEN 'passion' THEN RETURN 'passions';
    WHEN 'hobbies' THEN RETURN 'passions';
    WHEN 'hobby' THEN RETURN 'passions';
    WHEN 'interests' THEN RETURN 'passions';
    WHEN 'interest' THEN RETURN 'passions';
    WHEN 'shauk' THEN RETURN 'passions';
    WHEN 'user_passions' THEN RETURN 'passions';

    WHEN 'goal' THEN RETURN 'goals';
    WHEN 'primary_goal' THEN RETURN 'goals';
    WHEN 'life_goal' THEN RETURN 'goals';
    WHEN 'main_goal' THEN RETURN 'goals';
    WHEN 'career_goal' THEN RETURN 'goals';
    WHEN 'lakshya' THEN RETURN 'goals';
    WHEN 'user_goals' THEN RETURN 'goals';

    WHEN 'family' THEN RETURN 'family_details';
    WHEN 'family_and_relationships' THEN RETURN 'family_details';
    WHEN 'family_members' THEN RETURN 'family_details';
    WHEN 'family_facts' THEN RETURN 'family_details';
    WHEN 'ghar_ke_log' THEN RETURN 'family_details';
    WHEN 'parivaar' THEN RETURN 'family_details';

    WHEN 'important_life_facts' THEN RETURN 'important_facts';
    WHEN 'life_facts' THEN RETURN 'important_facts';
    WHEN 'key_facts' THEN RETURN 'important_facts';
    WHEN 'health_facts' THEN RETURN 'important_facts';
    WHEN 'critical_facts' THEN RETURN 'important_facts';

    WHEN 'office_hours' THEN RETURN 'work_schedule';
    WHEN 'office_days' THEN RETURN 'work_schedule';
    WHEN 'working_schedule' THEN RETURN 'work_schedule';
    WHEN 'work_timing' THEN RETURN 'work_schedule';
    WHEN 'work_hours' THEN RETURN 'work_schedule';
    WHEN 'nai_morning_schedule' THEN RETURN 'work_schedule';
    WHEN 'office_timing' THEN RETURN 'work_schedule';
    WHEN 'office_timings' THEN RETURN 'work_schedule';
    WHEN 'work_timings' THEN RETURN 'work_schedule';

    -- Direct Canonical Self-Mapping
    WHEN 'mother_name' THEN RETURN 'mother_name';
    WHEN 'mother_nickname' THEN RETURN 'mother_nickname';
    WHEN 'mother_occupation' THEN RETURN 'mother_occupation';
    WHEN 'father_name' THEN RETURN 'father_name';
    WHEN 'father_nickname' THEN RETURN 'father_nickname';
    WHEN 'father_occupation' THEN RETURN 'father_occupation';
    WHEN 'wife_name' THEN RETURN 'wife_name';
    WHEN 'wife_nickname' THEN RETURN 'wife_nickname';
    WHEN 'wife_occupation' THEN RETURN 'wife_occupation';
    WHEN 'wife_nail_art_skill' THEN RETURN 'wife_nail_art_skill';
    WHEN 'wife_cooking_skill' THEN RETURN 'wife_cooking_skill';
    WHEN 'husband_name' THEN RETURN 'husband_name';
    WHEN 'husband_nickname' THEN RETURN 'husband_nickname';
    WHEN 'husband_occupation' THEN RETURN 'husband_occupation';
    WHEN 'son_name' THEN RETURN 'son_name';
    WHEN 'son_nickname' THEN RETURN 'son_nickname';
    WHEN 'son_age' THEN RETURN 'son_age';
    WHEN 'son_birth_date' THEN RETURN 'son_birth_date';
    WHEN 'daughter_name' THEN RETURN 'daughter_name';
    WHEN 'daughter_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'daughter_age' THEN RETURN 'daughter_age';
    WHEN 'sister_name' THEN RETURN 'sister_name';
    WHEN 'sister_nickname' THEN RETURN 'sister_nickname';
    WHEN 'sister_occupation' THEN RETURN 'sister_occupation';
    WHEN 'brother_name' THEN RETURN 'brother_name';
    WHEN 'brother_nickname' THEN RETURN 'brother_nickname';
    WHEN 'brother_occupation' THEN RETURN 'brother_occupation';
    WHEN 'friend_name' THEN RETURN 'friend_name';
    WHEN 'company_name' THEN RETURN 'company_name';
    WHEN 'venture_name' THEN RETURN 'venture_name';
    WHEN 'birth_date' THEN RETURN 'birth_date';
    WHEN 'wife_birth_date' THEN RETURN 'wife_birth_date';
    WHEN 'marriage_date' THEN RETURN 'marriage_date';
    WHEN 'preferred_name' THEN RETURN 'preferred_name';
    WHEN 'preferred_work_hours' THEN RETURN 'preferred_work_hours';
    WHEN 'favourite_color' THEN RETURN 'favourite_color';
    WHEN 'favourite_beverage' THEN RETURN 'favourite_beverage';
    WHEN 'favourite_street_food' THEN RETURN 'favourite_street_food';
    WHEN 'passions' THEN RETURN 'passions';
    WHEN 'goals' THEN RETURN 'goals';
    WHEN 'family_details' THEN RETURN 'family_details';
    WHEN 'important_facts' THEN RETURN 'important_facts';
    WHEN 'work_schedule' THEN RETURN 'work_schedule';
    WHEN 'pet_name' THEN RETURN 'pet_name';
    WHEN 'partner_name' THEN RETURN 'partner_name';
    WHEN 'workout_routine' THEN RETURN 'workout_routine';
    WHEN 'diet_preference' THEN RETURN 'diet_preference';
    WHEN 'sleep_schedule' THEN RETURN 'sleep_schedule';
    WHEN 'education_degree' THEN RETURN 'education_degree';

    ELSE RETURN lk;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 3. First-Class Semantic Correction & Repair Ledger ────────────────────────
CREATE TABLE IF NOT EXISTS public.nova_correction_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_message_id UUID,
  original_interpretation JSONB NOT NULL DEFAULT '{}'::jsonb,
  correct_interpretation JSONB NOT NULL DEFAULT '{}'::jsonb,
  affected_entity_id TEXT,
  affected_memory_ids UUID[] DEFAULT '{}',
  affected_graph_edges JSONB DEFAULT '[]'::jsonb,
  repair_status TEXT NOT NULL DEFAULT 'REPAIRED',
  reason TEXT,
  confidence NUMERIC DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nova_correction_ledger_user_id ON public.nova_correction_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_nova_correction_ledger_created_at ON public.nova_correction_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_nova_correction_ledger_entity ON public.nova_correction_ledger(user_id, affected_entity_id);

-- RLS for nova_correction_ledger
ALTER TABLE public.nova_correction_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own correction ledger entries"
  ON public.nova_correction_ledger
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass
CREATE POLICY "Service role full access on nova_correction_ledger"
  ON public.nova_correction_ledger
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
