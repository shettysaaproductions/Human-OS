/**
 * memoryKeySchema.ts — Canonical Memory Key Map
 *
 * This is the SINGLE authoritative definition of canonical memory keys and
 * their known aliases. Any LLM-generated key that matches an alias is
 * silently normalized to the canonical key BEFORE the authority check or DB
 * read/write.
 *
 * Rules:
 *  - Canonical keys are the ONLY keys that may exist in the memories table.
 *  - Aliases are exact-match patterns derived from observed LLM output.
 *  - Unknown keys (no alias match) are accepted only if they are valid
 *    snake_case and don't look like a malformed alias of a known concept.
 *  - NEVER use this module to blindly singularize/pluralize arbitrary keys.
 */

// ── Canonical key → list of known aliases ─────────────────────────────────────
// Aliases must be lowercase exact strings (after the incoming key is lowercased).
const CANONICAL_ALIAS_MAP: Record<string, string[]> = {
  // ── Family: mother ──────────────────────────────────────────────────────────
  mother_name: [
    'mothers_name', 'moms_name', 'mom_name', 'maa_name', 'maa', 'mom',
    'mother', 'mummy_name', 'mata_name', 'maa_ka_naam', 'mummy_ka_naam', 'mom_ka_naam', 'mother_ka_naam', 'mother_real_name',
  ],
  mother_nickname: [
    'mothers_nickname', 'mom_nickname', 'moms_nickname', 'maa_ka_nickname', 'mummy_ka_nickname',
    'mother_nick_name', 'mom_nick_name',
  ],
  // ── Family: father ──────────────────────────────────────────────────────────
  father_name: [
    'fathers_name', 'dads_name', 'dad_name', 'papa_name', 'pita_name',
    'dad', 'father', 'papa', 'baap_name', 'papa_ka_naam', 'father_ka_naam', 'pita_ka_naam', 'father_real_name',
  ],
  father_nickname: [
    'fathers_nickname', 'dad_nickname', 'dads_nickname', 'papa_ka_nickname',
    'father_nick_name', 'dad_nick_name',
  ],
  // ── Family: wife ────────────────────────────────────────────────────────────
  wife_name: [
    'wives_name', 'wife', 'biwi', 'patni', 'biwi_name', 'patni_name',
    'spouse_name', 'wife_real_name', 'sakshi', 'wife_sakshi', 'biwi_sakshi',
    'wife_ka_naam', 'biwi_ka_naam', 'patni_ka_naam',
  ],
  wife_nickname: [
    'wives_nickname', 'wife_nick_name', 'biwi_ka_nickname', 'patni_ka_nickname',
    'spouse_nickname',
  ],
  wife_nail_art_skill: [
    'wife_nail_art', 'nail_art', 'last_year_nail_art', 'self_taught_nail_art',
    'self_taught', 'beautiful_art', 'wife_art', 'wife_passion_nail_art',
    'purchased_nail_art_kit', 'learned_nail_art', 'enjoyed_nail_art',
  ],
  wife_cooking_skill: [
    'wife_cooking', 'likes_wifes_cooking', 'wifes_cooking', 'cooking_talent',
  ],
  // ── Family: husband ─────────────────────────────────────────────────────────
  husband_name: [
    'husbands_name', 'husband', 'pati', 'shauhar', 'pati_name', 'shauhar_name',
    'husband_ka_naam', 'pati_ka_naam', 'shauhar_ka_naam',
    'husband_real_name',
  ],
  husband_nickname: [
    'husbands_nickname', 'husband_nick_name', 'pati_ka_nickname', 'shauhar_ka_nickname',
  ],
  // ── Family: son ─────────────────────────────────────────────────────────────
  son_name: [
    'sons_name', 'son', 'beta', 'beta_name', 'bete_ka_naam', 'son_ka_naam', 'beta_ka_naam', 'son_real_name',
    'shreshth', 'shresth',
  ],
  son_nickname: [
    'sons_nickname', 'son_nick_name', 'bete_ka_nickname', 'bete_ka_pyar_ka_naam', 'bete_ka_nick_name',
    'tiku', 'tiku_nickname', 'son_tiku', 'tuku', 'tuku_nickname', 'son_tuku', 'shreshth_tuku', 'tuku_shreshth',
    'shreshth_nickname', 'shreshth_nick_name', 'son_shreshth_nickname', 'baby_nickname', 'child_nickname',
    'family_nickname',
  ],
  son_age: [
    'sons_age', 'beta_age', 'bete_ki_umar', 'bete_ki_age', 'child_age',
  ],
  // ── Family: daughter ────────────────────────────────────────────────────────
  daughter_name: [
    'daughters_name', 'daughter', 'beti', 'beti_name', 'daughter_ka_naam', 'beti_ka_naam', 'daughter_real_name',
  ],
  daughter_nickname: [
    'daughters_nickname', 'daughter_nick_name', 'beti_ka_nickname', 'beti_ka_pyar_ka_naam',
  ],
  daughter_age: [
    'daughters_age', 'beti_age', 'beti_ki_umar', 'beti_ki_age',
  ],
  // ── Family: sister ──────────────────────────────────────────────────────────
  sister_name: [
    'sisters_name', 'sister', 'behen', 'behen_name', 'didi_name', 'sister_ka_naam', 'behen_ka_naam', 'didi_ka_naam', 'sister_real_name',
  ],
  sister_nickname: [
    'sisters_nickname', 'sister_nick_name', 'behen_ka_nickname', 'didi_ka_nickname',
  ],
  // ── Family: brother ─────────────────────────────────────────────────────────
  brother_name: [
    'brothers_name', 'bhai_name',
    // Bare 'brother' / 'bhai' ARE canonicalized to brother_name for key
    // normalization, but the value layer still blocks generic vocatives.
    'brother', 'bhai', 'brother_ka_naam', 'bhai_ka_naam', 'bhaiya_ka_naam', 'brother_real_name',
  ],
  brother_nickname: [
    'brothers_nickname', 'brother_nick_name', 'bhai_ka_nickname', 'bhaiya_ka_nickname',
  ],
  // ── Work: company ───────────────────────────────────────────────────────────
  company_name: [
    'business_name', 'company', 'business', 'firm_name',
    'office_name', 'workplace_name', 'current_company',
  ],
  // ── Work: business venture ──────────────────────────────────────────────────
  venture_name: [
    'business_venture', 'cloud_kitchen_business', 'cloud_kitchen', 'food_venture',
    'side_venture', 'side_business', 'entrepreneurial_venture', 'dhaba_venture',
    'shettys_dhaba_venture'
  ],
  // ── Dates: birthday ─────────────────────────────────────────────────────────
  birth_date: [
    'birthday', 'date_of_birth', 'dob', 'bday', 'janam_din', 'user_birth_date', 'user_dob', 'my_birthday', 'my_dob',
    'user_date_of_birth', 'my_date_of_birth', 'users_date_of_birth', 'users_dob'
  ],
  wife_birth_date: [
    'wife_dob', 'wifes_birthday', 'wifes_birth_date', 'wife_birthday',
    'wifes_dob', 'sakshi_birthday', 'sakshi_dob', 'sakshi_birth_date',
    'biwi_ka_bday', 'wife_bday', 'wife_date_of_birth', 'wifes_date_of_birth', 'sakshi_date_of_birth'
  ],
  son_birth_date: [
    'son_dob', 'sons_birthday', 'sons_birth_date', 'son_birthday',
    'sons_dob', 'child_birth_date', 'child_dob', 'child_birthday', 'child_birthdate',
    'tiku_birthday', 'tiku_dob', 'tiku_birth_date',
    'tuku_birthday', 'tuku_dob', 'tuku_birth_date',
    'shreshth_birthday', 'shreshth_dob', 'shreshth_birth_date', 'shreshth_bday',
    'bete_ka_bday', 'bete_ka_birthday', 'bete_ki_date_of_birth', 'son_bday', 'son_date_of_birth',
    'shreshth_date_of_birth', 'shresth_date_of_birth', 'shresth_dob', 'shresth_birthday',
    'tiku_date_of_birth', 'tuku_date_of_birth', 'child_date_of_birth'
  ],
  daughter_birth_date: [
    'daughters_birth_date', 'daughter_dob', 'daughter_birthday', 'daughters_dob', 'daughters_birthday',
    'daughter_date_of_birth', 'beti_ka_bday', 'beti_ki_date_of_birth'
  ],
  // ── Family: occupations ──────────────────────────────────────────────────────
  father_occupation: [
    'fathers_occupation', 'dad_occupation', 'dads_occupation', 'papa_ka_kaam', 'father_profession', 'father_job', 'dads_job'
  ],
  mother_occupation: [
    'mothers_occupation', 'mom_occupation', 'moms_occupation', 'maa_ka_kaam', 'mother_profession', 'mother_job', 'moms_job'
  ],
  wife_occupation: [
    'wifes_occupation', 'wife_profession', 'wife_job', 'biwi_ka_kaam'
  ],
  husband_occupation: [
    'husbands_occupation', 'husband_profession', 'husband_job', 'pati_ka_kaam'
  ],
  brother_occupation: [
    'brothers_occupation', 'brother_profession', 'brother_job', 'bhai_ka_kaam'
  ],
  sister_occupation: [
    'sisters_occupation', 'sister_profession', 'sister_job', 'behen_ka_kaam'
  ],
  // ── Friends & Associates ────────────────────────────────────────────────────
  friend_name: [
    'friends_name', 'friend', 'dost_ka_naam', 'dost'
  ],
  // ── Dates: marriage ─────────────────────────────────────────────────────────
  marriage_date: [
    'wedding_date', 'anniversary', 'anniversary_date', 'shadi_date',
    'vivah_date',
  ],
  // ── User: preferred name ────────────────────────────────────────────────────
  preferred_name: [
    'name', 'user_name', 'my_name', 'users_name', 'full_name', 'user_full_name', 'my_full_name', 'mera_full_name', 'mera_naam', 'mera_pura_naam',
    // NOTE: bare 'name' is an LLM-common alias that often conflicts with
    // other entities. It's listed here so it's normalized, but the value
    // validation layer will still reject non-name values.
  ],
  // ── Work: preferences ───────────────────────────────────────────────────────
  preferred_work_hours: [
    'prefer_work_hours', 'prefer_morning_work', 'prefer_evening_work',
    'work_hours_preference', 'working_hours_preference', 'preferred_working_hours'
  ],
  // ── User: Favourites / Preferences ──────────────────────────────────────────
  favourite_color: [
    'favorite_color', 'favorite_colour', 'fav_color', 'favourite_colour'
  ],
  favourite_beverage: [
    'favorite_beverage', 'favorite_drink', 'favourite_drink'
  ],
  favourite_street_food: [
    'favorite_street_food', 'favourite_food'
  ],
  // ── Foundational Onboarding & Lifestyle Domains ─────────────────────────────
  passions: [
    'passion', 'hobbies', 'hobby', 'interests', 'interest', 'shauk', 'user_passions'
  ],
  goals: [
    'goal', 'primary_goal', 'life_goal', 'main_goal', 'career_goal', 'lakshya', 'user_goals'
  ],
  family_details: [
    'family', 'family_and_relationships', 'family_members', 'family_facts', 'ghar_ke_log', 'parivaar'
  ],
  important_facts: [
    'important_life_facts', 'life_facts', 'key_facts', 'health_facts', 'critical_facts'
  ],
  work_schedule: [
    'office_hours', 'office_days', 'working_schedule', 'work_timing', 'work_hours',
    'nai_morning_schedule', 'office_timing', 'office_timings', 'work_timings'
  ],
  // ── Lifestyle Diversity: Pets, Fitness, Wellness, Partner, Education ────────
  pet_name: [
    'pets_name', 'pet', 'dog_name', 'dogs_name', 'cat_name', 'cats_name',
    'pet_dog', 'pet_cat', 'mera_pet', 'pet_naam'
  ],
  partner_name: [
    'partners_name', 'partner', 'boyfriend_name', 'girlfriend_name',
    'significant_other', 'fiance_name', 'fiancee_name'
  ],
  workout_routine: [
    'gym_routine', 'fitness_routine', 'workout_plan', 'exercise_routine',
    'gym_schedule', 'fitness_schedule', 'kasrat_routine'
  ],
  diet_preference: [
    'diet', 'eating_habit', 'dietary_preference', 'food_preference',
    'diet_plan', 'vegetarian_status', 'diet_type'
  ],
  sleep_schedule: [
    'sleeping_hours', 'bedtime', 'sleep_routine', 'sleep_timing',
    'wake_up_time', 'morning_routine', 'wake_up_routine'
  ],
  education_degree: [
    'college_name', 'university_name', 'school_name', 'degree',
    'course_name', 'study_subject', 'major_subject', 'education'
  ],
};

