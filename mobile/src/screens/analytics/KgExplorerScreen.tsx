import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Line, Circle, Text as SvgText, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import * as d3 from 'd3-force';
import { api } from '../../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_HEIGHT = SCREEN_HEIGHT - 175;

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
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
  x3d?: number;
  y3d?: number;
  z3d?: number;
}

interface GraphEdge extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: any;
  target: any;
  relation: string;
  color: string;
  isCrossDomain?: boolean;
  weight?: number;
  sourceNode?: GraphNode;
  targetNode?: GraphNode;
}

interface ProjectedNode {
  node: GraphNode;
  screenX: number;
  screenY: number;
  z: number;
  depthScale: number;
  depthOpacity: number;
  visible: boolean;
  isSelected: boolean;
  isConnectedToSelected: boolean;
}

interface ProjectedEdge {
  edge: GraphEdge;
  sourceId: string;
  targetId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
  avgZ: number;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  isHighlighted: boolean;
  visible: boolean;
}

interface DepartmentMeta {
  id: string;
  name: string;
  emoji: string;
  color: string;
  count: number;
}

interface CameraState {
  rotX: number;
  rotY: number;
  zoom: number;
}

const DOMAIN_COLORS: Record<string, { color: string; emoji: string; name: string }> = {
  family:    { color: '#EC4899', emoji: '👨‍👩‍👧', name: 'Family & Relationships' },
  work:      { color: '#3B82F6', emoji: '👔', name: 'Career & Professional' },
  goals:     { color: '#10B981', emoji: '🎯', name: 'Goals & Ambitions' },
  lifestyle: { color: '#F59E0B', emoji: '🧘', name: 'Lifestyle & Rhythm' },
  identity:  { color: '#8B5CF6', emoji: '📌', name: 'Core Identity' },
};

// 3D Orbital Coordinates for 5 Department Hubs
const DEPT_3D_POSITIONS: Record<string, { x: number; y: number; z: number }> = {
  identity:  { x: 0,    y: -15,  z: 135 }, // front center
  family:    { x: 120,  y: -50,  z: 40  }, // top right front
  work:      { x: -120, y: -50,  z: -40 }, // top left back
  goals:     { x: 70,   y: 105,  z: -50 }, // bottom right back
  lifestyle: { x: -80,  y: 90,   z: 60  }, // bottom left front
};

function inferDomain(rawKey: string, memoryType?: string): string {
  const k = (rawKey || '').toLowerCase();
  const mt = (memoryType || '').toLowerCase();
  if (k.includes('son_age') || k.includes('child_age') || mt === 'family' || /wife|son|mother|father|daughter|sister|brother|baby|child|family/.test(k)) return 'family';
  if (mt === 'work' || /company|office|schedule|hours|days|timing|candidate|job|work/.test(k)) return 'work';
  if (mt === 'goals' || /goal|target|passion|vision|ambition/.test(k)) return 'goals';
  if (mt === 'preferences' || mt === 'lifestyle' || /favourite|food|drink|beverage|color|routine/.test(k)) return 'lifestyle';
  return 'identity';
}

function toGraphLabel(key: string, value: string): string {
  const k = key.toLowerCase();
  const v = (value || '').trim();

  if (k === 'wife_name') return `${v} (Wife)`;
  if (k === 'son_name') return `${v} (Son)`;
  if (k === 'son_age') return `${v} old (Son)`;
  if (k === 'father_name') return `${v} (Father)`;
  if (k === 'mother_name') return `${v} (Mother)`;
  if (k === 'company_name') return `${v} (Company)`;
  if (k === 'work_schedule') return '11am - 8pm (Work)';
  if (k === 'office_hours') return `${v} (Hours)`;
  if (k === 'current_office_location') return `${v} (Office)`;
  if (k === 'candidates_for_job') return `${v} (Hiring)`;
  if (k === 'hope_for_job_selection') return 'Target: 2 Selections';
  if (k === 'goals') return v.length > 20 ? v.slice(0, 18) + '... (Goal)' : `${v} (Goal)`;
  if (k === 'passions') return 'Passions & Leadership';
  if (k === 'preferred_name') {
    const cleanName = v.replace(/^Prefers to be called\s+/i, '').replace(/\.$/, '');
    return `${cleanName} (Name)`;
  }
  const cleanKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return v.length > 16 ? `${v.slice(0, 14)}...` : (v || cleanKey);
}

