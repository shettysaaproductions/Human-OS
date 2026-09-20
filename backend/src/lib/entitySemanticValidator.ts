/**
 * entitySemanticValidator.ts — Universal Language-Aware Entity & Memory Quality Gate
 *
 * Enforces strict semantic entity and attribute validity across English, Hindi, and Hinglish.
 * Prevents grammatical particles ('Ke', 'Ka'), action/auxiliary verbs ('Kar', 'Rehta hai'),
 * prepositional fragments ('mere society mein'), and common situational words ('Office', 'Washroom')
 * from being promoted into persistent memory entities or corrupting entity names.
 */

// ── 1. HINDI / HINGLISH GRAMMATICAL PARTICLES & FUNCTION WORDS ──────────────
const HINDI_POSTPOSITIONS_AND_PARTICLES = new Set([
  'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'par', 'pe', 'ne', 're', 'wa',
  'lie', 'liye', 'saath', 'wala', 'wali', 'wale', 'bhi', 'hi', 'toh', 'to',
  'na', 'mat', 'bas', 'tak', 'bina', 'jaise', 'aise', 'waise', 'taaki',
  'aur', 'ya', 'lekin', 'magar', 'parantu', 'kintu', 'balki', 'kyunki', 'coz', 'isliye',
  'jab', 'tab', 'ab', 'kab', 'kahan', 'idhar', 'udhar', 'wahan', 'yahan', 'kahi',
  'kuch', 'koi', 'sab', 'sabkuch', 'kitna', 'kitne', 'kitni', 'kaun', 'kaunsa', 'kaunsi', 'kaise', 'kyun'
]);

// ── 2. HINDI / HINGLISH VERBS (ROOTS, INFLECTIONS, LIGHT VERBS, COPULAS) ──────
const HINDI_VERBS_AND_COPULAS = new Set([
  'kar', 'karo', 'karein', 'karna', 'karke', 'kiya', 'kiye', 'kiyi', 'karti', 'karta', 'karte',
  'ho', 'hona', 'hoga', 'hogi', 'hoge', 'hua', 'hue', 'hui', 'hai', 'hain', 'tha', 'thi', 'the',
  'raha', 'rahi', 'rahe', 'rehta', 'rehti', 'rehte', 'rehna', 'raho', 'rahein',
  'hota', 'hoti', 'hote', 'gaya', 'gaye', 'gayi', 'jaa', 'jaana', 'jao', 'jaate', 'jaata', 'jaati',
  'diya', 'diye', 'diyi', 'de', 'dena', 'dijiye', 'diyo', 'do',
  'liya', 'liye', 'liyi', 'le', 'lena', 'lijiye', 'lo',
  'aaya', 'aaye', 'aayi', 'aa', 'aana', 'aao', 'aate',
  'utha', 'uthna', 'uthana', 'uthao', 'uth', 'uthke',
  'bol', 'bolna', 'bolo', 'bole', 'bolte', 'bata', 'batana', 'batao', 'bataye',
  'dekh', 'dekhna', 'dekho', 'dekhe', 'sun', 'sunna', 'suno', 'sune',
  'rakh', 'rakhna', 'rakho', 'rakhe', 'lag', 'lagna', 'laga', 'lage', 'lagana',
  'chalo', 'chal', 'chalna', 'pohochna', 'pahuchna', 'pohoch', 'pahuch'
]);

// ── 3. HINDI / HINGLISH PRONOUNS & POSSESSIVES ──────────────────────────────
const HINDI_PRONOUNS = new Set([
  'main', 'mai', 'hum', 'mujhe', 'muje', 'mujhko', 'humein', 'humko', 'mera', 'meri', 'mere',
  'tu', 'tum', 'tumhe', 'tumko', 'tumhara', 'tumhari', 'tumhare',
  'aap', 'aapko', 'aapka', 'aapki', 'aapke',
  'yeh', 'ye', 'woh', 'wo', 'is', 'us', 'in', 'un',
  'iska', 'iski', 'iske', 'isse', 'isko', 'ismein', 'isme',
  'uska', 'uski', 'uske', 'usse', 'usko', 'usmein', 'usme',
  'inka', 'inki', 'inke', 'unka', 'unki', 'unke', 'unhe', 'unko', 'inse', 'unse',
  'apna', 'apni', 'apne', 'khud', 'swayam'
]);