// ── Reverse lookup: alias → canonical key ─────────────────────────────────────
const ALIAS_TO_CANONICAL: Map<string, string> = new Map();

for (const [canonical, aliases] of Object.entries(CANONICAL_ALIAS_MAP)) {
  for (const alias of aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
  }
  // Also map the canonical key to itself (idempotent)
  ALIAS_TO_CANONICAL.set(canonical.toLowerCase(), canonical);
}

// Export the full set of canonical keys for validation
export const CANONICAL_KEYS: ReadonlySet<string> = new Set(Object.keys(CANONICAL_ALIAS_MAP));

/**
 * Normalize an incoming memory key to its canonical form.
 *
 * Guarantees:
 *  1. If the key is already canonical, it is returned unchanged.
 *  2. If the key is a known alias, the canonical key is returned.
 *  3. If the key is unknown (no alias), it is returned as-is after basic
 *     validation — allowing genuinely new concept keys to pass through.
 *  4. Apostrophes are stripped before processing.
 *
 * This function is DETERMINISTIC and has no side effects.
 */
export function canonicalizeKey(rawKey: string): { canonical: string; wasAliased: boolean } {
  // P0-2: Strip apostrophes and quotes BEFORE any processing
  // "brother's_name" -> "brothers_name" -> canonicalize -> "brother_name"
  const noApostrophes = rawKey.replace(/['']/g, '');

  const lower = noApostrophes.toLowerCase().trim();
  const canonical = ALIAS_TO_CANONICAL.get(lower);

  if (canonical) {
    return {
      canonical,
      wasAliased: canonical !== rawKey.toLowerCase().trim(),
    };
  }

  // Unknown key — return as-is (snake_case passthrough for genuinely new concepts)
  return {
    canonical: lower,
    wasAliased: false,
  };
}

