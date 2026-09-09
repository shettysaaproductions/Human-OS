import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Line, Circle, Text as SvgText, Defs, RadialGradient, Stop, Rect } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
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
  avgOpacity: number;
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

const DOMAIN_COLORS: Record<string, { color: string; emoji: string; name: string }> = {
  family:    { color: '#EC4899', emoji: '👨‍👩‍👧', name: 'Family & Relationships' },
  work:      { color: '#3B82F6', emoji: '👔', name: 'Career & Professional' },
  goals:     { color: '#10B981', emoji: '🎯', name: 'Goals & Ambitions' },
  lifestyle: { color: '#F59E0B', emoji: '🧘', name: 'Lifestyle & Rhythm' },
  identity:  { color: '#8B5CF6', emoji: '📌', name: 'Core Identity' },
};

// 3D Orbital Coordinates for 5 Department Hubs (Equatorial & Inclined Orbit)
const DEPT_3D_POSITIONS: Record<string, { x: number; y: number; z: number }> = {
  identity:  { x: 0,    y: -15,  z: 140 }, // front center
  family:    { x: 125,  y: -55,  z: 45  }, // top right front
  work:      { x: -125, y: -55,  z: -45 }, // top left back
  goals:     { x: 75,   y: 110,  z: -55 }, // bottom right back
  lifestyle: { x: -85,  y: 95,   z: 65  }, // bottom left front
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
    // 1. Central Core Node
    if (n.isHub) {
      return { ...n, x3d: 0, y3d: 0, z3d: 0 };
    }

    // 2. Department Hubs
    if (n.isDepartment) {
      const p = DEPT_3D_POSITIONS[n.department] || { x: 0, y: 0, z: 120 };
      return { ...n, x3d: p.x, y3d: p.y, z3d: p.z };
    }

    // 3. Memory Dots orbiting their Department Hub
    const d = n.department || 'identity';
    const hubPos = DEPT_3D_POSITIONS[d] || { x: 0, y: 0, z: 120 };
    const members = deptMembers[d] || [];
    const index = members.findIndex(m => m.id === n.id);
    const count = Math.max(1, members.length);

    // Spherical orbit around hub at radius 65
    const angle = (index / count) * 2 * Math.PI;
    const elevation = Math.sin(index * 2.1) * 0.55;
    const r = 68;

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

// Client-side fallback synthesizer if /analytics/kg has latency
function synthesizeGraph(memories: any[], workingContext: any[], preferredName: string = 'Saa') {
  const rawNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // 1. Central Core Node
  const coreNode: GraphNode = {
    id: 'user-core',
    name: preferredName || 'You',
    entity_type: 'self',
    department: 'identity',
    color: '#8B5CF6',
    radius: 26,
    value: `Central Self: ${preferredName}`,
    isHub: true,
    emoji: '🧠'
  };
  rawNodes.push(coreNode);
  nodeIds.add(coreNode.id);

  // 2. Department Hubs
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
      radius: 21,
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

  // 3. Memory Nodes
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
      radius: 14,
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

  // 4. Working Context Nodes
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
      radius: 13,
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

  // 5. Cross-Domain Neural Edges (Visible Connecting Dots!)
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
  const [lineFilter, setLineFilter] = useState<'all' | 'cross' | 'connected'>('all');

  // 3D Camera State: Angles, Zoom, Auto-rotation
  const [rotX, setRotX] = useState(0.28); // pitch (~16 deg)
  const [rotY, setRotY] = useState(0.45); // yaw (~25 deg)
  const [zoom, setZoom] = useState(1.0);
  const [autoRotate, setAutoRotate] = useState(true);

  const rotXRef = useRef(0.28);
  const rotYRef = useRef(0.45);
  const zoomRef = useRef(1.0);
  const dragStartRotX = useRef(0.28);
  const dragStartRotY = useRef(0.45);
  const dragStartZoom = useRef(1.0);
  const animFrameRef = useRef<number | null>(null);

  // 2D Pan and Zoom Shared Values (for fallback 2D mode)
  const scale2D = useSharedValue(1);
  const savedScale2D = useSharedValue(1);
  const translateX2D = useSharedValue(0);
  const translateY2D = useSharedValue(0);
  const savedTranslateX2D = useSharedValue(0);
  const savedTranslateY2D = useSharedValue(0);

  const simulationRef = useRef<any>(null);

  useEffect(() => {
    fetchGraph();
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  // 3D Auto-Rotation loop (pauses smoothly during touch/drag)
  useEffect(() => {
    if (viewMode !== '3d' || !autoRotate) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    let lastTime = Date.now();
    const loop = () => {
      const now = Date.now();
      const dt = Math.min(0.08, (now - lastTime) / 1000);
      lastTime = now;

      // Rotate ~14 degrees per second around Y axis
      rotYRef.current = (rotYRef.current + dt * 0.25) % (2 * Math.PI);
      setRotY(rotYRef.current);
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [viewMode, autoRotate]);

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

      // Assign 3D and 2D initial coordinates
      const nodesWith3D = assign3DCoordinates(apiNodes);

      const centerX = SCREEN_WIDTH / 2;
      const centerY = GRAPH_HEIGHT / 2;

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
          const dist = 140 + Math.random() * 80;
          initX = centerX + Math.cos(angle) * dist;
          initY = centerY + Math.sin(angle) * dist;
        }

        return {
          ...n,
          x: initX,
          y: initY,
        };
      });

      const nodeMap = new Map(d3Nodes.map(n => [n.id, n]));

      const d3Edges: GraphEdge[] = (apiEdges || [])
        .map((e: any) => ({
          ...e,
          source: typeof e.source === 'string' ? e.source : e.source?.id,
          target: typeof e.target === 'string' ? e.target : e.target?.id,
        }))
        .filter((e: any) => nodeMap.has(e.source) && nodeMap.has(e.target));

      setDepartments(apiDepts || []);
      setNodes(d3Nodes);
      setEdges(d3Edges);

      // Run 2D force simulation in background for 2D mode
      if (simulationRef.current) simulationRef.current.stop();

      const simulation = d3.forceSimulation<GraphNode>(d3Nodes)
        .force('link', d3.forceLink<GraphNode, GraphEdge>(d3Edges)
          .id(d => d.id)
          .distance(d => {
            if ((d as any).isCrossDomain) return 110;
            if ((d as any).target?.isDepartment || (d as any).source?.isHub) return 85;
            return 55;
          })
          .strength(d => (d as any).isCrossDomain ? 0.2 : 0.6)
        )
        .force('charge', d3.forceManyBody<GraphNode>().strength(d => {
          if (d.isHub) return -450;
          if (d.isDepartment) return -250;
          return -120;
        }))
        .force('center', d3.forceCenter(centerX, centerY))
        .force('collide', d3.forceCollide<GraphNode>().radius(d => d.radius + 14))
        .alphaDecay(0.05);

      simulationRef.current = simulation;

      simulation.on('tick', () => {
        setNodes([...d3Nodes]);
      });

    } catch (err) {
      console.error('Failed to load knowledge graph', err);
    } finally {
      setLoading(false);
    }
  };

  // 3D Gesture: Drag to Rotate (Yaw & Pitch)
  const pan3DGesture = useMemo(() => {
    return Gesture.Pan()
      .runOnJS(true)
      .onBegin(() => {
        setAutoRotate(false);
        dragStartRotX.current = rotXRef.current;
        dragStartRotY.current = rotYRef.current;
      })
      .onUpdate((e) => {
        const nextY = dragStartRotY.current + (e.translationX * 0.009);
        const nextX = Math.max(-1.45, Math.min(1.45, dragStartRotX.current - (e.translationY * 0.009)));
        rotXRef.current = nextX;
        rotYRef.current = nextY;
        setRotX(nextX);
        setRotY(nextY);
      });
  }, []);

  // 3D Gesture: Pinch to Zoom
  const pinch3DGesture = useMemo(() => {
    return Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        setAutoRotate(false);
        dragStartZoom.current = zoomRef.current;
      })
      .onUpdate((e) => {
        const nextZoom = Math.max(0.45, Math.min(2.8, dragStartZoom.current * e.scale));
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
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
    rotXRef.current = 0.28;
    rotYRef.current = 0.45;
    zoomRef.current = 1.0;
    setRotX(0.28);
    setRotY(0.45);
    setZoom(1.0);
    setAutoRotate(true);
  }, []);

  const handleTopView = useCallback(() => {
    rotXRef.current = 1.4; // look down from above
    rotYRef.current = 0;
    setRotX(1.4);
    setRotY(0);
    setAutoRotate(false);
  }, []);

  const handleFrontView = useCallback(() => {
    rotXRef.current = 0;
    rotYRef.current = 0;
    setRotX(0);
    setRotY(0);
    setAutoRotate(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    setAutoRotate(false);
    const next = Math.min(zoomRef.current + 0.3, 2.8);
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const handleZoomOut = useCallback(() => {
    setAutoRotate(false);
    const next = Math.max(zoomRef.current - 0.3, 0.45);
    zoomRef.current = next;
    setZoom(next);
  }, []);

  const handleNodePress = (node: GraphNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
      setAutoRotate(false);
    }
  };

  // Connected edges for the selected node
  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      return sId === selectedNode.id || tId === selectedNode.id;
    });
  }, [selectedNode, edges]);

  // Set of connected node IDs for instant highlighting
  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set<string>();
    const set = new Set<string>([selectedNode.id]);
    for (const e of selectedNodeEdges) {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      set.add(sId);
      set.add(tId);
    }
    return set;
  }, [selectedNode, selectedNodeEdges]);

  // ----------------------------------------------------
  // 3D MATHEMATICAL PROJECTION ENGINE
  // Projects (x3d, y3d, z3d) -> 2D screen coordinates with depth cueing
  // ----------------------------------------------------
  const centerX = SCREEN_WIDTH / 2;
  const centerY = GRAPH_HEIGHT / 2;

  const { projectedNodes, projectedEdges } = useMemo(() => {
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);

    const cameraDist = 520;
    const focalLen = 520;

    const nodeMap = new Map<string, ProjectedNode>();

    // 1. Project all nodes
    const pNodes: ProjectedNode[] = nodes.map(n => {
      const x = n.x3d || 0;
      const y = n.y3d || 0;
      const z = n.z3d || 0;

      // Yaw rotation (around Y axis)
      const x1 = x * cosY - z * sinY;
      const y1 = y;
      const z1 = x * sinY + z * cosY;

      // Pitch rotation (around X axis)
      const x2 = x1;
      const y2 = y1 * cosX - z1 * sinX;
      const z2 = y1 * sinX + z1 * cosX;

      // Perspective Projection
      const effectiveZ = z2 * zoom;
      const distFromCam = cameraDist + focalLen - effectiveZ;
      const perspective = focalLen / Math.max(90, distFromCam);

      const screenX = centerX + x2 * zoom * perspective * 1.5;
      const screenY = centerY + y2 * zoom * perspective * 1.5;

      const depthScale = Math.max(0.45, Math.min(1.5, perspective * 2.0));
      const normalizedZ = (z2 + 220) / 440;
      const depthOpacity = Math.max(0.3, Math.min(1.0, 0.3 + normalizedZ * 0.7));

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

      nodeMap.set(n.id, pNode);
      return pNode;
    });

    // 2. Project all edges
    const pEdges: ProjectedEdge[] = edges.map(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;

      const pS = nodeMap.get(sId);
      const pT = nodeMap.get(tId);

      if (!pS || !pT) return null;

      const avgZ = (pS.z + pT.z) / 2;
      const avgOpacity = (pS.depthOpacity + pT.depthOpacity) / 2;
      const midX = (pS.screenX + pT.screenX) / 2;
      const midY = (pS.screenY + pT.screenY) / 2;

      const isConnectedToSelected = selectedNode && (sId === selectedNode.id || tId === selectedNode.id);
      const isCross = !!e.isCrossDomain;

      // Visibility filter
      let visible = true;
      if (selectedDept) {
        visible = pS.node.department === selectedDept || pT.node.department === selectedDept;
      }
      if (lineFilter === 'cross' && !isCross) {
        visible = false;
      }

      // Visual styling for exact connecting lines
      let strokeColor = e.color || 'rgba(255,255,255,0.2)';
      let strokeWidth = 1.2;
      let strokeOpacity = avgOpacity * 0.8;

      if (selectedNode) {
        if (isConnectedToSelected) {
          strokeColor = isCross ? '#38BDF8' : '#FFFFFF';
          strokeWidth = 3.2;
          strokeOpacity = 1.0;
        } else {
          // Dim non-connected lines down so the exact connected dots pop out!
          strokeOpacity = 0.05;
          strokeWidth = 0.8;
        }
      } else {
        if (isCross) {
          strokeColor = e.color || '#C084FC';
          strokeWidth = 2.0;
          strokeOpacity = Math.max(0.75, avgOpacity);
        }
      }

      return {
        edge: e,
        sourceId: sId,
        targetId: tId,
        x1: pS.screenX,
        y1: pS.screenY,
        x2: pT.screenX,
        y2: pT.screenY,
        midX,
        midY,
        avgZ,
        avgOpacity,
        strokeColor,
        strokeWidth,
        strokeOpacity,
        isHighlighted: !!isConnectedToSelected,
        visible
      };
    }).filter(Boolean) as ProjectedEdge[];

    // 3. Z-Index Depth Sorting (Farthest to Closest)
    pNodes.sort((a, b) => a.z - b.z);
    pEdges.sort((a, b) => a.avgZ - b.avgZ);

    return { projectedNodes: pNodes, projectedEdges: pEdges };
  }, [nodes, edges, rotX, rotY, zoom, selectedDept, selectedNode, connectedNodeIds, lineFilter, centerX, centerY]);

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
                <Text style={styles.live3DBadgeText}>3D MAP</Text>
              </View>
            </View>
            <Text style={styles.headerSubtitle}>
              {nodes.length} nodes · {edges.length} connecting lines across 5 departments
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
              All Lines ({edges.length})
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
                ✕ Clear Focus
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
                  <Defs>
                    <RadialGradient id="glow-core" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.8" />
                      <Stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                    </RadialGradient>
                    <RadialGradient id="glow-cyan" cx="50%" cy="50%" r="50%">
                      <Stop offset="0%" stopColor="#06B6D4" stopOpacity="0.8" />
                      <Stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
                    </RadialGradient>
                  </Defs>

                  {/* 1. Draw 3D Connecting Lines (Depth Sorted) */}
                  <G>
                    {projectedEdges.map((pe) => {
                      if (!pe.visible) return null;

                      const isCross = pe.edge.isCrossDomain;
                      const dashArray = isCross ? '4, 4' : undefined;

                      return (
                        <G key={`edge-${pe.edge.id}`}>
                          {/* Glow line backing for highlighted connections */}
                          {pe.isHighlighted && (
                            <Line
                              x1={pe.x1}
                              y1={pe.y1}
                              x2={pe.x2}
                              y2={pe.y2}
                              stroke="#38BDF8"
                              strokeWidth={7}
                              opacity={0.35}
                            />
                          )}

                          {/* Core Connector Line */}
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

                          {/* Relation badge on highlighted cross-domain lines */}
                          {pe.isHighlighted && pe.edge.relation && (
                            <G>
                              <Rect
                                x={pe.midX - 44}
                                y={pe.midY - 9}
                                width={88}
                                height={18}
                                rx={9}
                                fill="rgba(15,23,42,0.9)"
                                stroke="#38BDF8"
                                strokeWidth={1}
                              />
                              <SvgText
                                x={pe.midX}
                                y={pe.midY + 3.5}
                                fontSize={8.5}
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

                  {/* 2. Draw 3D Nodes (Depth Sorted: back to front) */}
                  <G>
                    {projectedNodes.map((pn) => {
                      if (!pn.visible) return null;

                      const n = pn.node;
                      const rad = n.radius * pn.depthScale;
                      const isSelected = pn.isSelected;
                      const isConnected = pn.isConnectedToSelected;

                      // Dim nodes that are not connected when a node is selected
                      const nodeOpacity = selectedNode
                        ? (isSelected || isConnected ? 1.0 : 0.2)
                        : pn.depthOpacity;

                      return (
                        <G
                          key={`node-${n.id}`}
                          onPress={() => handleNodePress(n)}
                          opacity={nodeOpacity}
                        >
                          {/* Outer Glow Halo for Hubs, Selection, or Connected partner */}
                          {(n.isHub || n.isDepartment || isSelected || isConnected) && (
                            <Circle
                              cx={pn.screenX}
                              cy={pn.screenY}
                              r={rad + (isSelected ? 9 : 6)}
                              fill={isSelected ? '#38BDF8' : n.color}
                              opacity={isSelected ? 0.45 : 0.18}
                            />
                          )}

                          {/* Core Node Circle */}
                          <Circle
                            cx={pn.screenX}
                            cy={pn.screenY}
                            r={rad}
                            fill={n.color}
                            stroke={isSelected ? '#FFFFFF' : isConnected ? '#38BDF8' : n.isDepartment ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)'}
                            strokeWidth={isSelected ? 3 : isConnected ? 2 : n.isDepartment ? 2 : 1}
                          />

                          {/* Emoji Icon inside Hub */}
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

                          {/* Node Label Text */}
                          <SvgText
                            x={pn.screenX}
                            y={pn.screenY + rad + 12}
                            fontSize={Math.max(8.5, (n.isHub ? 12 : n.isDepartment ? 10.5 : 9) * pn.depthScale)}
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
                  {/* 2D Edges */}
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

                  {/* 2D Nodes */}
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
                    const otherNode = (typeof e.source === 'object' && e.source.id !== selectedNode.id)
                      ? e.source
                      : (typeof e.target === 'object' && e.target.id !== selectedNode.id)
                        ? e.target
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
