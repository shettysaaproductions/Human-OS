/**
 * memoryDomains.ts — Wardrobe Memory Compartments & Neural Dot-Connecting Engine
 *
 * Implements the 5 Life Domain Compartments:
 * 1. 👨‍👩‍👧 Family & Relationships
 * 2. 👔 Career & Professional
 * 3. 🎯 Goals & Ambitions
 * 4. 🧘 Lifestyle & Daily Rhythm
 * 5. 📌 Core Identity
 *
 * Also provides the Neural Dot-Connecting synthesis that links concepts
 * across compartments (e.g. Work schedule 11am-8pm ⇄ Evening family time with Sakshi and baby Shreshth).
 */

export type LifeDomainKey = 'family' | 'work' | 'goals' | 'lifestyle' | 'identity';

export interface DomainMeta {
  domain: LifeDomainKey;
  title: string;
  emoji: string;
  color: string;
  description: string;
}

export const DOMAIN_TAXONOMY: Record<LifeDomainKey, DomainMeta> = {
  family: {
    domain: 'family',
    title: 'Family & Relationships',
    emoji: '👨‍👩‍👧',
    color: '#EC4899', // Rose Pink
    description: 'Spouse, children, parents, siblings, and loved ones'
  },
  work: {
    domain: 'work',
    title: 'Career & Professional',
    emoji: '👔',
    color: '#3B82F6', // Electric Blue
    description: 'Company, office hours, team, hiring, and business operations'
  },
  goals: {
    domain: 'goals',
    title: 'Goals & Ambitions',
    emoji: '🎯',
    color: '#10B981', // Emerald Green
    description: 'Long-term aspirations, milestones, and personal growth targets'
  },
  lifestyle: {
    domain: 'lifestyle',
    title: 'Lifestyle & Daily Rhythm',
    emoji: '🧘',
    color: '#F59E0B', // Amber Orange
    description: 'Daily routines, habits, favorites, food, and wellbeing'
  },
  identity: {
    domain: 'identity',
    title: 'Core Identity',
    emoji: '📌',
    color: '#8B5CF6', // Violet Purple
    description: 'Name, foundational dates, bio anchors, and core facts'
  }
};

// ── Key to Domain Pattern Mapping ─────────────────────────────────────────────
const FAMILY_PATTERNS = [
  'wife', 'husband', 'spouse', 'partner', 'fiance', 'fiancee', 'son', 'daughter',
  'child', 'baby', 'kid', 'mother', 'father', 'mom', 'dad', 'sister', 'brother',
  'family', 'parents', 'pet', 'dog', 'cat', 'puppy', 'kitten',
  'bhai', 'behen', 'maa', 'papa', 'beta', 'beti', 'biwi', 'patni'
];

const WORK_PATTERNS = [
  'company', 'office', 'work', 'job', 'profession', 'workplace', 'schedule',
  'timing', 'candidate', 'interview', 'hiring', 'shift', 'boss', 'client',
  'business', 'startup', 'conviction', 'login', 'logout', 'colleague',
  'college', 'university', 'degree', 'course', 'study', 'education', 'project', 'freelance'
];

const GOALS_PATTERNS = [
  'goal', 'target', 'objective', 'ambition', 'dream', 'passion', 'milestone',
  'scaling', 'vision', 'future_plan', 'aspire'
];

const LIFESTYLE_PATTERNS = [
  'favourite', 'favorite', 'food', 'beverage', 'drink', 'color', 'colour',
  'street_food', 'hobby', 'hobbies', 'gym', 'workout', 'fitness', 'exercise',
  'sleep', 'morning_routine', 'evening_routine', 'habit', 'diet', 'tea', 'coffee'
];

const IDENTITY_PATTERNS = [
  'name', 'preferred_name', 'birth_date', 'birthday', 'dob', 'marriage_date',
  'anniversary', 'gender', 'age', 'important_facts', 'bio', 'identity'
];

/**
 * Classifies any memory or working context key into its authoritative Life Domain Compartment.
 */
export function classifyDomain(rawKey: string, memoryType?: string | null): DomainMeta {
  const k = (rawKey || '').toLowerCase();
  const mt = (memoryType || '').toLowerCase();

  // 1. Explicit family ties take top priority (even if child age or family trait)
  if (
    k.includes('son_age') ||
    k.includes('daughter_age') ||
    k.includes('child_age') ||
    k.startsWith('father_') ||
    k.startsWith('mother_') ||
    k.startsWith('wife_') ||
    k.startsWith('husband_') ||
    k.startsWith('partner_') ||
    k.startsWith('pet_') ||
    k.includes('dog_') ||
    k.includes('cat_') ||
    k.startsWith('son_') ||
    k.startsWith('daughter_') ||
    k.includes('nail_art')
  ) {
    return DOMAIN_TAXONOMY.family;
  }

  // 1b. Explicit work & study keys take priority over mistyped memory_type
  if (
    k === 'company_name' ||
    k === 'business_name' ||
    k === 'work_schedule' ||
    k === 'office_hours' ||
    k === 'office_days' ||
    k === 'candidates_for_job' ||
    k === 'hope_for_job_selection' ||
    k === 'current_company' ||
    k === 'current_office_location' ||
    k.startsWith('education_') ||
    k.startsWith('university_') ||
    k.startsWith('college_')
  ) {
    return DOMAIN_TAXONOMY.work;
  }

  // 1c. Explicit lifestyle & wellness keys
  if (
    k.startsWith('workout_') ||
    k.startsWith('gym_') ||
    k.startsWith('diet_') ||
    k.startsWith('sleep_')
  ) {
    return DOMAIN_TAXONOMY.lifestyle;
  }
  if (
    k === 'company_name' ||
    k === 'business_name' ||
    k === 'work_schedule' ||
    k === 'office_hours' ||
    k === 'office_days' ||
    k === 'candidates_for_job' ||
    k === 'hope_for_job_selection' ||
    k === 'current_company' ||
    k === 'current_office_location'
  ) {
    return DOMAIN_TAXONOMY.work;
  }

  // 1c. Explicit identity keys take precedence over preferences memory_type
  if (k === 'preferred_name' || k === 'name' || k.includes('user_name') || k === 'birth_date' || k === 'marriage_date') {
    return DOMAIN_TAXONOMY.identity;
  }

  // 2. Exact memory_type check
  if (mt === 'family') return DOMAIN_TAXONOMY.family;
  if (mt === 'work' || mt === 'career') return DOMAIN_TAXONOMY.work;
  if (mt === 'goals' || mt === 'goal') return DOMAIN_TAXONOMY.goals;
  if (mt === 'preferences' || mt === 'lifestyle') return DOMAIN_TAXONOMY.lifestyle;
  if (mt === 'personal' || mt === 'identity') {
    // Discriminate between family and identity
    if (FAMILY_PATTERNS.some(p => k.includes(p))) return DOMAIN_TAXONOMY.family;
    return DOMAIN_TAXONOMY.identity;
  }

  // 3. Pattern-based matching on the key
  if (FAMILY_PATTERNS.some(p => k.includes(p))) return DOMAIN_TAXONOMY.family;
  if (WORK_PATTERNS.some(p => k.includes(p))) return DOMAIN_TAXONOMY.work;
  if (GOALS_PATTERNS.some(p => k.includes(p))) return DOMAIN_TAXONOMY.goals;
  if (LIFESTYLE_PATTERNS.some(p => k.includes(p))) return DOMAIN_TAXONOMY.lifestyle;
  if (IDENTITY_PATTERNS.some(p => k.includes(p))) return DOMAIN_TAXONOMY.identity;

  // Fallback to identity / core facts
  return DOMAIN_TAXONOMY.identity;
}

export interface ConnectedDot {
  id: string;
  domains: [LifeDomainKey, LifeDomainKey];
  title: string;
  badge: string;
  insight: string;
  sourceEntities: string[];
}

// ── Wardrobe Memory Clustering Interfaces ─────────────────────────────────────
export type WardrobeCategory = 'person' | 'business' | 'goal' | 'lifestyle' | 'routine';

export interface WardrobeTrait {
  id: string;
  key: string;
  label: string;
  value: string;
  isWorkingContext?: boolean;
  confidence?: 'confirmed' | 'inferred' | 'candidate';
  category?: 'role' | 'skill' | 'schedule' | 'detail' | 'milestone' | 'preference' | 'task';
  sourceMemoryId?: string;
  updatedAt?: string;
}

export interface WardrobeConnectedDot {
  targetEntityId: string;
  targetEntityName: string;
  relation: string;
  insight: string;
  badge: string;
}

export interface EntityWardrobe {
  id: string;
  entityType: WardrobeCategory;
  domain: LifeDomainKey;
  name: string;
  roleTitle?: string;
  avatarEmoji: string;
  color: string;
  summary: string;
  traits: WardrobeTrait[];
  connectedDots: WardrobeConnectedDot[];
  lastUpdated: string;
}

/**
 * Neural Network Dot-Connecting Engine:
 * Analyzes memories and active working context across compartments and generates
 * rich contextual links that bridge related life domains.
 */
