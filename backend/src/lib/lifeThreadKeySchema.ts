/**
 * lifeThreadKeySchema.ts — Canonical LifeThread Identity Schema & Normalizer
 *
 * PHASE 1 / AMENDMENT 1: Real-World Objective & Ownership Invariance
 *
 * Principles:
 * 1. REAL-WORLD OBJECTIVE:
 *    Do NOT blindly strip sub-objective nouns. Distinguish:
 *    - "cloud kitchen"                -> "cloud_kitchen"
 *    - "cloud kitchen licence"        -> "cloud_kitchen_licence"
 *    - "cloud kitchen menu"           -> "cloud_kitchen_menu"
 *    - "cloud kitchen investor pitch" -> "cloud_kitchen_investor_pitch"
 *    - "cloud kitchen chef hiring"    -> "cloud_kitchen_hiring"
 *
 * 2. OWNERSHIP / ENTITY PRESERVATION:
 *    Distinguish between user's own goals vs third-party goals:
 *    - "my cloud kitchen"             -> "cloud_kitchen" (entity: self)
 *    - "friend's cloud kitchen"       -> "friend:cloud_kitchen" (entity: friend)
 *    - "client's cloud kitchen"       -> "client:cloud_kitchen" (entity: client)
 *    - "brother's cloud kitchen"      -> "brother:cloud_kitchen" (entity: brother)
 *
 * 3. FILLER & VARIANT NORMALIZATION:
 *    Normalize superficial variations that describe the SAME objective:
 *    - "Start cloud kitchen"          -> "cloud_kitchen"
 *    - "cloud kitchen project"        -> "cloud_kitchen"
 *    - "Introduce myself to team"     -> "introduce_myself"
 *    - "self introduction"            -> "introduce_myself"
 *    - "interview preparation"        -> "job_interview_prep"
 */

export interface CanonicalLifeThreadKeyResult {
  /** Canonical slug identifying the thread */
  canonicalKey: string;
  /** Extracted entity scope ('self', 'friend', 'client', 'brother', etc.) */
  entity: string;
  /** Clean human-readable display topic title */
  displayTopic: string;
  /** Sub-objective aspect if detected ('licence', 'menu', 'investor_pitch', etc.) */
  aspect?: string;
}