// ── 4. ENGLISH FUNCTION WORDS & PARTICLES ───────────────────────────────────
const ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'because', 'although', 'while', 'if',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down', 'out', 'off', 'over', 'under',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself',
  'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself',
  'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'having', 'do', 'does', 'did', 'doing', 'can', 'could', 'will', 'would', 'shall', 'should', 'may',
  'might', 'must', 'just', 'now', 'then', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'own', 'same', 'too'
]);

// ── 5. SITUATIONAL / COMMON NOUNS MISCLASSIFIED AS PROPER ENTITIES ─────────
const COMMON_NON_ENTITY_NOUNS = new Set([
  'office', 'work', 'job', 'home', 'house', 'flat', 'society', 'room', 'washroom', 'bathroom',
  'market', 'shop', 'store', 'cloths', 'clothes', 'kapde', 'schedule', 'timing', 'time',
  'alarm', 'reminder', 'task', 'goal', 'target', 'habit', 'day', 'month', 'year', 'week',
  'morning', 'evening', 'night', 'afternoon', 'subah', 'shaam', 'dopahar', 'raat',
  'friend', 'friends', 'dost', 'family', 'relatives', 'colleague', 'coworker', 'person', 'human',
  'date', 'birthday', 'bday', 'dob', 'age', 'year', 'years', 'month', 'months', 'days', 'din'
]);

// ── 6. KINSHIP VOCATIVES & ROLE TITLES (NOT PROPER NAMES) ───────────────────
const KINSHIP_ROLE_TITLES = new Set([
  'father', 'papa', 'pitaji', 'dad', 'daddy', 'baap', 'bapu', 'abbu',
  'mother', 'mummy', 'mom', 'maa', 'mataji', 'ammi', 'aai',
  'my father', 'my mother', 'mere papa', 'mere mummy', 'meri mummy', 'mera baap',
  'son', 'beta', 'child', 'children', 'bache', 'bacho', 'kid', 'kids', 'daughter', 'beti', 'gudiya',
  'wife', 'biwi', 'patni', 'husband', 'pati', 'brother', 'bhai', 'bhaiya', 'sister', 'behen', 'didi',
  'uncle', 'aunty', 'chacha', 'chachi', 'mama', 'mami', 'bua', 'fufa',
  'mentor', 'boss', 'manager', 'partner', 'doctor', 'lawyer', 'tailor'
]);

// Combined particle & function token lookup
const ALL_GRAMMATICAL_TOKENS = new Set([
  ...HINDI_POSTPOSITIONS_AND_PARTICLES,
  ...HINDI_VERBS_AND_COPULAS,
  ...HINDI_PRONOUNS,
  ...ENGLISH_FUNCTION_WORDS
]);

/**
 * Checks if a single token is a grammatical particle, verb, pronoun, or conjunction.
 */
export function isGrammaticalParticleOrVerb(token: string): boolean {
  if (!token) return true;
  const t = token.toLowerCase().trim();
  return ALL_GRAMMATICAL_TOKENS.has(t);
}

/**
 * Validates whether a candidate string can legitimately represent a named entity
 * (e.g. person, pet, character, organization, project).
 *
 * Rejects:
 * - Grammatical particles: "Kar", "Ke", "Ka", "Ki", "Ko", "Se", "Me", "Hai"
 * - Verbs & verb phrases: "Rehta hai", "Utha dena", "Call kar"
 * - Prepositional / clausal fragments: "mere society mein", "society mein"
 * - Kinship vocatives: "Papa", "Mummy", "Son", "Wife"
 * - Common non-entity nouns: "Office", "Washroom", "Alarm"
 *
 * Allows:
 * - Genuine proper names (e.g. "Suresh", "Rajeshree", "Sakshi", "Shreshth", "Tuku", "Sushant", "Dhiraj", "Tanmay", "Ezra")
 * - Genuine short names (e.g. "Om", "Al", "Bo", "Jo", "Ty", "Mo", "Ed", "Vu", "Pi")
 * - Compound project / venture names (e.g. "Shetty's Dhaba", "Conviction HR", "MTV Hustle")
 */
