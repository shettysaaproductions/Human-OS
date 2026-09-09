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
  'wife', 'husband', 'spouse', 'son', 'daughter', 'child', 'baby', 'kid',
  'mother', 'father', 'mom', 'dad', 'sister', 'brother', 'family', 'parents',
  'bhai', 'behen', 'maa', 'papa', 'beta', 'beti', 'biwi', 'patni'
];

const WORK_PATTERNS = [
  'company', 'office', 'work', 'job', 'profession', 'workplace', 'schedule',
  'timing', 'candidate', 'interview', 'hiring', 'shift', 'boss', 'client',
  'business', 'startup', 'conviction', 'login', 'logout', 'colleague'
];

const GOALS_PATTERNS = [
  'goal', 'target', 'objective', 'ambition', 'dream', 'passion', 'milestone',
  'scaling', 'vision', 'future_plan', 'aspire'
];

const LIFESTYLE_PATTERNS = [
  'favourite', 'favorite', 'food', 'beverage', 'drink', 'color', 'colour',
  'street_food', 'hobby', 'hobbies', 'gym', 'workout', 'sleep', 'morning_routine',
  'evening_routine', 'habit', 'diet', 'tea', 'coffee'
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

  // 1. Explicit family ties take top priority (even if child age)
  if (k.includes('son_age') || k.includes('daughter_age') || k.includes('child_age')) {
    return DOMAIN_TAXONOMY.family;
  }

  // 1b. Explicit identity keys take precedence over preferences memory_type
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

/**
 * Neural Network Dot-Connecting Engine:
 * Analyzes memories and active working context across compartments and generates
 * contextual links that bridge related life domains.
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

  // Dot 2: Work (Company) ⇄ Active Context (Candidate Interviews) ⇄ Goals
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

  // Dot 3: Lifestyle & Passions ⇄ Family Connection
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

  return dots;
}