/**
 * Return whether a given key is a known alias of some canonical concept.
 * Used during context retrieval to detect legacy alias rows.
 */
export function isAliasKey(key: string): boolean {
  const lower = key.toLowerCase().trim();
  const canonical = ALIAS_TO_CANONICAL.get(lower);
  return canonical !== undefined && canonical !== lower;
}

/**
 * Return whether two keys refer to the same canonical semantic concept.
 * Used in CognitiveContextService to detect cross-alias conflicts.
 */
export function sameCanonicalConcept(keyA: string, keyB: string): boolean {
  const a = ALIAS_TO_CANONICAL.get(keyA.toLowerCase().trim()) ?? keyA.toLowerCase().trim();
  const b = ALIAS_TO_CANONICAL.get(keyB.toLowerCase().trim()) ?? keyB.toLowerCase().trim();
  return a === b;
}

/**
 * Return whether a canonical key is explicitly defined in our map,
 * or is a valid entity-scoped canonical key (e.g. entity:person_ejaz_father:military_service).
 */
export function isKnownCanonicalKey(canonicalKey: string): boolean {
  if (CANONICAL_KEYS.has(canonicalKey)) return true;
  // Entity-scoped canonical keys: entity:<subject_id>:<predicate>
  if (/^entity:[a-z0-9_]+:[a-z0-9_]+$/i.test(canonicalKey)) return true;
  return false;
}

/**
 * Export the raw alias map for tests and the reconciliation script.
 */
export { CANONICAL_ALIAS_MAP };