export function isValidEntityName(name: string, _entityType?: string): { isValid: boolean; reason?: string } {
  if (!name || typeof name !== 'string') {
    return { isValid: false, reason: 'NAME_EMPTY' };
  }

  const raw = name.trim();
  const lower = raw.toLowerCase();

  // Length limits
  if (raw.length < 2) {
    return { isValid: false, reason: 'NAME_TOO_SHORT' };
  }
  if (raw.length > 40) {
    return { isValid: false, reason: 'NAME_TOO_LONG' };
  }

  // Ban fragments with leading punctuation
  if (/^['".,;?!/\\-]/.test(raw)) {
    return { isValid: false, reason: 'LEADING_PUNCTUATION' };
  }

  // 1. Single token is a grammatical particle, verb, pronoun, or function word
  if (!raw.includes(' ') && ALL_GRAMMATICAL_TOKENS.has(lower)) {
    return { isValid: false, reason: `GRAMMATICAL_PARTICLE_OR_VERB: "${raw}"` };
  }

  // 2. Single token is a common non-entity noun
  if (!raw.includes(' ') && COMMON_NON_ENTITY_NOUNS.has(lower)) {
    return { isValid: false, reason: `COMMON_NON_ENTITY_NOUN: "${raw}"` };
  }

  // 3. Kinship role titles (not proper names)
  if (KINSHIP_ROLE_TITLES.has(lower)) {
    return { isValid: false, reason: `KINSHIP_ROLE_TITLE: "${raw}"` };
  }

  // 4. Multi-word phrase composed entirely of grammatical function tokens
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.every(w => ALL_GRAMMATICAL_TOKENS.has(w))) {
    return { isValid: false, reason: `ALL_TOKENS_GRAMMATICAL: "${raw}"` };
  }

  // 5. Verbal phrase, prepositional starter, or clausal fragment indicators
  const fragmentPatterns = [
    /\b(rehta|rehti|rehte|hota|hoti|hote)\s+hai\b/i,
    /\b(bechte|bechta|bechti)\s+hai\b/i,
    /\b(run|kaam)\s+(karta|karti|karte)\s+hai\b/i,
    /\b(society|sheher|gaon)\s+(mein|me)\b/i,
    /\b(call|phone)\s+(kar|karke|karna)\b/i,
    /\b(utha|jaga)\s+(dena|do|diyo)\b/i,
    /\b(yaad|remind)\s+(dilana|dilao|kar)\b/i,
    /\b(ka|ki|ke)\s+(naam|name)\s+(hai)?\b/i,
    /\b(one|guy|person|someone|character|banda|bandi)\s+(i|we|you|he|she|who|that|jisko|jiski|jisne)\s+(was|am|were|is|had|have|talked|talking|said|mentioned|ke baare|ki baat)\b/i,
    /\b(talking|speaking)\s+about\b/i,
    /\b\d+\s*(months?|years?|days?|weeks?|hours?|mins?|saal|mahine|yo)\b/i,
    /\b(every|each)\s+(month|day|week|year|monday|sunday|saturday|hour)\b/i,
    /\b\d+(st|nd|rd|th)?\s*(day|date)?\s*of\s*(every|each|the|this)\b/i,
    /\b(not specified|unknown|unnamed|anonymous|not mentioned|unspecified|placeholder)\b/i,
    /^(since|from|during|after|before|until|till|around|near|inside|outside)\s+/i
  ];
  for (const pat of fragmentPatterns) {
    if (pat.test(lower)) {
      return { isValid: false, reason: `CLAUSAL_FRAGMENT_DETECTED: "${raw}"` };
    }
  }

  // 6. Two-word combination where one is a light-verb or postposition pair (e.g. "kar ke", "ke liye", "karke utha")
  if (words.length === 2) {
    if (words[0] === 'kar' || words[0] === 'ke' || words[1] === 'kar' || words[1] === 'ke') {
      return { isValid: false, reason: `LIGHT_VERB_COMBINATION: "${raw}"` };
    }
  }

  return { isValid: true };
}

/**
 * Validates whether an extracted memory value is semantically sound for its key.
 *
 * Rejects:
 * - Particle values for names or nicknames (`son_name: "Kar"`, `son_nickname: "Ke"`)
 * - Verb phrases for locations (`friend_location: "Rehta hai"`)
 * - Redundant role words (`friend_attribute: "friend"`)
 * - Raw sentence clauses (`friend_sushant_residence: "mere society mein"`)
 */