// ── Possessive Entity Qualifiers (Third-Party Ownership) ──────────────────────
const ENTITY_PATTERNS: Array<{ entity: string; regex: RegExp; stripRegex: RegExp }> = [
  {
    entity: 'friend',
    regex: /\b(friend(?:'s)?|dost(?:\s+ka|\s+ki|\s+ke)?|yaar(?:\s+ka|\s+ki)?)\b/i,
    stripRegex: /\b(friend(?:'?s)?|dost(?:\s+ka|\s+ki|\s+ke)?|yaar)\b/gi
  },
  {
    entity: 'client',
    regex: /\b(client(?:'s)?|customer(?:'s)?|grahak(?:\s+ka|\s+ki|\s+ke)?)\b/i,
    stripRegex: /\b(client(?:'?s)?|customer(?:'?s)?|grahak)\b/gi
  },
  {
    entity: 'brother',
    regex: /\b(brother(?:'s)?|bhai(?:\s+ka|\s+ki|\s+ke)?|bhaiya(?:\s+ka|\s+ki)?)\b/i,
    stripRegex: /\b(brother(?:'?s)?|bhai|bhaiya)\b/gi
  },
  {
    entity: 'sister',
    regex: /\b(sister(?:'s)?|behen(?:\s+ka|\s+ki|\s+ke)?|didi(?:\s+ka|\s+ki)?)\b/i,
    stripRegex: /\b(sister(?:'?s)?|behen|didi)\b/gi
  },
  {
    entity: 'wife',
    regex: /\b(wife(?:'s)?|biwi(?:\s+ka|\s+ki|\s+ke)?|patni(?:\s+ka|\s+ki)?)\b/i,
    stripRegex: /\b(wife(?:'?s)?|biwi|patni)\b/gi
  },
  {
    entity: 'husband',
    regex: /\b(husband(?:'s)?|pati(?:\s+ka|\s+ki|\s+ke)?)\b/i,
    stripRegex: /\b(husband(?:'?s)?|pati)\b/gi
  },
  {
    entity: 'father',
    regex: /\b(father(?:'s)?|dad(?:'s)?|papa(?:\s+ka|\s+ki|\s+ke)?)\b/i,
    stripRegex: /\b(father(?:'?s)?|dad|papa)\b/gi
  },
  {
    entity: 'mother',
    regex: /\b(mother(?:'s)?|mom(?:'s)?|maa(?:\s+ka|\s+ki|\s+ke)?|mummy(?:\s+ka|\s+ki)?)\b/i,
    stripRegex: /\b(mother(?:'?s)?|mom|maa|mummy)\b/gi
  },
];

// ── Sub-Objective Aspects (Must be PRESERVED to prevent false merge) ─────────
const ASPECT_PATTERNS: Array<{ aspect: string; regex: RegExp }> = [
  { aspect: 'licence', regex: /\b(licen[cs]e|fssai|gst|permit|registration|compliance)\b/gi },
  { aspect: 'menu', regex: /\b(menu|recipe|dishes|pricing|food\s+items?)\b/gi },
  { aspect: 'investor_pitch', regex: /\b(investor\s+pitch|pitch\s+deck|fundrais(?:ing|e)|funding|seed\s+round|investors?)\b/gi },
  { aspect: 'location', regex: /\b(location|property|rent|real\s+estate|site\s+selection|space)\b/gi },
  { aspect: 'hiring', regex: /\b(hiring|staff|chef|cook|employees?|recruitment|team\s+building)\b/gi },
  { aspect: 'marketing', regex: /\b(marketing|branding|social\s+media|ads|launch\s+campaign|promotion)\b/gi },
  { aspect: 'equipment', regex: /\b(equipment|kitchen\s+setup|machinery|appliances|hardware)\b/gi },
  { aspect: 'packaging', regex: /\b(packaging|boxes|delivery\s+materials?)\b/gi },
];

// ── Common Domain Canonical Aliases ───────────────────────────────────────────
const DOMAIN_CANONICAL_MAP: Record<string, string> = {
  'introduce_myself': 'introduce_myself',
  'introduce_myself_team': 'introduce_myself',
  'introduce_myself_to_team': 'introduce_myself',
  'introduce_team': 'introduce_myself',
  'introduction': 'introduce_myself',
  'self_introduction': 'introduce_myself',
  'job_interview_prep': 'job_interview_prep',
  'interview_preparation': 'job_interview_prep',
  'interview_prep': 'job_interview_prep',
  'job_interview': 'job_interview_prep',
  'interview': 'job_interview_prep',
};

// ── Conversational Action Fillers (Safe to strip when normalizing base concept) ─
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'my', 'mera', 'meri', 'mere', 'apna', 'apni', 'apne',
  'to', 'in', 'on', 'at', 'for', 'of', 'and', 'or', 'with', 'by',
  'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'hai', 'hain', 'tha', 'thi', 'the',
  'hu', 'hoon', 'main', 'hum', 'ek', 'toh', 'ab', 'bhi', 'kuch', 'yeh', 'woh',
  'final', 'finalise', 'finalize',
  'karna', 'karni', 'karne', 'karo', 'karein', 'karenge', 'karunga', 'karungi',
  'start', 'starting', 'shuru', 'shuruat', 'open', 'opening', 'kholna',
  'plan', 'planning', 'project', 'kam', 'kaam', 'setup', 'kar', 'raha', 'rahi', 'rahe',
  'preparation', 'prep', 'team', 'myself', 'self'
]);

/**
 * Normalizes a string into a clean snake_case slug
 */
function toSnakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Canonicalizes a topic string into a deterministic canonical key and structured metadata.
 */
export function canonicalizeLifeThreadKey(rawTopic: string, rawContext?: string): CanonicalLifeThreadKeyResult {
  const combined = `${rawTopic || ''} ${rawContext || ''}`.trim();
  let topicClean = (rawTopic || '').trim();

  // 1. Detect Entity (e.g. friend's, client's, brother's)
  let detectedEntity = 'self';
  let matchedEntityConfig: (typeof ENTITY_PATTERNS)[0] | undefined;

  for (const item of ENTITY_PATTERNS) {
    if (item.regex.test(combined)) {
      detectedEntity = item.entity;
      matchedEntityConfig = item;
      break;
    }
  }

  // 2. Strip entity word from topicClean if entity was detected
  if (matchedEntityConfig) {
    topicClean = topicClean.replace(matchedEntityConfig.stripRegex, ' ');
  }

  // 3. Detect Aspect (Sub-Objective)
  let detectedAspect: string | undefined;
  for (const { aspect, regex } of ASPECT_PATTERNS) {
    if (regex.test(topicClean) || (rawContext && regex.test(rawContext) && !regex.test(topicClean))) {
      detectedAspect = aspect;
      // Strip all matching aspect keywords from topicClean so they don't duplicate
      topicClean = topicClean.replace(regex, ' ');
      break;
    }
  }

  // 4. Tokenize and extract meaningful words
  const rawSnake = toSnakeCase(rawTopic || '');
  if (DOMAIN_CANONICAL_MAP[rawSnake]) {
    const canonicalKey = detectedEntity !== 'self'
      ? `${detectedEntity}:${DOMAIN_CANONICAL_MAP[rawSnake]}`
      : DOMAIN_CANONICAL_MAP[rawSnake];

    return {
      canonicalKey,
      entity: detectedEntity,
      displayTopic: (rawTopic || '').trim(),
      aspect: detectedAspect,
    };
  }

  const words = topicClean
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const meaningfulWords = words.filter(w => !FILLER_WORDS.has(w));

  let baseSlug = meaningfulWords.length > 0
    ? meaningfulWords.join('_')
    : toSnakeCase(topicClean);

  if (!baseSlug) {
    baseSlug = detectedAspect ? 'general' : 'general_goal';
  }

  // Check Domain Canonical Map
  if (DOMAIN_CANONICAL_MAP[baseSlug]) {
    baseSlug = DOMAIN_CANONICAL_MAP[baseSlug];
  }

  // 5. Append Aspect if detected
  if (detectedAspect) {
    baseSlug = baseSlug === 'general' ? detectedAspect : `${baseSlug}_${detectedAspect}`;
  }

  baseSlug = toSnakeCase(baseSlug);

  // Check Domain Canonical Map again on full slug
  if (DOMAIN_CANONICAL_MAP[baseSlug]) {
    baseSlug = DOMAIN_CANONICAL_MAP[baseSlug];
  }

  // 6. Construct full canonical key
  const canonicalKey = detectedEntity !== 'self'
    ? `${detectedEntity}:${baseSlug}`
    : baseSlug;

  const displayTopic = (rawTopic || '').trim() || baseSlug.replace(/_/g, ' ');

  return {
    canonicalKey,
    entity: detectedEntity,
    displayTopic,
    aspect: detectedAspect,
  };
}

/**
 * Checks if two raw topic strings represent the same canonical LifeThread objective.
 */
export function isSameCanonicalThread(topicA: string, topicB: string, contextA?: string, contextB?: string): boolean {
  const keyA = canonicalizeLifeThreadKey(topicA, contextA).canonicalKey;
  const keyB = canonicalizeLifeThreadKey(topicB, contextB).canonicalKey;
  return keyA === keyB;
}
