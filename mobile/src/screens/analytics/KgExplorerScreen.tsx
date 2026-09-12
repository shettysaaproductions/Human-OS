import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, ScrollView, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { G, Line, Path, Circle } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, withRepeat, Easing, runOnJS
} from 'react-native-reanimated';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/useAuthStore';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_HEIGHT = SCREEN_HEIGHT - 170;

// Expanded virtual canvas coordinates for wide, clear gaps between branches and stems
const WORLD_SIZE = 2000;
const CENTER = WORLD_SIZE / 2; // 1000

interface GraphNode {
  id: string;
  name: string;
  shortName: string;
  subLabel?: string;
  entity_type: string;
  department: string;
  color: string;
  radius: number;
  value: string;
  raw_key?: string;
  isHub?: boolean;
  isDepartment?: boolean;
  isContext?: boolean;
  emoji?: string;
  parentEntityId?: string;
  hierarchyLevel?: 1 | 2 | 3; // 1 = Dept Trunk, 2 = Entity Branch, 3 = Attribute Stem
  treePath?: string[];
  x: number;
  y: number;
  x3d?: number;
  y3d?: number;
  z3d?: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  color: string;
  isCrossDomain?: boolean;
  weight?: number;
  edgeType?: 'DEPARTMENT_BRANCH' | 'ENTITY_BRANCH' | 'ATTRIBUTE_STEM' | 'NEURAL_BRIDGE';
  explanation?: string;
  sourceNode?: GraphNode;
  targetNode?: GraphNode;
  pathD?: string;
  midX?: number;
  midY?: number;
}

interface DepartmentMeta {
  id: string;
  name: string;
  emoji: string;
  color: string;
  count: number;
  x: number;
  y: number;
}

// Single-codepoint, non-ZWJ Unicode emojis safe across all Android Skia/HarfBuzz font engines
const DOMAIN_COLORS: Record<string, { color: string; emoji: string; name: string; short: string }> = {
  family:    { color: '#EC4899', emoji: '👥', name: 'Family & Relationships', short: 'Family' },
  work:      { color: '#3B82F6', emoji: '💼', name: 'Career & Professional',  short: 'Career' },
  goals:     { color: '#10B981', emoji: '🎯', name: 'Goals & Ambitions',      short: 'Goals' },
  lifestyle: { color: '#F59E0B', emoji: '🧘', name: 'Lifestyle & Rhythm',     short: 'Lifestyle' },
  identity:  { color: '#8B5CF6', emoji: '🧠', name: 'Core Identity',          short: 'Identity' },
};

// Department hub angles around the central Core (Sun) at radius 175
const DEPT_ANGLES: Record<string, number> = {
  family:    -Math.PI * 0.18, // Top-right (~ -32 deg)
  work:      -Math.PI * 0.60, // Top-left (~ -108 deg)
  goals:     -Math.PI * 0.98, // Far-left (~ -176 deg)
  lifestyle:  Math.PI * 0.62, // Bottom-left (~ 112 deg)
  identity:   Math.PI * 0.22, // Bottom-right (~ 40 deg)
};

function inferDomain(rawKey?: string, memoryType?: string): string {
  const k = (rawKey || '').toLowerCase();
  const mt = (memoryType || '').toLowerCase();
  if (
    mt === 'family' ||
    /wife|son|mother|father|daughter|sister|brother|baby|child|family|husband|partner|pet|dog|cat|bird|puppy|kitten|cousin|uncle|aunt|cook/.test(k)
  ) return 'family';
  if (
    mt === 'work' ||
    /company|office|schedule|hours|days|timing|candidate|job|work|business|kitchen|project|repo|app|software|client|stack|career|colleague|coworker|mentor/.test(k)
  ) return 'work';
  if (
    mt === 'goals' ||
    /goal|target|passion|vision|ambition|marathon|milestone|deadline|aim|sprint/.test(k)
  ) return 'goals';
  if (
    mt === 'preferences' || mt === 'lifestyle' ||
    /favourite|food|drink|beverage|color|routine|habit|gym|workout|fitness|diet|sleep|car|bike|vehicle|guitar|piano|music|travel|trip|doctor|health|hobby|sport/.test(k)
  ) return 'lifestyle';
  return 'identity';
}

function toDisplayNames(key: string = '', value: string = '', fallbackName: string = ''): { title: string; sub?: string } {
  const k = (key || '').toLowerCase();
  const v = (value || '').trim();

  // If fallbackName already has (Role) format e.g. "Sakshi (Wife)"
  if (!k && fallbackName) {
    const match = fallbackName.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      return { title: match[1].trim(), sub: match[2].trim() };
    }
  }

  if (k.startsWith('entity:')) {
    const subParts = k.replace(/^entity:/, '').split(':');
    const entityScoped = (subParts[0] || '').replace(/^person_/, '').split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    const attr = (subParts[1] || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      title: v || attr,
      sub: attr ? `${entityScoped} • ${attr}` : entityScoped
    };
  }

  if (k === 'wife_name' || k === 'sakshi') return { title: v || 'Sakshi', sub: 'Wife' };
  if (k === 'son_name' || k === 'shreshth') return { title: v || 'Shreshth', sub: 'Son' };
  if (k === 'son_nickname' || k === 'family_nickname' || k.includes('tiku') || k.includes('tuku')) return { title: v || 'Tuku', sub: 'Nickname' };
  if (k.includes('nail_art') || k.includes('nail') || k.includes('self_taught') || k.includes('beautiful_art')) {
    return { title: 'Nail Artist', sub: 'Creative Skill' };
  }
  if (k === 'son_birth_date' || k === 'son_dob' || k.includes('son_bday') || k.includes('tuku_dob') || k.includes('tiku_dob') || k.includes('tuku_b') || k.includes('tiku_b') || k.includes('shreshth_b') || k.includes('shreshth_dob') || k.includes('child_b') || k.includes('child_dob') || k.includes('shreshth_date_of_birth') || k.includes('son_date_of_birth')) return { title: v || '17 Feb 2026', sub: 'Birthday' };
  if (k === 'wife_birth_date' || k === 'wife_birthday' || k.includes('sakshi_b') || k.includes('wife_dob')) return { title: v || '23 July', sub: 'Birthday' };
  if (k === 'son_age' || k === 'child_age' || k === 'baby_age') {
    const cleanAge = (v || '').replace(/(\s*old)+$/i, '').trim();
    return { title: cleanAge ? `${cleanAge} old` : 'Age', sub: 'Age' };
  }
  if (k === 'likes_wifes_cooking') return { title: "Wife's Cooking", sub: 'Hobby / Food' };
  if (k === 'venture_name' || k === 'business_venture' || k === 'cloud_kitchen_business' || k === 'dhaba_venture') {
    return { title: v || "Shetty's Dhaba", sub: 'Venture' };
  }
  if (k === 'father_name') return { title: v || 'Father', sub: 'Father' };
  if (k === 'mother_name') return { title: v || 'Mother', sub: 'Mother' };
  if (k === 'mother_occupation' || k === 'mother_job') return { title: v || 'Tailor', sub: 'Mother Occupation' };
  if (k === 'father_business' || k === 'father_job') return { title: v || 'Business', sub: 'Father Business' };
  if (k === 'daughter_name') return { title: v || 'Daughter', sub: 'Daughter' };
  if (k === 'sister_name') return { title: v || 'Sister', sub: 'Sister' };
  if (k === 'brother_name') return { title: v || 'Brother', sub: 'Brother' };
  if (k === 'company_name' || k === 'current_company') return { title: v || 'Company', sub: 'Company' };
  if (k === 'work_schedule') return { title: '11am - 8pm', sub: 'Work Hours' };
  if (k === 'office_hours') return { title: v || 'Office Hours', sub: 'Office Hours' };
  if (k === 'current_office_location') return { title: v || 'Location', sub: 'Office Location' };
  if (k === 'candidates_for_job') return { title: v || 'Interviews', sub: 'Candidate Pipeline' };
  if (k === 'hope_for_job_selection') return { title: 'Target: 2', sub: 'Selections' };
  if (k === 'goals' || k === 'primary_goal') return { title: v || 'Ambition', sub: 'Primary Goal' };
  if (k === 'passions') return { title: 'Passions', sub: 'Core Driver' };
  if (k === 'preferred_name') {
    const clean = v.replace(/^Prefers to be called\s+/i, '').replace(/\.$/, '');
    return { title: clean, sub: 'Name' };
  }

  // Generic fallback: check if fallbackName has (Role)
  if (fallbackName) {
    const match = fallbackName.match(/^(.*?)\s*\((.*?)\)$/);
    if (match) {
      return { title: match[1].trim(), sub: match[2].trim() };
    }
  }

  // Dynamic multi-segment keys: <prefix>_<entity>_<trait> or <entity>_<trait>
  const parts = (key || '').split('_');
  if (parts.length >= 3) {
    const entity = parts[1].replace(/\b\w/g, c => c.toUpperCase());
    const trait = parts.slice(2).join(' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      title: v || trait,
      sub: `${trait} (${entity})`
    };
  }
  if (parts.length === 2) {
    const entity = parts[0].replace(/\b\w/g, c => c.toUpperCase());
    const trait = parts[1].replace(/\b\w/g, c => c.toUpperCase());
    return {
      title: v || trait,
      sub: `${trait}`
    };
  }

  const cleanKey = (key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return {
    title: v || cleanKey || 'Memory',
    sub: cleanKey || 'Attribute'
  };
}

