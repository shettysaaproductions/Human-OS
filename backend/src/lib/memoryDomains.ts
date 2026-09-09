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
  if (k === 'son_age') return `${v} old (Son Age)`;
  if (k === 'father_name') return `${v} (Father)`;
  if (k === 'mother_name') return `${v} (Mother)`;
  if (k === 'daughter_name') return `${v} (Daughter)`;

  // Work
  if (k === 'company_name') return `${v} (Company)`;
  if (k === 'work_schedule') return '11am - 8pm (Work Hours)';
  if (k === 'office_hours') return `${v} (Office Hours)`;
  if (k === 'current_office_location') return `${v} (Office)`;
  if (k === 'candidates_for_job') return `${v} (Interviews)`;
  if (k === 'hope_for_job_selection') return 'Target: 2 (Selections)';

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
      if (['wife_name', 'son_name', 'father_name', 'mother_name', 'daughter_name', 'sister_name', 'brother_name'].includes(k)) {
        hierarchyLevel = 2;
        relation = 'FAMILY_MEMBER';
        edgeType = 'ENTITY_BRANCH';
        explanation = `Primary family member branch under Family`;
      } else if ((k.startsWith('wife_') || k === 'likes_wifes_cooking') && allKeys.has('wife_name')) {
        parentId = 'mem-wife_name';
        hierarchyLevel = 3;
        relation = k.includes('cook') ? 'COOKING_HOBBY' : k.includes('profession') ? 'PROFESSION' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Detail stem of Wife in Family Tree`;
      } else if ((k.startsWith('son_') || k === 'child_age' || k.startsWith('baby_')) && allKeys.has('son_name')) {
        parentId = 'mem-son_name';
        hierarchyLevel = 3;
        relation = k.includes('age') ? 'AGE' : k.includes('school') ? 'EDUCATION' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = `Detail stem of Son in Family Tree`;
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

  return text;
}