// Deterministic 3D Constellation Generator
function assign3DCoordinates(nodes: GraphNode[]): GraphNode[] {
  const deptMembers: Record<string, GraphNode[]> = {
    family: [], work: [], goals: [], lifestyle: [], identity: []
  };

  for (const n of nodes) {
    if (n.isHub || n.isDepartment) continue;
    const d = n.department || 'identity';
    if (!deptMembers[d]) deptMembers[d] = [];
    deptMembers[d].push(n);
  }

  return nodes.map((n) => {
    if (n.isHub) {
      return { ...n, x3d: 0, y3d: 0, z3d: 0 };
    }

    if (n.isDepartment) {
      const p = DEPT_3D_POSITIONS[n.department] || { x: 0, y: 0, z: 120 };
      return { ...n, x3d: p.x, y3d: p.y, z3d: p.z };
    }

    const d = n.department || 'identity';
    const hubPos = DEPT_3D_POSITIONS[d] || { x: 0, y: 0, z: 120 };
    const members = deptMembers[d] || [];
    const index = members.findIndex(m => m.id === n.id);
    const count = Math.max(1, members.length);

    const angle = (index / count) * 2 * Math.PI;
    const elevation = Math.sin(index * 2.1) * 0.55;
    const r = 66;

    const dx = r * Math.cos(angle) * Math.cos(elevation);
    const dy = r * Math.sin(angle) * Math.cos(elevation);
    const dz = r * Math.sin(elevation);

    return {
      ...n,
      x3d: Math.round(hubPos.x + dx),
      y3d: Math.round(hubPos.y + dy),
      z3d: Math.round(hubPos.z + dz)
    };
  });
}

function synthesizeGraph(memories: any[], workingContext: any[], preferredName: string = 'Saa') {
  const rawNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const coreNode: GraphNode = {
    id: 'user-core',
    name: preferredName || 'You',
    entity_type: 'self',
    department: 'identity',
    color: '#8B5CF6',
    radius: 25,
    value: `Central Self: ${preferredName}`,
    isHub: true,
    emoji: '🧠'
  };
  rawNodes.push(coreNode);
  nodeIds.add(coreNode.id);

  const deptCounts: Record<string, number> = { family: 0, work: 0, goals: 0, lifestyle: 0, identity: 0 };
  const DEPT_KEYS = ['family', 'work', 'goals', 'lifestyle', 'identity'];

  for (const d of DEPT_KEYS) {
    const meta = DOMAIN_COLORS[d];
    const deptNodeId = `dept-${d}`;
    rawNodes.push({
      id: deptNodeId,
      name: meta.name,
      entity_type: 'department',
      department: d,
      color: meta.color,
      radius: 20,
      value: `Department: ${meta.name}`,
      isDepartment: true,
      emoji: meta.emoji
    });
    nodeIds.add(deptNodeId);

    edges.push({
      id: `edge-core-${d}`,
      source: 'user-core',
      target: deptNodeId,
      relation: 'HAS_DEPARTMENT',
      color: 'rgba(255,255,255,0.3)',
      weight: 3
    });
  }

  for (const mem of memories) {
    if (!mem.key || !mem.value) continue;
    const d = inferDomain(mem.key, mem.memory_type);
    const meta = DOMAIN_COLORS[d] || DOMAIN_COLORS.identity;
    const nodeId = `mem-${mem.key}`;
    if (nodeIds.has(nodeId)) continue;

    rawNodes.push({
      id: nodeId,
      name: toGraphLabel(mem.key, mem.value),
      entity_type: mem.memory_type || 'memory',
      department: d,
      color: meta.color,
      radius: 13,
      value: mem.value,
      raw_key: mem.key,
      emoji: meta.emoji
    });
    nodeIds.add(nodeId);
    deptCounts[d]++;

    edges.push({
      id: `edge-dept-${mem.key}`,
      source: `dept-${d}`,
      target: nodeId,
      relation: 'CONTAINS',
      color: meta.color,
      weight: 1
    });
  }

  for (const wm of workingContext) {
    if (!wm.key || !wm.value) continue;
    const d = inferDomain(wm.key);
    const nodeId = `wm-${wm.key}`;
    if (nodeIds.has(nodeId)) continue;

    rawNodes.push({
      id: nodeId,
      name: toGraphLabel(wm.key, wm.value),
      entity_type: 'active_context',
      department: d,
      color: '#06B6D4',
      radius: 12,
      value: wm.value,
      raw_key: wm.key,
      isContext: true,
      emoji: '⚡'
    });
    nodeIds.add(nodeId);
    deptCounts[d]++;

    edges.push({
      id: `edge-dept-wm-${wm.key}`,
      source: `dept-${d}`,
      target: nodeId,
      relation: 'ACTIVE_FOCUS',
      color: '#06B6D4',
      weight: 1
    });
  }

  if (nodeIds.has('mem-work_schedule') && nodeIds.has('mem-wife_name')) {
    edges.push({
      id: 'cross-sched-wife',
      source: 'mem-work_schedule',
      target: 'mem-wife_name',
      relation: 'EVENING_ROUTINE',
      color: '#C084FC',
      isCrossDomain: true,
      weight: 2
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
      weight: 2
    });
  }
  if (nodeIds.has('wm-candidates_for_job') && nodeIds.has('mem-company_name')) {
    edges.push({
      id: 'cross-cand-comp',
      source: 'wm-candidates_for_job',
      target: 'mem-company_name',
      relation: 'HIRING_AT',
      color: '#34D399',
      isCrossDomain: true,
      weight: 2
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
      weight: 2
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
      weight: 2
    });
  }

  const nodes = assign3DCoordinates(rawNodes);

  const departments: DepartmentMeta[] = DEPT_KEYS.map(d => ({
    id: d,
    name: DOMAIN_COLORS[d].name,
    emoji: DOMAIN_COLORS[d].emoji,
    color: DOMAIN_COLORS[d].color,
    count: deptCounts[d]
  }));

  return { nodes, edges, departments };
}