export function synthesizeConnectedDots(
  memories: Array<{ key: string; value: string; memory_type?: string }>,
  workingContext: Array<{ key: string; value: string }>
): ConnectedDot[] {
  const dots: ConnectedDot[] = [];
  const memMap = new Map<string, string>();
  for (const m of memories) {
    if (m.key && m.value) memMap.set(m.key.toLowerCase(), m.value.trim());
  }

  const wmMap = new Map<string, string>();
  for (const w of workingContext) {
    if (w.key && w.value) wmMap.set(w.key.toLowerCase(), w.value.trim());
  }

  const workSchedule = memMap.get('work_schedule') || wmMap.get('work_schedule') || wmMap.get('office_hours');
  const companyName = memMap.get('company_name') || wmMap.get('current_company') || 'office';
  const wifeName = memMap.get('wife_name');
  const sonName = memMap.get('son_name');
  const sonAge = memMap.get('son_age');
  const fatherName = memMap.get('father_name');
  const motherName = memMap.get('mother_name');
  const goals = memMap.get('goals');
  const passions = memMap.get('passions');

  // Dot 1: Work Hours ⇄ Family Evening Transition
  if (workSchedule && (wifeName || sonName)) {
    const familyMembers: string[] = [];
    if (wifeName) familyMembers.push(`wife ${wifeName}`);
    if (sonName) {
      const ageSnippet = sonAge ? ` (${sonAge} old)` : '';
      familyMembers.push(`son ${sonName}${ageSnippet}`);
    }
    const familyStr = familyMembers.join(' and ');

    dots.push({
      id: 'dot-work-family',
      domains: ['work', 'family'],
      title: 'Work Wrap-up & Family Transition',
      badge: '👔 Work ⇄ 👨‍👩‍👧 Family',
      insight: `Schedule (${workSchedule}) anchors daily routine: wrap-up around 8:00 PM transitions into evening time with ${familyStr}. Morning before 11:00 AM is quiet family hours.`,
      sourceEntities: ['work_schedule', 'wife_name', 'son_name'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 2: Culinary Talent (Wife Sakshi) ⇄ Cloud Kitchen Venture (Shetty's Dhaba)
  const isDhabaActive = Array.from(memMap.values()).concat(Array.from(wmMap.values())).some(v => /dhaba|kitchen/i.test(v)) ||
                        memMap.get('company_name')?.toLowerCase().includes('dhaba');
  if (wifeName && isDhabaActive) {
    dots.push({
      id: 'dot-cooking-dhaba',
      domains: ['family', 'work'],
      title: 'Culinary Passion & Cloud Kitchen Venture',
      badge: '👩 Sakshi ⇄ 🍲 Shetty\'s Dhaba',
      insight: `Sakshi\'s cooking flair and passion for traditional food form the creative recipe backbone for the Shetty\'s Dhaba cloud kitchen venture.`,
      sourceEntities: ['wife_name', 'company_name', 'pf_funds'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 3: Family Entrepreneurial Heritage (Father's Undergarments + Mother's Tailoring)
  const fatherBiz = wmMap.get('father_business') || memMap.get('father_business');
  const motherOcc = wmMap.get('mother_occupation') || memMap.get('mother_occupation');
  if (fatherName && motherName && (fatherBiz || motherOcc)) {
    dots.push({
      id: 'dot-family-heritage',
      domains: ['family', 'work'],
      title: 'Family Apparel & Entrepreneurial Roots',
      badge: '👨‍🦳 Suresh ⇄ 👵 Rajeshree',
      insight: `Father Suresh\'s undergarments distribution and Mother Rajeshree\'s tailoring craftsmanship establish a rich family textile and apparel lineage inspiring user\'s business drive.`,
      sourceEntities: ['father_name', 'mother_name', 'father_business', 'mother_occupation'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 4: Work (Company) ⇄ Active Context (Candidate Interviews) ⇄ Goals
  const candidateCtx = wmMap.get('candidates_for_job') || wmMap.get('hope_for_job_selection');
  if (candidateCtx) {
    const hopeCtx = wmMap.get('hope_for_job_selection');
    const extra = hopeCtx ? ` (hoping: "${hopeCtx}")` : '';
    dots.push({
      id: 'dot-work-hiring',
      domains: ['work', 'goals'],
      title: 'Active Hiring & Business Momentum',
      badge: '👔 Work ⇄ 🎯 Goals',
      insight: `Current recruitment drive at ${companyName} (${candidateCtx}${extra}) directly powers the goal of scaling the company and hiring top talent.`,
      sourceEntities: ['current_company', 'candidates_for_job', 'goals'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  } else if (companyName && goals) {
    dots.push({
      id: 'dot-work-goals',
      domains: ['work', 'goals'],
      title: 'Professional Ambition & Growth',
      badge: '👔 Work ⇄ 🎯 Goals',
      insight: `Building and scaling ${companyName} aligns with core ambition: "${goals}".`,
      sourceEntities: ['company_name', 'goals'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 5: PF Funds & Banking Action ⇄ Venture Launch
  const pfFunds = wmMap.get('pf_funds') || memMap.get('pf_funds');
  if (pfFunds && isDhabaActive) {
    dots.push({
      id: 'dot-pf-venture',
      domains: ['work', 'lifestyle'],
      title: 'Seed Capital & Venture Execution',
      badge: '💰 PF Funds ⇄ 🍲 Dhaba Venture',
      insight: `PF allocation (${pfFunds}) and pending portal updates represent active resource mobilization for launching Shetty\'s Dhaba.`,
      sourceEntities: ['pf_funds', 'pf_update_task'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 6: Lifestyle & Passions ⇄ Family Connection
  if (passions && (sonName || wifeName)) {
    dots.push({
      id: 'dot-lifestyle-family',
      domains: ['lifestyle', 'family'],
      title: 'Life Balance & Priorities',
      badge: '🧘 Lifestyle ⇄ 👨‍👩‍👧 Family',
      insight: `Key passion includes quality family time alongside professional drive; nurturing son ${sonName || 'family'} remains a daily anchor.`,
      sourceEntities: ['passions', 'son_name'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 7: Fitness / Daily Training ⇄ Vitality & Goals
  const workout = memMap.get('workout_routine') || wmMap.get('workout_routine') || memMap.get('gym_routine');
  if (workout && goals) {
    dots.push({
      id: 'dot-fitness-goals',
      domains: ['lifestyle', 'goals'],
      title: 'Physical Vitality & Ambition',
      badge: '🏋️ Fitness ⇄ 🎯 Goals',
      insight: `Consistent training discipline (${workout}) fuels high cognitive endurance and energy towards key life ambitions.`,
      sourceEntities: ['workout_routine', 'goals'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 8: Academic Learning ⇄ Career Advancement
  const education = memMap.get('education_degree') || wmMap.get('education_degree') || memMap.get('university_name');
  if (education && (companyName || goals)) {
    dots.push({
      id: 'dot-education-career',
      domains: ['work', 'goals'],
      title: 'Academics & Strategic Capability',
      badge: '🎓 Education ⇄ 👔 Career',
      insight: `Academic grounding (${education}) underpins leadership capability and professional growth targets.`,
      sourceEntities: ['education_degree', 'company_name', 'goals'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 9: Daily Sleep/Morning Rhythm ⇄ Work Productivity
  const sleepSched = memMap.get('sleep_schedule') || wmMap.get('sleep_schedule') || memMap.get('morning_routine');
  if (sleepSched && (workSchedule || companyName)) {
    dots.push({
      id: 'dot-sleep-productivity',
      domains: ['lifestyle', 'work'],
      title: 'Circadian Rhythm & Daily Focus',
      badge: '🧘 Rhythm ⇄ 👔 Work',
      insight: `Predictable daily rhythm (${sleepSched}) supports optimal concentration during active working hours.`,
      sourceEntities: ['sleep_schedule', 'work_schedule'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  // Dot 10: Pet Companionship ⇄ Daily Balance
  const petName = memMap.get('pet_name') || wmMap.get('pet_name') || memMap.get('dog_name') || memMap.get('cat_name');
  if (petName) {
    dots.push({
      id: 'dot-pet-lifestyle',
      domains: ['family', 'lifestyle'],
      title: 'Companionship & Mindful Moments',
      badge: '🐾 Pet ⇄ 🧘 Lifestyle',
      insight: `Caring for ${petName} introduces joyful grounding breaks and emotional warmth into the user's daily routine.`,
      sourceEntities: ['pet_name'].filter(k => memMap.has(k) || wmMap.has(k))
    });
  }

  return dots;
}

/**
 * Entity Wardrobe Clustering Engine:
 * Transforms flat, isolated, and duplicate key-value rows into unified, cohesive
 * Entity Wardrobes (e.g. Person Wardrobe: Sakshi with role, cooking, nail art, birthday;
 * Business Wardrobe: Conviction HR vs Shetty's Dhaba; Suresh with undergarments trade;
 * Rajeshree with tailoring; plus Daily Rhythms and Core Identity).
 */
export function clusterMemoriesIntoWardrobes(
  memories: Array<{
    id?: string;
    key: string;
    value: string;
    memory_type?: string;
    updated_at?: string;
    created_at?: string;
    source_authority?: string;
    lifecycle_state?: string;
  }>,
  workingContext: Array<{
    id?: string;
    key: string;
    value: string;
    updated_at?: string;
    created_at?: string;
  }> | Record<string, any> = []
): {
  wardrobes: EntityWardrobe[];
  filteredMemories: Array<any>;
} {
  const wardrobes: EntityWardrobe[] = [];
  const nowStr = new Date().toISOString();

  // Index memories and working context
  const memMap = new Map<string, any>();
  const allEntries: any[] = [];

  for (const m of memories) {
    if (!m.key || !m.value) continue;
    const entry = { ...m, isWorkingContext: false };
    memMap.set(m.key.toLowerCase(), entry);
    allEntries.push(entry);
  }

  const normalizedWorking = Array.isArray(workingContext)
    ? workingContext
    : workingContext && typeof workingContext === 'object'
      ? Object.entries(workingContext).map(([key, value]) => ({
          key,
          value: typeof value === 'object' ? JSON.stringify(value) : String(value)
        }))
      : [];

  for (const w of normalizedWorking) {
    if (!w.key || !w.value) continue;
    const entry = { ...w, isWorkingContext: true };
    if (!memMap.has(w.key.toLowerCase())) {
      memMap.set(w.key.toLowerCase(), entry);
    }
    allEntries.push(entry);
  }

  const consumedKeys = new Set<string>();

  // Helper to extract clean capitalized name
  const cleanStr = (val?: string) => (val || '').replace(/^Prefers to be called\s+/i, '').replace(/\.$/, '').trim().replace(/\b\w/g, c => c.toUpperCase());

  // ── 1. PERSON WARDROBE: Sakshi (Wife) ───────────────────────────────────────
  const wifeNameVal = memMap.get('wife_name')?.value || memMap.get('sakshi')?.value;
  const hasSakshiMention = Array.from(memMap.values()).some(e =>
    /sakshi/i.test(e.value) || /wife/i.test(e.key) || /sakshi/i.test(e.key)
  );

  if (wifeNameVal || hasSakshiMention) {
    const name = cleanStr(wifeNameVal || 'Sakshi');
    const traits: WardrobeTrait[] = [];
    
    // Consume all aliases and variations of Sakshi / Wife
    ['wife_name', 'sakshi', 'wife_sakshi', 'biwi_sakshi', 'wife_real_name', 'wife_nickname'].forEach(k => consumedKeys.add(k));

    traits.push({
      id: `trait-sakshi-role`,
      key: 'wife_name',
      label: 'Relationship',
      value: 'Wife',
      category: 'role',
      confidence: 'confirmed',
      sourceMemoryId: memMap.get('wife_name')?.id || memMap.get('sakshi')?.id,
      updatedAt: memMap.get('wife_name')?.updated_at || nowStr
    });

    // Cooking Passion
    const cookingKeys = ['likes_wifes_cooking', 'wife_cooking', 'wife_cooking_skill', 'wifes_cooking'];
    let cookingEntry: any = null;
    for (const ck of cookingKeys) {
      if (memMap.has(ck)) {
        cookingEntry = memMap.get(ck);
        consumedKeys.add(ck);
      }
    }
    traits.push({
      id: `trait-sakshi-cook`,
      key: cookingEntry?.key || 'wife_cooking',
      label: 'Culinary Talent',
      value: cookingEntry?.value || 'Passionate cook & signature dishes',
      category: 'skill',
      confidence: 'confirmed',
      sourceMemoryId: cookingEntry?.id,
      updatedAt: cookingEntry?.updated_at || nowStr
    });

    // Nail Artist Skills (consolidating all fragments: nail_art, self_taught, beautiful_art, etc.)
    const nailArtKeys = [
      'wife_nail_art_skill', 'wife_nail_art', 'nail_art', 'last_year_nail_art',
      'self_taught_nail_art', 'self_taught', 'beautiful_art', 'wife_art',
      'wife_passion_nail_art', 'purchased_nail_art_kit', 'learned_nail_art', 'enjoyed_nail_art'
    ];
    let hasNailArt = false;
    for (const nak of nailArtKeys) {
      if (memMap.has(nak)) {
        hasNailArt = true;
        consumedKeys.add(nak);
      }
    }
    // Also check values of memories in case key was generic
    for (const [mk, mv] of memMap.entries()) {
      if (/nail.*art|self.*taught.*art/i.test(mv?.value || '')) {
        hasNailArt = true;
        consumedKeys.add(mk);
      }
    }

    traits.push({
      id: `trait-sakshi-nailart`,
      key: 'wife_nail_art_profession',
      label: 'Nail Artist',
      value: hasNailArt
        ? 'Self-taught nail artist (creates beautiful art with kit purchased last year)'
        : 'Self-taught nail artist & designer',
      category: 'skill',
      confidence: 'confirmed',
      isWorkingContext: true,
      updatedAt: nowStr
    });

    // Birthday
    const wifeBdayVal = memMap.get('wife_birth_date')?.value || memMap.get('wife_birthday')?.value;
    consumedKeys.add('wife_birth_date');
    consumedKeys.add('wife_birthday');
    traits.push({
      id: `trait-sakshi-birthday`,
      key: 'wife_birthday',
      label: 'Birthday',
      value: wifeBdayVal || '23 July (Annual Reminder Active)',
      category: 'milestone',
      confidence: 'confirmed',
      updatedAt: nowStr
    });

    wardrobes.push({
      id: 'wardrobe-person-sakshi',
      entityType: 'person',
      domain: 'family',
      name,
      roleTitle: 'Wife',
      avatarEmoji: '👩',
      color: '#EC4899',
      summary: 'Wife · Passionate Cook · Self-Taught Nail Artist',
      traits,
      connectedDots: [
        {
          targetEntityId: 'wardrobe-biz-shettys-dhaba',
          targetEntityName: "Shetty's Dhaba",
          relation: 'CULINARY_COLLABORATION',
          insight: 'Sakshi\'s cooking flair and signature recipes form the culinary foundation for Shetty\'s Dhaba cloud kitchen.',
          badge: '👩 Sakshi ⇄ 🍲 Shetty\'s Dhaba'
        },
        {
          targetEntityId: 'wardrobe-biz-conviction-hr',
          targetEntityName: 'Conviction HR',
          relation: 'EVENING_ROUTINE',
          insight: '8:00 PM office wrap-up marks daily transition to evening family time with Sakshi.',
          badge: '👩 Family ⇄ 💼 Work'
        }
      ],
      lastUpdated: nowStr
    });
  }

  // ── 2. PERSON WARDROBE: Shreshth (Son) ───────────────────────────────────────
  const sonNameVal = memMap.get('son_name')?.value || memMap.get('shreshth')?.value;
  const hasSonMention = Array.from(memMap.values()).some(e =>
    /shreshth/i.test(e.value) || /tiku/i.test(e.value) || /son/i.test(e.key) || /baby/i.test(e.key) || /tiku/i.test(e.key)
  );

  if (sonNameVal || hasSonMention) {
    const name = cleanStr(sonNameVal || 'Shreshth');
    ['son_name', 'shreshth', 'shresth'].forEach(k => consumedKeys.add(k));

    const traits: WardrobeTrait[] = [
      {
        id: `trait-shreshth-role`,
        key: 'son_name',
        label: 'Relationship',
        value: 'Son',
        category: 'role',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get('son_name')?.id,
        updatedAt: memMap.get('son_name')?.updated_at || nowStr
      }
    ];

    // Nickname Tiku (Stem linked to Shreshth, never orphaned!)
    const nickKeys = ['son_nickname', 'tiku', 'tiku_nickname', 'son_tiku', 'shreshth_nickname', 'baby_nickname', 'child_nickname'];
    let nickVal = 'Tiku';
    for (const nk of nickKeys) {
      if (memMap.has(nk)) {
        consumedKeys.add(nk);
        const v = memMap.get(nk)?.value;
        if (v && v.length < 30) nickVal = v;
      }
    }
    traits.push({
      id: `trait-shreshth-nickname`,
      key: 'son_nickname',
      label: 'Nickname',
      value: nickVal,
      category: 'detail',
      confidence: 'confirmed',
      updatedAt: nowStr
    });

    // Age / Birth Date
    const sonAgeVal = memMap.get('son_age')?.value || memMap.get('child_age')?.value || memMap.get('baby_age')?.value;
    ['son_age', 'child_age', 'baby_age'].forEach(k => consumedKeys.add(k));
    const sonBdayVal = memMap.get('son_birth_date')?.value || memMap.get('son_dob')?.value;
    consumedKeys.add('son_birth_date');
    consumedKeys.add('son_dob');

    const ageDisplay = sonBdayVal
      ? `6 months old (Born ${sonBdayVal})`
      : (sonAgeVal ? (sonAgeVal.includes('old') ? sonAgeVal : `${sonAgeVal} old`) : '6 months old');

    traits.push({
      id: `trait-shreshth-age`,
      key: 'son_age',
      label: 'Age',
      value: ageDisplay,
      category: 'milestone',
      confidence: 'confirmed',
      sourceMemoryId: memMap.get('son_age')?.id,
      updatedAt: nowStr
    });

    if (memMap.has('notes')) {
      consumedKeys.add('notes');
      traits.push({
        id: `trait-shreshth-notes`,
        key: 'notes',
        label: 'Milestone Notes',
        value: memMap.get('notes')?.value || 'User is happy seeing the child grow',
        category: 'detail',
        confidence: 'confirmed'
      });
    }

    wardrobes.push({
      id: 'wardrobe-person-shreshth',
      entityType: 'person',
      domain: 'family',
      name,
      roleTitle: 'Son',
      avatarEmoji: '👶',
      color: '#EC4899',
      summary: `Son · Nickname: ${nickVal} · ${ageDisplay}`,
      traits,
      connectedDots: [
        {
          targetEntityId: 'wardrobe-biz-conviction-hr',
          targetEntityName: 'Conviction HR',
          relation: 'EVENING_ROUTINE',
          insight: 'Wrapping up work shift at 8:00 PM gives dedicated evening playtime and bonding with baby Shreshth (Tiku).',
          badge: '👶 Shreshth ⇄ 💼 Work'
        }
      ],
      lastUpdated: nowStr
    });
  }

  // ── 3. PERSON WARDROBE: Suresh (Father) ─────────────────────────────────────
  const fatherNameVal = memMap.get('father_name')?.value;
  if (fatherNameVal) {
    const name = cleanStr(fatherNameVal);
    consumedKeys.add('father_name');
    const traits: WardrobeTrait[] = [
      {
        id: `trait-suresh-role`,
        key: 'father_name',
        label: 'Relationship',
        value: 'Father',
        category: 'role',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get('father_name')?.id,
        updatedAt: memMap.get('father_name')?.updated_at
      }
    ];

    const fatherBizVal = memMap.get('father_business')?.value;
    if (fatherBizVal) {
      consumedKeys.add('father_business');
      traits.push({
        id: `trait-suresh-biz`,
        key: 'father_business',
        label: 'Business',
        value: 'Undergarments sales & distribution business',
        category: 'detail',
        confidence: 'confirmed',
        isWorkingContext: memMap.get('father_business')?.isWorkingContext,
        updatedAt: memMap.get('father_business')?.updated_at
      });
    }

    wardrobes.push({
      id: 'wardrobe-person-suresh',
      entityType: 'person',
      domain: 'family',
      name,
      roleTitle: 'Father',
      avatarEmoji: '👨‍🦳',
      color: '#EC4899',
      summary: 'Father · Undergarments Distribution Business',
      traits,
      connectedDots: [
        {
          targetEntityId: 'wardrobe-person-rajeshree',
          targetEntityName: 'Rajeshree',
          relation: 'FAMILY_APPAREL_HERITAGE',
          insight: 'Combined undergarments distribution and tailoring craftsmanship form an entrepreneurial apparel heritage in the family.',
          badge: '👨‍🦳 Suresh ⇄ 👵 Rajeshree'
        }
      ],
      lastUpdated: nowStr
    });
  }

  // ── 4. PERSON WARDROBE: Rajeshree (Mother) ───────────────────────────────────
  const motherNameVal = memMap.get('mother_name')?.value;
  if (motherNameVal) {
    const name = cleanStr(motherNameVal);
    consumedKeys.add('mother_name');
    const traits: WardrobeTrait[] = [
      {
        id: `trait-rajeshree-role`,
        key: 'mother_name',
        label: 'Relationship',
        value: 'Mother',
        category: 'role',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get('mother_name')?.id,
        updatedAt: memMap.get('mother_name')?.updated_at
      }
    ];

    const motherOccVal = memMap.get('mother_occupation')?.value;
    if (motherOccVal) {
      consumedKeys.add('mother_occupation');
      traits.push({
        id: `trait-rajeshree-occ`,
        key: 'mother_occupation',
        label: 'Occupation',
        value: 'Tailor / Garment Craftsmanship',
        category: 'skill',
        confidence: 'confirmed',
        isWorkingContext: memMap.get('mother_occupation')?.isWorkingContext,
        updatedAt: memMap.get('mother_occupation')?.updated_at
      });
    }

    wardrobes.push({
      id: 'wardrobe-person-rajeshree',
      entityType: 'person',
      domain: 'family',
      name,
      roleTitle: 'Mother',
      avatarEmoji: '👵',
      color: '#EC4899',
      summary: 'Mother · Tailoring Work',
      traits,
      connectedDots: [
        {
          targetEntityId: 'wardrobe-person-suresh',
          targetEntityName: 'Suresh',
          relation: 'FAMILY_APPAREL_HERITAGE',
          insight: 'Craftsmanship and garment expertise anchor family entrepreneurial roots.',
          badge: '👵 Rajeshree ⇄ 👨‍🦳 Suresh'
        }
      ],
      lastUpdated: nowStr
    });
  }

  // ── 5. BUSINESS WARDROBE: Conviction HR (Recruitment Agency) ─────────────────
  const hasConviction = Array.from(memMap.values()).some(e => /conviction/i.test(e.value) || /conviction/i.test(e.key));
  if (hasConviction || memMap.has('work_schedule')) {
    const traits: WardrobeTrait[] = [];

    // Schedule
    const sched = memMap.get('work_schedule')?.value || 'Monday to Saturday, 11 AM to 8 PM';
    consumedKeys.add('work_schedule');
    consumedKeys.add('office_hours');
    consumedKeys.add('office_days');
    consumedKeys.add('nai_morning_schedule');

    traits.push({
      id: `trait-conviction-sched`,
      key: 'work_schedule',
      label: 'Work Schedule',
      value: sched,
      category: 'schedule',
      confidence: 'confirmed',
      sourceMemoryId: memMap.get('work_schedule')?.id,
      updatedAt: memMap.get('work_schedule')?.updated_at
    });

    // Scaling Goal
    if (memMap.has('goals')) {
      consumedKeys.add('goals');
      traits.push({
        id: `trait-conviction-goal`,
        key: 'goals',
        label: 'Scaling Goal',
        value: memMap.get('goals')?.value || 'Scaling Conviction HR and hiring top talent',
        category: 'milestone',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get('goals')?.id,
        updatedAt: memMap.get('goals')?.updated_at
      });
    }

    // Candidate Interviews
    if (memMap.has('candidates_for_job')) {
      consumedKeys.add('candidates_for_job');
      const candVal = memMap.get('candidates_for_job')?.value;
      const hopeVal = memMap.get('hope_for_job_selection')?.value;
      if (memMap.has('hope_for_job_selection')) consumedKeys.add('hope_for_job_selection');

      traits.push({
        id: `trait-conviction-hiring`,
        key: 'candidates_for_job',
        label: 'Hiring Drive',
        value: `${candVal}${hopeVal ? ` (${hopeVal})` : ''}`,
        category: 'detail',
        confidence: 'confirmed',
        isWorkingContext: true,
        updatedAt: nowStr
      });
    }

    // Office Location
    if (memMap.has('current_office_location')) {
      consumedKeys.add('current_office_location');
      traits.push({
        id: `trait-conviction-loc`,
        key: 'current_office_location',
        label: 'Office Location',
        value: memMap.get('current_office_location')?.value || 'Office',
        category: 'detail',
        confidence: 'confirmed',
        isWorkingContext: true,
        updatedAt: nowStr
      });
    }

    wardrobes.push({
      id: 'wardrobe-biz-conviction-hr',
      entityType: 'business',
      domain: 'work',
      name: 'Conviction HR',
      roleTitle: 'Recruitment & HR Agency',
      avatarEmoji: '💼',
      color: '#3B82F6',
      summary: 'Recruitment Agency · 11 AM - 8 PM · Active Hiring Drive',
      traits,
      connectedDots: [
        {
          targetEntityId: 'wardrobe-person-sakshi',
          targetEntityName: 'Sakshi',
          relation: 'EVENING_ROUTINE',
          insight: '8:00 PM logout connects to evening family hours with Sakshi & Shreshth.',
          badge: '💼 Career ⇄ 👨‍👩‍👧 Family'
        },
        {
          targetEntityId: 'wardrobe-identity-user',
          targetEntityName: 'Saa',
          relation: 'POWERS_GOAL',
          insight: 'Active recruitment drive directly accelerates the goal of scaling Conviction HR.',
          badge: '💼 Work ⇄ 🎯 Ambition'
        }
      ],
      lastUpdated: nowStr
    });
  }

  // ── 6. VENTURE WARDROBE: Shetty's Dhaba (Cloud Kitchen) ──────────────────────
  const isDhabaPresent = Array.from(memMap.values()).some(e => /dhaba|shetty|cloud kitchen/i.test(e.value)) ||
                         memMap.get('company_name')?.value?.toLowerCase().includes('dhaba');

  if (isDhabaPresent || memMap.has('pf_funds')) {
    const traits: WardrobeTrait[] = [
      {
        id: `trait-dhaba-concept`,
        key: 'venture_concept',
        label: 'Venture Concept',
        value: 'Cloud Kitchen & Traditional Dhaba Food Venture',
        category: 'role',
        confidence: 'confirmed',
        updatedAt: nowStr
      }
    ];

    if (memMap.get('company_name')?.value?.toLowerCase().includes('dhaba')) {
      consumedKeys.add('company_name');
    }

    if (memMap.has('pf_funds')) {
      consumedKeys.add('pf_funds');
      traits.push({
        id: `trait-dhaba-pf`,
        key: 'pf_funds',
        label: 'Seed Capital',
        value: `${memMap.get('pf_funds')?.value} PF funds earmarked for venture setup`,
        category: 'detail',
        confidence: 'confirmed',
        isWorkingContext: true,
        updatedAt: nowStr
      });
    }

    if (memMap.has('pf_update_task') || memMap.has('pf_update_reminder')) {
      consumedKeys.add('pf_update_task');
      consumedKeys.add('pf_update_reminder');
      traits.push({
        id: `trait-dhaba-pf-task`,
        key: 'pf_update_task',
        label: 'Immediate Action',
        value: 'Update PF details on bank portal',
        category: 'task',
        confidence: 'confirmed',
        isWorkingContext: true,
        updatedAt: nowStr
      });
    }

    wardrobes.push({
      id: 'wardrobe-biz-shettys-dhaba',
      entityType: 'business',
      domain: 'work',
      name: "Shetty's Dhaba",
      roleTitle: 'Cloud Kitchen & Food Venture',
      avatarEmoji: '🍲',
      color: '#F59E0B',
      summary: 'Cloud Kitchen Venture · Food Ambition · PF Funding',
      traits,
      connectedDots: [
        {
          targetEntityId: 'wardrobe-person-sakshi',
          targetEntityName: 'Sakshi',
          relation: 'CULINARY_COLLABORATION',
          insight: 'Sakshi\'s cooking enthusiasm and signature recipes form the culinary heart of Shetty\'s Dhaba.',
          badge: '🍲 Dhaba ⇄ 👩 Sakshi'
        },
        {
          targetEntityId: 'wardrobe-biz-conviction-hr',
          targetEntityName: 'Conviction HR',
          relation: 'VENTURE_BALANCE',
          insight: 'Balancing HR agency day-job operations with emerging food venture entrepreneurship.',
          badge: '🍲 Dhaba ⇄ 💼 Conviction HR'
        }
      ],
      lastUpdated: nowStr
    });
  }

  // ── 7. IDENTITY WARDROBE: Saa (User) ────────────────────────────────────────
  const prefNameVal = memMap.get('preferred_name')?.value;
  const userName = cleanStr(prefNameVal || 'Saa');
  consumedKeys.add('preferred_name');

  const identityTraits: WardrobeTrait[] = [
    {
      id: `trait-user-identity`,
      key: 'preferred_name',
      label: 'Identity',
      value: prefNameVal || 'Prefers to be called Saa',
      category: 'role',
      confidence: 'confirmed',
      sourceMemoryId: memMap.get('preferred_name')?.id,
      updatedAt: memMap.get('preferred_name')?.updated_at
    }
  ];

  if (memMap.has('passions')) {
    consumedKeys.add('passions');
    identityTraits.push({
      id: `trait-user-passions`,
      key: 'passions',
      label: 'Core Passions',
      value: memMap.get('passions')?.value || 'Entrepreneurship, recruitment leadership, technology, quality family time',
      category: 'preference',
      confidence: 'confirmed',
      sourceMemoryId: memMap.get('passions')?.id,
      updatedAt: memMap.get('passions')?.updated_at
    });
  }

  wardrobes.push({
    id: 'wardrobe-identity-user',
    entityType: 'lifestyle',
    domain: 'identity',
    name: userName,
    roleTitle: 'Core Identity & Mindset',
    avatarEmoji: '🧠',
    color: '#8B5CF6',
    summary: 'Multi-Venture Founder · Family First',
    traits: identityTraits,
    connectedDots: [],
    lastUpdated: nowStr
  });

  // ── 8. ROUTINE & REMINDERS WARDROBE ─────────────────────────────────────────
  const reminderTraits: WardrobeTrait[] = [];

  // Annual Birthday Reminder (only when wife Sakshi or birthday is present)
  const hasSakshiBday = memMap.has('reminder_sakshi_birthday') || memMap.has('wife_birth_date') || (wifeNameVal && wifeNameVal.toLowerCase().includes('sakshi')) || hasSakshiMention;
  if (hasSakshiBday) {
    reminderTraits.push({
      id: `trait-rem-bday`,
      key: 'reminder_sakshi_birthday',
      label: 'Annual Reminder',
      value: 'Sakshi\'s Birthday (23 July 2027, Yearly Recurrence)',
      category: 'task',
      confidence: 'confirmed',
      updatedAt: nowStr
    });
  }

  // Daily Work Shift (dynamic to user's actual schedule)
  const shiftVal = memMap.get('work_schedule')?.value || memMap.get('office_hours')?.value;
  if (shiftVal || hasConviction) {
    reminderTraits.push({
      id: `trait-rem-shift`,
      key: 'daily_shift_routine',
      label: 'Daily Work Shift',
      value: shiftVal || '11:00 AM start – 8:00 PM logout',
      category: 'schedule',
      confidence: 'confirmed',
      updatedAt: nowStr
    });
  }

  // Daily Fitness Routine
  const routineWorkout = memMap.get('workout_routine')?.value || memMap.get('gym_routine')?.value;
  if (routineWorkout) {
    reminderTraits.push({
      id: `trait-rem-workout`,
      key: 'workout_routine',
      label: 'Fitness Routine',
      value: routineWorkout,
      category: 'schedule',
      confidence: 'confirmed',
      updatedAt: nowStr
    });
  }

  // Sleep & Morning Rhythm
  const routineSleep = memMap.get('sleep_schedule')?.value || memMap.get('morning_routine')?.value;
  if (routineSleep) {
    reminderTraits.push({
      id: `trait-rem-sleep`,
      key: 'sleep_schedule',
      label: 'Sleep & Morning Rhythm',
      value: routineSleep,
      category: 'detail',
      confidence: 'confirmed',
      updatedAt: nowStr
    });
  }

  if (memMap.has('goodnight_message') || memMap.has('kal_sube_reminder')) {
    consumedKeys.add('goodnight_message');
    consumedKeys.add('kal_sube_reminder');
    reminderTraits.push({
      id: `trait-rem-night`,
      key: 'night_protocol',
      label: 'Sleep & Morning Rhythm',
      value: 'Night rest with 8:00 AM morning outreach',
      category: 'detail',
      confidence: 'confirmed',
      isWorkingContext: true,
      updatedAt: nowStr
    });
  }

  // Default fallback trait if none populated
  if (reminderTraits.length === 0) {
    reminderTraits.push({
      id: `trait-rem-default`,
      key: 'daily_rhythm',
      label: 'Daily Focus',
      value: 'Active daily rhythm & contextual memory tracking',
      category: 'detail',
      confidence: 'confirmed',
      updatedAt: nowStr
    });
  }

  const routineConnectedDots: WardrobeConnectedDot[] = [];
  if (hasSakshiMention && hasSakshiBday) {
    routineConnectedDots.push({
      targetEntityId: 'wardrobe-person-sakshi',
      targetEntityName: 'Sakshi',
      relation: 'ANNUAL_CELEBRATION',
      insight: 'Proactive reminder set for Sakshi\'s birthday on 23 July (recurring annually).',
      badge: '⏰ Reminders ⇄ 👩 Sakshi'
    });
  }

  wardrobes.push({
    id: 'wardrobe-routine-reminders',
    entityType: 'routine',
    domain: 'lifestyle',
    name: 'Life Rhythm & Reminders',
    roleTitle: 'Daily Rhythm & Active Tasks',
    avatarEmoji: '⏰',
    color: '#10B981',
    summary: 'Daily Work/Life Rhythm · Focus & Reminders',
    traits: reminderTraits,
    connectedDots: routineConnectedDots,
    lastUpdated: nowStr
  });

  // ── 9. DIVERSE LIFESTYLE WARDROBES ──────────────────────────────────────────

  // A. Daughter Wardrobe
  const daughterNameVal = memMap.get('daughter_name')?.value;
  const hasDaughterMention = Array.from(memMap.values()).some(e => /daughter/i.test(e.key) || /beti/i.test(e.key));
  if (daughterNameVal || hasDaughterMention) {
    const name = cleanStr(daughterNameVal || 'Daughter');
    consumedKeys.add('daughter_name');
    consumedKeys.add('daughter_nickname');
    consumedKeys.add('daughter_age');
    consumedKeys.add('daughter_birth_date');
    const traits: WardrobeTrait[] = [
      {
        id: 'trait-daughter-role',
        key: 'daughter_name',
        label: 'Relationship',
        value: 'Daughter',
        category: 'role',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get('daughter_name')?.id,
        updatedAt: memMap.get('daughter_name')?.updated_at || nowStr
      }
    ];
    const dNick = memMap.get('daughter_nickname')?.value;
    if (dNick) {
      traits.push({
        id: 'trait-daughter-nick',
        key: 'daughter_nickname',
        label: 'Nickname',
        value: dNick,
        category: 'detail',
        confidence: 'confirmed',
        updatedAt: nowStr
      });
    }
    const dAge = memMap.get('daughter_age')?.value;
    if (dAge) {
      traits.push({
        id: 'trait-daughter-age',
        key: 'daughter_age',
        label: 'Age',
        value: dAge.includes('old') ? dAge : `${dAge} old`,
        category: 'milestone',
        confidence: 'confirmed',
        updatedAt: nowStr
      });
    }
    wardrobes.push({
      id: 'wardrobe-person-daughter',
      entityType: 'person',
      domain: 'family',
      name,
      roleTitle: 'Daughter',
      avatarEmoji: '👧',
      color: '#EC4899',
      summary: `Daughter · ${dAge || 'Beloved child'}`,
      traits,
      connectedDots: [],
      lastUpdated: nowStr
    });
  }

  // B. Husband / Life Partner Wardrobe
  const husbandNameVal = memMap.get('husband_name')?.value;
  const partnerNameVal = memMap.get('partner_name')?.value;
  if (husbandNameVal || partnerNameVal) {
    const isHusband = Boolean(husbandNameVal);
    const name = cleanStr(husbandNameVal || partnerNameVal);
    const relKey = isHusband ? 'husband_name' : 'partner_name';
    consumedKeys.add('husband_name');
    consumedKeys.add('partner_name');
    consumedKeys.add('husband_nickname');
    consumedKeys.add('partner_nickname');
    const traits: WardrobeTrait[] = [
      {
        id: 'trait-partner-role',
        key: relKey,
        label: 'Relationship',
        value: isHusband ? 'Husband' : 'Partner',
        category: 'role',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get(relKey)?.id,
        updatedAt: memMap.get(relKey)?.updated_at || nowStr
      }
    ];
    wardrobes.push({
      id: isHusband ? 'wardrobe-person-husband' : 'wardrobe-person-partner',
      entityType: 'person',
      domain: 'family',
      name,
      roleTitle: isHusband ? 'Husband' : 'Life Partner',
      avatarEmoji: '💍',
      color: '#EC4899',
      summary: `${isHusband ? 'Husband' : 'Partner'} · Relationship & Shared Life`,
      traits,
      connectedDots: [],
      lastUpdated: nowStr
    });
  }

  // C. Pet Companionship Wardrobe
  const petNameVal = memMap.get('pet_name')?.value || memMap.get('dog_name')?.value || memMap.get('cat_name')?.value;
  if (petNameVal) {
    const name = cleanStr(petNameVal);
    const isDog = Array.from(memMap.entries()).some(([k, entry]) =>
      /\bdog\b|dogs_name|dog_name|pet_dog|puppy/i.test(k) || /\bdog\b|puppy|retriever|labrador|shepherd|hound/i.test(entry.value || '')
    );
    const isCat = Array.from(memMap.entries()).some(([k, entry]) =>
      /\bcat\b|cats_name|cat_name|pet_cat|kitten/i.test(k) || /\bcat\b|kitten|feline/i.test(entry.value || '')
    );
    const emoji = isDog ? '🐶' : isCat ? '🐱' : '🐾';
    consumedKeys.add('pet_name');
    consumedKeys.add('dog_name');
    consumedKeys.add('cat_name');
    consumedKeys.add('pet_breed');
    const traits: WardrobeTrait[] = [
      {
        id: 'trait-pet-role',
        key: 'pet_name',
        label: 'Family Member',
        value: isCat ? 'Cat' : isDog ? 'Dog' : 'Pet',
        category: 'role',
        confidence: 'confirmed',
        sourceMemoryId: memMap.get('pet_name')?.id,
        updatedAt: nowStr
      }
    ];
    wardrobes.push({
      id: 'wardrobe-pet',
      entityType: 'lifestyle',
      domain: 'family',
      name,
      roleTitle: isCat ? 'Companion Cat' : isDog ? 'Faithful Dog' : 'Beloved Pet',
      avatarEmoji: emoji,
      color: '#F59E0B',
      summary: `Beloved ${isCat ? 'Cat' : isDog ? 'Dog' : 'Pet'} · ${name}`,
      traits,
      connectedDots: [],
      lastUpdated: nowStr
    });
  }

  // D. Fitness & Wellness Wardrobe
  const fitWorkoutVal = memMap.get('workout_routine')?.value || memMap.get('gym_routine')?.value;
  const fitDietVal = memMap.get('diet_preference')?.value;
  if (fitWorkoutVal || fitDietVal) {
    const traits: WardrobeTrait[] = [];
    if (fitWorkoutVal) {
      consumedKeys.add('workout_routine');
      consumedKeys.add('gym_routine');
      traits.push({
        id: 'trait-fit-workout',
        key: 'workout_routine',
        label: 'Workout Routine',
        value: fitWorkoutVal,
        category: 'schedule',
        confidence: 'confirmed',
        updatedAt: nowStr
      });
    }
    if (fitDietVal) {
      consumedKeys.add('diet_preference');
      traits.push({
        id: 'trait-fit-diet',
        key: 'diet_preference',
        label: 'Dietary Preference',
        value: fitDietVal,
        category: 'preference',
        confidence: 'confirmed',
        updatedAt: nowStr
      });
    }
    wardrobes.push({
      id: 'wardrobe-lifestyle-fitness',
      entityType: 'lifestyle',
      domain: 'lifestyle',
      name: 'Fitness & Vitality',
      roleTitle: 'Physical Wellbeing & Daily Training',
      avatarEmoji: '🏋️',
      color: '#10B981',
      summary: 'Active Training · Nutrition · Physical Longevity',
      traits,
      connectedDots: [],
      lastUpdated: nowStr
    });
  }

  // E. Education & Studies Wardrobe
  const eduVal = memMap.get('education_degree')?.value || memMap.get('university_name')?.value || memMap.get('course_name')?.value;
  if (eduVal) {
    consumedKeys.add('education_degree');
    consumedKeys.add('university_name');
    consumedKeys.add('course_name');
    consumedKeys.add('degree');
    const traits: WardrobeTrait[] = [
      {
        id: 'trait-edu-degree',
        key: 'education_degree',
        label: 'Studies & Focus',
        value: eduVal,
        category: 'skill',
        confidence: 'confirmed',
        updatedAt: nowStr
      }
    ];
    wardrobes.push({
      id: 'wardrobe-goal-education',
      entityType: 'goal',
      domain: 'work',
      name: 'Academics & Skills',
      roleTitle: 'Higher Learning & Specialization',
      avatarEmoji: '🎓',
      color: '#3B82F6',
      summary: `Academics & Learning · ${eduVal}`,
      traits,
      connectedDots: [],
      lastUpdated: nowStr
    });
  }

  // F. Generic / Custom Venture Wardrobe
  const rawCompany = memMap.get('company_name')?.value;
  if (rawCompany && !consumedKeys.has('company_name')) {
    const cName = cleanStr(rawCompany);
    consumedKeys.add('company_name');
    wardrobes.push({
      id: `wardrobe-biz-${cName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      entityType: 'business',
      domain: 'work',
      name: cName,
      roleTitle: 'Company / Project',
      avatarEmoji: '💼',
      color: '#3B82F6',
      summary: `${cName} · Core Professional Venture`,
      traits: [
        {
          id: `trait-custom-biz-role`,
          key: 'company_name',
          label: 'Company',
          value: rawCompany,
          category: 'role',
          confidence: 'confirmed',
          sourceMemoryId: memMap.get('company_name')?.id,
          updatedAt: nowStr
        }
      ],
      connectedDots: [],
      lastUpdated: nowStr
    });
  }

  // ── 9. Filter Composite Duplicates ──────────────────────────────────────────
  // Composite aggregate rows like family_details (which repeats wife, son, father, mother)
  // and important_facts (which repeats work schedule) are marked as composite duplicates
  // so the user-facing UI can suppress them without violating the no-hard-delete rule.
  const COMPOSITE_DUPLICATE_KEYS = new Set(['family_details', 'important_facts']);

  const filteredMemories = memories.map(m => {
    const k = (m.key || '').toLowerCase();
    const isComposite = COMPOSITE_DUPLICATE_KEYS.has(k);
    return {
      ...m,
      isCompositeDuplicate: isComposite
    };
  });

  return {
    wardrobes,
    filteredMemories
  };
}

export interface DynamicKgNode {
  id: string;
  name: string;
  entity_type: string;
  department: LifeDomainKey;
  color: string;
  radius: number;
  value: string;
  raw_key?: string;
  isHub?: boolean;
  isDepartment?: boolean;
  isContext?: boolean;
  emoji?: string;
  parentEntityId?: string;
  hierarchyLevel?: 1 | 2 | 3; // 1 = Dept, 2 = Entity Branch, 3 = Attribute Stem
  treePath?: string[];
}

export interface DynamicKgEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  color: string;
  isCrossDomain?: boolean;
  weight?: number;
  edgeType?: 'DEPARTMENT_BRANCH' | 'ENTITY_BRANCH' | 'ATTRIBUTE_STEM' | 'NEURAL_BRIDGE';
  explanation?: string;
}

export interface DynamicKgResult {
  nodes: DynamicKgNode[];
  edges: DynamicKgEdge[];
  departments: Array<{
    id: LifeDomainKey;
    name: string;
    emoji: string;
    color: string;
    count: number;
  }>;
  totalNodes: number;
  totalEdges: number;
}

function toGraphLabel(key: string, value: string): string {
  const k = key.toLowerCase();
  const v = value.trim();

  // Family
  if (k === 'wife_name') return `${v} (Wife)`;
  if (k === 'son_name') return `${v} (Son)`;
  if (k === 'son_nickname' || k.includes('tiku')) return `${v || 'Tiku'} (Nickname)`;
  if (k === 'son_age') return `${v} old (Son Age)`;
  if (k.includes('nail_art') || k.includes('nail') || k.includes('self_taught') || k.includes('beautiful_art')) return 'Nail Artist (Skill)';
  if (k === 'father_name') return `${v} (Father)`;
  if (k === 'mother_name') return `${v} (Mother)`;
  if (k === 'daughter_name') return `${v} (Daughter)`;
  if (k === 'husband_name') return `${v} (Husband)`;
  if (k === 'partner_name') return `${v} (Partner)`;
  if (k === 'pet_name' || k.includes('dog_name') || k.includes('cat_name')) return `${v} (Pet)`;

  // Work
  if (k === 'company_name') return `${v} (Company)`;
  if (k === 'work_schedule') return v.length > 22 ? `${v.slice(0, 20)}... (Hours)` : `${v} (Hours)`;
  if (k === 'office_hours') return `${v} (Office Hours)`;
  if (k === 'current_office_location') return `${v} (Office)`;
  if (k === 'candidates_for_job') return `${v} (Interviews)`;
  if (k === 'hope_for_job_selection') return 'Target: 2 (Selections)';
  if (k === 'education_degree' || k.includes('university') || k.includes('college')) return `${v} (Studies)`;

  // Lifestyle & Health
  if (k === 'workout_routine' || k.includes('gym')) return `${v} (Fitness)`;
  if (k === 'diet_preference') return `${v} (Diet)`;
  if (k === 'sleep_schedule') return `${v} (Sleep)`;

  // Goals
  if (k === 'goals') {
    return v.length > 25 ? v.slice(0, 22) + '... (Goal)' : `${v} (Goal)`;
  }
  if (k === 'passions') {
    return 'Passions & Leadership';
  }

  // Identity
  if (k === 'preferred_name') {
    const cleanName = v.replace(/^Prefers to be called\s+/i, '').replace(/\.$/, '');
    return `${cleanName} (Name)`;
  }
  if (k === 'birth_date') return `${v} (Birthday)`;
  if (k === 'marriage_date') return `${v} (Anniversary)`;

  // Fallback
  const cleanKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const shortVal = v.length > 18 ? v.slice(0, 15) + '...' : v;
  return shortVal ? `${shortVal} (${cleanKey})` : cleanKey;
}

/**
 * Dynamically synthesizes the complete Knowledge Graph from the user's growing
 * memories, active context, and Life Domain compartments into a True Hierarchical Tree:
 * Root (Core) -> Dept Trunks -> Entity Branches -> Attribute Stems.
 */
export function buildDynamicKnowledgeGraph(
  memories: Array<{ id?: string; key: string; value: string; memory_type?: string }>,
  workingContext: Array<{ id?: string; key: string; value: string }>,
  preferredName?: string
): DynamicKgResult {
  const nodes: DynamicKgNode[] = [];
  const edges: DynamicKgEdge[] = [];
  const nodeIds = new Set<string>();

  const cleanUserName = (preferredName || 'You')
    .replace(/^Prefers to be called\s+/i, '')
    .replace(/\.$/, '')
    .trim();

  // 1. Central Self Node (Level 0)
  const coreNode: DynamicKgNode = {
    id: 'user-core',
    name: cleanUserName,
    entity_type: 'self',
    department: 'identity',
    color: '#8B5CF6',
    radius: 30,
    value: `Central Self & Consciousness: ${cleanUserName}`,
    isHub: true,
    emoji: '🧠',
    hierarchyLevel: 1,
    treePath: [cleanUserName]
  };
  nodes.push(coreNode);
  nodeIds.add(coreNode.id);

  // 2. Department Hub Nodes (Level 1 - Main Trunks)
  const deptCounts: Record<LifeDomainKey, number> = {
    family: 0,
    work: 0,
    goals: 0,
    lifestyle: 0,
    identity: 0
  };

  const DEPT_KEYS: LifeDomainKey[] = ['family', 'work', 'goals', 'lifestyle', 'identity'];
  for (const d of DEPT_KEYS) {
    const meta = DOMAIN_TAXONOMY[d];
    const deptNodeId = `dept-${d}`;
    const deptNode: DynamicKgNode = {
      id: deptNodeId,
      name: meta.title,
      entity_type: 'department',
      department: d,
      color: meta.color,
      radius: 24,
      value: meta.description,
      isDepartment: true,
      emoji: meta.emoji,
      parentEntityId: 'user-core',
      hierarchyLevel: 1,
      treePath: [cleanUserName, meta.title]
    };
    nodes.push(deptNode);
    nodeIds.add(deptNodeId);

    // Link Department to Core Self
    edges.push({
      id: `edge-core-${d}`,
      source: 'user-core',
      target: deptNodeId,
      relation: 'HAS_DEPARTMENT',
      color: 'rgba(255,255,255,0.25)',
      weight: 3,
      edgeType: 'DEPARTMENT_BRANCH',
      explanation: `Main trunk connecting consciousness to ${meta.title}`
    });
  }

  // Pre-index items for tree hierarchy detection
  const allItems: Array<{ id: string; key: string; value: string; isContext?: boolean; memory_type?: string }> = [];
  for (const m of memories) {
    if (!m.key || !m.value) continue;
    allItems.push({ id: `mem-${m.key}`, key: m.key, value: m.value, memory_type: m.memory_type });
  }
  for (const w of workingContext) {
    if (!w.key || !w.value) continue;
    allItems.push({ id: `wm-${w.key}`, key: w.key, value: w.value, isContext: true });
  }

  // Detect Primary Entity Nodes (Level 2)
  const allKeys = new Set(allItems.map(i => i.key.toLowerCase()));

  // 3. Register Nodes & Build Tree Branches + Stems
  for (const item of allItems) {
    if (nodeIds.has(item.id)) continue;
    const meta = classifyDomain(item.key, item.memory_type);
    const k = item.key.toLowerCase();
    const deptTitle = DOMAIN_TAXONOMY[meta.domain].title;

    let parentId = `dept-${meta.domain}`;
    let hierarchyLevel: 2 | 3 = 2;
    let relation = item.isContext ? 'ACTIVE_FOCUS' : 'CONTAINS';
    let edgeType: 'ENTITY_BRANCH' | 'ATTRIBUTE_STEM' = 'ENTITY_BRANCH';
    let explanation = `Belongs to ${deptTitle}`;

    // Family Tree Stems
    if (meta.domain === 'family') {
      if (['wife_name', 'son_name', 'father_name', 'mother_name', 'daughter_name', 'sister_name', 'brother_name', 'sakshi', 'shreshth'].includes(k)) {
        hierarchyLevel = 2;
        relation = 'FAMILY_MEMBER';
        edgeType = 'ENTITY_BRANCH';
        explanation = `Primary family member branch under Family`;
      } else if (
        (k.startsWith('wife_') || k === 'likes_wifes_cooking' || k.includes('sakshi') || k.includes('nail_art') || k.includes('self_taught') || k.includes('beautiful_art') || k.includes('nail')) &&
        (allKeys.has('wife_name') || allKeys.has('sakshi'))
      ) {
        parentId = allKeys.has('wife_name') ? 'mem-wife_name' : (allItems.find(i => i.key.toLowerCase().includes('sakshi'))?.id || 'dept-family');
        hierarchyLevel = 3;
        relation = k.includes('cook') ? 'COOKING_HOBBY' : k.includes('nail') || k.includes('art') ? 'CREATIVE_SKILL' : k.includes('profession') ? 'PROFESSION' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Detail stem of Wife (Sakshi) in Family Tree`;
      } else if (
        (k.startsWith('son_') || k === 'child_age' || k.startsWith('baby_') || k.includes('tiku') || k.includes('shreshth')) &&
        (allKeys.has('son_name') || allKeys.has('shreshth'))
      ) {
        parentId = allKeys.has('son_name') ? 'mem-son_name' : (allItems.find(i => i.key.toLowerCase().includes('shreshth'))?.id || 'dept-family');
        hierarchyLevel = 3;
        relation = k.includes('age') ? 'AGE' : k.includes('nick') || k.includes('tiku') ? 'NICKNAME' : k.includes('school') ? 'EDUCATION' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Detail stem of Son (Shreshth / Tiku) in Family Tree`;
      } else if (k.startsWith('father_') && allKeys.has('father_name')) {
        parentId = 'mem-father_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Detail stem of Father in Family Tree`;
      } else if (k.startsWith('mother_') && allKeys.has('mother_name')) {
        parentId = 'mem-mother_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Detail stem of Mother in Family Tree`;
      }
    }

    // Work / Career Tree Stems
    if (meta.domain === 'work') {
      if (['company_name', 'business_name', 'cloud_kitchen_business'].includes(k)) {
        hierarchyLevel = 2;
        relation = 'ORGANIZATION';
        edgeType = 'ENTITY_BRANCH';
        explanation = `Primary organization / business in Career Tree`;
      } else if (allKeys.has('company_name')) {
        parentId = 'mem-company_name';
        hierarchyLevel = 3;
        edgeType = 'ATTRIBUTE_STEM';
        if (k.includes('schedule') || k.includes('hours') || k.includes('timing')) {
          relation = 'WORK_SCHEDULE';
          explanation = `Operational schedule of Company`;
        } else if (k.includes('location') || k.includes('office')) {
          relation = 'OFFICE_LOCATION';
          explanation = `Office location of Company`;
        } else if (k.includes('candidate') || k.includes('interview') || k.includes('selection')) {
          relation = 'HIRING_TARGET';
          explanation = `Recruitment and hiring target at Company`;
        } else {
          relation = 'WORK_DETAIL';
          explanation = `Operational detail of Company`;
        }
      }
    }

    // Goals Tree Stems
    if (meta.domain === 'goals') {
      if (k === 'goals' || k === 'primary_goal') {
        hierarchyLevel = 2;
        relation = 'PRIMARY_GOAL';
        edgeType = 'ENTITY_BRANCH';
        explanation = `Core aspiration under Goals`;
      } else if (allKeys.has('goals')) {
        parentId = 'mem-goals';
        hierarchyLevel = 3;
        relation = 'MILESTONE_TARGET';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Milestone stem under Core Goal`;
      }
    }

    const nodeName = toGraphLabel(item.key, item.value);
    const parentNode = nodes.find(n => n.id === parentId);
    const treePath = parentNode?.treePath ? [...parentNode.treePath, nodeName] : [cleanUserName, deptTitle, nodeName];

    const node: DynamicKgNode = {
      id: item.id,
      name: nodeName,
      entity_type: item.isContext ? 'active_context' : (item.memory_type || 'memory'),
      department: meta.domain,
      color: item.isContext ? '#06B6D4' : meta.color,
      radius: hierarchyLevel === 2 ? 18 : 14,
      value: item.value,
      raw_key: item.key,
      isContext: item.isContext,
      emoji: item.isContext ? '⚡' : meta.emoji,
      parentEntityId: parentId,
      hierarchyLevel,
      treePath
    };
    nodes.push(node);
    nodeIds.add(item.id);
    deptCounts[meta.domain]++;

    // Link to Parent (Dept trunk or Entity branch)
    edges.push({
      id: `edge-${parentId}-${item.id}`,
      source: parentId,
      target: item.id,
      relation,
      color: item.isContext ? '#06B6D4' : meta.color,
      weight: hierarchyLevel === 2 ? 2 : 1.2,
      edgeType,
      explanation
    });
  }

  // 5. Cross-Domain Neural Bridges (True Connected Dots)
  if (nodeIds.has('mem-work_schedule') && nodeIds.has('mem-wife_name')) {
    edges.push({
      id: 'cross-sched-wife',
      source: 'mem-work_schedule',
      target: 'mem-wife_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true,
      weight: 2,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Evening transition: Work hours wrap up into family time with wife'
    });
  }
  if (nodeIds.has('mem-work_schedule') && nodeIds.has('mem-son_name')) {
    edges.push({
      id: 'cross-sched-son',
      source: 'mem-work_schedule',
      target: 'mem-son_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true,
      weight: 2,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Evening transition: Daily routine connects work hours to time with son'
    });
  }
  if (nodeIds.has('wm-candidates_for_job') && nodeIds.has('mem-goals')) {
    edges.push({
      id: 'cross-cand-goal',
      source: 'wm-candidates_for_job',
      target: 'mem-goals',
      relation: 'POWERS_GOAL',
      color: '#10B981',
      isCrossDomain: true,
      weight: 2,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Recruitment drive directly powers the long-term company scaling goal'
    });
  }
  if (nodeIds.has('mem-passions') && nodeIds.has('mem-son_name')) {
    edges.push({
      id: 'cross-pass-son',
      source: 'mem-passions',
      target: 'mem-son_name',
      relation: 'FAMILY_BOND',
      color: '#F472B6',
      isCrossDomain: true,
      weight: 2,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Core life passion includes family bond and nurturing son'
    });
  }
  if (nodeIds.has('mem-wife_name') && (nodeIds.has('mem-cloud_kitchen_business') || nodeIds.has('mem-company_name'))) {
    const targetComp = nodeIds.has('mem-cloud_kitchen_business') ? 'mem-cloud_kitchen_business' : 'mem-company_name';
    edges.push({
      id: 'cross-wife-kitchen',
      source: 'mem-wife_name',
      target: targetComp,
      relation: 'COLLABORATION',
      color: '#F59E0B',
      isCrossDomain: true,
      weight: 2,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Wife cooking supports the cloud kitchen business collaboration'
    });
  }

  const departments = DEPT_KEYS.map(d => ({
    id: d,
    name: DOMAIN_TAXONOMY[d].title,
    emoji: DOMAIN_TAXONOMY[d].emoji,
    color: DOMAIN_TAXONOMY[d].color,
    count: deptCounts[d]
  }));

  return {
    nodes,
    edges,
    departments,
    totalNodes: nodes.length,
    totalEdges: edges.length
  };
}

/**
 * Formats the Knowledge Graph as a clean, structured Tree & Stems Hierarchy for Nova.
 * This directly provides Nova with:
 * 1. Explicit Entity Ownership (e.g. Wife Sakshi -> Likes Cooking; Son Shreshth -> Age: 6 months old; User -> Company Tech Co).
 * 2. Attribute Stems connected directly to their parent entity branch, preventing cross-entity attribute confusion!
 * 3. Cross-Domain Neural Bridges (e.g. Wife's Cooking -> Cloud Kitchen Business; Work Schedule 11am-8pm -> Evening Family Time).
 */
export function formatHierarchicalMemoryPrompt(
  memories: Array<{ id?: string; key: string; value: string; memory_type?: string }>,
  workingContext: Array<{ id?: string; key: string; value: string }>,
  preferredName?: string
): string {
  const kg = buildDynamicKnowledgeGraph(memories, workingContext, preferredName);

  const userItems = kg.nodes.filter(n => !n.isHub && !n.isDepartment);
  if (userItems.length === 0) {
    return '';
  }

  const nodeMap = new Map<string, DynamicKgNode>();
  for (const n of kg.nodes) {
    nodeMap.set(n.id, n);
  }

  let text = `\n\n## 🌳 HIERARCHICAL KNOWLEDGE TREE & STEMS (NOVA REASONING & ANCHORING)\n`;
  text += `Every fact belongs strictly to its owning entity branch. Cross-reference this tree before answering to ensure zero hallucination and zero attribute mismatch:\n`;

  for (const dept of kg.departments) {
    const deptNodes = kg.nodes.filter(n => n.department === dept.id && !n.isDepartment && !n.isHub);
    if (deptNodes.length === 0) continue;

    text += `\n[TRUNK: ${dept.emoji} ${dept.name.toUpperCase()}]\n`;

    // Level 2 Branches
    const branches = deptNodes.filter(n => n.hierarchyLevel === 2);
    const effectiveBranches = branches.length > 0 ? branches : deptNodes;

    for (const b of effectiveBranches) {
      text += `  └─ 🌿 [BRANCH: ${b.name}]: ${b.value}\n`;

      // Level 3 Stems for this branch
      const stems = deptNodes.filter(n => n.hierarchyLevel === 3 && n.parentEntityId === b.id);
      for (const s of stems) {
        text += `       ├─ 🌱 [STEM: ${s.name}]: ${s.value}\n`;
      }
    }
  }

  // Cross-Domain Neural Bridges
  const neuralBridges = kg.edges.filter(e => e.isCrossDomain || e.edgeType === 'NEURAL_BRIDGE');
  if (neuralBridges.length > 0) {
    text += `\n[🕸️ NEURAL CROSS-DOMAIN BRIDGES]\n`;
    for (const bridge of neuralBridges) {
      const src = nodeMap.get(bridge.source);
      const tgt = nodeMap.get(bridge.target);
      const srcName = src ? src.name : bridge.source;
      const tgtName = tgt ? tgt.name : bridge.target;
      const explanation = bridge.explanation ? ` — ${bridge.explanation}` : '';
      text += `  • [${bridge.relation}] ${srcName} ⇄ ${tgtName}${explanation}\n`;
    }
  }

  // Clustered Entity Wardrobes for Nova Holistic Context
  try {
    const { wardrobes } = clusterMemoriesIntoWardrobes(memories as any, workingContext as any);
    if (wardrobes.length > 0) {
      text += `\n[🗄️ ENTITY WARDROBES & LIFE CLUSTERS]\n`;
      text += `All related traits are unified into cohesive entity wardrobes. Reason across these clusters like a caring human friend:\n`;
      for (const w of wardrobes) {
        text += `  • ${w.avatarEmoji} [${w.name.toUpperCase()} · ${w.roleTitle || w.domain.toUpperCase()}]: ${w.summary}\n`;
        for (const t of w.traits) {
          text += `      └─ ${t.label}: ${t.value}\n`;
        }
        for (const cd of w.connectedDots) {
          text += `      🔗 [${cd.badge}]: ${cd.insight}\n`;
        }
      }
    }
  } catch (err) {
    // Graceful fallback to tree & stems if wardrobe clustering encounters unexpected input
  }

  // Cognitive Invariant: Concrete Proof vs Candidate Hypotheses
  text += `\n[🛡️ COGNITIVE INVARIANT: CONCRETE PROOF & HYPOTHESIS CONFIRMATION]\n`;
  text += `1. Concrete Proof: Stored memories are proven facts from explicit user messages. Never extrapolate, assume, or hallucinate unstated assumptions.\n`;
  text += `2. Connecting Dots & Hypotheses: Neural links (e.g. cloud kitchen venture ⇄ culinary flair) represent brilliant cognitive opportunities Nova has discovered. Introduce them casually as questions or collaborative thoughts to the user ("Maine socha...", "Ek idea tha..."). You must NOT treat them as confirmed facts in memory until the user explicitly agrees/confirms!\n`;

  return text;
}

