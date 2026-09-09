-- ─────────────────────────────────────────────────────────────────────────────
-- HUMAN OS — MIGRATION 066: Expand Canonical Keys Schema
--
-- Expands canonical keys and aliases in PostgreSQL to include:
--  1. Onboarding domains: passions, goals, family_details, important_facts, work_schedule
--  2. Child age tracking: son_age, daughter_age
--  3. Preserves all existing canonical keys and alias mappings.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Authoritative canonical membership set ────────────────────────────────
CREATE OR REPLACE FUNCTION is_canonical_key_sql(key TEXT) RETURNS BOOLEAN AS $$
DECLARE
  lk TEXT := lower(trim(regexp_replace(COALESCE(key,''), '['']', '', 'g')));
BEGIN
  RETURN lk IN (
    'mother_name','mother_nickname',
    'father_name','father_nickname',
    'wife_name','wife_nickname',
    'husband_name','husband_nickname',
    'son_name','son_nickname','son_age',
    'daughter_name','daughter_nickname','daughter_age',
    'sister_name','sister_nickname',
    'brother_name','brother_nickname',
    'company_name',
    'birth_date',
    'marriage_date',
    'preferred_name',
    'preferred_work_hours',
    'favourite_color','favourite_beverage','favourite_street_food',
    'passions',
    'goals',
    'family_details',
    'important_facts',
    'work_schedule'
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 2. Canonical key resolution / normalization helper ────────────────────────
CREATE OR REPLACE FUNCTION canonicalize_key_sql(raw_key TEXT) RETURNS TEXT AS $$
DECLARE
  lk TEXT := lower(regexp_replace(COALESCE(raw_key, ''), '['']', '', 'g'));
BEGIN
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

    -- Wife
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

    -- Son
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
    WHEN 'sons_age' THEN RETURN 'son_age';
    WHEN 'beta_age' THEN RETURN 'son_age';
    WHEN 'bete_ki_umar' THEN RETURN 'son_age';
    WHEN 'bete_ki_age' THEN RETURN 'son_age';
    WHEN 'child_age' THEN RETURN 'son_age';

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

    -- Company
    WHEN 'business_name' THEN RETURN 'company_name';
    WHEN 'company' THEN RETURN 'company_name';
    WHEN 'business' THEN RETURN 'company_name';
    WHEN 'startup_name' THEN RETURN 'company_name';
    WHEN 'firm_name' THEN RETURN 'company_name';
    WHEN 'office_name' THEN RETURN 'company_name';
    WHEN 'workplace_name' THEN RETURN 'company_name';

    -- Dates
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

    -- Preferred name
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

    -- Preferred work hours
    WHEN 'prefer_work_hours' THEN RETURN 'preferred_work_hours';
    WHEN 'prefer_morning_work' THEN RETURN 'preferred_work_hours';
    WHEN 'prefer_evening_work' THEN RETURN 'preferred_work_hours';
    WHEN 'work_hours_preference' THEN RETURN 'preferred_work_hours';
    WHEN 'working_hours_preference' THEN RETURN 'preferred_work_hours';
    WHEN 'preferred_working_hours' THEN RETURN 'preferred_work_hours';

    -- Favourites
    WHEN 'favorite_color' THEN RETURN 'favourite_color';
    WHEN 'favorite_colour' THEN RETURN 'favourite_color';
    WHEN 'fav_color' THEN RETURN 'favourite_color';
    WHEN 'favourite_colour' THEN RETURN 'favourite_color';
    WHEN 'favorite_beverage' THEN RETURN 'favourite_beverage';
    WHEN 'favorite_drink' THEN RETURN 'favourite_beverage';
    WHEN 'favourite_drink' THEN RETURN 'favourite_beverage';
    WHEN 'favorite_street_food' THEN RETURN 'favourite_street_food';
    WHEN 'favourite_food' THEN RETURN 'favourite_street_food';

    -- Passions / Hobbies
    WHEN 'passion' THEN RETURN 'passions';
    WHEN 'hobbies' THEN RETURN 'passions';
    WHEN 'hobby' THEN RETURN 'passions';
    WHEN 'interests' THEN RETURN 'passions';
    WHEN 'interest' THEN RETURN 'passions';
    WHEN 'shauk' THEN RETURN 'passions';
    WHEN 'user_passions' THEN RETURN 'passions';

    -- Goals
    WHEN 'goal' THEN RETURN 'goals';
    WHEN 'primary_goal' THEN RETURN 'goals';
    WHEN 'life_goal' THEN RETURN 'goals';
    WHEN 'main_goal' THEN RETURN 'goals';
    WHEN 'career_goal' THEN RETURN 'goals';
    WHEN 'lakshya' THEN RETURN 'goals';
    WHEN 'user_goals' THEN RETURN 'goals';

    -- Family details
    WHEN 'family' THEN RETURN 'family_details';
    WHEN 'family_and_relationships' THEN RETURN 'family_details';
    WHEN 'family_members' THEN RETURN 'family_details';
    WHEN 'family_facts' THEN RETURN 'family_details';
    WHEN 'ghar_ke_log' THEN RETURN 'family_details';
    WHEN 'parivaar' THEN RETURN 'family_details';

    -- Important facts
    WHEN 'important_life_facts' THEN RETURN 'important_facts';
    WHEN 'life_facts' THEN RETURN 'important_facts';
    WHEN 'key_facts' THEN RETURN 'important_facts';
    WHEN 'health_facts' THEN RETURN 'important_facts';
    WHEN 'critical_facts' THEN RETURN 'important_facts';

    -- Work schedule
    WHEN 'office_hours' THEN RETURN 'work_schedule';
    WHEN 'office_days' THEN RETURN 'work_schedule';
    WHEN 'working_schedule' THEN RETURN 'work_schedule';
    WHEN 'work_timing' THEN RETURN 'work_schedule';
    WHEN 'work_hours' THEN RETURN 'work_schedule';

    -- Direct Canonical Self-Mapping
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
    WHEN 'son_age' THEN RETURN 'son_age';
    WHEN 'daughter_name' THEN RETURN 'daughter_name';
    WHEN 'daughter_nickname' THEN RETURN 'daughter_nickname';
    WHEN 'daughter_age' THEN RETURN 'daughter_age';
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
    WHEN 'passions' THEN RETURN 'passions';
    WHEN 'goals' THEN RETURN 'goals';
    WHEN 'family_details' THEN RETURN 'family_details';
    WHEN 'important_facts' THEN RETURN 'important_facts';
    WHEN 'work_schedule' THEN RETURN 'work_schedule';

    ELSE RETURN lk;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

NOTIFY pgrst, 'reload schema';