export function isValidMemoryAttributeValue(key: string, value: string): { isValid: boolean; reason?: string } {
  if (!value || typeof value !== 'string') {
    return { isValid: false, reason: 'VALUE_EMPTY' };
  }

  const k = key.toLowerCase().trim();
  const v = value.trim();
  const lowerV = v.toLowerCase();

  // Basic length check
  if (v.length < 2) {
    return { isValid: false, reason: 'VALUE_TOO_SHORT' };
  }

  // 1. Name & Nickname keys must have a valid entity name
  if (k.endsWith('_name') || k.endsWith('_nickname') || k.endsWith('_real_name')) {
    const nameCheck = isValidEntityName(v, 'person');
    if (!nameCheck.isValid) {
      return { isValid: false, reason: `INVALID_NAME_FOR_${k}: ${nameCheck.reason}` };
    }

    // Special protection: Do not let single grammatical words become names
    if (ALL_GRAMMATICAL_TOKENS.has(lowerV)) {
      return { isValid: false, reason: `GRAMMATICAL_WORD_AS_NAME: "${v}"` };
    }
  }

  // 2. Location keys cannot be verbs or prepositional clauses
  if (k.endsWith('_location') || k === 'location' || k.endsWith('_city') || k === 'city' || k.endsWith('_residence') || k === 'residence' || k.endsWith('_place') || k === 'place') {
    if (/\b(rehta|rehti|rehte|hai|hain|tha|thi|the|karta|karti)\b/i.test(lowerV)) {
      return { isValid: false, reason: `VERB_PHRASE_AS_LOCATION: "${v}"` };
    }
    if (/^(mere|apne|unki|uski)?\s*society\s*(mein|me)$/i.test(lowerV)) {
      return { isValid: false, reason: `PREPOSITIONAL_CLAUSE_AS_LOCATION: "${v}"` };
    }
    if (ALL_GRAMMATICAL_TOKENS.has(lowerV)) {
      return { isValid: false, reason: `GRAMMATICAL_WORD_AS_LOCATION: "${v}"` };
    }
  }

  // 3. Attribute keys cannot be tautological / redundant role labels
  if (k.endsWith('_attribute')) {
    if (/^(friend|dost|colleague|family|relative|person|son|daughter|child|baby|wife|husband|mother|father|mummy|papa)$/i.test(lowerV)) {
      return { isValid: false, reason: `TAUTOLOGICAL_ATTRIBUTE: "${v}"` };
    }
  }

  // 4. Age keys must describe an age, not a date of birth
  if (k.endsWith('_age')) {
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(v)) {
      return { isValid: false, reason: `DOB_AS_AGE: "${v}"` };
    }
  }

  // 5. DOB / Birthday keys must describe a date, not a relative age duration
  if (k.endsWith('_birth_date') || k.endsWith('_dob') || k.endsWith('_birthday')) {
    if (/\b(?:\d+|one|two|three|six)\s*(?:months?|mahine|yo|years?|saal)\s*(?:old)?\b/i.test(v)) {
      return { isValid: false, reason: `RELATIVE_AGE_AS_DOB: "${v}"` };
    }
  }

  return { isValid: true };
}

// ── 7. REUSABLE SEMANTIC ENTITY TYPING GATEWAY ──────────────────────────────
export type SemanticEntityType =
  | 'person'
  | 'pet'
  | 'event'
  | 'role'
  | 'concept'
  | 'organization';

const KNOWN_PET_BREEDS_AND_ANIMALS = new Set([
  'dog', 'cat', 'puppy', 'kitten', 'kutta', 'billi', 'pet', 'pets',
  'rottweiler', 'labrador', 'retriever', 'golden retriever', 'pug',
  'german shepherd', 'beagle', 'bulldog', 'poodle', 'husky', 'chihuahua',
  'boxer', 'dalmatian', 'doberman', 'shih tzu', 'persian cat', 'siamese cat',
  'parrot', 'bird', 'fish', 'hamster', 'rabbit'
]);

const KNOWN_EVENT_WORDS = new Set([
  'celebration', 'celebrations', 'festival', 'utsav', 'parv', 'puja', 'pooja',
  'party', 'wedding', 'marriage', 'shaadi', 'shadi', 'anniversary', 'ceremony',
  'trip', 'tour', 'concert', 'match', 'tournament', 'gathering',
  'birthday', 'bday', 'ganpati', 'ganpati celebrations', 'ganesh chaturthi',
  'diwali', 'deepavali', 'holi', 'navratri', 'eid', 'christmas', 'new year'
]);