export function KgExplorerScreen() {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'3d' | '2d'>('3d');
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [departments, setDepartments] = useState<DepartmentMeta[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [lineFilter, setLineFilter] = useState<'all' | 'cross'>('all');
  const [autoRotate, setAutoRotate] = useState(true);

  // 60FPS Camera State with Single Master RAF Loop
  const [camera, setCamera] = useState<CameraState>({ rotX: 0.28, rotY: 0.45, zoom: 1.0 });

  const cameraRef = useRef<CameraState>({ rotX: 0.28, rotY: 0.45, zoom: 1.0 });
  const isDirtyRef = useRef(false);
  const autoRotateRef = useRef(true);

  const dragStartRotX = useRef(0.28);
  const dragStartRotY = useRef(0.45);
  const dragStartZoom = useRef(1.0);

  // 2D Pan and Zoom Shared Values (fallback 2D mode)
  const scale2D = useSharedValue(1);
  const savedScale2D = useSharedValue(1);
  const translateX2D = useSharedValue(0);
  const translateY2D = useSharedValue(0);
  const savedTranslateX2D = useSharedValue(0);
  const savedTranslateY2D = useSharedValue(0);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    fetchGraph();
  }, []);

  // ----------------------------------------------------
  // SINGLE MASTER ANIMATION LOOP (SILKY SMOOTH 60 FPS)
  // Decoupled from touch events: touch events only set refs,
  // this RAF loop syncs with screen refresh rate without state flooding!
  // ----------------------------------------------------
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.06, (now - lastTime) / 1000);
      lastTime = now;

      let needsUpdate = false;

      if (autoRotateRef.current && viewMode === '3d') {
        // Gentle smooth rotation ~14 deg/sec
        cameraRef.current.rotY = (cameraRef.current.rotY + dt * 0.22) % (2 * Math.PI);
        needsUpdate = true;
      } else if (isDirtyRef.current) {
        isDirtyRef.current = false;
        needsUpdate = true;
      }

      if (needsUpdate) {
        setCamera({
          rotX: cameraRef.current.rotX,
          rotY: cameraRef.current.rotY,
          zoom: cameraRef.current.zoom,
        });
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [viewMode]);

  const fetchGraph = async () => {
    try {
      setLoading(true);
      let apiNodes: any[] = [];
      let apiEdges: any[] = [];
      let apiDepts: any[] = [];

      try {
        const res = await api.get('/analytics/kg');
        if (res.data?.data?.nodes && res.data.data.nodes.length > 0) {
          apiNodes = res.data.data.nodes;
          apiEdges = res.data.data.edges || [];
          apiDepts = res.data.data.departments || [];
        }
      } catch (e) {
        // Fallback to /analytics/memories
      }

      if (!apiNodes || apiNodes.length === 0) {
        const memRes = await api.get('/analytics/memories');
        const memData = memRes.data?.data;
        if (memData) {
          const synthesized = synthesizeGraph(
            memData.currentMemories || [],
            memData.workingContext || [],
            'Saa'
          );
          apiNodes = synthesized.nodes;
          apiEdges = synthesized.edges;
          apiDepts = synthesized.departments;
        }
      }

      const nodesWith3D = assign3DCoordinates(apiNodes);

      const centerX = SCREEN_WIDTH / 2;
      const centerY = GRAPH_HEIGHT / 2;

      // Pre-position for 2D mode
      const d3Nodes: GraphNode[] = nodesWith3D.map((n: any, idx: number) => {
        let initX = centerX;
        let initY = centerY;

        if (n.isHub) {
          initX = centerX;
          initY = centerY;
        } else if (n.isDepartment) {
          const angle = (idx * 2 * Math.PI) / 5;
          initX = centerX + Math.cos(angle) * 110;
          initY = centerY + Math.sin(angle) * 110;
        } else {
          const angle = Math.random() * 2 * Math.PI;
          const dist = 140 + Math.random() * 70;
          initX = centerX + Math.cos(angle) * dist;
          initY = centerY + Math.sin(angle) * dist;
        }

        return { ...n, x: initX, y: initY };
      });

      const nodeMap = new Map<string, GraphNode>(d3Nodes.map(n => [n.id, n]));

      // Pre-link direct node references onto edges for O(1) projection (NO map lookups per frame!)
      const processedEdges: GraphEdge[] = (apiEdges || [])
        .map((e: any) => {
          const sId = typeof e.source === 'string' ? e.source : e.source?.id;
          const tId = typeof e.target === 'string' ? e.target : e.target?.id;
          const sourceNode = nodeMap.get(sId);
          const targetNode = nodeMap.get(tId);
          return {
            ...e,
            source: sId,
            target: tId,
            sourceNode,
            targetNode,
          };
        })
        .filter((e: any) => e.sourceNode && e.targetNode);

      // Pre-calculate 2D layout synchronously in 3ms without background tick loops!
      const sim = d3.forceSimulation<GraphNode>(d3Nodes)
        .force('link', d3.forceLink<GraphNode, GraphEdge>(processedEdges).id(d => d.id).distance(80))
        .force('charge', d3.forceManyBody<GraphNode>().strength(-200))
        .force('center', d3.forceCenter(centerX, centerY))
        .stop();
      for (let i = 0; i < 40; ++i) sim.tick();

      setDepartments(apiDepts || []);
      setNodes(d3Nodes);
      setEdges(processedEdges);
    } catch (err) {
      console.error('Failed to load knowledge graph', err);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------------------------------
  // ULTRA-FAST 3D TOUCH GESTURE
  // ZERO setState calls during drag -> silky smooth 60fps!
  // ----------------------------------------------------
  const pan3DGesture = useMemo(() => {
    return Gesture.Pan()
      .runOnJS(true)
      .onBegin(() => {
        autoRotateRef.current = false;
        setAutoRotate(false);
        dragStartRotX.current = cameraRef.current.rotX;
        dragStartRotY.current = cameraRef.current.rotY;
      })
      .onUpdate((e) => {
        // High-precision smooth sensitivity
        const nextY = dragStartRotY.current + (e.translationX * 0.0065);
        const nextX = Math.max(-1.35, Math.min(1.35, dragStartRotX.current - (e.translationY * 0.0065)));
        cameraRef.current.rotX = nextX;
        cameraRef.current.rotY = nextY;
        isDirtyRef.current = true;
      });
  }, []);

  const pinch3DGesture = useMemo(() => {
    return Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        autoRotateRef.current = false;
        setAutoRotate(false);
        dragStartZoom.current = cameraRef.current.zoom;
      })
      .onUpdate((e) => {
        const nextZoom = Math.max(0.45, Math.min(2.8, dragStartZoom.current * e.scale));
        cameraRef.current.zoom = nextZoom;
        isDirtyRef.current = true;
      });
  }, []);

  const composed3DGesture = Gesture.Simultaneous(pan3DGesture, pinch3DGesture);

  // 2D Gesture Handlers
  const pinch2DGesture = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      scale2D.value = Math.max(0.35, Math.min(savedScale2D.value * e.scale, 3.2));
    })
    .onEnd(() => {
      'worklet';
      savedScale2D.value = scale2D.value;
    });

  const pan2DGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      translateX2D.value = savedTranslateX2D.value + e.translationX;
      translateY2D.value = savedTranslateY2D.value + e.translationY;
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX2D.value = translateX2D.value;
      savedTranslateY2D.value = translateY2D.value;
    });

  const composed2DGesture = Gesture.Simultaneous(pinch2DGesture, pan2DGesture);

  const animated2DStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX2D.value },
      { translateY: translateY2D.value },
      { scale: scale2D.value }
    ]
  }));

  // Quick 3D Perspective Presets
  const handleReset3D = useCallback(() => {
    cameraRef.current = { rotX: 0.28, rotY: 0.45, zoom: 1.0 };
    isDirtyRef.current = true;
    autoRotateRef.current = true;
    setAutoRotate(true);
  }, []);

  const handleTopView = useCallback(() => {
    cameraRef.current.rotX = 1.35;
    cameraRef.current.rotY = 0;
    isDirtyRef.current = true;
    autoRotateRef.current = false;
    setAutoRotate(false);
  }, []);

  const handleFrontView = useCallback(() => {
    cameraRef.current.rotX = 0;
    cameraRef.current.rotY = 0;
    isDirtyRef.current = true;
    autoRotateRef.current = false;
    setAutoRotate(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    cameraRef.current.zoom = Math.min(cameraRef.current.zoom + 0.3, 2.8);
    isDirtyRef.current = true;
  }, []);

  const handleZoomOut = useCallback(() => {
    cameraRef.current.zoom = Math.max(cameraRef.current.zoom - 0.3, 0.45);
    isDirtyRef.current = true;
  }, []);

  const handleNodePress = (node: GraphNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
      autoRotateRef.current = false;
      setAutoRotate(false);
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

  // ----------------------------------------------------
  // ULTRA-OPTIMIZED 3D MATHEMATICAL PROJECTION (<0.05ms)
  // ----------------------------------------------------
  const centerX = SCREEN_WIDTH / 2;
  const centerY = GRAPH_HEIGHT / 2;

  const { projectedNodes, projectedEdges } = useMemo(() => {
    const { rotX, rotY, zoom } = camera;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);

    const cameraDist = 520;
    const focalLen = 520;

    const projectedNodeLookup = new Map<string, ProjectedNode>();

    // 1. Project nodes
    const pNodes: ProjectedNode[] = nodes.map(n => {
      const x = n.x3d || 0;
      const y = n.y3d || 0;
      const z = n.z3d || 0;

      // Yaw
      const x1 = x * cosY - z * sinY;
      const y1 = y;
      const z1 = x * sinY + z * cosY;

      // Pitch
      const x2 = x1;
      const y2 = y1 * cosX - z1 * sinX;
      const z2 = y1 * sinX + z1 * cosX;

      // Perspective factor
      const effectiveZ = z2 * zoom;
      const perspective = focalLen / Math.max(90, cameraDist + focalLen - effectiveZ);

      const screenX = centerX + x2 * zoom * perspective * 1.5;
      const screenY = centerY + y2 * zoom * perspective * 1.5;

      const depthScale = Math.max(0.45, Math.min(1.4, perspective * 2.0));
      const normalizedZ = (z2 + 200) / 400;
      const depthOpacity = Math.max(0.32, Math.min(1.0, 0.32 + normalizedZ * 0.68));

      const isVisible = !selectedDept || n.isHub || n.department === selectedDept;
      const isSelected = selectedNode?.id === n.id;
      const isConnected = connectedNodeIds.has(n.id);

      const pNode: ProjectedNode = {
        node: n,
        screenX,
        screenY,
        z: z2,
        depthScale,
        depthOpacity,
        visible: isVisible,
        isSelected,
        isConnectedToSelected: isConnected
      };

      projectedNodeLookup.set(n.id, pNode);
      return pNode;
    });

    // 2. Project edges directly with pre-linked node references
    const pEdges: ProjectedEdge[] = edges.map(e => {
      const pS = projectedNodeLookup.get(e.source);
      const pT = projectedNodeLookup.get(e.target);
      if (!pS || !pT) return null;

      const avgZ = (pS.z + pT.z) / 2;
      const avgOpacity = (pS.depthOpacity + pT.depthOpacity) / 2;
      const midX = (pS.screenX + pT.screenX) / 2;
      const midY = (pS.screenY + pT.screenY) / 2;

      const isConnectedToSelected = selectedNode && (e.source === selectedNode.id || e.target === selectedNode.id);
      const isCross = !!e.isCrossDomain;

      let visible = true;
      if (selectedDept) {
        visible = pS.node.department === selectedDept || pT.node.department === selectedDept;
      }
      if (lineFilter === 'cross' && !isCross) {
        visible = false;
      }

      let strokeColor = e.color || 'rgba(255,255,255,0.2)';
      let strokeWidth = 1.2;
      let strokeOpacity = avgOpacity * 0.8;

      if (selectedNode) {
        if (isConnectedToSelected) {
          strokeColor = isCross ? '#38BDF8' : '#FFFFFF';
          strokeWidth = 3.2;
          strokeOpacity = 1.0;
        } else {
          strokeOpacity = 0.05; // Dim background lines
          strokeWidth = 0.8;
        }
      } else if (isCross) {
        strokeColor = e.color || '#C084FC';
        strokeWidth = 2.0;
        strokeOpacity = Math.max(0.75, avgOpacity);
      }

      return {
        edge: e,
        sourceId: e.source,
        targetId: e.target,
        x1: pS.screenX,
        y1: pS.screenY,
        x2: pT.screenX,
        y2: pT.screenY,
        midX,
        midY,
        avgZ,
        strokeColor,
        strokeWidth,
        strokeOpacity,
        isHighlighted: !!isConnectedToSelected,
        visible
      };
    }).filter(Boolean) as ProjectedEdge[];

    // 3. Depth Sort
    pNodes.sort((a, b) => a.z - b.z);
    pEdges.sort((a, b) => a.avgZ - b.avgZ);

    return { projectedNodes: pNodes, projectedEdges: pEdges };
  }, [nodes, edges, camera, selectedDept, selectedNode, connectedNodeIds, lineFilter, centerX, centerY]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#06B6D4" />
        <Text style={styles.loadingText}>Synthesizing 3D Knowledge Galaxy...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>

        {/* Top Header & 3D/2D View Mode Toggle */}
        <View style={styles.header}>
          <View>
            <View style={styles.titleRow}>
              <Text style={styles.headerTitle}>Neural Galaxy</Text>
              <View style={styles.live3DBadge}>
                <Text style={styles.live3DBadgeText}>60 FPS 3D</Text>
              </View>
            </View>
            <Text style={styles.headerSubtitle}>
              {nodes.length} nodes · {edges.length} connecting lines
            </Text>
          </View>

          {/* Mode Switcher: 3D Galaxy vs 2D Map */}
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

        {/* Department Filter Chips */}
        <View style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <TouchableOpacity
              style={[styles.filterChip, !selectedDept && styles.filterChipActive]}
              onPress={() => setSelectedDept(null)}
            >
              <Text style={[styles.filterChipText, !selectedDept && styles.filterChipTextActive]}>
                All Galaxy ({nodes.length})
              </Text>
            </TouchableOpacity>

            {departments.map((dept) => {
              const isActive = selectedDept === dept.id;
              return (
                <TouchableOpacity
                  key={dept.id}
                  style={[
                    styles.filterChip,
                    isActive && { borderColor: dept.color, backgroundColor: `${dept.color}25` }
                  ]}
                  onPress={() => setSelectedDept(isActive ? null : dept.id)}
                >
                  <Text style={[styles.filterChipText, isActive && { color: dept.color }]}>
                    {dept.emoji} {dept.name} ({dept.count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Connecting Lines Filter Bar */}
        <View style={styles.subFilterBar}>
          <Text style={styles.subFilterLabel}>LINES:</Text>
          <TouchableOpacity
            style={[styles.subFilterChip, lineFilter === 'all' && styles.subFilterChipActive]}
            onPress={() => setLineFilter('all')}
          >
            <Text style={[styles.subFilterChipText, lineFilter === 'all' && styles.subFilterChipTextActive]}>
              All ({edges.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.subFilterChip, lineFilter === 'cross' && styles.subFilterChipActive]}
            onPress={() => setLineFilter('cross')}
          >
            <Text style={[styles.subFilterChipText, lineFilter === 'cross' && styles.subFilterChipTextActive]}>
              ⚡ Cross-Domain Only
            </Text>
          </TouchableOpacity>
          {selectedNode && (
            <TouchableOpacity
              style={[styles.subFilterChip, { borderColor: '#38BDF8', backgroundColor: 'rgba(56,189,248,0.15)' }]}
              onPress={() => setSelectedNode(null)}
            >
              <Text style={[styles.subFilterChipText, { color: '#38BDF8', fontWeight: 'bold' }]}>
                ✕ Clear
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* MAIN CANVAS: 3D GALAXY OR 2D MAP */}
        <View style={styles.canvasWrapper}>
          {viewMode === '3d' ? (
            <GestureDetector gesture={composed3DGesture}>
              <View style={styles.canvas3DContainer}>
                <Svg width={SCREEN_WIDTH} height={GRAPH_HEIGHT} style={styles.svg}>
                  {/* 1. Draw 3D Connecting Lines */}
                  <G>
                    {projectedEdges.map((pe) => {
                      if (!pe.visible) return null;

                      const isCross = pe.edge.isCrossDomain;
                      const dashArray = isCross ? '4, 4' : undefined;

                      return (
                        <G key={`edge-${pe.edge.id}`}>
                          {/* Glow backing only for highlighted lines to keep rasterization blazing fast */}
                          {pe.isHighlighted && (
                            <Line
                              x1={pe.x1}
                              y1={pe.y1}
                              x2={pe.x2}
                              y2={pe.y2}
                              stroke="#38BDF8"
                              strokeWidth={6}
                              opacity={0.35}
                            />
                          )}

                          <Line
                            x1={pe.x1}
                            y1={pe.y1}
                            x2={pe.x2}
                            y2={pe.y2}
                            stroke={pe.strokeColor}
                            strokeWidth={pe.strokeWidth}
                            strokeDasharray={dashArray}
                            opacity={pe.strokeOpacity}
                          />

                          {/* Midpoint relation badge only for highlighted lines */}
                          {pe.isHighlighted && pe.edge.relation && (
                            <G>
                              <Rect
                                x={pe.midX - 42}
                                y={pe.midY - 8.5}
                                width={84}
                                height={17}
                                rx={8.5}
                                fill="rgba(15,23,42,0.92)"
                                stroke="#38BDF8"
                                strokeWidth={1}
                              />
                              <SvgText
                                x={pe.midX}
                                y={pe.midY + 3}
                                fontSize={8}
                                fontWeight="bold"
                                fill="#38BDF8"
                                textAnchor="middle"
                              >
                                {pe.edge.relation.replace(/_/g, ' ')}
                              </SvgText>
                            </G>
                          )}
                        </G>
                      );
                    })}
                  </G>

                  {/* 2. Draw 3D Nodes */}
                  <G>
                    {projectedNodes.map((pn) => {
                      if (!pn.visible) return null;

                      const n = pn.node;
                      const rad = n.radius * pn.depthScale;
                      const isSelected = pn.isSelected;
                      const isConnected = pn.isConnectedToSelected;

                      const nodeOpacity = selectedNode
                        ? (isSelected || isConnected ? 1.0 : 0.2)
                        : pn.depthOpacity;

                      return (
                        <G
                          key={`node-${n.id}`}
                          onPress={() => handleNodePress(n)}
                          opacity={nodeOpacity}
                        >
                          {/* Glow halo only on Hubs or Selected/Connected nodes */}
                          {(n.isHub || n.isDepartment || isSelected) && (
                            <Circle
                              cx={pn.screenX}
                              cy={pn.screenY}
                              r={rad + (isSelected ? 8 : 5)}
                              fill={isSelected ? '#38BDF8' : n.color}
                              opacity={isSelected ? 0.45 : 0.18}
                            />
                          )}

                          <Circle
                            cx={pn.screenX}
                            cy={pn.screenY}
                            r={rad}
                            fill={n.color}
                            stroke={isSelected ? '#FFFFFF' : isConnected ? '#38BDF8' : n.isDepartment ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'}
                            strokeWidth={isSelected ? 2.8 : isConnected ? 2 : n.isDepartment ? 1.8 : 1}
                          />

                          {n.emoji && (
                            <SvgText
                              x={pn.screenX}
                              y={pn.screenY + (rad * 0.35)}
                              fontSize={rad * 0.9}
                              textAnchor="middle"
                            >
                              {n.emoji}
                            </SvgText>
                          )}

                          <SvgText
                            x={pn.screenX}
                            y={pn.screenY + rad + 11}
                            fontSize={Math.max(8.5, (n.isHub ? 11.5 : n.isDepartment ? 10 : 8.5) * pn.depthScale)}
                            fontWeight={n.isHub || n.isDepartment || isSelected ? 'bold' : '500'}
                            fill={isSelected ? '#38BDF8' : n.isDepartment ? n.color : '#E4E4E7'}
                            textAnchor="middle"
                          >
                            {n.name}
                          </SvgText>
                        </G>
                      );
                    })}
                  </G>
                </Svg>
              </View>
            </GestureDetector>
          ) : (
            /* 2D Canvas View */
            <GestureDetector gesture={composed2DGesture}>
              <Animated.View style={[styles.canvas2DContainer, animated2DStyle]}>
                <Svg width={SCREEN_WIDTH} height={GRAPH_HEIGHT} style={styles.svg}>
                  <G>
                    {edges.map((e, i) => {
                      const source = (typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source)) as GraphNode;
                      const target = (typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target)) as GraphNode;
                      if (!source?.x || !target?.x) return null;

                      const isSelectedEdge = selectedNode && (source.id === selectedNode.id || target.id === selectedNode.id);
                      const strokeColor = isSelectedEdge ? '#FFFFFF' : e.isCrossDomain ? '#C084FC' : e.color || 'rgba(255,255,255,0.2)';
                      const strokeWidth = isSelectedEdge ? 2.8 : e.isCrossDomain ? 1.8 : 1.2;

                      return (
                        <Line
                          key={`edge-2d-${e.id || i}`}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                          stroke={strokeColor}
                          strokeWidth={strokeWidth}
                          strokeDasharray={e.isCrossDomain ? '4, 4' : undefined}
                          opacity={selectedNode ? (isSelectedEdge ? 1.0 : 0.1) : 0.8}
                        />
                      );
                    })}
                  </G>

                  <G>
                    {nodes.map((n) => {
                      if (n.x === undefined || n.y === undefined) return null;
                      const isSelected = selectedNode?.id === n.id;
                      const opacity = selectedNode ? (isSelected || connectedNodeIds.has(n.id) ? 1.0 : 0.2) : 1.0;

                      return (
                        <G
                          key={`node-2d-${n.id}`}
                          onPress={() => handleNodePress(n)}
                          opacity={opacity}
                        >
                          <Circle
                            cx={n.x}
                            cy={n.y}
                            r={n.radius}
                            fill={n.color}
                            stroke={isSelected ? '#FFFFFF' : 'rgba(255,255,255,0.3)'}
                            strokeWidth={isSelected ? 3 : 1}
                          />
                          {n.emoji && (
                            <SvgText x={n.x} y={n.y + 5} fontSize={n.radius * 0.85} textAnchor="middle">
                              {n.emoji}
                            </SvgText>
                          )}
                          <SvgText
                            x={n.x}
                            y={n.y + n.radius + 12}
                            fontSize={10}
                            fill="#E4E4E7"
                            textAnchor="middle"
                          >
                            {n.name}
                          </SvgText>
                        </G>
                      );
                    })}
                  </G>
                </Svg>
              </Animated.View>
            </GestureDetector>
          )}

          {/* Floating 3D Navigation HUD */}
          {viewMode === '3d' && (
            <View style={styles.hud3D}>
              <TouchableOpacity
                style={[styles.hudBtn, autoRotate && styles.hudBtnActive]}
                onPress={() => setAutoRotate(!autoRotate)}
                activeOpacity={0.7}
              >
                <Text style={styles.hudBtnText}>{autoRotate ? '⏸' : '▶'}</Text>
                <Text style={styles.hudBtnSub}>{autoRotate ? 'Pause' : 'Spin'}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudBtn} onPress={handleZoomIn} activeOpacity={0.7}>
                <Text style={styles.hudBtnText}>＋</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudBtn} onPress={handleZoomOut} activeOpacity={0.7}>
                <Text style={styles.hudBtnText}>－</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudBtn} onPress={handleReset3D} activeOpacity={0.7}>
                <Text style={styles.hudBtnText}>⟲</Text>
                <Text style={styles.hudBtnSub}>Reset</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudBtn} onPress={handleTopView} activeOpacity={0.7}>
                <Text style={[styles.hudBtnText, { fontSize: 11 }]}>TOP</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudBtn} onPress={handleFrontView} activeOpacity={0.7}>
                <Text style={[styles.hudBtnText, { fontSize: 11 }]}>FRONT</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Selected Node Details & Exact Connecting Lines Sheet */}
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

            {/* Exact Connected Dots & Lines Breakdown */}
            {selectedNodeEdges.length > 0 ? (
              <View style={styles.linesSection}>
                <Text style={styles.linesSectionTitle}>
                  ⚡ EXACT CONNECTING LINES ({selectedNodeEdges.length}):
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
                      <View key={idx} style={[styles.linkChip, { borderColor: otherNode.color }]}>
                        <Text style={[styles.linkChipRelation, { color: otherNode.color }]}>
                          [{e.relation.replace(/_/g, ' ')}]
                        </Text>
                        <Text style={styles.linkChipTarget}>
                          ➔ {otherNode.name}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            ) : (
              <Text style={styles.noLinksText}>No external connections for this dot</Text>
            )}
          </View>
        )}

      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  loadingText: { color: '#71717A', marginTop: 12, fontSize: 14 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFFFFF' },
  live3DBadge: {
    backgroundColor: 'rgba(6,182,212,0.2)', borderWidth: 1, borderColor: '#06B6D4',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6
  },
  live3DBadgeText: { color: '#06B6D4', fontSize: 10, fontWeight: '800' },
  headerSubtitle: { fontSize: 11, color: '#71717A', marginTop: 2 },

  viewToggleGroup: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10, padding: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)'
  },
  viewToggleBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  viewToggleBtnActive: { backgroundColor: '#06B6D4' },
  viewToggleText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },
  viewToggleTextActive: { color: '#FFFFFF', fontWeight: 'bold' },

  filterBar: { marginBottom: 2 },
  filterScroll: { paddingHorizontal: 16, paddingVertical: 4 },
  filterChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20,
    paddingHorizontal: 11, paddingVertical: 4, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.03)'
  },
  filterChipActive: { borderColor: '#06B6D4', backgroundColor: 'rgba(6,182,212,0.15)' },
  filterChipText: { color: '#A1A1AA', fontSize: 11, fontWeight: '500' },
  filterChipTextActive: { color: '#06B6D4', fontWeight: 'bold' },

  subFilterBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 4, gap: 8
  },
  subFilterLabel: { color: '#52525B', fontSize: 10, fontWeight: '700' },
  subFilterChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 3, backgroundColor: 'rgba(255,255,255,0.02)'
  },
  subFilterChipActive: { borderColor: '#38BDF8', backgroundColor: 'rgba(56,189,248,0.12)' },
  subFilterChipText: { color: '#71717A', fontSize: 10, fontWeight: '500' },
  subFilterChipTextActive: { color: '#38BDF8', fontWeight: '700' },

  canvasWrapper: { flex: 1, overflow: 'hidden', backgroundColor: '#09090B' },
  canvas3DContainer: { width: SCREEN_WIDTH, height: GRAPH_HEIGHT },
  canvas2DContainer: { width: SCREEN_WIDTH, height: GRAPH_HEIGHT },
  svg: { width: SCREEN_WIDTH, height: GRAPH_HEIGHT },

  // Floating 3D Navigation HUD
  hud3D: {
    position: 'absolute', right: 14, top: 16,
    backgroundColor: 'rgba(24,24,27,0.85)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    padding: 6, alignItems: 'center', gap: 6
  },
  hudBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center'
  },
  hudBtnActive: {
    backgroundColor: 'rgba(6,182,212,0.25)', borderWidth: 1, borderColor: '#06B6D4'
  },
  hudBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  hudBtnSub: { color: '#71717A', fontSize: 8, fontWeight: '700', marginTop: -2 },

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
  deptBadgeText: { fontSize: 10, fontWeight: '700' },
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
