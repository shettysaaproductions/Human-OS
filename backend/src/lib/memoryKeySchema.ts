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
    'mother', 'mummy_name', 'mata_name', 'maa_ka_naam', 'mother_real_name',
  ],
  mother_nickname: [
    'mothers_nickname', 'mom_nickname', 'moms_nickname', 'maa_ka_nickname', 'mummy_ka_nickname',
    'mother_nick_name', 'mom_nick_name',
  ],
  // ── Family: father ──────────────────────────────────────────────────────────
  father_name: [
    'fathers_name', 'dads_name', 'dad_name', 'papa_name', 'pita_name',
    'dad', 'father', 'papa', 'baap_name', 'father_real_name',
  ],
  father_nickname: [
    'fathers_nickname', 'dad_nickname', 'dads_nickname', 'papa_ka_nickname',
    'father_nick_name', 'dad_nick_name',
  ],
  // ── Family: wife ────────────────────────────────────────────────────────────
  wife_name: [
    'wives_name', 'wife', 'biwi', 'patni', 'biwi_name', 'patni_name',
    'spouse_name', 'wife_real_name',
  ],
  wife_nickname: [
    'wives_nickname', 'wife_nick_name', 'biwi_ka_nickname', 'patni_ka_nickname',
    'spouse_nickname',
  ],
  // ── Family: husband ─────────────────────────────────────────────────────────
  husband_name: [
    'husbands_name', 'husband', 'pati', 'shauhar', 'pati_name', 'shauhar_name',
    'husband_real_name',
  ],
  husband_nickname: [
    'husbands_nickname', 'husband_nick_name', 'pati_ka_nickname', 'shauhar_ka_nickname',
  ],
  // ── Family: son ─────────────────────────────────────────────────────────────
  son_name: [
    'sons_name', 'son', 'beta', 'beta_name', 'bete_ka_naam', 'son_real_name',
    'child_name',  // only when context indicates male child
  ],
  son_nickname: [
    'sons_nickname', 'son_nick_name', 'bete_ka_nickname', 'bete_ka_pyar_ka_naam',
    'child_nickname', 'child_nick_name',
  ],
  // ── Family: daughter ────────────────────────────────────────────────────────
  daughter_name: [
    'daughters_name', 'daughter', 'beti', 'beti_name', 'daughter_real_name',
  ],
  daughter_nickname: [
    'daughters_nickname', 'daughter_nick_name', 'beti_ka_nickname', 'beti_ka_pyar_ka_naam',
  ],
  // ── Family: sister ──────────────────────────────────────────────────────────
  sister_name: [
    'sisters_name', 'sister', 'behen', 'behen_name', 'didi_name', 'sister_real_name',
  ],
  sister_nickname: [
    'sisters_nickname', 'sister_nick_name', 'behen_ka_nickname', 'didi_ka_nickname',
  ],
  // ── Family: brother ─────────────────────────────────────────────────────────
  brother_name: [
    'brothers_name', 'bhai_name',
    // NOTE: bare 'brother' and 'bhai' are NOT added here —
    // they are separately blocked as vocative values in the agent filter.
    // But if LLM emits key='brother' or key='bhai' with a proper-name value,
    // we canonicalize the key but still validate the value separately.
    'brother', 'bhai', 'brother_real_name',
  ],
  brother_nickname: [
    'brothers_nickname', 'brother_nick_name', 'bhai_ka_nickname', 'bhaiya_ka_nickname',
  ],
  // ── Work: company ───────────────────────────────────────────────────────────
  company_name: [
    'business_name', 'company', 'business', 'startup_name', 'firm_name',
    'office_name', 'workplace_name',
  ],
  // ── Dates: birthday ─────────────────────────────────────────────────────────
  birth_date: [
    'birthday', 'date_of_birth', 'dob', 'bday', 'janam_din',
    'child_birthdate',  // generic child birthdate — we preserve the value
  ],
  // ── Dates: marriage ─────────────────────────────────────────────────────────
  marriage_date: [
    'wedding_date', 'anniversary', 'anniversary_date', 'shadi_date',
    'vivah_date',
  ],
  // ── User: preferred name ────────────────────────────────────────────────────
  preferred_name: [
    'name', 'user_name', 'my_name', 'users_name',
    // NOTE: bare 'name' is an LLM-common alias that often conflicts with
    // other entities. It's listed here so it's normalized, but the value
    // validation layer will still reject non-name values.
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
 *
 * This function is DETERMINISTIC and has no side effects.
 */
export function canonicalizeKey(rawKey: string): { canonical: string; wasAliased: boolean } {
  const lower = rawKey.toLowerCase().trim();
  const canonical = ALIAS_TO_CANONICAL.get(lower);

  if (canonical) {
    return {
      canonical,
      wasAliased: canonical !== lower,
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
 * Export the raw alias map for tests and the reconciliation script.
 */
export { CANONICAL_ALIAS_MAP };
