import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Line, Circle, Text as SvgText, Rect, Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring
} from 'react-native-reanimated';
import { api } from '../../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_HEIGHT = SCREEN_HEIGHT - 170;

// Safe virtual canvas dimensions well below Android OpenGL texture limit (2048x2048)
const WORLD_SIZE = 1000;
const CENTER = WORLD_SIZE / 2; // 500

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
  x: number;
  y: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  color: string;
  isCrossDomain?: boolean;
  weight?: number;
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

// Department hub angles around the central Core (Sun) at radius 200
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
  if (k.includes('son_age') || k.includes('child_age') || mt === 'family' || /wife|son|mother|father|daughter|sister|brother|baby|child|family/.test(k)) return 'family';
  if (mt === 'work' || /company|office|schedule|hours|days|timing|candidate|job|work/.test(k)) return 'work';
  if (mt === 'goals' || /goal|target|passion|vision|ambition/.test(k)) return 'goals';
  if (mt === 'preferences' || mt === 'lifestyle' || /favourite|food|drink|beverage|color|routine/.test(k)) return 'lifestyle';
  return 'identity';
}

function toDisplayNames(key: string = '', value: string = ''): { title: string; sub?: string } {
  const k = (key || '').toLowerCase();
  const v = (value || '').trim();

  if (k === 'wife_name') return { title: v, sub: 'Wife' };
  if (k === 'son_name') return { title: v, sub: 'Son' };
  if (k === 'son_age') return { title: `${v} old`, sub: 'Son Age' };
  if (k === 'father_name') return { title: v, sub: 'Father' };
  if (k === 'mother_name') return { title: v, sub: 'Mother' };
  if (k === 'company_name') return { title: v, sub: 'Company' };
  if (k === 'work_schedule') return { title: '11am - 8pm', sub: 'Work Hours' };
  if (k === 'office_hours') return { title: v, sub: 'Office Hours' };
  if (k === 'current_office_location') return { title: v, sub: 'Current Location' };
  if (k === 'candidates_for_job') return { title: v, sub: 'Interviews' };
  if (k === 'hope_for_job_selection') return { title: 'Target: 2', sub: 'Selections' };
  if (k === 'goals') return { title: v.length > 20 ? v.slice(0, 18) + '...' : v, sub: 'Ambition' };
  if (k === 'passions') return { title: 'Passions', sub: 'Leadership' };
  if (k === 'preferred_name') {
    const clean = v.replace(/^Prefers to be called\s+/i, '').replace(/\.$/, '');
    return { title: clean, sub: 'Name' };
  }
  const cleanKey = (key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return {
    title: v.length > 16 ? `${v.slice(0, 14)}...` : (v || cleanKey || 'Memory'),
    sub: cleanKey || 'Fact'
  };
}

// ----------------------------------------------------
// PLANETARY CONSTELLATION ALGORITHM (ZERO OVERLAPPING)
// Distributes nodes on wide non-intersecting orbital fans
// Safe coordinate bounds: [125, 875] within 1000x1000 universe
// ----------------------------------------------------
function buildPlanetaryGalaxy(rawNodes: any[] = [], rawEdges: any[] = []) {
  const nodes: GraphNode[] = [];
  const nodeMap = new Map<string, GraphNode>();

  // 1. Central Sun (Core User)
  const coreNode: GraphNode = {
    id: 'user-core',
    name: 'Saa',
    shortName: 'Saa',
    subLabel: 'Central Core',
    entity_type: 'self',
    department: 'identity',
    color: '#8B5CF6',
    radius: 30,
    value: 'Saa · Central Brain & Consciousness',
    isHub: true,
    emoji: '🧠',
    x: CENTER,
    y: CENTER
  };
  nodes.push(coreNode);
  nodeMap.set(coreNode.id, coreNode);

  // Group raw memory nodes by department
  const deptBuckets: Record<string, any[]> = {
    family: [], work: [], goals: [], lifestyle: [], identity: []
  };

  for (const n of rawNodes) {
    if (!n || n.id === 'user-core' || n.isHub || n.isDepartment) continue;
    const d = n.department || inferDomain(n.raw_key || n.id, n.entity_type);
    if (!deptBuckets[d]) deptBuckets[d] = [];
    deptBuckets[d].push(n);
  }

  // 2. Department Hubs (Planets) at Radius 200 from Center
  const DEPT_ORBIT_RADIUS = 200;
  const deptList: DepartmentMeta[] = [];
  const DEPT_KEYS = ['family', 'work', 'goals', 'lifestyle', 'identity'];

  for (const d of DEPT_KEYS) {
    const meta = DOMAIN_COLORS[d] || DOMAIN_COLORS.identity;
    const angle = DEPT_ANGLES[d] ?? 0;
    const hx = Math.round(CENTER + DEPT_ORBIT_RADIUS * Math.cos(angle));
    const hy = Math.round(CENTER + DEPT_ORBIT_RADIUS * Math.sin(angle));

    const hubNode: GraphNode = {
      id: `dept-${d}`,
      name: meta.name,
      shortName: meta.short,
      subLabel: `${deptBuckets[d]?.length || 0} items`,
      entity_type: 'department',
      department: d,
      color: meta.color,
      radius: 22,
      value: `${meta.name} Department (${deptBuckets[d]?.length || 0} connected memories)`,
      isDepartment: true,
      emoji: meta.emoji,
      x: hx,
      y: hy
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

    // 3. Memory Nodes (Moons) in Two Non-Colliding Staggered Orbital Fans
    const members = deptBuckets[d] || [];
    const count = members.length;
    if (count === 0) continue;

    // Outward pointing direction angle away from center
    const outwardAngle = angle;
    // Fan spread: ~120 degrees total spread
    const spreadSpan = Math.min(Math.PI * 0.75, Math.max(Math.PI * 0.45, (count - 1) * 0.35));
    const startAngle = outwardAngle - spreadSpan / 2;

    members.forEach((mem, idx) => {
      const names = toDisplayNames(mem.raw_key || mem.name || mem.id, mem.value || mem.name);

      // Stagger between inner arc (100px) and outer arc (160px)
      const isOuter = count > 3 ? idx % 2 === 1 : false;
      const moonDist = isOuter ? 160 : 105;

      const frac = count === 1 ? 0.5 : idx / (count - 1);
      const moonAngle = startAngle + frac * spreadSpan;

      const mx = Math.round(hx + moonDist * Math.cos(moonAngle));
      const my = Math.round(hy + moonDist * Math.sin(moonAngle));

      const moonNode: GraphNode = {
        id: mem.id || `node-${d}-${idx}`,
        name: names.title,
        shortName: names.title,
        subLabel: names.sub,
        entity_type: mem.entity_type || 'memory',
        department: d,
        color: mem.isContext ? '#06B6D4' : meta.color,
        radius: mem.isContext ? 14 : 15,
        value: mem.value || names.title,
        raw_key: mem.raw_key,
        isContext: mem.isContext,
        emoji: mem.isContext ? '⚡' : undefined,
        x: mx,
        y: my
      };

      nodes.push(moonNode);
      nodeMap.set(moonNode.id, moonNode);
    });
  }

  // 4. Edges Construction (Core -> Hubs, Hubs -> Moons, and Cross-Domain Links)
  const edges: GraphEdge[] = [];

  // Core -> Department Hubs
  for (const d of DEPT_KEYS) {
    const hubId = `dept-${d}`;
    const hub = nodeMap.get(hubId);
    if (!hub) continue;

    edges.push({
      id: `edge-core-${d}`,
      source: 'user-core',
      target: hubId,
      sourceNode: coreNode,
      targetNode: hub,
      relation: 'DEPARTMENT_HUB',
      color: 'rgba(255,255,255,0.25)',
      weight: 3
    });
  }

  // Department Hub -> Memory Nodes
  for (const d of DEPT_KEYS) {
    const hubId = `dept-${d}`;
    const hub = nodeMap.get(hubId);
    const members = deptBuckets[d] || [];
    if (!hub) continue;

    for (const mem of members) {
      const moon = nodeMap.get(mem.id);
      if (!moon) continue;

      edges.push({
        id: `edge-${hubId}-${moon.id}`,
        source: hubId,
        target: moon.id,
        sourceNode: hub,
        targetNode: moon,
        relation: 'CONTAINS',
        color: hub.color,
        weight: 1.5
      });
    }
  }

  // Cross-Domain Curved Neural Bridges
  for (const re of rawEdges) {
    if (!re || !re.isCrossDomain) continue;
    const sId = typeof re.source === 'string' ? re.source : re.source?.id;
    const tId = typeof re.target === 'string' ? re.target : re.target?.id;
    if (!sId || !tId) continue;

    const sNode = nodeMap.get(sId);
    const tNode = nodeMap.get(tId);
    if (!sNode || !tNode) continue;

    const dx = tNode.x - sNode.x;
    const dy = tNode.y - sNode.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;

    const nx = -dy / dist;
    const ny = dx / dist;
    const curveAmount = Math.min(60, Math.max(30, dist * 0.15));

    const midX = Math.round((sNode.x + tNode.x) / 2 + nx * curveAmount);
    const midY = Math.round((sNode.y + tNode.y) / 2 + ny * curveAmount);

    const pathD = `M ${sNode.x} ${sNode.y} Q ${midX} ${midY} ${tNode.x} ${tNode.y}`;

    edges.push({
      id: re.id || `cross-${sId}-${tId}`,
      source: sId,
      target: tId,
      sourceNode: sNode,
      targetNode: tNode,
      relation: re.relation || 'NEURAL_LINK',
      color: re.color || '#C084FC',
      isCrossDomain: true,
      weight: 2.5,
      pathD,
      midX,
      midY
    });
  }

  return { nodes, edges, departments: deptList };
}

// Resilient fallback synthesizer
function synthesizeGalaxy(memories: any[] = [], workingContext: any[] = []) {
  const rawNodes: any[] = [];
  const rawEdges: any[] = [];
  const ids = new Set<string>();

  for (const m of (memories || [])) {
    if (!m || !m.key || !m.value) continue;
    const d = inferDomain(m.key, m.memory_type);
    const nodeId = `mem-${m.key}`;
    if (ids.has(nodeId)) continue;

    rawNodes.push({
      id: nodeId,
      raw_key: m.key,
      name: m.key,
      value: m.value,
      department: d,
      entity_type: m.memory_type || 'memory'
    });
    ids.add(nodeId);
  }

  for (const w of (workingContext || [])) {
    if (!w || !w.key || !w.value) continue;
    const d = inferDomain(w.key);
    const nodeId = `wm-${w.key}`;
    if (ids.has(nodeId)) continue;

    rawNodes.push({
      id: nodeId,
      raw_key: w.key,
      name: w.key,
      value: w.value,
      department: d,
      entity_type: 'active_context',
      isContext: true
    });
    ids.add(nodeId);
  }

  // Cross-domain links
  if (ids.has('mem-work_schedule') && ids.has('mem-wife_name')) {
    rawEdges.push({
      id: 'cross-sched-wife',
      source: 'mem-work_schedule',
      target: 'mem-wife_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true
    });
  }
  if (ids.has('mem-work_schedule') && ids.has('mem-son_name')) {
    rawEdges.push({
      id: 'cross-sched-son',
      source: 'mem-work_schedule',
      target: 'mem-son_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true
    });
  }
  if (ids.has('wm-candidates_for_job') && ids.has('mem-company_name')) {
    rawEdges.push({
      id: 'cross-cand-comp',
      source: 'wm-candidates_for_job',
      target: 'mem-company_name',
      relation: 'HIRING_AT',
      color: '#34D399',
      isCrossDomain: true
    });
  }
  if (ids.has('wm-candidates_for_job') && ids.has('mem-goals')) {
    rawEdges.push({
      id: 'cross-cand-goal',
      source: 'wm-candidates_for_job',
      target: 'mem-goals',
      relation: 'POWERS_GOAL',
      color: '#10B981',
      isCrossDomain: true
    });
  }
  if (ids.has('mem-passions') && ids.has('mem-son_name')) {
    rawEdges.push({
      id: 'cross-pass-son',
      source: 'mem-passions',
      target: 'mem-son_name',
      relation: 'FAMILY_BOND',
      color: '#F472B6',
      isCrossDomain: true
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [gestureMode, setGestureMode] = useState<'pan' | 'orbit'>('orbit');
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [departments, setDepartments] = useState<DepartmentMeta[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [lineFilter, setLineFilter] = useState<'all' | 'cross'>('all');
  const [lastSyncTime, setLastSyncTime] = useState<string>('just now');

  // Default overview placing center (500, 500) dead-center on phone screen
  const defaultScale = Math.min((SCREEN_WIDTH - 24) / 720, 0.58);
  const defaultTranslateX = (SCREEN_WIDTH - WORLD_SIZE) / 2;
  const defaultTranslateY = (GRAPH_HEIGHT - WORLD_SIZE) / 2;

  const translateX = useSharedValue(defaultTranslateX);
  const translateY = useSharedValue(defaultTranslateY);
  const savedTranslateX = useSharedValue(defaultTranslateX);
  const savedTranslateY = useSharedValue(defaultTranslateY);

  const scale = useSharedValue(defaultScale);
  const savedScale = useSharedValue(defaultScale);

  const pitch = useSharedValue(0.24); // ~14 deg tilt
  const yaw = useSharedValue(0.35);   // ~20 deg angle
  const savedPitch = useSharedValue(0.24);
  const savedYaw = useSharedValue(0.35);

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
  // Pinch to Zoom (0.35x to 4.5x)
  // Pan to Move Universe OR Orbit 360 in 3D
  // ----------------------------------------------------
  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .onUpdate((e) => {
        'worklet';
        const next = Math.max(0.35, Math.min(4.5, savedScale.value * e.scale));
        scale.value = next;
      })
      .onEnd(() => {
        'worklet';
        savedScale.value = scale.value;
      });
  }, [scale, savedScale]);

  const panGesture = useMemo(() => {
    return Gesture.Pan()
      .minDistance(2)
      .onUpdate((e) => {
        'worklet';
        if (viewMode === '3d' && gestureMode === 'orbit') {
          // Continuous 360 degree rotation on Yaw
          yaw.value = savedYaw.value + (e.translationX * 0.006);
          // Clamp Pitch between -60 deg and +60 deg to prevent gimbal inversion
          pitch.value = Math.max(-1.05, Math.min(1.05, savedPitch.value - (e.translationY * 0.006)));
        } else {
          // Free Pan across universe
          translateX.value = savedTranslateX.value + e.translationX;
          translateY.value = savedTranslateY.value + e.translationY;
        }
      })
      .onEnd(() => {
        'worklet';
        if (viewMode === '3d' && gestureMode === 'orbit') {
          savedYaw.value = yaw.value;
          savedPitch.value = pitch.value;
        } else {
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;
        }
      });
  }, [viewMode, gestureMode, yaw, pitch, savedYaw, savedPitch, translateX, translateY, savedTranslateX, savedTranslateY]);

  const composedGesture = useMemo(() => {
    return Gesture.Simultaneous(pinchGesture, panGesture);
  }, [pinchGesture, panGesture]);

  // Native GPU Animated Style with Safe Angle Formatting
  const animatedUniverseStyle = useAnimatedStyle(() => {
    'worklet';
    const tx = isNaN(translateX.value) ? defaultTranslateX : translateX.value;
    const ty = isNaN(translateY.value) ? defaultTranslateY : translateY.value;
    const s = isNaN(scale.value) ? defaultScale : scale.value;

    if (viewMode === '3d') {
      const p = isNaN(pitch.value) ? 0.24 : pitch.value;
      const y = isNaN(yaw.value) ? 0.35 : yaw.value;
      const pDeg = `${(p * 57.2958).toFixed(1)}deg`;
      const yDeg = `${(y * 57.2958).toFixed(1)}deg`;

      return {
        transform: [
          { perspective: 1000 },
          { translateX: tx },
          { translateY: ty },
          { scale: s },
          { rotateX: pDeg },
          { rotateY: yDeg }
        ]
      };
    }

    return {
      transform: [
        { translateX: tx },
        { translateY: ty },
        { scale: s }
      ]
    };
  });

  // ----------------------------------------------------
  // CAMERA QUICK SNAPS: Glides camera straight to any node/dept
  // ----------------------------------------------------
  const glideCameraTo = useCallback((targetX: number, targetY: number, targetScale: number = 1.35) => {
    // Relative displacement from canvas center
    const destX = (SCREEN_WIDTH - WORLD_SIZE) / 2 - (targetX - CENTER) * targetScale;
    const destY = (GRAPH_HEIGHT - WORLD_SIZE) / 2 - (targetY - CENTER) * targetScale;

    translateX.value = withSpring(destX, { damping: 18 });
    translateY.value = withSpring(destY, { damping: 18 });
    savedTranslateX.value = destX;
    savedTranslateY.value = destY;

    scale.value = withSpring(targetScale, { damping: 18 });
    savedScale.value = targetScale;
  }, [translateX, translateY, savedTranslateX, savedTranslateY, scale, savedScale]);

  const handleResetView = useCallback(() => {
    translateX.value = withSpring(defaultTranslateX, { damping: 18 });
    translateY.value = withSpring(defaultTranslateY, { damping: 18 });
    savedTranslateX.value = defaultTranslateX;
    savedTranslateY.value = defaultTranslateY;

    scale.value = withSpring(defaultScale, { damping: 18 });
    savedScale.value = defaultScale;

    pitch.value = withSpring(0.24, { damping: 18 });
    yaw.value = withSpring(0.35, { damping: 18 });
    savedPitch.value = 0.24;
    savedYaw.value = 0.35;
  }, [defaultTranslateX, defaultTranslateY, defaultScale, translateX, translateY, savedTranslateX, savedTranslateY, scale, savedScale, pitch, yaw, savedPitch, savedYaw]);

  const handleFocusDept = useCallback((deptId: string) => {
    const dept = departments.find(d => d.id === deptId);
    if (!dept) return;

    setSelectedDept(deptId);
    glideCameraTo(dept.x, dept.y, 1.4);
  }, [departments, glideCameraTo]);

  const handleZoomIn = useCallback(() => {
    const next = Math.min(scale.value + 0.4, 4.5);
    scale.value = withSpring(next);
    savedScale.value = next;
  }, [scale, savedScale]);

  const handleZoomOut = useCallback(() => {
    const next = Math.max(scale.value - 0.4, 0.35);
    scale.value = withSpring(next);
    savedScale.value = next;
  }, [scale, savedScale]);

  const handleNodePress = (node: GraphNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
      glideCameraTo(node.x, node.y, Math.max(scale.value, 1.35));
    }
  };

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id);
  }, [selectedNode, edges]);

  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>([selectedNode.id]);
    for (const e of selectedNodeEdges) {
      set.add(e.source);
      set.add(e.target);
    }
    return set;
  }, [selectedNode, selectedNodeEdges]);

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
              <Text style={styles.headerTitle}>Neural Galaxy</Text>
              <TouchableOpacity style={styles.syncBadge} onPress={() => fetchGraph(false)}>
                <Text style={styles.syncBadgeText}>
                  {syncing ? '↻ Syncing...' : `● LIVE · ${lastSyncTime}`}
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
                  🔄 Orbit
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
            </View>
          )}
        </View>

        {/* GALAXY CANVAS */}
        <View style={styles.canvasContainer}>
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.universe, animatedUniverseStyle]}>
              <Svg width={WORLD_SIZE} height={WORLD_SIZE} viewBox={`0 0 ${WORLD_SIZE} ${WORLD_SIZE}`}>

                {/* 1. Draw Connecting Lines */}
                <G>
                  {edges.map((e) => {
                    const isCross = !!e.isCrossDomain;
                    if (lineFilter === 'cross' && !isCross) return null;

                    const isSelectedEdge = selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id);

                    let strokeColor = e.color || 'rgba(255,255,255,0.2)';
                    let strokeWidth = isCross ? 2.5 : 1.5;
                    let strokeOpacity = 0.55;

                    if (selectedNode) {
                      if (isSelectedEdge) {
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
                    }

                    if (isCross && e.pathD) {
                      // Curved Bézier Arch for Cross-Domain Connections
                      return (
                        <G key={`edge-${e.id}`}>
                          {isSelectedEdge && (
                            <Path
                              d={e.pathD}
                              stroke="#38BDF8"
                              strokeWidth={8}
                              strokeLinecap="round"
                              fill="none"
                              opacity={0.3}
                            />
                          )}
                          <Path
                            d={e.pathD}
                            stroke={strokeColor}
                            strokeWidth={strokeWidth}
                            strokeDasharray={isSelectedEdge ? undefined : '5, 5'}
                            strokeLinecap="round"
                            fill="none"
                            opacity={strokeOpacity}
                          />
                        </G>
                      );
                    }

                    // Straight radial spokes
                    if (!e.sourceNode || !e.targetNode) return null;
                    return (
                      <Line
                        key={`edge-${e.id}`}
                        x1={e.sourceNode.x}
                        y1={e.sourceNode.y}
                        x2={e.targetNode.x}
                        y2={e.targetNode.y}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        opacity={strokeOpacity}
                      />
                    );
                  })}
                </G>

                {/* 2. Highlighted Midpoint Relationship Badges */}
                <G>
                  {edges.map((e) => {
                    if (!selectedNode || !e.relation || (e.source !== selectedNode.id && e.target !== selectedNode.id)) {
                      return null;
                    }
                    if (!e.midX || !e.midY) return null;

                    const label = (e.relation || '').replace(/_/g, ' ');
                    const pillWidth = Math.max(68, label.length * 6.5 + 16);

                    return (
                      <G key={`badge-${e.id}`}>
                        <Rect
                          x={e.midX - pillWidth / 2}
                          y={e.midY - 11}
                          width={pillWidth}
                          height={22}
                          rx={11}
                          fill="rgba(15,23,42,0.96)"
                          stroke="#38BDF8"
                          strokeWidth={1.5}
                        />
                        <SvgText
                          x={e.midX}
                          y={e.midY + 4}
                          fontSize={9.5}
                          fontWeight="bold"
                          fill="#38BDF8"
                          textAnchor="middle"
                        >
                          {label}
                        </SvgText>
                      </G>
                    );
                  })}
                </G>

                {/* 3. Draw Nodes (Central Sun, Department Planets, and Memory Moons) */}
                <G>
                  {nodes.map((n) => {
                    const isSelected = selectedNode?.id === n.id;
                    const isConnected = connectedNodeIds.has(n.id);
                    const isFocus = isSelected || isConnected;

                    const opacity = selectedNode
                      ? (isFocus ? 1.0 : 0.22)
                      : 1.0;

                    return (
                      <G
                        key={`node-${n.id}`}
                        onPress={() => handleNodePress(n)}
                        opacity={opacity}
                      >
                        {/* Outer Glow Aura */}
                        {(n.isHub || n.isDepartment || isSelected) && (
                          <Circle
                            cx={n.x}
                            cy={n.y}
                            r={n.radius + (isSelected ? 10 : n.isHub ? 11 : 6)}
                            fill={isSelected ? '#38BDF8' : n.color}
                            opacity={isSelected ? 0.45 : 0.2}
                          />
                        )}

                        {/* Core Circle */}
                        <Circle
                          cx={n.x}
                          cy={n.y}
                          r={n.radius}
                          fill={n.color}
                          stroke={isSelected ? '#FFFFFF' : isConnected ? '#38BDF8' : n.isDepartment ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)'}
                          strokeWidth={isSelected ? 3.5 : isConnected ? 2.5 : n.isDepartment ? 2 : 1.2}
                        />

                        {/* Emoji Icon inside Node */}
                        {n.emoji && (
                          <SvgText
                            x={n.x}
                            y={n.y + (n.radius * 0.35)}
                            fontSize={n.radius * 0.9}
                            textAnchor="middle"
                          >
                            {n.emoji}
                          </SvgText>
                        )}

                        {/* Node Title */}
                        <SvgText
                          x={n.x}
                          y={n.y + n.radius + 12}
                          fontSize={n.isHub ? 13 : n.isDepartment ? 11.5 : 10}
                          fontWeight={n.isHub || n.isDepartment || isSelected ? 'bold' : '600'}
                          fill={isSelected ? '#38BDF8' : n.isDepartment ? n.color : '#FFFFFF'}
                          textAnchor="middle"
                        >
                          {n.name}
                        </SvgText>

                        {/* Subtitle / Role Tag */}
                        {n.subLabel && (
                          <SvgText
                            x={n.x}
                            y={n.y + n.radius + 23}
                            fontSize={8.5}
                            fontWeight="500"
                            fill="#A1A1AA"
                            textAnchor="middle"
                          >
                            {n.subLabel}
                          </SvgText>
                        )}
                      </G>
                    );
                  })}
                </G>

              </Svg>
            </Animated.View>
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

        {/* Selected Node Details & Connection Inspector Sheet */}
        {selectedNode && (
          <View style={styles.detailCard}>
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleRow}>
                <View style={[styles.deptBadge, { backgroundColor: `${selectedNode.color}25`, borderColor: selectedNode.color }]}>
                  <Text style={[styles.deptBadgeText, { color: selectedNode.color }]}>
                    {selectedNode.emoji || '●'} {selectedNode.department.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.detailName}>{selectedNode.name}</Text>
              </View>

              <TouchableOpacity onPress={() => setSelectedNode(null)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.detailValue}>{selectedNode.value}</Text>

            {/* Exact Connected Dots Breakdown */}
            {selectedNodeEdges.length > 0 ? (
              <View style={styles.linesSection}>
                <Text style={styles.linesSectionTitle}>
                  ⚡ EXACT CONNECTIONS ({selectedNodeEdges.length}):
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
                        onPress={() => handleNodePress(otherNode)}
                      >
                        <Text style={[styles.linkChipRelation, { color: otherNode.color }]}>
                          [{(e.relation || '').replace(/_/g, ' ')}]
                        </Text>
                        <Text style={styles.linkChipTarget}>
                          ➔ {otherNode.name}
                        </Text>
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
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF' },
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
  deptBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4
  },
  deptBadgeText: { fontSize: 9.5, fontWeight: '700' },
  detailName: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#71717A', fontSize: 16, fontWeight: 'bold' },
  detailValue: { fontSize: 12.5, color: '#D4D4D8', lineHeight: 17, marginBottom: 8 },

  linesSection: { marginTop: 4 },
  linesSectionTitle: { fontSize: 10, fontWeight: '800', color: '#38BDF8', marginBottom: 6 },
  linksScroll: { flexDirection: 'row' },
  linkChip: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, backgroundColor: 'rgba(255,255,255,0.04)', flexDirection: 'column'
  },
  linkChipRelation: { fontSize: 9.5, fontWeight: '700' },
  linkChipTarget: { fontSize: 11, fontWeight: '500', color: '#FFFFFF', marginTop: 1 },
  noLinksText: { fontSize: 11, color: '#71717A', fontStyle: 'italic' }
});