// ----------------------------------------------------
// TREE & STEMS HIERARCHICAL GALAXY ALGORITHM
// Central Sun -> Department Trunks -> Entity Branches -> Attribute Stems
// Safe coordinate bounds: [120, 880] within 1000x1000 universe
// ----------------------------------------------------
function buildPlanetaryGalaxy(rawNodes: any[] = [], rawEdges: any[] = []) {
  const nodes: GraphNode[] = [];
  const nodeMap = new Map<string, GraphNode>();

  // 1. Central Sun (Core User)
  const rawCore = rawNodes.find(n => n && (n.id === 'user-core' || n.entity_type === 'self'));
  const user = useAuthStore.getState().user;
  const coreName = (rawCore?.name && rawCore.name !== 'Saa')
    ? rawCore.name
    : (user?.preferred_name || user?.name || rawCore?.name || 'You');
  const coreNode: GraphNode = {
    id: 'user-core',
    name: coreName,
    shortName: coreName,
    subLabel: 'Central Core',
    entity_type: 'self',
    department: 'identity',
    color: '#8B5CF6',
    radius: 30,
    value: rawCore?.value || `${coreName} · Central Brain & Consciousness`,
    isHub: true,
    emoji: '🧠',
    hierarchyLevel: 1,
    treePath: [coreName],
    x: CENTER,
    y: CENTER,
    x3d: 0,
    y3d: 0,
    z3d: 0
  };
  nodes.push(coreNode);
  nodeMap.set(coreNode.id, coreNode);

  // Group items by department (excluding core and dept hubs)
  const deptBuckets: Record<string, any[]> = {
    family: [], work: [], goals: [], lifestyle: [], identity: []
  };

  function isPlaceholderValue(val?: string | null): boolean {
    if (!val) return true;
    const v = val.trim().toLowerCase();
    if (v.length < 2) return true;
    return /^(not\s+mentioned|not\s+available|none|null|undefined|unknown|n\/a|na|no\s+data|empty|to\s+be\s+decided|tbd|to\s+be\s+revised|not\s+specified|unspecified|not\s+provided|no\s+information|extra\s+with\s+no\s+data|since\s+the\s+son|as\s+an\s+infant)$/i.test(v);
  }

  for (const n of rawNodes) {
    if (!n || n.id === 'user-core' || n.isHub || n.isDepartment || n.id?.startsWith('dept-')) continue;
    if (isPlaceholderValue(n.value)) continue;
    const d = n.department || inferDomain(n.raw_key || n.id, n.entity_type);
    if (!deptBuckets[d]) deptBuckets[d] = [];
    deptBuckets[d].push(n);
  }

  // 2. Department Hubs (Level 1 Trunks) at Radius 380
  const DEPT_ORBIT_RADIUS = 380;
  const deptList: DepartmentMeta[] = [];
  const DEPT_KEYS = ['family', 'work', 'goals', 'lifestyle', 'identity'];

  // Anatomical 3D Brain Coordinates for 5 Main Functional Lobes
  const DEPT_3D_COORDS: Record<string, { x: number; y: number; z: number }> = {
    goals: { x: -40, y: 360, z: 140 },       // Prefrontal Polar Cortex (Dorsal & Anterior)
    work: { x: -340, y: 160, z: 240 },       // Left Frontal Executive Lobe
    family: { x: 340, y: -75, z: 240 },      // Right Temporal & Limbic Lobe
    lifestyle: { x: 280, y: -200, z: -260 }, // Right Occipital & Somatosensory Lobe
    identity: { x: -270, y: -180, z: -260 }  // Left Parietal Cortical Lobe
  };

  for (const d of DEPT_KEYS) {
    const meta = DOMAIN_COLORS[d] || DOMAIN_COLORS.identity;
    const angle = DEPT_ANGLES[d] ?? 0;
    const hx = Math.round(CENTER + DEPT_ORBIT_RADIUS * Math.cos(angle));
    const hy = Math.round(CENTER + DEPT_ORBIT_RADIUS * Math.sin(angle));
    const coords3d = DEPT_3D_COORDS[d] || { x: 0, y: 0, z: 0 };

    const hubId = `dept-${d}`;
    const hubNode: GraphNode = {
      id: hubId,
      name: meta.name,
      shortName: meta.short,
      subLabel: `${deptBuckets[d]?.length || 0} stems`,
      entity_type: 'department',
      department: d,
      color: meta.color,
      radius: 22,
      value: `${meta.name} Trunk (${deptBuckets[d]?.length || 0} connected memories & stems)`,
      isDepartment: true,
      emoji: meta.emoji,
      parentEntityId: 'user-core',
      hierarchyLevel: 1,
      treePath: [coreName, meta.short],
      x: hx,
      y: hy,
      x3d: coords3d.x,
      y3d: coords3d.y,
      z3d: coords3d.z
    };
    nodes.push(hubNode);
    nodeMap.set(hubNode.id, hubNode);

    deptList.push({
      id: d,
      name: meta.name,
      emoji: meta.emoji,
      color: meta.color,
      count: deptBuckets[d]?.length || 0,
      x: hx,
      y: hy
    });

    // 3. Tree Hierarchy: Separate Level 2 Branches vs Level 3 Stems
    const members = deptBuckets[d] || [];
    if (members.length === 0) continue;

    // Identify Entity Branches (Level 2) and Stems (Level 3)
    const rawBranchItems: any[] = [];
    const rawStemItems: any[] = [];

    // Partition members with domain-aware entity linking
    for (const mem of members) {
      const k = (mem.raw_key || mem.id || '').toLowerCase();
      const cleanK = k.replace(/^mem-|^wm-/, '');
      const parts = cleanK.split('_');

      if (d === 'family') {
        if (cleanK === 'family_details' || cleanK.includes('family_details')) {
          // Composite summary - skip so individual family member entities are authoritative
          continue;
        }
        if (k === 'family_nickname' || k.includes('family_nick') || k.includes('tiku') || k.includes('tuku') || k.includes('son_nick') || k.includes('child_age') || k.includes('baby_age') || k.includes('son_age') || k.includes('son_birth') || k.includes('shreshth_date_of_birth') || k.includes('notes')) {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-son_name';
          rawStemItems.push(mem);
          continue;
        }
        if (k.includes('nail') || k.includes('self_taught') || k.includes('beautiful_art') || k.includes('cooking') || k.includes('wife_birth') || k.includes('wife_bday')) {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-wife_name';
          rawStemItems.push(mem);
          continue;
        }
        if (cleanK.startsWith('daughter_') && cleanK !== 'daughter_name') {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-daughter_name';
          rawStemItems.push(mem);
          continue;
        }
        if (cleanK.startsWith('father_') && cleanK !== 'father_name') {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-father_name';
          rawStemItems.push(mem);
          continue;
        }
        if (cleanK.startsWith('mother_') && cleanK !== 'mother_name') {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-mother_name';
          rawStemItems.push(mem);
          continue;
        }
        if (cleanK.startsWith('husband_') && cleanK !== 'husband_name') {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-husband_name';
          rawStemItems.push(mem);
          continue;
        }
        if (cleanK.startsWith('partner_') && cleanK !== 'partner_name') {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-partner_name';
          rawStemItems.push(mem);
          continue;
        }
      }

      if (d === 'work') {
        const isCompanyBranch = cleanK === 'company_name' || cleanK === 'current_company' || cleanK === 'office_name';
        const isVentureBranch = cleanK === 'venture_name' || cleanK === 'business_venture' || cleanK === 'cloud_kitchen_business' || cleanK === 'dhaba_venture';

        if (isCompanyBranch || isVentureBranch) {
          mem.hierarchyLevel = 2;
          rawBranchItems.push(mem);
          continue;
        }
        if (cleanK.includes('pf_') || cleanK.includes('kitchen') || cleanK.includes('dhaba') || cleanK.includes('venture')) {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-venture_name';
          rawStemItems.push(mem);
          continue;
        }
        if (cleanK.includes('schedule') || cleanK.includes('hours') || cleanK.includes('timing') || cleanK.includes('location') || cleanK.includes('candidate') || cleanK.includes('interview') || cleanK.includes('office') || cleanK.includes('target') || cleanK.includes('selection')) {
          mem.hierarchyLevel = 3;
          mem.parentEntityId = 'mem-company_name';
          rawStemItems.push(mem);
          continue;
        }
      }

      // Dynamic multi-segment keys (e.g. pet_coco_breed, project_helios_stack, friend_rohit_job)
      if (parts.length >= 3) {
        mem.hierarchyLevel = 3;
        mem.parentEntityId = `mem-${parts[0]}_${parts[1]}`;
        rawStemItems.push(mem);
        continue;
      }

      if (mem.hierarchyLevel === 3 || (mem.parentEntityId && mem.parentEntityId !== hubId && mem.parentEntityId !== 'user-core')) {
        rawStemItems.push(mem);
      } else {
        rawBranchItems.push(mem);
      }
    }

    // Collapse duplicate branch items (e.g. wife_sakshi and sakshi and wife_name)
    const branchItems: any[] = [];
    const seenBranchKeys = new Set<string>();
    for (const b of rawBranchItems) {
      const bKey = (b.raw_key || b.name || '').toLowerCase();
      let norm = bKey;
      if (norm.includes('family_details') || norm === 'family_details') continue;
      if (norm.includes('sakshi') || norm.includes('wife')) norm = 'sakshi';
      if (norm.includes('shreshth') || norm.includes('son')) norm = 'shreshth';
      if (norm.includes('tiku') || norm.includes('tuku') || norm.includes('family_nickname') || norm.includes('son_nickname')) {
        // Redundant nickname in branch list - should never be an entity branch
        continue;
      }
      if (seenBranchKeys.has(norm)) continue;
      seenBranchKeys.add(norm);
      branchItems.push(b);
    }

    // Deduplicate redundant nail art / self-taught stems under Sakshi
    const seenNailArt = new Set<string>();
    const stemItems: any[] = [];
    for (const s of rawStemItems) {
      const sk = (s.raw_key || s.id || '').toLowerCase();
      if (sk.includes('nail') || sk.includes('self_taught') || sk.includes('beautiful_art')) {
        if (seenNailArt.has('nail_art')) continue;
        seenNailArt.add('nail_art');
        s.name = 'Nail Artist';
        s.shortName = 'Nail Artist';
        s.subLabel = 'Creative Skill';
        s.value = 'Self-taught nail artist (creates beautiful art with kit from last year)';
        s.raw_key = 'wife_nail_art_skill';
      }
      stemItems.push(s);
    }

    // If all items ended up in stemItems but no branches (edge case), promote the primary parent
    if (branchItems.length === 0 && stemItems.length > 0) {
      branchItems.push(stemItems.shift()!);
    }

    // Position Level 2 Branches: Fanning outward from Department Hub (hx, hy)
    const branchCount = branchItems.length;
    const branchDist = 330;
    const branchSpread = Math.min(Math.PI * 0.85, Math.max(0.55, (branchCount - 1) * 0.46));

    // 3D Direction & Orthogonal Basis for Branch Arborization
    const h3d = coords3d;
    const hLen = Math.sqrt(h3d.x * h3d.x + h3d.y * h3d.y + h3d.z * h3d.z) || 1;
    const ux = h3d.x / hLen;
    const uy = h3d.y / hLen;
    const uz = h3d.z / hLen;

    let px3d = -uy;
    let py3d = ux;
    let pz3d = 0;
    const pLen = Math.sqrt(px3d * px3d + py3d * py3d);
    if (pLen > 0.001) {
      px3d /= pLen; py3d /= pLen;
    } else {
      px3d = 1; py3d = 0; pz3d = 0;
    }
    const qx3d = uy * pz3d - uz * py3d;
    const qy3d = uz * px3d - ux * pz3d;
    const qz3d = ux * py3d - uy * px3d;

    branchItems.forEach((bMem, bIdx) => {
      const names = toDisplayNames(bMem.raw_key, bMem.value, bMem.name);
      const frac = branchCount === 1 ? 0 : (bIdx / (branchCount - 1) - 0.5);
      const bAngle = angle + frac * branchSpread;

      const bx = Math.round(hx + branchDist * Math.cos(bAngle));
      const by = Math.round(hy + branchDist * Math.sin(bAngle));

      const branchAngle3d = frac * Math.PI * 0.82;
      const branchDist3d = 260;
      const bx3d = Math.round(h3d.x + ux * (branchDist3d * 0.35) + (px3d * Math.cos(branchAngle3d) + qx3d * Math.sin(branchAngle3d)) * branchDist3d);
      const by3d = Math.round(h3d.y + uy * (branchDist3d * 0.35) + (py3d * Math.cos(branchAngle3d) + qy3d * Math.sin(branchAngle3d)) * branchDist3d);
      const bz3d = Math.round(h3d.z + uz * (branchDist3d * 0.35) + (pz3d * Math.cos(branchAngle3d) + qz3d * Math.sin(branchAngle3d)) * branchDist3d);

      const treePath = bMem.treePath || [coreName, meta.short, names.title];

      const branchNode: GraphNode = {
        id: bMem.id || `node-${d}-branch-${bIdx}`,
        name: names.title,
        shortName: names.title,
        subLabel: names.sub,
        entity_type: bMem.entity_type || 'entity_branch',
        department: d,
        color: bMem.isContext ? '#06B6D4' : meta.color,
        radius: 18,
        value: bMem.value || names.title,
        raw_key: bMem.raw_key,
        isContext: bMem.isContext,
        emoji: bMem.isContext ? '⚡' : undefined,
        parentEntityId: hubId,
        hierarchyLevel: 2,
        treePath,
        x: bx,
        y: by,
        x3d: bx3d,
        y3d: by3d,
        z3d: bz3d
      };

      nodes.push(branchNode);
      nodeMap.set(branchNode.id, branchNode);
      if (bMem.raw_key) nodeMap.set(bMem.raw_key, branchNode);
    });

    // Position Level 3 Stems: Fanning outward from their respective Parent Branch
    const stemsByParent = new Map<string, any[]>();
    for (const stem of stemItems) {
      let pId = stem.parentEntityId || branchItems[0]?.id;
      // Smart re-mapping if parentId was conceptual
      if (pId === 'mem-son_name') {
        const foundSon = branchItems.find(b => {
          const bk = (b.raw_key || b.name || '').toLowerCase();
          return bk.includes('son') || bk.includes('shreshth');
        });
        if (foundSon) pId = foundSon.id;
      } else if (pId === 'mem-wife_name') {
        const foundWife = branchItems.find(b => {
          const bk = (b.raw_key || b.name || '').toLowerCase();
          return bk.includes('wife') || bk.includes('sakshi');
        });
        if (foundWife) pId = foundWife.id;
      } else if (pId === 'mem-daughter_name') {
        const found = branchItems.find(b => (b.raw_key || b.name || '').toLowerCase().includes('daughter'));
        if (found) pId = found.id;
      } else if (pId === 'mem-father_name') {
        const found = branchItems.find(b => (b.raw_key || b.name || '').toLowerCase().includes('father'));
        if (found) pId = found.id;
      } else if (pId === 'mem-mother_name') {
        const found = branchItems.find(b => (b.raw_key || b.name || '').toLowerCase().includes('mother'));
        if (found) pId = found.id;
      } else if (pId === 'mem-husband_name') {
        const found = branchItems.find(b => (b.raw_key || b.name || '').toLowerCase().includes('husband'));
        if (found) pId = found.id;
      } else if (pId === 'mem-partner_name') {
        const found = branchItems.find(b => (b.raw_key || b.name || '').toLowerCase().includes('partner'));
        if (found) pId = found.id;
      } else if (pId === 'mem-venture_name') {
        const found = branchItems.find(b => {
          const bk = (b.raw_key || b.name || '').toLowerCase();
          return bk.includes('venture') || bk.includes('dhaba') || bk.includes('kitchen');
        });
        if (found) pId = found.id;
      } else if (pId === 'mem-company_name') {
        const found = branchItems.find(b => {
          const bk = (b.raw_key || b.name || '').toLowerCase();
          return bk.includes('company') || bk.includes('conviction');
        });
        if (found) pId = found.id;
      } else if (pId) {
        const foundBranch = branchItems.find(b => b.id === pId || b.raw_key === pId || (b.raw_key && pId.includes(b.raw_key)));
        if (foundBranch) pId = foundBranch.id;
      }
      if (!stemsByParent.has(pId)) stemsByParent.set(pId, []);
      stemsByParent.get(pId)!.push(stem);
    }

    stemsByParent.forEach((stems, parentId) => {
      const parentNode = nodeMap.get(parentId) || branchItems.find(b => b.id === parentId) || branchItems[0];
      const px = parentNode ? parentNode.x : hx;
      const py = parentNode ? parentNode.y : hy;

      // Base angle pointing away from dept hub (or center)
      const baseStemAngle = parentNode
        ? Math.atan2(parentNode.y - hy, parentNode.x - hx)
        : angle;

      const sCount = stems.length;
      const stemDist = 240;
      const stemSpread = Math.min(Math.PI * 0.95, Math.max(0.55, (sCount - 1) * 0.44));

      const pBranch3d = (parentNode && parentNode.x3d !== undefined)
        ? { x: parentNode.x3d, y: parentNode.y3d || 0, z: parentNode.z3d || 0 }
        : h3d;

      stems.forEach((sMem, sIdx) => {
        const names = toDisplayNames(sMem.raw_key, sMem.value, sMem.name);
        const sFrac = sCount === 1 ? 0 : (sIdx / (sCount - 1) - 0.5);
        const sAngle = baseStemAngle + sFrac * stemSpread;

        // Radial staggering provides comfortable breathing room for full text badges
        const effectiveStemDist = stemDist + (sIdx % 2 === 0 ? 0 : 70);
        const sx = Math.round(px + effectiveStemDist * Math.cos(sAngle));
        const sy = Math.round(py + effectiveStemDist * Math.sin(sAngle));

        const stemAngle3d = sFrac * Math.PI * 0.95;
        const stemDist3d = 175 + (sIdx % 3) * 45;
        const zOffset = ((sIdx % 3) - 1) * 65;

        const sx3d = Math.round(pBranch3d.x + (px3d * Math.cos(stemAngle3d) + qx3d * Math.sin(stemAngle3d)) * stemDist3d);
        const sy3d = Math.round(pBranch3d.y + (py3d * Math.cos(stemAngle3d) + qy3d * Math.sin(stemAngle3d)) * stemDist3d);
        const sz3d = Math.round(pBranch3d.z + zOffset + (pz3d * Math.cos(stemAngle3d) + qz3d * Math.sin(stemAngle3d)) * stemDist3d);

        const treePath = sMem.treePath || (parentNode ? [...(parentNode.treePath || []), names.title] : [coreName, meta.short, names.title]);

        const stemNode: GraphNode = {
          id: sMem.id || `node-${d}-stem-${sIdx}`,
          name: names.title,
          shortName: names.title,
          subLabel: names.sub,
          entity_type: sMem.entity_type || 'attribute_stem',
          department: d,
          color: sMem.isContext ? '#06B6D4' : meta.color,
          radius: 14,
          value: sMem.value || names.title,
          raw_key: sMem.raw_key,
          isContext: sMem.isContext,
          emoji: sMem.isContext ? '⚡' : undefined,
          parentEntityId: parentNode?.id || hubId,
          hierarchyLevel: 3,
          treePath,
          x: sx,
          y: sy,
          x3d: sx3d,
          y3d: sy3d,
          z3d: sz3d
        };

        nodes.push(stemNode);
        nodeMap.set(stemNode.id, stemNode);
      });
    });
  }

  // 4. Edges Construction (Preserve raw edges or synthesize tree lines + cross bridges)
  const edges: GraphEdge[] = [];
  const edgeSet = new Set<string>();

  if (rawEdges && rawEdges.length > 0) {
    for (const re of rawEdges) {
      if (!re) continue;
      const sId = typeof re.source === 'string' ? re.source : re.source?.id;
      const tId = typeof re.target === 'string' ? re.target : re.target?.id;
      if (!sId || !tId || sId === tId) continue;

      const sNode = nodeMap.get(sId);
      const tNode = nodeMap.get(tId);
      if (!sNode || !tNode) continue;

      const edgeKey = `${sId}-->${tId}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);

      const isCross = !!re.isCrossDomain;
      let pathD: string | undefined;
      let midX = Math.round((sNode.x + tNode.x) / 2);
      let midY = Math.round((sNode.y + tNode.y) / 2);

      if (isCross) {
        const dx = tNode.x - sNode.x;
        const dy = tNode.y - sNode.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 1) {
          const nx = -dy / dist;
          const ny = dx / dist;
          const curveAmount = Math.min(120, Math.max(50, dist * 0.18));
          const ctrlX = Math.round((sNode.x + tNode.x) / 2 + nx * curveAmount);
          const ctrlY = Math.round((sNode.y + tNode.y) / 2 + ny * curveAmount);
          pathD = `M ${sNode.x} ${sNode.y} Q ${ctrlX} ${ctrlY} ${tNode.x} ${tNode.y}`;
          // Midpoint of quadratic Bézier at t=0.5
          midX = Math.round(0.25 * sNode.x + 0.5 * ctrlX + 0.25 * tNode.x);
          midY = Math.round(0.25 * sNode.y + 0.5 * ctrlY + 0.25 * tNode.y);
        }
      }

      edges.push({
        id: re.id || `edge-${sId}-${tId}`,
        source: sId,
        target: tId,
        sourceNode: sNode,
        targetNode: tNode,
        relation: re.relation || (isCross ? 'NEURAL_BRIDGE' : 'CONNECTED'),
        color: re.color || (isCross ? '#C084FC' : sNode.color),
        isCrossDomain: isCross,
        weight: re.weight || (isCross ? 2.5 : 1.5),
        edgeType: re.edgeType || (isCross ? 'NEURAL_BRIDGE' : 'ATTRIBUTE_STEM'),
        explanation: re.explanation,
        pathD,
        midX,
        midY
      });
    }
  } else {
    // Fallback edge creation if rawEdges was empty
    for (const d of DEPT_KEYS) {
      const hubId = `dept-${d}`;
      const hub = nodeMap.get(hubId);
      if (!hub) continue;

      // Core -> Dept Hub
      edges.push({
        id: `edge-core-${d}`,
        source: 'user-core',
        target: hubId,
        sourceNode: coreNode,
        targetNode: hub,
        relation: 'DEPARTMENT_TRUNK',
        color: 'rgba(255,255,255,0.25)',
        weight: 3,
        edgeType: 'DEPARTMENT_BRANCH',
        explanation: `Main trunk connecting core to ${hub.name}`,
        midX: Math.round((coreNode.x + hub.x) / 2),
        midY: Math.round((coreNode.y + hub.y) / 2)
      });
    }

    // Connect child nodes to their parentEntityId
    for (const n of nodes) {
      if (!n.parentEntityId || n.id === 'user-core' || n.id.startsWith('dept-')) continue;
      const parent = nodeMap.get(n.parentEntityId);
      if (!parent) continue;

      edges.push({
        id: `edge-${parent.id}-${n.id}`,
        source: parent.id,
        target: n.id,
        sourceNode: parent,
        targetNode: n,
        relation: n.hierarchyLevel === 2 ? 'ENTITY_BRANCH' : 'ATTRIBUTE_STEM',
        color: parent.color,
        weight: n.hierarchyLevel === 2 ? 2 : 1.2,
        edgeType: n.hierarchyLevel === 2 ? 'ENTITY_BRANCH' : 'ATTRIBUTE_STEM',
        explanation: `${n.name} branch under ${parent.name}`,
        midX: Math.round((parent.x + n.x) / 2),
        midY: Math.round((parent.y + n.y) / 2)
      });
    }
  }

  return { nodes, edges, departments: deptList };
}

// Resilient fallback synthesizer
function synthesizeGalaxy(memories: any[] = [], workingContext: any[] = []) {
  const rawNodes: any[] = [];
  const rawEdges: any[] = [];
  const ids = new Set<string>();

  const allItems: Array<{ id: string; key: string; value: string; isContext?: boolean }> = [];
  for (const m of (memories || [])) {
    if (!m || !m.key || !m.value) continue;
    if (/^(not\s+mentioned|not\s+available|none|null|undefined|unknown|n\/a|na|no\s+data|empty|to\s+be\s+decided|tbd|to\s+be\s+revised|not\s+specified|unspecified|not\s+provided|no\s+information|extra\s+with\s+no\s+data|since\s+the\s+son|as\s+an\s+infant)$/i.test(String(m.value).trim())) continue;
    allItems.push({ id: `mem-${m.key}`, key: m.key, value: m.value });
  }
  for (const w of (workingContext || [])) {
    if (!w || !w.key || !w.value) continue;
    if (/^(not\s+mentioned|not\s+available|none|null|undefined|unknown|n\/a|na|no\s+data|empty|to\s+be\s+decided|tbd|to\s+be\s+revised|not\s+specified|unspecified|not\s+provided|no\s+information|extra\s+with\s+no\s+data|since\s+the\s+son|as\s+an\s+infant)$/i.test(String(w.value).trim())) continue;
    allItems.push({ id: `wm-${w.key}`, key: w.key, value: w.value, isContext: true });
  }

  const allKeys = new Set(allItems.map(i => i.key.toLowerCase()));

  for (const item of allItems) {
    if (ids.has(item.id)) continue;
    const d = inferDomain(item.key);
    const k = item.key.toLowerCase();

    let parentId = `dept-${d}`;
    let hierarchyLevel: 2 | 3 = 2;
    let relation = item.isContext ? 'ACTIVE_FOCUS' : 'CONTAINS';
    let edgeType: 'ENTITY_BRANCH' | 'ATTRIBUTE_STEM' = 'ENTITY_BRANCH';
    let explanation = `Belongs to ${d}`;

    // Family Stems
    if (d === 'family') {
      if (k === 'family_details' || k.includes('family_details')) {
        // Skip composite summary so individual family member entities are authoritative
        continue;
      }
      if (['wife_name', 'son_name', 'father_name', 'mother_name', 'daughter_name', 'sakshi', 'shreshth'].includes(k)) {
        hierarchyLevel = 2;
        relation = 'FAMILY_MEMBER';
        edgeType = 'ENTITY_BRANCH';
        explanation = 'Family member branch';
      } else if (
        (k.startsWith('wife_') || k === 'likes_wifes_cooking' || k.includes('sakshi') || k.includes('nail_art') || k.includes('self_taught') || k.includes('beautiful_art') || k.includes('nail')) &&
        (allKeys.has('wife_name') || allKeys.has('sakshi'))
      ) {
        parentId = allKeys.has('wife_name') ? 'mem-wife_name' : (allItems.find(i => i.key.toLowerCase().includes('sakshi'))?.id || 'dept-family');
        hierarchyLevel = 3;
        relation = k.includes('cook') ? 'COOKING_HOBBY' : k.includes('nail') || k.includes('art') ? 'CREATIVE_SKILL' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Wife (Sakshi)";
      } else if (
        (k.startsWith('son_') || k === 'child_age' || k.startsWith('baby_') || k.includes('tiku') || k.includes('shreshth')) &&
        (allKeys.has('son_name') || allKeys.has('shreshth'))
      ) {
        parentId = allKeys.has('son_name') ? 'mem-son_name' : (allItems.find(i => i.key.toLowerCase().includes('shreshth'))?.id || 'dept-family');
        hierarchyLevel = 3;
        relation = k.includes('age') ? 'AGE' : k.includes('nick') || k.includes('tiku') ? 'NICKNAME' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Son (Shreshth / Tiku)";
      } else if (k.startsWith('father_') && allKeys.has('father_name')) {
        parentId = 'mem-father_name';
        hierarchyLevel = 3;
        relation = k.includes('business') ? 'FATHER_BUSINESS' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Father";
      } else if (k.startsWith('mother_') && allKeys.has('mother_name')) {
        parentId = 'mem-mother_name';
        hierarchyLevel = 3;
        relation = (k.includes('occupat') || k.includes('job')) ? 'OCCUPATION' : 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Mother";
      } else if (k.startsWith('daughter_') && allKeys.has('daughter_name')) {
        parentId = 'mem-daughter_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Daughter";
      } else if (k.startsWith('husband_') && allKeys.has('husband_name')) {
        parentId = 'mem-husband_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Husband";
      } else if (k.startsWith('partner_') && allKeys.has('partner_name')) {
        parentId = 'mem-partner_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Partner";
      } else if (k.startsWith('sister_') && allKeys.has('sister_name')) {
        parentId = 'mem-sister_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Sister";
      } else if (k.startsWith('brother_') && allKeys.has('brother_name')) {
        parentId = 'mem-brother_name';
        hierarchyLevel = 3;
        relation = 'MEMBER_ATTRIBUTE';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Brother";
      }
    }

    // Dynamic multi-segment keys (e.g. pet_coco_breed, project_helios_stack, friend_rohit_job)
    const cleanKey = k.replace(/^mem-|^wm-/, '');
    const parts = cleanKey.split('_');
    if (parts.length >= 3) {
      const dynEntityKey = `mem-${parts[0]}_${parts[1]}`;
      if (!ids.has(dynEntityKey)) {
        const entityName = parts[1].replace(/\b\w/g, c => c.toUpperCase());
        rawNodes.push({
          id: dynEntityKey,
          raw_key: `${parts[0]}_${parts[1]}`,
          name: entityName,
          value: `${entityName} · Entity Branch`,
          department: d,
          entity_type: parts[0],
          parentEntityId: `dept-${d}`,
          hierarchyLevel: 2
        });
        ids.add(dynEntityKey);
        rawEdges.push({
          id: `edge-dept-${d}-${dynEntityKey}`,
          source: `dept-${d}`,
          target: dynEntityKey,
          relation: 'ENTITY_BRANCH',
          edgeType: 'ENTITY_BRANCH',
          explanation: `Entity branch for ${entityName}`
        });
      }
      parentId = dynEntityKey;
      hierarchyLevel = 3;
      edgeType = 'ATTRIBUTE_STEM';
      relation = parts.slice(2).join('_').toUpperCase();
      explanation = `Detail stem of ${parts[1]}`;
    }

    // Work Stems
    if (d === 'work') {
      if (['company_name', 'business_name', 'cloud_kitchen_business'].includes(k)) {
        hierarchyLevel = 2;
        relation = 'ORGANIZATION';
        edgeType = 'ENTITY_BRANCH';
        explanation = 'Organization / Business in Career Tree';
      } else if (allKeys.has('company_name')) {
        parentId = 'mem-company_name';
        hierarchyLevel = 3;
        relation = k.includes('schedule') ? 'WORK_SCHEDULE' : k.includes('candidate') ? 'HIRING_TARGET' : 'WORK_DETAIL';
        edgeType = 'ATTRIBUTE_STEM';
        explanation = "Detail stem of Company";
      }
    }

    // Goals Stems
    if (d === 'goals') {
      if (k === 'goals' || k === 'primary_goal') {
        hierarchyLevel = 2;
        relation = 'PRIMARY_GOAL';
        edgeType = 'ENTITY_BRANCH';
        explanation = 'Primary Goal branch';
      }
    }

    rawNodes.push({
      id: item.id,
      raw_key: item.key,
      name: item.key,
      value: item.value,
      department: d,
      entity_type: item.isContext ? 'active_context' : 'memory',
      isContext: item.isContext,
      parentEntityId: parentId,
      hierarchyLevel
    });
    ids.add(item.id);

    rawEdges.push({
      id: `edge-${parentId}-${item.id}`,
      source: parentId,
      target: item.id,
      relation,
      edgeType,
      explanation
    });
  }

  // Cross-domain neural bridges
  if (ids.has('mem-work_schedule') && ids.has('mem-wife_name')) {
    rawEdges.push({
      id: 'cross-sched-wife',
      source: 'mem-work_schedule',
      target: 'mem-wife_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Evening transition: Work hours wrap up into family time with wife'
    });
  }
  if (ids.has('mem-work_schedule') && ids.has('mem-son_name')) {
    rawEdges.push({
      id: 'cross-sched-son',
      source: 'mem-work_schedule',
      target: 'mem-son_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Evening transition: Daily routine connects work hours to time with son'
    });
  }
  if (ids.has('wm-candidates_for_job') && ids.has('mem-goals')) {
    rawEdges.push({
      id: 'cross-cand-goal',
      source: 'wm-candidates_for_job',
      target: 'mem-goals',
      relation: 'POWERS_GOAL',
      color: '#10B981',
      isCrossDomain: true,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Recruitment drive directly powers long-term company scaling goal'
    });
  }
  if (ids.has('wm-candidates_for_job') && ids.has('mem-company_name')) {
    rawEdges.push({
      id: 'cross-cand-comp',
      source: 'wm-candidates_for_job',
      target: 'mem-company_name',
      relation: 'HIRING_AT',
      color: '#34D399',
      isCrossDomain: true,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Active interviews building the core team at the company'
    });
  }
  if (ids.has('mem-passions') && ids.has('mem-son_name')) {
    rawEdges.push({
      id: 'cross-pass-son',
      source: 'mem-passions',
      target: 'mem-son_name',
      relation: 'FAMILY_BOND',
      color: '#F472B6',
      isCrossDomain: true,
      edgeType: 'NEURAL_BRIDGE',
      explanation: 'Core life passions anchor nurturing family time with son'
    });
  }

  return buildPlanetaryGalaxy(rawNodes, rawEdges);
}

// Safe component error boundary
class KgErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; errorText: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorText: '' };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorText: error?.message || 'Unknown error' };
  }
  componentDidCatch(error: any, errorInfo: any) {
    console.error('[KgExplorerScreen] Caught UI error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.centerContainer}>
          <Text style={styles.errorTitle}>Knowledge Galaxy</Text>
          <Text style={styles.errorText}>Unable to load visual graph. Tap below to retry.</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, errorText: '' })}
          >
            <Text style={styles.retryBtnText}>Reload Galaxy</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

function KgExplorerContent() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [gestureMode, setGestureMode] = useState<'pan' | 'orbit'>('orbit');
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [departments, setDepartments] = useState<DepartmentMeta[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [lineFilter, setLineFilter] = useState<'all' | 'cross'>('all');
  const [lastSyncTime, setLastSyncTime] = useState<string>('just now');

  // Conversational Memory Surgery & On-the-Spot Correction State
  const [talkModalVisible, setTalkModalVisible] = useState(false);
  const [talkInput, setTalkInput] = useState('');
  const [directInput, setDirectInput] = useState('');
  const [isDirectEditMode, setIsDirectEditMode] = useState(false);
  const [surgicalLoading, setSurgicalLoading] = useState(false);
  const [novaFeedback, setNovaFeedback] = useState<string | null>(null);

  // Default 3D perspective camera state
  const defaultCamera = {
    pitch: 0.24, // ~14 deg tilt (X-axis)
    yaw: 0.35,   // ~20 deg orbit (Y-axis)
    roll: 0.0,   // 0 deg roll (Z-axis)
    panX: 0,
    panY: 0,
    scale: 0.70
  };

  const pendingCameraRef = useRef(defaultCamera);
  const [camera, setCamera] = useState(defaultCamera);
  const rafRef = useRef<number | null>(null);

  const pitch = useSharedValue(0.24);
  const yaw = useSharedValue(0.35);
  const roll = useSharedValue(0.0);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const scale = useSharedValue(0.70);

  const savedPitch = useSharedValue(0.24);
  const savedYaw = useSharedValue(0.35);
  const savedRoll = useSharedValue(0.0);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);
  const savedScale = useSharedValue(0.70);

  const [isAutoOrbit, setIsAutoOrbit] = useState(false);

  // Throttled 60/120 FPS camera sync to JS thread for mathematical 3D projection
  const syncCamera = useCallback((y: number, p: number, r: number, px: number, py: number, s: number) => {
    pendingCameraRef.current = { yaw: y, pitch: p, roll: r, panX: px, panY: py, scale: s };
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setCamera({ ...pendingCameraRef.current });
    });
  }, []);

  const fetchGraph = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      else setSyncing(true);

      let rawNodes: any[] = [];
      let rawEdges: any[] = [];

      try {
        const res = await api.get('/analytics/kg');
        if (res.data?.data?.nodes && Array.isArray(res.data.data.nodes) && res.data.data.nodes.length > 0) {
          rawNodes = res.data.data.nodes;
          rawEdges = res.data.data.edges || [];
        }
      } catch (e) {
        // Fallback below
      }

      if (!rawNodes || rawNodes.length === 0) {
        const memRes = await api.get('/analytics/memories');
        const memData = memRes.data?.data;
        if (memData) {
          const galaxy = synthesizeGalaxy(
            memData.currentMemories || [],
            memData.workingContext || []
          );
          setNodes(galaxy.nodes);
          setEdges(galaxy.edges);
          setDepartments(galaxy.departments);
          setLastSyncTime('just now');
          return;
        }
      }

      const galaxy = buildPlanetaryGalaxy(rawNodes, rawEdges);
      setNodes(galaxy.nodes);
      setEdges(galaxy.edges);
      setDepartments(galaxy.departments);
      setLastSyncTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (err) {
      console.error('Failed to load knowledge galaxy', err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph(false);

    // Auto-sync polling every 20 seconds while on screen
    const interval = setInterval(() => {
      fetchGraph(true);
    }, 20000);

    return () => clearInterval(interval);
  }, [fetchGraph]);

  // ----------------------------------------------------
  // FLUID GESTURE SYSTEM (GPU-DRIVEN ON NATIVE UI THREAD)
  // ----------------------------------------------------
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .onUpdate((e) => {
        'worklet';
        const next = Math.max(0.25, Math.min(5.0, savedScale.value * e.scale));
        scale.value = next;
        runOnJS(syncCamera)(yaw.value, pitch.value, roll.value, panX.value, panY.value, next);
      })
      .onEnd(() => {
        'worklet';
        savedScale.value = scale.value;
        runOnJS(syncCamera)(yaw.value, pitch.value, roll.value, panX.value, panY.value, scale.value);
      });
  }, [scale, savedScale, yaw, pitch, roll, panX, panY, syncCamera]);

  const panGesture = useMemo(() => {
    return Gesture.Pan()
      .minDistance(2)
      .onUpdate((e) => {
        'worklet';
        if (viewMode === '3d' && gestureMode === 'orbit') {
          // Continuous 360-degree rotation around Y (yaw) and X (pitch) with zero clamping!
          yaw.value = savedYaw.value + (e.translationX * 0.007);
          pitch.value = savedPitch.value - (e.translationY * 0.007);
        } else {
          panX.value = savedPanX.value + e.translationX;
          panY.value = savedPanY.value + e.translationY;
        }
        runOnJS(syncCamera)(yaw.value, pitch.value, roll.value, panX.value, panY.value, scale.value);
      })
      .onEnd(() => {
        'worklet';
        if (viewMode === '3d' && gestureMode === 'orbit') {
          savedYaw.value = yaw.value;
          savedPitch.value = pitch.value;
        } else {
          savedPanX.value = panX.value;
          savedPanY.value = panY.value;
        }
        runOnJS(syncCamera)(yaw.value, pitch.value, roll.value, panX.value, panY.value, scale.value);
      });
  }, [viewMode, gestureMode, yaw, pitch, savedYaw, savedPitch, panX, panY, savedPanX, savedPanY, roll, scale, syncCamera]);

  const rotationGesture = useMemo(() => {
    return Gesture.Rotation()
      .onUpdate((e) => {
        'worklet';
        if (viewMode === '3d') {
          // Free 360-degree continuous roll around Z-axis!
          roll.value = savedRoll.value + e.rotation;
          runOnJS(syncCamera)(yaw.value, pitch.value, roll.value, panX.value, panY.value, scale.value);
        }
      })
      .onEnd(() => {
        'worklet';
        if (viewMode === '3d') {
          savedRoll.value = roll.value;
          runOnJS(syncCamera)(yaw.value, pitch.value, roll.value, panX.value, panY.value, scale.value);
        }
      });
  }, [viewMode, roll, savedRoll, yaw, pitch, panX, panY, scale, syncCamera]);

  const composedGesture = useMemo(() => {
    return Gesture.Simultaneous(pinchGesture, panGesture, rotationGesture);
  }, [pinchGesture, panGesture, rotationGesture]);

  const handleResetView = useCallback(() => {
    pitch.value = withSpring(0.24, { damping: 18 });
    yaw.value = withSpring(0.35, { damping: 18 });
    roll.value = withSpring(0.0, { damping: 18 });
    panX.value = withSpring(0, { damping: 18 });
    panY.value = withSpring(0, { damping: 18 });
    scale.value = withSpring(0.70, { damping: 18 });

    savedPitch.value = 0.24;
    savedYaw.value = 0.35;
    savedRoll.value = 0.0;
    savedPanX.value = 0;
    savedPanY.value = 0;
    savedScale.value = 0.70;

    syncCamera(0.35, 0.24, 0.0, 0, 0, 0.70);
  }, [pitch, yaw, roll, panX, panY, scale, savedPitch, savedYaw, savedRoll, savedPanX, savedPanY, savedScale, syncCamera]);

  const handleSpinY = useCallback(() => {
    const next = yaw.value + Math.PI / 2;
    yaw.value = withSpring(next, { damping: 16 });
    savedYaw.value = next;
    syncCamera(next, pitch.value, roll.value, panX.value, panY.value, scale.value);
  }, [yaw, savedYaw, pitch, roll, panX, panY, scale, syncCamera]);

  const handleZoomIn = useCallback(() => {
    const next = Math.min(scale.value * 1.3, 5.0);
    scale.value = withSpring(next);
    savedScale.value = next;
    syncCamera(yaw.value, pitch.value, roll.value, panX.value, panY.value, next);
  }, [scale, savedScale, yaw, pitch, roll, panX, panY, syncCamera]);

  const handleZoomOut = useCallback(() => {
    const next = Math.max(scale.value / 1.3, 0.25);
    scale.value = withSpring(next);
    savedScale.value = next;
    syncCamera(yaw.value, pitch.value, roll.value, panX.value, panY.value, next);
  }, [scale, savedScale, yaw, pitch, roll, panX, panY, syncCamera]);

  const toggleAutoOrbit = useCallback(() => {
    setIsAutoOrbit(prev => !prev);
  }, []);

  useEffect(() => {
    if (!isAutoOrbit) return;
    let active = true;
    let lastTime = Date.now();

    const loop = () => {
      if (!active) return;
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      const nextYaw = yaw.value + 0.35 * dt;
      yaw.value = nextYaw;
      savedYaw.value = nextYaw;
      syncCamera(nextYaw, pitch.value, roll.value, panX.value, panY.value, scale.value);
      requestAnimationFrame(loop);
    };
    const handle = requestAnimationFrame(loop);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [isAutoOrbit, yaw, savedYaw, pitch, roll, panX, panY, scale, syncCamera]);

  const parentNode = useMemo(() => {
    if (!selectedNode?.parentEntityId) return null;
    return nodes.find(n => n.id === selectedNode.parentEntityId) || null;
  }, [selectedNode, nodes]);

  const childStems = useMemo(() => {
    if (!selectedNode) return [];
    return nodes.filter(n => n.parentEntityId === selectedNode.id);
  }, [selectedNode, nodes]);

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id);
  }, [selectedNode, edges]);

  const connectedNodeIds = useMemo(() => {
    if (selectedEdge) {
      return new Set<string>([selectedEdge.source, selectedEdge.target]);
    }
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>([selectedNode.id]);
    for (const e of selectedNodeEdges) {
      set.add(e.source);
      set.add(e.target);
    }
    return set;
  }, [selectedNode, selectedNodeEdges, selectedEdge]);

  // ----------------------------------------------------
  // TRUE 3D PROJECTION ENGINE (EULER 360 ROTATION + PERSPECTIVE)
  // ----------------------------------------------------
  function project3DPoint(
    x: number, y: number, z: number,
    pitchAngle: number, yawAngle: number, rollAngle: number,
    camScale: number, pX: number, pY: number,
    viewportW: number, viewportH: number
  ) {
    // 1. Yaw rotation around Y axis (horizontal 360 orbit)
    const cy = Math.cos(yawAngle);
    const sy = Math.sin(yawAngle);
    const x1 = x * cy + z * sy;
    const y1 = y;
    const z1 = -x * sy + z * cy;

    // 2. Pitch rotation around X axis (vertical 360 tilt)
    const cp = Math.cos(pitchAngle);
    const sp = Math.sin(pitchAngle);
    const x2 = x1;
    const y2 = y1 * cp - z1 * sp;
    const z2 = y1 * sp + z1 * cp;

    // 3. Roll rotation around Z axis (banking roll)
    const cr = Math.cos(rollAngle);
    const sr = Math.sin(rollAngle);
    const x3 = x2 * cr - y2 * sr;
    const y3 = x2 * sr + y2 * cr;
    const z3 = z2;

    // 4. Perspective projection
    const cameraDistance = 1100;
    const dist = Math.max(200, cameraDistance - z3);
    const perspective = cameraDistance / dist; // ~0.7 to 1.5

    // 5. Projected screen plane coordinates
    const screenX = (viewportW / 2) + pX + (x3 * perspective * camScale);
    const screenY = (viewportH / 2) + pY + (y3 * perspective * camScale);

    return {
      screenX,
      screenY,
      depth: z3,
      perspective
    };
  }

  // ----------------------------------------------------
  // 3D GRAPH PROJECTION & PUBG/GTA DYNAMIC NAMEPLATE COLLISION AVOIDANCE
  // ----------------------------------------------------
  const projectedGraph = useMemo(() => {
    const is3d = viewMode === '3d';
    const curPitch = is3d ? camera.pitch : 0;
    const curYaw = is3d ? camera.yaw : 0;
    const curRoll = is3d ? camera.roll : 0;
    const curScale = camera.scale;
    const curPanX = camera.panX;
    const curPanY = camera.panY;

    // 1. Project all nodes
    const projectedNodesRaw = nodes.map(n => {
      const x = is3d ? (n.x3d ?? (n.x - CENTER)) : (n.x - CENTER);
      const y = is3d ? (n.y3d ?? (n.y - CENTER)) : (n.y - CENTER);
      const z = is3d ? (n.z3d ?? 0) : 0;

      const proj = project3DPoint(
        x, y, z,
        curPitch, curYaw, curRoll,
        curScale, curPanX, curPanY,
        SCREEN_WIDTH, GRAPH_HEIGHT
      );

      const baseSize = n.isHub ? 42 : n.isDepartment ? 36 : (n.hierarchyLevel === 2 ? 28 : 20);
      const circleSize = Math.round(baseSize * Math.min(1.4, Math.max(0.65, proj.perspective)));

      const isSelected = selectedNode?.id === n.id;
      const isConnected = connectedNodeIds.has(n.id);
      const isFocus = isSelected || isConnected;

      let opacity = 1.0;
      if (selectedNode || selectedEdge) {
        opacity = isFocus ? 1.0 : 0.2;
      } else if (is3d) {
        // Atmospheric neural depth attenuation
        opacity = Math.max(0.38, Math.min(1.0, 0.42 + 0.58 * ((proj.depth + 400) / 800)));
      }

      return {
        node: n,
        screenX: proj.screenX,
        screenY: proj.screenY,
        depth: proj.depth,
        perspective: proj.perspective,
        circleSize,
        opacity,
        zIndex: Math.round(proj.depth + 1000)
      };
    });

    const projectedNodeMap = new Map<string, typeof projectedNodesRaw[0]>();
    for (const pn of projectedNodesRaw) {
      projectedNodeMap.set(pn.node.id, pn);
    }

    // 2. PUBG / GTA Dynamic 360 Collision Avoidance Pass for Nameplates
    interface PlacedBox {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }

    function boxesOverlap(b1: PlacedBox, b2: PlacedBox, pad = 2): boolean {
      return !(
        b1.right + pad < b2.left ||
        b1.left - pad > b2.right ||
        b1.bottom + pad < b2.top ||
        b1.top - pad > b2.bottom
      );
    }

    function boxCollidesWithCircle(box: PlacedBox, cx: number, cy: number, r: number, pad = 2): boolean {
      const closestX = Math.max(box.left, Math.min(cx, box.right));
      const closestY = Math.max(box.top, Math.min(cy, box.bottom));
      const dx = cx - closestX;
      const dy = cy - closestY;
      return (dx * dx + dy * dy) < (r + pad) * (r + pad);
    }

    function getIntersectionArea(b1: PlacedBox, b2: PlacedBox, pad = 2): number {
      const xOverlap = Math.max(0, Math.min(b1.right + pad, b2.right + pad) - Math.max(b1.left - pad, b2.left - pad));
      const yOverlap = Math.max(0, Math.min(b1.bottom + pad, b2.bottom + pad) - Math.max(b1.top - pad, b2.top - pad));
      return xOverlap * yOverlap;
    }

    // Node orbs for true-circle collision testing (excluding node's own circle)
    const circleNodes = projectedNodesRaw.map(pn => ({
      id: pn.node.id,
      x: pn.screenX,
      y: pn.screenY,
      r: pn.circleSize / 2
    }));

    const placedLabelBoxes: PlacedBox[] = [];

    // Prioritize: Selected > Connected > Hub > Department > Branch > Stem
    const sortedForCollision = [...projectedNodesRaw].sort((a, b) => {
      const aPrio = selectedNode?.id === a.node.id ? 100
        : connectedNodeIds.has(a.node.id) ? 80
        : a.node.isHub ? 60
        : a.node.isDepartment ? 50
        : a.node.hierarchyLevel === 2 ? 30
        : 10;
      const bPrio = selectedNode?.id === b.node.id ? 100
        : connectedNodeIds.has(b.node.id) ? 80
        : b.node.isHub ? 60
        : b.node.isDepartment ? 50
        : b.node.hierarchyLevel === 2 ? 30
        : 10;

      if (aPrio !== bPrio) return bPrio - aPrio;
      return b.depth - a.depth;
    });

    interface PlacementResult {
      labelOffsetX: number;
      labelOffsetY: number;
      labelW: number;
      labelH: number;
      hasLeaderLine: boolean;
      leaderStartX: number;
      leaderStartY: number;
      leaderEndX: number;
      leaderEndY: number;
    }

    const placementMap = new Map<string, PlacementResult>();

    // 16 radial test angles (ordered from base direction outward to inward)
    const ANGLE_OFFSETS = [
      0,
      0.39, -0.39,   // ±22.5 deg
      0.78, -0.78,   // ±45 deg
      1.17, -1.17,   // ±67.5 deg
      1.57, -1.57,   // ±90 deg
      1.96, -1.96,   // ±112.5 deg
      2.35, -2.35,   // ±135 deg
      2.74, -2.74,   // ±157.5 deg
      Math.PI        // 180 deg
    ];

    for (const pn of sortedForCollision) {
      const isSelected = selectedNode?.id === pn.node.id;
      const isConnected = connectedNodeIds.has(pn.node.id);
      const isFocus = isSelected || isConnected;
      const r = pn.circleSize / 2;

      // Dynamic sizing based on hierarchy and name length
      let labelW = Math.min(100, Math.max(36, pn.node.name.length * 6.2 + 14));
      let labelH = 16;

      if (pn.node.isHub || pn.node.isDepartment) {
        labelW = Math.min(130, Math.max(48, pn.node.name.length * 7.2 + 16));
        labelH = pn.node.subLabel ? 26 : 18;
      } else if (pn.node.hierarchyLevel === 2) {
        labelW = Math.min(115, Math.max(42, pn.node.name.length * 6.6 + 14));
        labelH = (pn.node.subLabel && isFocus) ? 24 : 17;
      }

      // Base outward arborization angle (away from parent or central sun)
      let baseAngle = Math.PI / 2; // Default downwards
      if (pn.node.parentEntityId && projectedNodeMap.has(pn.node.parentEntityId)) {
        const parentPn = projectedNodeMap.get(pn.node.parentEntityId)!;
        const dx = pn.screenX - parentPn.screenX;
        const dy = pn.screenY - parentPn.screenY;
        if (Math.hypot(dx, dy) > 2) {
          baseAngle = Math.atan2(dy, dx);
        }
      } else if (pn.node.id !== 'user-core') {
        const corePn = projectedNodeMap.get('user-core');
        if (corePn) {
          const dx = pn.screenX - corePn.screenX;
          const dy = pn.screenY - corePn.screenY;
          if (Math.hypot(dx, dy) > 2) {
            baseAngle = Math.atan2(dy, dx);
          }
        }
      }

      // 3 distance tiers for PUBG/GTA style dynamic nameplate clearance
      const tiers = [
        { tier: 0, dist: r + 4 + labelH / 2 },
        { tier: 1, dist: r + 15 + labelH / 2 },
        { tier: 2, dist: r + 28 + labelH / 2 }
      ];

      let cleanFound: {
        angle: number;
        dist: number;
        tier: number;
        box: PlacedBox;
      } | null = null;

      let bestScore = Infinity;
      let bestCandidate: {
        angle: number;
        dist: number;
        tier: number;
        box: PlacedBox;
      } | null = null;

      for (const t of tiers) {
        for (const offset of ANGLE_OFFSETS) {
          const angle = baseAngle + offset;
          const cx = pn.screenX + t.dist * Math.cos(angle);
          const cy = pn.screenY + t.dist * Math.sin(angle);

          const candBox: PlacedBox = {
            left: cx - labelW / 2,
            top: cy - labelH / 2,
            right: cx + labelW / 2,
            bottom: cy + labelH / 2
          };

          // Test collision with other node circles (immunity from self-collision)
          let collidesCircle = false;
          let circleOverlapScore = 0;
          for (const c of circleNodes) {
            if (c.id === pn.node.id) continue;
            if (boxCollidesWithCircle(candBox, c.x, c.y, c.r, 2)) {
              collidesCircle = true;
              circleOverlapScore += 200;
            }
          }

          // Test collision with already placed labels
          let collidesLabel = false;
          let labelOverlapScore = 0;
          for (const lb of placedLabelBoxes) {
            if (boxesOverlap(candBox, lb, 2)) {
              collidesLabel = true;
              labelOverlapScore += getIntersectionArea(candBox, lb, 2);
            }
          }

          if (!collidesCircle && !collidesLabel) {
            cleanFound = { angle, dist: t.dist, tier: t.tier, box: candBox };
            break;
          }

          const penaltyScore =
            circleOverlapScore +
            labelOverlapScore +
            t.tier * 40 +
            Math.abs(offset) * 12;

          if (penaltyScore < bestScore) {
            bestScore = penaltyScore;
            bestCandidate = { angle, dist: t.dist, tier: t.tier, box: candBox };
          }
        }
        if (cleanFound) break;
      }

      const chosen = cleanFound || bestCandidate || {
        angle: baseAngle,
        dist: tiers[0].dist,
        tier: 0,
        box: {
          left: pn.screenX - labelW / 2,
          top: pn.screenY + tiers[0].dist - labelH / 2,
          right: pn.screenX + labelW / 2,
          bottom: pn.screenY + tiers[0].dist + labelH / 2
        }
      };

      placedLabelBoxes.push(chosen.box);

      const hasLeaderLine = chosen.tier >= 1;
      const cosA = Math.cos(chosen.angle);
      const sinA = Math.sin(chosen.angle);

      placementMap.set(pn.node.id, {
        labelOffsetX: chosen.dist * cosA,
        labelOffsetY: chosen.dist * sinA,
        labelW,
        labelH,
        hasLeaderLine,
        leaderStartX: (r + 1) * cosA,
        leaderStartY: (r + 1) * sinA,
        leaderEndX: (chosen.dist - labelH / 2 - 2) * cosA,
        leaderEndY: (chosen.dist - labelH / 2 - 2) * sinA
      });
    }

    // Sort nodes back-to-front (painter's algorithm)
    const finalNodes = projectedNodesRaw.map(pn => {
      const placement = placementMap.get(pn.node.id)!;
      return {
        ...pn,
        ...placement
      };
    }).sort((a, b) => a.depth - b.depth);

    // 3. Project all edges
    const projectedEdges: Array<{
      edge: GraphEdge;
      sourceNode: typeof projectedNodesRaw[0];
      targetNode: typeof projectedNodesRaw[0];
      isCross: boolean;
      pathD?: string;
      midX: number;
      midY: number;
      avgDepth: number;
    }> = [];

    for (const e of edges) {
      const sNode = projectedNodeMap.get(e.source);
      const tNode = projectedNodeMap.get(e.target);
      if (!sNode || !tNode) continue;

      const isCross = !!e.isCrossDomain;
      let pathD: string | undefined;
      let midX = Math.round((sNode.screenX + tNode.screenX) / 2);
      let midY = Math.round((sNode.screenY + tNode.screenY) / 2);

      if (isCross) {
        if (is3d) {
          // 3D arched neural bridge
          const sx = sNode.node.x3d ?? (sNode.node.x - CENTER);
          const sy = sNode.node.y3d ?? (sNode.node.y - CENTER);
          const sz = sNode.node.z3d ?? 0;
          const tx = tNode.node.x3d ?? (tNode.node.x - CENTER);
          const ty = tNode.node.y3d ?? (tNode.node.y - CENTER);
          const tz = tNode.node.z3d ?? 0;

          const mx3d = (sx + tx) / 2;
          const my3d = (sy + ty) / 2;
          const mz3d = (sz + tz) / 2;
          const mLen = Math.sqrt(mx3d * mx3d + my3d * my3d + mz3d * mz3d) || 1;
          const archHeight = 90;
          const cx3d = mx3d + (mx3d / mLen) * archHeight;
          const cy3d = my3d + (my3d / mLen) * archHeight;
          const cz3d = mz3d + (mz3d / mLen) * archHeight;

          const ctrlProj = project3DPoint(
            cx3d, cy3d, cz3d,
            curPitch, curYaw, curRoll,
            curScale, curPanX, curPanY,
            SCREEN_WIDTH, GRAPH_HEIGHT
          );

          pathD = `M ${Math.round(sNode.screenX)} ${Math.round(sNode.screenY)} Q ${Math.round(ctrlProj.screenX)} ${Math.round(ctrlProj.screenY)} ${Math.round(tNode.screenX)} ${Math.round(tNode.screenY)}`;
          midX = Math.round(0.25 * sNode.screenX + 0.5 * ctrlProj.screenX + 0.25 * tNode.screenX);
          midY = Math.round(0.25 * sNode.screenY + 0.5 * ctrlProj.screenY + 0.25 * tNode.screenY);
        } else {
          // 2D Bézier
          const dx = tNode.screenX - sNode.screenX;
          const dy = tNode.screenY - sNode.screenY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1) {
            const nx = -dy / dist;
            const ny = dx / dist;
            const curveAmount = Math.min(80, Math.max(30, dist * 0.18));
            const ctrlX = Math.round((sNode.screenX + tNode.screenX) / 2 + nx * curveAmount);
            const ctrlY = Math.round((sNode.screenY + tNode.screenY) / 2 + ny * curveAmount);
            pathD = `M ${Math.round(sNode.screenX)} ${Math.round(sNode.screenY)} Q ${ctrlX} ${ctrlY} ${Math.round(tNode.screenX)} ${Math.round(tNode.screenY)}`;
            midX = Math.round(0.25 * sNode.screenX + 0.5 * ctrlX + 0.25 * tNode.screenX);
            midY = Math.round(0.25 * sNode.screenY + 0.5 * ctrlY + 0.25 * tNode.screenY);
          }
        }
      }

      const avgDepth = (sNode.depth + tNode.depth) / 2;

      projectedEdges.push({
        edge: e,
        sourceNode: sNode,
        targetNode: tNode,
        isCross,
        pathD,
        midX,
        midY,
        avgDepth
      });
    }

    return {
      nodes: finalNodes,
      edges: projectedEdges,
      nodeMap: projectedNodeMap
    };
  }, [nodes, edges, camera, viewMode, selectedNode, selectedEdge, connectedNodeIds]);

  const handleNodePress = useCallback((node: GraphNode) => {
    setSelectedEdge(null);
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
      const pn = projectedGraph.nodeMap.get(node.id);
      if (pn) {
        const dx = pn.screenX - SCREEN_WIDTH / 2;
        const dy = pn.screenY - GRAPH_HEIGHT / 2;
        const nextPanX = panX.value - dx;
        const nextPanY = panY.value - dy;
        const nextScale = Math.max(scale.value, 1.25);

        panX.value = withSpring(nextPanX, { damping: 18 });
        panY.value = withSpring(nextPanY, { damping: 18 });
        savedPanX.value = nextPanX;
        savedPanY.value = nextPanY;
        scale.value = withSpring(nextScale, { damping: 18 });
        savedScale.value = nextScale;

        syncCamera(yaw.value, pitch.value, roll.value, nextPanX, nextPanY, nextScale);
      }
    }
  }, [selectedNode, projectedGraph, panX, panY, savedPanX, savedPanY, scale, savedScale, yaw, pitch, roll, syncCamera]);

  const handleEdgePress = useCallback((edge: GraphEdge) => {
    setSelectedNode(null);
    if (selectedEdge?.id === edge.id) {
      setSelectedEdge(null);
    } else {
      setSelectedEdge(edge);
      const pe = projectedGraph.edges.find(e => e.edge.id === edge.id);
      if (pe && pe.midX && pe.midY) {
        const dx = pe.midX - SCREEN_WIDTH / 2;
        const dy = pe.midY - GRAPH_HEIGHT / 2;
        const nextPanX = panX.value - dx;
        const nextPanY = panY.value - dy;
        const nextScale = Math.max(scale.value, 1.3);

        panX.value = withSpring(nextPanX, { damping: 18 });
        panY.value = withSpring(nextPanY, { damping: 18 });
        savedPanX.value = nextPanX;
        savedPanY.value = nextPanY;
        scale.value = withSpring(nextScale, { damping: 18 });
        savedScale.value = nextScale;

        syncCamera(yaw.value, pitch.value, roll.value, nextPanX, nextPanY, nextScale);
      }
    }
  }, [selectedEdge, projectedGraph, panX, panY, savedPanX, savedPanY, scale, savedScale, yaw, pitch, roll, syncCamera]);

  // Conversational Memory Editing & Surgical Handlers
  const handleOpenTalkModal = useCallback((node: GraphNode) => {
    setTalkInput('');
    setDirectInput(node.value || node.name);
    setIsDirectEditMode(false);
    setNovaFeedback(null);
    setTalkModalVisible(true);
  }, []);

  const handleSurgicalSubmit = useCallback(async () => {
    if (!selectedNode) return;
    if (!isDirectEditMode && !talkInput.trim()) return;
    if (isDirectEditMode && !directInput.trim()) return;

    try {
      setSurgicalLoading(true);
      setNovaFeedback(null);

      const res = await api.post('/analytics/kg/surgical-alteration', {
        nodeId: selectedNode.id,
        rawKey: selectedNode.raw_key,
        nodeName: selectedNode.name,
        currentValue: selectedNode.value,
        department: selectedNode.department,
        userInstruction: talkInput.trim(),
        directValue: isDirectEditMode ? directInput.trim() : undefined
      });

      if (res.data?.success) {
        setNovaFeedback(res.data.message || 'Updated on the spot!');

        if (res.data.action === 'DELETE') {
          setTimeout(() => {
            setTalkModalVisible(false);
            setSelectedNode(null);
            fetchGraph(false);
          }, 1200);
        } else {
          const newVal = res.data.value || (isDirectEditMode ? directInput.trim() : talkInput.trim());
          setSelectedNode(prev => prev ? { ...prev, value: newVal } : null);
          fetchGraph(false);
          setTimeout(() => {
            setTalkModalVisible(false);
          }, 1400);
        }
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to update memory');
      }
    } catch (err: any) {
      Alert.alert('Alteration Error', err?.response?.data?.error || err?.message || 'Failed to update');
    } finally {
      setSurgicalLoading(false);
    }
  }, [selectedNode, isDirectEditMode, talkInput, directInput, fetchGraph]);

  const handleConfirmDelete = useCallback((node: GraphNode) => {
    Alert.alert(
      'Delete Memory Bubble?',
      `Are you sure you want to remove "${node.name}" from your neural memory? Nova will surgically archive and forget this fact.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setSyncing(true);
              const res = await api.delete(`/analytics/kg/node/${encodeURIComponent(node.id)}`, {
                params: { rawKey: node.raw_key, nodeName: node.name },
                data: { rawKey: node.raw_key, nodeName: node.name }
              });
              if (res.data?.success) {
                setSelectedNode(null);
                fetchGraph(false);
              } else {
                Alert.alert('Error', res.data?.error || 'Could not delete node');
              }
            } catch (err: any) {
              Alert.alert('Delete Error', err?.response?.data?.error || err?.message || 'Failed to delete');
            } finally {
              setSyncing(false);
            }
          }
        }
      ]
    );
  }, [fetchGraph]);

  const handleOpenInChat = useCallback(() => {
    if (!selectedNode) return;
    setTalkModalVisible(false);
    navigation.navigate('Chat', {
      initialPrompt: `Regarding memory: [${selectedNode.name}]: "${selectedNode.value}" - `
    });
  }, [selectedNode, navigation]);

  const handleFocusDept = useCallback((deptId: string) => {
    setSelectedDept(deptId);
    setSelectedNode(null);
    setSelectedEdge(null);
    const hubNode = nodes.find(n => n.id === `dept-${deptId}`);
    if (hubNode) {
      handleNodePress(hubNode);
    }
  }, [nodes, handleNodePress]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#06B6D4" />
        <Text style={styles.loadingText}>Synthesizing Knowledge Galaxy...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>

        {/* Top Header & View Switcher */}
        <View style={styles.header}>
          <View>
            <View style={styles.titleRow}>
              <TouchableOpacity
                onPress={() => {
                  try { navigation.navigate('Chat'); } catch { if (navigation.canGoBack()) navigation.goBack(); }
                }}
                style={styles.backBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.backChevron}>‹</Text>
                <Text style={styles.backText}>Chat</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Neural Galaxy</Text>
              <TouchableOpacity style={styles.syncBadge} onPress={() => fetchGraph(false)}>
                <Text style={styles.syncBadgeText}>
                  {syncing ? '↻' : `● LIVE · ${lastSyncTime}`}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.headerSubtitle}>
              {nodes.length} nodes · {edges.length} connections across {departments.length} departments
            </Text>
          </View>

          <View style={styles.viewToggleGroup}>
            <TouchableOpacity
              style={[styles.viewToggleBtn, viewMode === '3d' && styles.viewToggleBtnActive]}
              onPress={() => setViewMode('3d')}
            >
              <Text style={[styles.viewToggleText, viewMode === '3d' && styles.viewToggleTextActive]}>
                🌐 3D
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewToggleBtn, viewMode === '2d' && styles.viewToggleBtnActive]}
              onPress={() => setViewMode('2d')}
            >
              <Text style={[styles.viewToggleText, viewMode === '2d' && styles.viewToggleTextActive]}>
                🗺️ 2D
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Department Glider Navigation Bar */}
        <View style={styles.deptBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deptScroll}>
            <TouchableOpacity
              style={[styles.deptChip, !selectedDept && styles.deptChipActive]}
              onPress={() => {
                setSelectedDept(null);
                setSelectedNode(null);
                setSelectedEdge(null);
                handleResetView();
              }}
            >
              <Text style={[styles.deptChipText, !selectedDept && styles.deptChipTextActive]}>
                ✨ All Galaxy ({nodes.length})
              </Text>
            </TouchableOpacity>

            {departments.map((dept) => {
              const isActive = selectedDept === dept.id;
              return (
                <TouchableOpacity
                  key={dept.id}
                  style={[
                    styles.deptChip,
                    isActive && { borderColor: dept.color, backgroundColor: `${dept.color}25` }
                  ]}
                  onPress={() => handleFocusDept(dept.id)}
                >
                  <Text style={[styles.deptChipText, isActive && { color: dept.color, fontWeight: 'bold' }]}>
                    {dept.emoji} {dept.name} ({dept.count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Sub-Bar: Line Filters & 3D Orbit/Pan Switch */}
        <View style={styles.subBar}>
          <View style={styles.lineFilterRow}>
            <Text style={styles.subBarLabel}>LINES:</Text>
            <TouchableOpacity
              style={[styles.subPill, lineFilter === 'all' && styles.subPillActive]}
              onPress={() => setLineFilter('all')}
            >
              <Text style={[styles.subPillText, lineFilter === 'all' && styles.subPillTextActive]}>
                All ({edges.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subPill, lineFilter === 'cross' && styles.subPillActive]}
              onPress={() => setLineFilter('cross')}
            >
              <Text style={[styles.subPillText, lineFilter === 'cross' && styles.subPillTextActive]}>
                ⚡ Cross-Domain Only
              </Text>
            </TouchableOpacity>
          </View>

          {viewMode === '3d' && (
            <View style={styles.gestureModeGroup}>
              <TouchableOpacity
                style={[styles.gestureModeBtn, gestureMode === 'orbit' && styles.gestureModeBtnActive]}
                onPress={() => setGestureMode('orbit')}
              >
                <Text style={[styles.gestureModeText, gestureMode === 'orbit' && styles.gestureModeTextActive]}>
                  🔄 360° Orbit
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.gestureModeBtn, gestureMode === 'pan' && styles.gestureModeBtnActive]}
                onPress={() => setGestureMode('pan')}
              >
                <Text style={[styles.gestureModeText, gestureMode === 'pan' && styles.gestureModeTextActive]}>
                  ✋ Pan
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.gestureModeBtn, isAutoOrbit && styles.gestureModeBtnActive]}
                onPress={toggleAutoOrbit}
              >
                <Text style={[styles.gestureModeText, isAutoOrbit && styles.gestureModeTextActive]}>
                  🌌 Auto
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.gestureModeBtn}
                onPress={handleSpinY}
              >
                <Text style={styles.gestureModeText}>
                  ↻ 90°
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* GALAXY CANVAS */}
        <View style={styles.canvasContainer}>
          <GestureDetector gesture={composedGesture}>
            <View style={StyleSheet.absoluteFill}>
              {/* 1. Vector Connection Lines (SVG Canvas with depth styling & non-scaling stroke) */}
              <Svg
                width={SCREEN_WIDTH}
                height={GRAPH_HEIGHT}
                style={StyleSheet.absoluteFill}
              >
                <G>
                  {projectedGraph.edges.map((pe) => {
                    const e = pe.edge;
                    const isCross = pe.isCross;
                    if (lineFilter === 'cross' && !isCross) return null;

                    const isDirectlySelected = selectedEdge?.id === e.id;
                    const isNodeConnected = selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id);
                    const isHighlight = isDirectlySelected || isNodeConnected;

                    let strokeColor = e.color || 'rgba(255,255,255,0.2)';
                    let strokeWidth = isCross ? 2.5 : 1.5;
                    let strokeOpacity = 0.55;

                    if (selectedEdge) {
                      if (isDirectlySelected) {
                        strokeColor = '#38BDF8';
                        strokeWidth = 4.5;
                        strokeOpacity = 1.0;
                      } else {
                        strokeOpacity = 0.06;
                        strokeWidth = 0.8;
                      }
                    } else if (selectedNode) {
                      if (isNodeConnected) {
                        strokeColor = isCross ? '#38BDF8' : '#FFFFFF';
                        strokeWidth = 4;
                        strokeOpacity = 1.0;
                      } else {
                        strokeOpacity = 0.06;
                        strokeWidth = 0.8;
                      }
                    } else if (isCross) {
                      strokeColor = e.color || '#C084FC';
                      strokeWidth = 2.8;
                      strokeOpacity = 0.85;
                    } else if (viewMode === '3d') {
                      // 3D Depth weighting
                      const depthNorm = Math.max(0.3, Math.min(1.0, (pe.avgDepth + 400) / 800));
                      strokeOpacity = 0.25 + 0.45 * depthNorm;
                      strokeWidth = Math.max(0.8, strokeWidth * depthNorm);
                    }

                    if (isCross && pe.pathD) {
                      return (
                        <G key={`edge-${e.id}`}>
                          {isHighlight && (
                            <Path
                              d={pe.pathD}
                              stroke="#38BDF8"
                              strokeWidth={10}
                              strokeLinecap="round"
                              fill="none"
                              opacity={0.35}
                            />
                          )}
                          <Path
                            d={pe.pathD}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            strokeDasharray={isHighlight ? undefined : '5, 5'}
                            strokeLinecap="round"
                            fill="none"
                            opacity={strokeOpacity}
                          />
                          {/* Invisible hit-box */}
                          <Path
                            d={pe.pathD}
                            stroke="transparent"
                            strokeWidth={28}
                            fill="none"
                            onPress={() => handleEdgePress(e)}
                          />
                        </G>
                      );
                    }

                    return (
                      <G key={`edge-${e.id}`}>
                        {isHighlight && (
                          <Line
                            x1={pe.sourceNode.screenX}
                            y1={pe.sourceNode.screenY}
                            x2={pe.targetNode.screenX}
                            y2={pe.targetNode.screenY}
                            stroke="#38BDF8"
                            strokeWidth={10}
                            strokeLinecap="round"
                            opacity={0.35}
                          />
                        )}
                        <Line
                          x1={pe.sourceNode.screenX}
                          y1={pe.sourceNode.screenY}
                          x2={pe.targetNode.screenX}
                          y2={pe.targetNode.screenY}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          opacity={strokeOpacity}
                          strokeLinecap="round"
                        />
                        {/* Synaptic Terminal Dots at filament junctions */}
                        <Circle
                          cx={pe.targetNode.screenX}
                          cy={pe.targetNode.screenY}
                          r={2}
                          fill={strokeColor}
                          opacity={strokeOpacity * 0.9}
                        />
                        {/* Invisible hit-box */}
                        <Line
                          x1={pe.sourceNode.screenX}
                          y1={pe.sourceNode.screenY}
                          x2={pe.targetNode.screenX}
                          y2={pe.targetNode.screenY}
                          stroke="transparent"
                          strokeWidth={28}
                          strokeLinecap="round"
                          onPress={() => handleEdgePress(e)}
                        />
                      </G>
                    );
                  })}
                </G>

                {/* Dynamic Leader Lines connecting node orbs to offset nameplates */}
                <G id="leader-lines">
                  {projectedGraph.nodes.map((pn) => {
                    if (!pn.hasLeaderLine) return null;
                    return (
                      <Line
                        key={`leader-${pn.node.id}`}
                        x1={pn.screenX + pn.leaderStartX}
                        y1={pn.screenY + pn.leaderStartY}
                        x2={pn.screenX + pn.leaderEndX}
                        y2={pn.screenY + pn.leaderEndY}
                        stroke={pn.node.color || 'rgba(255,255,255,0.45)'}
                        strokeWidth={1}
                        strokeDasharray="2, 2"
                        opacity={0.65}
                      />
                    );
                  })}
                </G>
              </Svg>

              {/* 2. Interactive Midpoint Relationship Badges */}
              {projectedGraph.edges.map((pe) => {
                const e = pe.edge;
                const isDirectlySelected = selectedEdge?.id === e.id;
                const isNodeConnected = selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id);
                const shouldShowBadge = isDirectlySelected || isNodeConnected || (e.isCrossDomain && !selectedNode && !selectedEdge);

                if (!shouldShowBadge || !e.relation || !pe.midX || !pe.midY) {
                  return null;
                }

                const label = (e.relation || '').replace(/_/g, ' ');
                const badgeColor = isDirectlySelected ? '#38BDF8' : (e.isCrossDomain ? '#C084FC' : '#38BDF8');

                return (
                  <View
                    key={`badge-${e.id}`}
                    style={[
                      styles.badgeAnchor,
                      { left: pe.midX, top: pe.midY }
                    ]}
                    pointerEvents="box-none"
                  >
                    <TouchableOpacity
                      style={[
                        styles.badgePill,
                        { borderColor: badgeColor },
                        isDirectlySelected && styles.badgePillSelected
                      ]}
                      onPress={() => handleEdgePress(e)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.badgeText, { color: badgeColor }]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              {/* 3. Interactive Nodes (100% Round Spheres at Any Angle, Dynamic Non-Overlapping Nameplates) */}
              {projectedGraph.nodes.map((pn) => {
                const n = pn.node;
                const isSelected = selectedNode?.id === n.id;
                const isConnected = connectedNodeIds.has(n.id);
                const circleSize = pn.circleSize;

                return (
                  <View
                    key={`node-${n.id}`}
                    style={[
                      styles.nodeAnchor,
                      {
                        left: pn.screenX,
                        top: pn.screenY,
                        opacity: pn.opacity,
                        zIndex: isSelected ? 9999 : (n.isHub ? 8000 : (n.isDepartment ? 5000 : pn.zIndex))
                      }
                    ]}
                    pointerEvents="box-none"
                  >
                    {/* Spherical Bubble Orb */}
                    <TouchableOpacity
                      style={styles.nodeTouchable}
                      onPress={() => handleNodePress(n)}
                      activeOpacity={0.75}
                    >
                      {/* Glow Halo */}
                      {(n.isHub || n.isDepartment || isSelected || (selectedEdge && isConnected)) && (
                        <View
                          style={[
                            styles.glowRing,
                            {
                              width: circleSize + (isSelected ? 16 : 8),
                              height: circleSize + (isSelected ? 16 : 8),
                              borderRadius: (circleSize + (isSelected ? 16 : 8)) / 2,
                              backgroundColor: isSelected ? '#38BDF8' : n.color,
                              opacity: isSelected ? 0.35 : 0.2
                            }
                          ]}
                        />
                      )}

                      {/* 100% Round Spherical Orb from ANY viewing angle */}
                      <View
                        style={[
                          styles.nodeCircle,
                          {
                            width: circleSize,
                            height: circleSize,
                            borderRadius: circleSize / 2,
                            backgroundColor: n.color,
                            borderColor: isSelected
                              ? '#FFFFFF'
                              : isConnected
                              ? '#38BDF8'
                              : n.isDepartment
                              ? 'rgba(255,255,255,0.85)'
                              : 'rgba(255,255,255,0.4)',
                            borderWidth: isSelected ? 3 : isConnected ? 2.5 : n.isDepartment ? 2 : 1.2,
                            overflow: 'hidden'
                          }
                        ]}
                      >
                        {/* 3D Specular Highlight Crescent (renders 3D ball curvature from any angle) */}
                        <View
                          style={{
                            position: 'absolute',
                            top: circleSize * 0.08,
                            left: circleSize * 0.12,
                            width: circleSize * 0.38,
                            height: circleSize * 0.22,
                            borderRadius: circleSize * 0.18,
                            backgroundColor: 'rgba(255, 255, 255, 0.7)',
                            transform: [{ rotate: '-35deg' }]
                          }}
                        />

                        {/* 3D Shaded Depth Crescent */}
                        <View
                          style={{
                            position: 'absolute',
                            bottom: -circleSize * 0.1,
                            right: -circleSize * 0.1,
                            width: circleSize * 0.72,
                            height: circleSize * 0.72,
                            borderRadius: circleSize * 0.36,
                            backgroundColor: 'rgba(0, 0, 0, 0.3)'
                          }}
                        />

                        {n.emoji ? (
                          <Text style={[styles.nodeEmoji, { fontSize: circleSize * 0.52 }]}>
                            {n.emoji}
                          </Text>
                        ) : (
                          <View
                            style={[
                              styles.innerDot,
                              {
                                backgroundColor: '#FFFFFF',
                                width: circleSize * 0.28,
                                height: circleSize * 0.28,
                                borderRadius: circleSize * 0.14
                              }
                            ]}
                          />
                        )}
                      </View>
                    </TouchableOpacity>

                    {/* Dynamic Non-Overlapping Nameplate (PUBG / GTA 360 Dynamic HUD) */}
                    <TouchableOpacity
                      style={[
                        styles.labelPill,
                        {
                          position: 'absolute',
                          left: pn.labelOffsetX - pn.labelW / 2,
                          top: pn.labelOffsetY - pn.labelH / 2,
                          width: pn.labelW,
                          height: pn.labelH,
                          borderColor: isSelected
                            ? '#38BDF8'
                            : isConnected
                            ? '#38BDF8'
                            : n.isDepartment
                            ? n.color
                            : 'rgba(255,255,255,0.22)'
                        },
                        isSelected && styles.labelPillSelected,
                        isConnected && styles.labelPillConnected
                      ]}
                      onPress={() => handleNodePress(n)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.labelText,
                          isSelected && styles.labelTextSelected,
                          n.isDepartment && { color: n.color }
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {n.name}
                      </Text>
                      {pn.labelH > 20 && n.subLabel ? (
                        <Text style={styles.subLabelText} numberOfLines={1}>
                          {n.subLabel}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </GestureDetector>

          {/* Floating Compact HUD Zoom & Center Controls */}
          <View style={styles.compactHud}>
            <TouchableOpacity style={styles.hudCircleBtn} onPress={handleZoomIn} activeOpacity={0.7}>
              <Text style={styles.hudCircleText}>＋</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.hudCircleBtn} onPress={handleZoomOut} activeOpacity={0.7}>
              <Text style={styles.hudCircleText}>－</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.hudCircleBtn} onPress={handleResetView} activeOpacity={0.7}>
              <Text style={[styles.hudCircleText, { fontSize: 13 }]}>⟲</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1. Connection Inspector Sheet (when an Edge/Line is tapped) */}
        {selectedEdge && (
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleRow}>
                <View style={styles.badgesRow}>
                  <View style={[styles.deptBadge, {
                    backgroundColor: selectedEdge.isCrossDomain ? 'rgba(192,132,252,0.2)' : 'rgba(56,189,248,0.2)',
                    borderColor: selectedEdge.isCrossDomain ? '#C084FC' : '#38BDF8'
                  }]}>
                    <Text style={[styles.deptBadgeText, {
                      color: selectedEdge.isCrossDomain ? '#C084FC' : '#38BDF8'
                    }]}>
                      {selectedEdge.edgeType ? selectedEdge.edgeType.replace(/_/g, ' ') : (selectedEdge.isCrossDomain ? 'NEURAL BRIDGE' : 'TREE CONNECTION')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.detailName}>
                  {(selectedEdge.relation || 'Connected').replace(/_/g, ' ')}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedEdge(null)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedEdge.explanation && (
              <Text style={styles.edgeExplanationText}>
                💡 {selectedEdge.explanation}
              </Text>
            )}

            {/* Connected Nodes Interactive Chips */}
            <View style={styles.edgeNodesRow}>
              {selectedEdge.sourceNode && (
                <TouchableOpacity
                  style={[styles.edgeNodeChip, { borderColor: selectedEdge.sourceNode.color }]}
                  onPress={() => {
                    handleNodePress(selectedEdge.sourceNode!);
                    setSelectedEdge(null);
                  }}
                >
                  <Text style={styles.edgeNodeRole}>SOURCE</Text>
                  <Text style={[styles.edgeNodeName, { color: selectedEdge.sourceNode.color }]}>
                    {selectedEdge.sourceNode.emoji || '●'} {selectedEdge.sourceNode.name}
                  </Text>
                  {selectedEdge.sourceNode.subLabel && (
                    <Text style={styles.edgeNodeSub}>{selectedEdge.sourceNode.subLabel}</Text>
                  )}
                </TouchableOpacity>
              )}

              <Text style={styles.edgeArrow}>➔</Text>

              {selectedEdge.targetNode && (
                <TouchableOpacity
                  style={[styles.edgeNodeChip, { borderColor: selectedEdge.targetNode.color }]}
                  onPress={() => {
                    handleNodePress(selectedEdge.targetNode!);
                    setSelectedEdge(null);
                  }}
                >
                  <Text style={styles.edgeNodeRole}>TARGET</Text>
                  <Text style={[styles.edgeNodeName, { color: selectedEdge.targetNode.color }]}>
                    {selectedEdge.targetNode.emoji || '●'} {selectedEdge.targetNode.name}
                  </Text>
                  {selectedEdge.targetNode.subLabel && (
                    <Text style={styles.edgeNodeSub}>{selectedEdge.targetNode.subLabel}</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Tree Context */}
            {(selectedEdge.sourceNode?.treePath || selectedEdge.targetNode?.treePath) && (
              <View style={styles.treePathSection}>
                <Text style={styles.treePathLabel}>🌳 TREE HIERARCHY:</Text>
                {selectedEdge.sourceNode?.treePath && (
                  <Text style={styles.treePathText}>
                    Source: {selectedEdge.sourceNode.treePath.join(' › ')}
                  </Text>
                )}
                {selectedEdge.targetNode?.treePath && (
                  <Text style={styles.treePathText}>
                    Target: {selectedEdge.targetNode.treePath.join(' › ')}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* 2. Hierarchical Node Inspector Sheet (when a Node is tapped) */}
        {selectedNode && !selectedEdge && (
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleRow}>
                <View style={styles.badgesRow}>
                  <View style={[styles.deptBadge, { backgroundColor: `${selectedNode.color}25`, borderColor: selectedNode.color }]}>
                    <Text style={[styles.deptBadgeText, { color: selectedNode.color }]}>
                      {selectedNode.emoji || '●'} {selectedNode.department.toUpperCase()}
                    </Text>
                  </View>
                  {selectedNode.hierarchyLevel && (
                    <View style={[styles.levelBadge, { borderColor: selectedNode.color }]}>
                      <Text style={styles.levelBadgeText}>
                        {selectedNode.hierarchyLevel === 1 ? 'TRUNK' : selectedNode.hierarchyLevel === 2 ? 'BRANCH' : 'STEM'}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.detailName}>{selectedNode.name}</Text>
              </View>

              <TouchableOpacity onPress={() => setSelectedNode(null)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Tree Breadcrumbs */}
            {selectedNode.treePath && selectedNode.treePath.length > 1 && (
              <View style={styles.breadcrumbContainer}>
                <Text style={styles.breadcrumbText}>
                  🌳 {selectedNode.treePath.join(' › ')}
                </Text>
              </View>
            )}

            <Text style={styles.detailValue}>{selectedNode.value}</Text>

            {/* Surgical Action Bar: Talk to Nova to Edit & Delete Bubble */}
            {!selectedNode.isDepartment && selectedNode.id !== 'user-core' && (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.talkToNovaBtn}
                  onPress={() => handleOpenTalkModal(selectedNode)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.talkToNovaIcon}>⚡</Text>
                  <Text style={styles.talkToNovaText}>Talk to Nova to Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteBubbleBtn}
                  onPress={() => handleConfirmDelete(selectedNode)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.deleteBubbleIcon}>🗑️</Text>
                  <Text style={styles.deleteBubbleText}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Parent Entity Quick Jump */}
            {parentNode && (
              <View style={styles.parentSection}>
                <Text style={styles.parentLabel}>ROOT BRANCH:</Text>
                <TouchableOpacity
                  style={[styles.parentChip, { borderColor: parentNode.color }]}
                  onPress={() => handleNodePress(parentNode)}
                >
                  <Text style={[styles.parentChipText, { color: parentNode.color }]}>
                    ↖ {parentNode.emoji || '●'} {parentNode.name} ({parentNode.subLabel || 'Branch'})
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Child Stems */}
            {childStems.length > 0 && (
              <View style={styles.stemsSection}>
                <Text style={styles.stemsSectionTitle}>
                  🌱 ATTRIBUTE STEMS ({childStems.length}):
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.linksScroll}>
                  {childStems.map((stem) => (
                    <TouchableOpacity
                      key={stem.id}
                      style={[styles.stemChip, { borderColor: stem.color }]}
                      onPress={() => handleNodePress(stem)}
                    >
                      <Text style={[styles.stemChipName, { color: stem.color }]}>
                        {stem.name}
                      </Text>
                      {stem.subLabel && (
                        <Text style={styles.stemChipSub}>{stem.subLabel}</Text>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Exact Connections Breakdown */}
            {selectedNodeEdges.length > 0 ? (
              <View style={styles.linesSection}>
                <Text style={styles.linesSectionTitle}>
                  ⚡ CONNECTIONS & NEURAL BRIDGES ({selectedNodeEdges.length}):
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.linksScroll}>
                  {selectedNodeEdges.map((e, idx) => {
                    const otherNode = (e.sourceNode && e.sourceNode.id !== selectedNode.id)
                      ? e.sourceNode
                      : (e.targetNode && e.targetNode.id !== selectedNode.id)
                        ? e.targetNode
                        : null;

                    if (!otherNode) return null;

                    return (
                      <TouchableOpacity
                        key={idx}
                        style={[styles.linkChip, { borderColor: otherNode.color }]}
                        onPress={() => handleEdgePress(e)}
                      >
                        <Text style={[styles.linkChipRelation, { color: otherNode.color }]}>
                          [{(e.relation || '').replace(/_/g, ' ')}]
                        </Text>
                        <Text style={styles.linkChipTarget}>
                          ➔ {otherNode.name}
                        </Text>
                        {e.explanation && (
                          <Text style={styles.linkChipExplanation} numberOfLines={1}>
                            {e.explanation}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <Text style={styles.noLinksText}>Central hub node</Text>
            )}
          </View>
        )}

        {/* Nova On-the-Spot Memory Surgeon Modal */}
        <Modal
          visible={talkModalVisible}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setTalkModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalOverlay}
          >
            <TouchableOpacity
              style={styles.modalBackdrop}
              activeOpacity={1}
              onPress={() => setTalkModalVisible(false)}
            />
            <View style={styles.modalCard}>
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderTitleRow}>
                  <View style={styles.novaAvatarCircle}>
                    <Text style={styles.novaAvatarEmoji}>⚡</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.modalTitle}>Talk to Nova to Correct</Text>
                    <Text style={styles.modalSubtitle} numberOfLines={1}>
                      {selectedNode?.name} • {selectedNode?.department?.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => setTalkModalVisible(false)} style={styles.modalCloseBtn}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </TouchableOpacity>
              </View>

              {/* Current Value Display */}
              <View style={styles.currentValBox}>
                <Text style={styles.currentValLabel}>CURRENT MEMORY VALUE:</Text>
                <Text style={styles.currentValText} numberOfLines={3}>
                  {selectedNode?.value}
                </Text>
              </View>

              {/* Mode Toggle: Conversational vs Direct Edit */}
              <View style={styles.modeToggleRow}>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, !isDirectEditMode && styles.modeToggleBtnActive]}
                  onPress={() => setIsDirectEditMode(false)}
                >
                  <Text style={[styles.modeToggleText, !isDirectEditMode && styles.modeToggleTextActive]}>
                    💬 Talk to Nova
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeToggleBtn, isDirectEditMode && styles.modeToggleBtnActive]}
                  onPress={() => setIsDirectEditMode(true)}
                >
                  <Text style={[styles.modeToggleText, isDirectEditMode && styles.modeToggleTextActive]}>
                    ✏️ Direct Edit
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Input Area */}
              {!isDirectEditMode ? (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputGuideText}>
                    Tell Nova in your own words what to correct or change:
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="e.g. Actually her birthday is 24 July, or She works in Bangalore..."
                    placeholderTextColor="#71717A"
                    value={talkInput}
                    onChangeText={setTalkInput}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              ) : (
                <View style={styles.inputContainer}>
                  <Text style={styles.inputGuideText}>
                    Directly modify the stored value:
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Enter updated memory value..."
                    placeholderTextColor="#71717A"
                    value={directInput}
                    onChangeText={setDirectInput}
                    multiline
                    numberOfLines={3}
                  />
                </View>
              )}

              {/* Live Nova Feedback Message */}
              {novaFeedback && (
                <View style={styles.novaFeedbackBox}>
                  <Text style={styles.novaFeedbackIcon}>✨</Text>
                  <Text style={styles.novaFeedbackText}>{novaFeedback}</Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.modalActionRow}>
                <TouchableOpacity
                  style={styles.modalChatBtn}
                  onPress={handleOpenInChat}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalChatText}>💬 Deep Chat</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalSubmitBtn,
                    surgicalLoading && styles.modalSubmitBtnDisabled
                  ]}
                  onPress={handleSurgicalSubmit}
                  disabled={surgicalLoading}
                  activeOpacity={0.8}
                >
                  {surgicalLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.modalSubmitIcon}>⚡</Text>
                      <Text style={styles.modalSubmitText}>Correct On-the-Spot</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </SafeAreaView>
    </View>
  );
}

export function KgExplorerScreen() {
  return (
    <KgErrorBoundary>
      <KgExplorerContent />
    </KgErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B', padding: 24 },
  loadingText: { color: '#71717A', marginTop: 12, fontSize: 14 },
  errorTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF', marginBottom: 8 },
  errorText: { fontSize: 13, color: '#A1A1AA', textAlign: 'center', marginBottom: 16 },
  retryBtn: { backgroundColor: '#06B6D4', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  retryBtnText: { color: '#FFFFFF', fontWeight: 'bold' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginRight: 2,
  },
  backChevron: {
    color: '#06B6D4',
    fontSize: 18,
    lineHeight: 18,
    fontWeight: '700',
    marginRight: 2,
    marginTop: -1,
  },
  backText: {
    color: '#E4E4E7',
    fontSize: 12,
    fontWeight: '600',
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFFFFF' },
  syncBadge: {
    backgroundColor: 'rgba(16,185,129,0.15)', borderWidth: 1, borderColor: '#10B981',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6
  },
  syncBadgeText: { color: '#10B981', fontSize: 9.5, fontWeight: '700' },
  headerSubtitle: { fontSize: 11, color: '#71717A', marginTop: 1 },

  viewToggleGroup: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  viewToggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  viewToggleBtnActive: { backgroundColor: '#06B6D4' },
  viewToggleText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },
  viewToggleTextActive: { color: '#FFFFFF', fontWeight: 'bold' },

  deptBar: { marginVertical: 2 },
  deptScroll: { paddingHorizontal: 16, paddingVertical: 3 },
  deptChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20,
    paddingHorizontal: 11, paddingVertical: 4, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.03)'
  },
  deptChipActive: { borderColor: '#06B6D4', backgroundColor: 'rgba(6,182,212,0.15)' },
  deptChipText: { color: '#A1A1AA', fontSize: 11, fontWeight: '500' },
  deptChipTextActive: { color: '#06B6D4', fontWeight: 'bold' },

  subBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 3
  },
  lineFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  subBarLabel: { color: '#52525B', fontSize: 9.5, fontWeight: '800' },
  subPill: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2.5, backgroundColor: 'rgba(255,255,255,0.02)'
  },
  subPillActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56,189,248,0.12)' },
  subPillText: { color: '#71717A', fontSize: 10, fontWeight: '500' },
  subPillTextActive: { color: '#38BDF8', fontWeight: '700' },

  gestureModeGroup: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 8, padding: 2, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  gestureModeBtn: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 6 },
  gestureModeBtnActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  gestureModeText: { color: '#71717A', fontSize: 9.5, fontWeight: '600' },
  gestureModeTextActive: { color: '#FFFFFF', fontWeight: 'bold' },

  canvasContainer: { flex: 1, overflow: 'hidden', backgroundColor: '#09090B' },
  universe: { width: WORLD_SIZE, height: WORLD_SIZE },

  // Screen Space Projected Elements
  nodeAnchor: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5
  },
  nodeTouchable: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  glowRing: {
    position: 'absolute',
    zIndex: -1
  },
  nodeCircle: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 6
  },
  nodeEmoji: {
    textAlign: 'center'
  },
  innerDot: {
    opacity: 0.95
  },
  labelPill: {
    backgroundColor: 'rgba(15,23,42,0.95)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 5
  },
  labelPillSelected: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(14,116,144,0.98)'
  },
  labelPillConnected: {
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(15,23,42,0.98)'
  },
  labelText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#F4F4F5',
    textAlign: 'center'
  },
  labelTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800'
  },
  subLabelText: {
    fontSize: 7.5,
    fontWeight: '500',
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 0.5
  },

  badgeAnchor: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10
  },
  badgePill: {
    backgroundColor: 'rgba(15,23,42,0.94)',
    borderWidth: 1.2,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 5
  },
  badgePillSelected: {
    borderWidth: 2,
    borderColor: '#38BDF8',
    backgroundColor: 'rgba(12,74,110,0.95)'
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3
  },

  // Compact floating HUD on the bottom-right
  compactHud: {
    position: 'absolute', right: 16, bottom: 24,
    backgroundColor: 'rgba(24,24,27,0.85)', borderRadius: 24,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    padding: 4, gap: 6, elevation: 8
  },
  hudCircleBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center'
  },
  hudCircleText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },

  // Detail Sheet Card
  detailCard: {
    position: 'absolute', bottom: 12, left: 14, right: 14,
    backgroundColor: 'rgba(24,24,27,0.96)', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 10
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  detailTitleRow: { flex: 1, marginRight: 8 },
  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  deptBadge: {
    borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2
  },
  deptBadgeText: { fontSize: 9.5, fontWeight: '700' },
  levelBadge: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  levelBadgeText: { fontSize: 8.5, fontWeight: '800', color: '#E4E4E7', letterSpacing: 0.5 },
  detailName: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#71717A', fontSize: 16, fontWeight: 'bold' },
  detailValue: { fontSize: 12.5, color: '#D4D4D8', lineHeight: 17, marginBottom: 8 },

  breadcrumbContainer: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4, marginBottom: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  breadcrumbText: { fontSize: 11, color: '#A1A1AA', fontWeight: '500' },

  parentSection: { marginBottom: 8 },
  parentLabel: { fontSize: 9.5, fontWeight: '800', color: '#71717A', marginBottom: 3 },
  parentChip: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.04)', alignSelf: 'flex-start'
  },
  parentChipText: { fontSize: 11.5, fontWeight: '600' },

  stemsSection: { marginBottom: 8 },
  stemsSectionTitle: { fontSize: 10, fontWeight: '800', color: '#10B981', marginBottom: 4 },
  stemChip: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, backgroundColor: 'rgba(255,255,255,0.04)'
  },
  stemChipName: { fontSize: 11, fontWeight: '600' },
  stemChipSub: { fontSize: 9, color: '#A1A1AA', marginTop: 1 },

  edgeExplanationText: { fontSize: 12.5, color: '#E4E4E7', lineHeight: 18, marginBottom: 10 },
  edgeNodesRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  edgeNodeChip: {
    flex: 1, borderWidth: 1, borderRadius: 10, padding: 8,
    backgroundColor: 'rgba(255,255,255,0.04)'
  },
  edgeNodeRole: { fontSize: 8.5, fontWeight: '800', color: '#71717A', marginBottom: 2 },
  edgeNodeName: { fontSize: 12, fontWeight: '700' },
  edgeNodeSub: { fontSize: 9.5, color: '#A1A1AA', marginTop: 1 },
  edgeArrow: { fontSize: 16, color: '#38BDF8', fontWeight: 'bold', marginHorizontal: 8 },
  treePathSection: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8,
    padding: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)'
  },
  treePathLabel: { fontSize: 9, fontWeight: '800', color: '#71717A', marginBottom: 4 },
  treePathText: { fontSize: 10.5, color: '#D4D4D8', lineHeight: 15 },

  linesSection: { marginTop: 4 },
  linesSectionTitle: { fontSize: 10, fontWeight: '800', color: '#38BDF8', marginBottom: 6 },
  linksScroll: { flexDirection: 'row' },
  linkChip: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, backgroundColor: 'rgba(255,255,255,0.04)', flexDirection: 'column'
  },
  linkChipRelation: { fontSize: 9.5, fontWeight: '700' },
  linkChipTarget: { fontSize: 11, fontWeight: '500', color: '#FFFFFF', marginTop: 1 },
  linkChipExplanation: { fontSize: 9, color: '#71717A', marginTop: 2, maxWidth: 160 },
  noLinksText: { fontSize: 11, color: '#71717A', fontStyle: 'italic' },

  // Surgical Action Bar & Buttons
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 6,
    gap: 8
  },
  talkToNovaBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14,116,144,0.3)',
    borderColor: '#38BDF8',
    borderWidth: 1.2,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 12
  },
  talkToNovaIcon: {
    fontSize: 13,
    marginRight: 6
  },
  talkToNovaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38BDF8',
    letterSpacing: 0.3
  },
  deleteBubbleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.5)',
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 12
  },
  deleteBubbleIcon: {
    fontSize: 12,
    marginRight: 4
  },
  deleteBubbleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#EF4444'
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)'
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0
  },
  modalCard: {
    backgroundColor: '#0F172A',
    borderColor: 'rgba(56,189,248,0.3)',
    borderTopWidth: 1.5,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 20
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1
  },
  novaAvatarCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(56,189,248,0.2)',
    borderColor: '#38BDF8',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center'
  },
  novaAvatarEmoji: {
    fontSize: 16
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#F4F4F5'
  },
  modalSubtitle: {
    fontSize: 11,
    fontWeight: '500',
    color: '#38BDF8',
    marginTop: 1
  },
  modalCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalCloseText: {
    fontSize: 13,
    color: '#A1A1AA',
    fontWeight: '700'
  },
  currentValBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12
  },
  currentValLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
    marginBottom: 4
  },
  currentValText: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#E2E8F0',
    lineHeight: 17
  },
  modeToggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10
  },
  modeToggleBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6
  },
  modeToggleBtnActive: {
    backgroundColor: '#38BDF8'
  },
  modeToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8'
  },
  modeToggleTextActive: {
    color: '#0F172A',
    fontWeight: '800'
  },
  inputContainer: {
    marginBottom: 12
  },
  inputGuideText: {
    fontSize: 10.5,
    fontWeight: '500',
    color: '#A1A1AA',
    marginBottom: 6
  },
  modalInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#FFFFFF',
    minHeight: 65,
    textAlignVertical: 'top'
  },
  novaFeedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderColor: 'rgba(16,185,129,0.4)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12
  },
  novaFeedbackIcon: {
    fontSize: 14,
    marginRight: 6
  },
  novaFeedbackText: {
    flex: 1,
    fontSize: 11.5,
    fontWeight: '600',
    color: '#34D399'
  },
  modalActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  modalChatBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  modalChatText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#D4D4D8'
  },
  modalSubmitBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0284C7',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14
  },
  modalSubmitBtnDisabled: {
    opacity: 0.6
  },
  modalSubmitIcon: {
    fontSize: 13,
    marginRight: 6
  },
  modalSubmitText: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#FFFFFF'
  }
});