const KNOWN_ROLE_AND_CONCEPT_WORDS = new Set([
  'friend', 'friends', 'dost', 'colleague', 'coworker', 'partner', 'smoking partner',
  'since college', 'college friend', 'school friend', 'childhood friend',
  'name not specified', 'not specified', 'unspecified', 'unknown',
  'hr', 'human resources', 'manager', 'boss', 'developer', 'designer',
  'engineer', 'doctor', 'lawyer', 'tailor', 'mentor', 'mentee',
  'habit', 'context', 'preference'
]);

const KNOWN_ORGANIZATION_WORDS = new Set([
  'company', 'inc', 'corp', 'corporation', 'ltd', 'limited', 'pvt', 'llc',
  'studio', 'studios', 'productions', 'films', 'entertainment',
  'bank', 'hospital', 'clinic', 'school', 'college', 'university',
  'institute', 'institution', 'agency', 'firm', 'club', 'foundation',
  'startup', 'venture', 'office', 'workplace'
]);

/**
 * Reusable semantic entity type classifier.
 * Infers whether an entity candidate represents a real person, pet/animal,
 * event/celebration, role/concept, or organization, based on evidence,
 * domain, relation hints, and multi-script phonetic roots.
 */
export function inferSemanticEntityType(
  name: string,
  domainHint?: string,
  relationHint?: string,
  contextText?: string
): SemanticEntityType {
  if (!name || typeof name !== 'string') return 'person';
  const lower = name.toLowerCase().trim();
  const relLower = (relationHint || '').toLowerCase().trim();
  const domainLower = (domainHint || '').toLowerCase().trim();
  const ctxLower = (contextText || '').toLowerCase().trim();

  // 1. Animals / Pets / Breeds (e.g. Rottweiler, Labrador, Bruno)
  const isExplicitBreedOrAnimal =
    KNOWN_PET_BREEDS_AND_ANIMALS.has(lower) ||
    lower.split(/\s+/).some(w => KNOWN_PET_BREEDS_AND_ANIMALS.has(w));

  if (
    isExplicitBreedOrAnimal ||
    relLower.includes('pet') || relLower.includes('dog') || relLower.includes('cat') ||
    relLower.includes('kutta') || relLower.includes('billi') ||
    ctxLower.includes('dog') || ctxLower.includes('cat') || ctxLower.includes('pet')
  ) {
    // Explicit animal/breed name always classifies as pet.
    // General pet hints only defer to human kinship if not an explicit breed name.
    if (isExplicitBreedOrAnimal || !/^(father|mother|wife|husband|son|daughter|brother|sister|friend|colleague)$/i.test(relLower)) {
      return 'pet';
    }
  }

  // 2. Events / Celebrations / Festivals (e.g. Ganpati Celebrations, Diwali)
  if (
    KNOWN_EVENT_WORDS.has(lower) ||
    lower.split(/\s+/).some(w => KNOWN_EVENT_WORDS.has(w)) ||
    lower.endsWith('celebration') || lower.endsWith('celebrations') ||
    lower.endsWith('festival') || lower.endsWith('party') || lower.endsWith('puja') ||
    lower.endsWith('wedding') || lower.endsWith('tour') || lower.endsWith('trip') ||
    relLower.includes('event') || relLower.includes('celebration') || relLower.includes('festival')
  ) {
    return 'event';
  }

  // 3. Concepts / Attributes / Temporal Fragments (e.g. "Since College", "Name Not Specified")
  if (
    lower.startsWith('since ') ||
    lower.includes('not specified') ||
    lower === 'unknown'
  ) {
    return 'concept';
  }

  // 4. Roles / Relational Descriptors (e.g. "Smoking Partner", "Friend", "Hr")
  if (
    KNOWN_ROLE_AND_CONCEPT_WORDS.has(lower) ||
    lower.includes('partner')
  ) {
    return 'role';
  }

  // 5. Organizations / Ventures / Studios (e.g. "Conviction HR", "Shetty Productions")
  if (
    KNOWN_ORGANIZATION_WORDS.has(lower) ||
    /\b(inc|corp|ltd|llc|pvt|studio|productions|bank|hospital|clinic|university|startup)\b/i.test(lower) ||
    (domainLower === 'work' && (relLower.includes('company') || relLower.includes('organization') || relLower.includes('startup')))
  ) {
    return 'organization';
  }

  // 6. Default: Real person
  return 'person';
}
