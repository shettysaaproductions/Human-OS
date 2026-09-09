import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Line, Circle, Text as SvgText, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as d3 from 'd3-force';
import { api } from '../../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRAPH_HEIGHT = SCREEN_HEIGHT - 170;

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
  if (k === 'work_schedule') return '11am - 8pm (Work Hours)';
  if (k === 'office_hours') return `${v} (Hours)`;
  if (k === 'current_office_location') return `${v} (Office)`;
  if (k === 'candidates_for_job') return `${v} (Hiring)`;
  if (k === 'hope_for_job_selection') return 'Target: 2 Selections';
  if (k === 'goals') return v.length > 22 ? v.slice(0, 20) + '... (Goal)' : `${v} (Goal)`;
  if (k === 'passions') return 'Passions & Leadership';
  if (k === 'preferred_name') {
    const cleanName = v.replace(/^Prefers to be called\s+/i, '').replace(/\.$/, '');
    return `${cleanName} (Name)`;
  }
  const cleanKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return v.length > 16 ? `${v.slice(0, 14)}...` : (v || cleanKey);
}

// Client-side fallback synthesizer if /analytics/kg is not yet populated
function synthesizeGraph(memories: any[], workingContext: any[], preferredName: string = 'Saa') {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  // 1. Central Core Node
  const coreNode: GraphNode = {
    id: 'user-core',
    name: preferredName || 'You',
    entity_type: 'self',
    department: 'identity',
    color: '#8B5CF6',
    radius: 28,
    value: `Central Self: ${preferredName}`,
    isHub: true,
    emoji: '🧠'
  };
  nodes.push(coreNode);
  nodeIds.add(coreNode.id);

  // 2. Department Hubs
  const deptCounts: Record<string, number> = { family: 0, work: 0, goals: 0, lifestyle: 0, identity: 0 };
  const DEPT_KEYS = ['family', 'work', 'goals', 'lifestyle', 'identity'];

  for (const d of DEPT_KEYS) {
    const meta = DOMAIN_COLORS[d];
    const deptNodeId = `dept-${d}`;
    nodes.push({
      id: deptNodeId,
      name: meta.name,
      entity_type: 'department',
      department: d,
      color: meta.color,
      radius: 22,
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
      color: 'rgba(255,255,255,0.25)',
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

    nodes.push({
      id: nodeId,
      name: toGraphLabel(mem.key, mem.value),
      entity_type: mem.memory_type || 'memory',
      department: d,
      color: meta.color,
      radius: 15,
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

    nodes.push({
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

  // 5. Cross-Domain Neural Edges
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
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [departments, setDepartments] = useState<DepartmentMeta[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [displayScale, setDisplayScale] = useState(100);

  const simulationRef = useRef<any>(null);

  // Zoom and Pan transform shared values
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    fetchGraph();
    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current = null;
      }
    };
  }, []);

  const fetchGraph = async () => {
    try {
      setLoading(true);
      let apiNodes: any[] = [];
      let apiEdges: any[] = [];
      let apiDepts: any[] = [];

      // Try /analytics/kg first
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

      // If /analytics/kg was empty, synthesize directly from /analytics/memories
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

      setDepartments(apiDepts || []);

      const centerX = SCREEN_WIDTH / 2;
      const centerY = GRAPH_HEIGHT / 2;

      // Position nodes in radial clusters around the screen center
      const d3Nodes: GraphNode[] = (apiNodes || []).map((n: any, idx: number) => {
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

      // D3 Force Simulation centered exactly in the phone screen
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
        setEdges([...d3Edges]);
      });

      simulation.on('end', () => {
        setNodes([...d3Nodes]);
        setEdges([...d3Edges]);
      });

    } catch (err) {
      console.error('Failed to load knowledge graph', err);
    } finally {
      setLoading(false);
    }
  };

  // Pinch to Zoom Gesture
  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      const newScale = Math.max(0.35, Math.min(savedScale.value * e.scale, 3.2));
      scale.value = newScale;
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
    });

  // Pan to Move Canvas
  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      'worklet';
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedCanvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ]
  }));

  // Quick Zoom Controls
  const handleZoomIn = useCallback(() => {
    const nextScale = Math.min(savedScale.value + 0.35, 3.2);
    scale.value = withSpring(nextScale);
    savedScale.value = nextScale;
    setDisplayScale(Math.round(nextScale * 100));
  }, []);

  const handleZoomOut = useCallback(() => {
    const nextScale = Math.max(savedScale.value - 0.35, 0.35);
    scale.value = withSpring(nextScale);
    savedScale.value = nextScale;
    setDisplayScale(Math.round(nextScale * 100));
  }, []);

  const handleReset = useCallback(() => {
    scale.value = withSpring(1);
    savedScale.value = 1;
    translateX.value = withSpring(0);
    translateY.value = withSpring(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    setDisplayScale(100);
  }, []);

  const handleNodePress = (node: GraphNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
    }
  };

  const isNodeVisible = (node: GraphNode) => {
    if (!selectedDept) return true;
    if (node.isHub) return true;
    return node.department === selectedDept;
  };

  const isEdgeVisible = (edge: GraphEdge) => {
    if (!selectedDept) return true;
    const sourceNode = typeof edge.source === 'object' ? edge.source : nodes.find(n => n.id === edge.source);
    const targetNode = typeof edge.target === 'object' ? edge.target : nodes.find(n => n.id === edge.target);
    return sourceNode?.department === selectedDept || targetNode?.department === selectedDept;
  };

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNode) return [];
    return edges.filter(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      return sId === selectedNode.id || tId === selectedNode.id;
    });
  }, [selectedNode, edges]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#06B6D4" />
        <Text style={styles.loadingText}>Building Knowledge Galaxy...</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>

        {/* Top Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Knowledge Graph</Text>
            <Text style={styles.headerSubtitle}>
              {nodes.length} nodes · {edges.length} connections across 5 departments
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={fetchGraph}>
            <Text style={styles.refreshBtnText}>↻ Refresh</Text>
          </TouchableOpacity>
        </View>

        {/* Department Filter Chips */}
        <View style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            <TouchableOpacity
              style={[styles.filterChip, !selectedDept && styles.filterChipActive]}
              onPress={() => setSelectedDept(null)}
            >
              <Text style={[styles.filterChipText, !selectedDept && styles.filterChipTextActive]}>
                All ({nodes.length})
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

        {/* Zoom & Pan Knowledge Graph Canvas */}
        <View style={styles.canvasWrapper}>
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.animatedContainer, animatedCanvasStyle]}>
              <Svg width={SCREEN_WIDTH} height={GRAPH_HEIGHT} style={styles.svg}>
                <Defs>
                  <RadialGradient id="glow-purple" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.6" />
                    <Stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                  </RadialGradient>
                </Defs>

                {/* Draw Connector Edges */}
                <G>
                  {edges.map((e, i) => {
                    const source = (typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source)) as GraphNode;
                    const target = (typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target)) as GraphNode;

                    if (!source?.x || !target?.x) return null;

                    const visible = isEdgeVisible(e);
                    const isSelectedEdge = selectedNode && (source.id === selectedNode.id || target.id === selectedNode.id);

                    const strokeColor = isSelectedEdge
                      ? '#FFFFFF'
                      : e.isCrossDomain
                        ? e.color || '#C084FC'
                        : visible
                          ? e.color || 'rgba(255,255,255,0.2)'
                          : 'rgba(255,255,255,0.04)';

                    const strokeWidth = isSelectedEdge ? 2.5 : e.isCrossDomain ? 1.8 : 1.2;
                    const strokeDasharray = e.isCrossDomain ? '4, 4' : undefined;

                    return (
                      <Line
                        key={`edge-${e.id || i}`}
                        x1={source.x}
                        y1={source.y}
                        x2={target.x}
                        y2={target.y}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        opacity={visible ? 0.85 : 0.1}
                      />
                    );
                  })}
                </G>

                {/* Draw Graph Nodes */}
                <G>
                  {nodes.map((n) => {
                    if (n.x === undefined || n.y === undefined) return null;

                    const visible = isNodeVisible(n);
                    const isSelected = selectedNode?.id === n.id;
                    const opacity = visible ? 1 : 0.15;

                    return (
                      <G
                        key={`node-${n.id}`}
                        onPress={() => handleNodePress(n)}
                        opacity={opacity}
                      >
                        {/* Glow Halo for Hubs and Selection */}
                        {(n.isHub || n.isDepartment || isSelected) && (
                          <Circle
                            cx={n.x}
                            cy={n.y}
                            r={n.radius + (isSelected ? 9 : 6)}
                            fill={n.color}
                            opacity={isSelected ? 0.4 : 0.18}
                          />
                        )}

                        {/* Node Circle */}
                        <Circle
                          cx={n.x}
                          cy={n.y}
                          r={n.radius}
                          fill={n.color}
                          stroke={isSelected ? '#FFFFFF' : n.isDepartment ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)'}
                          strokeWidth={isSelected ? 3 : n.isDepartment ? 2 : 1}
                        />

                        {/* Emoji icon inside hub */}
                        {n.emoji && (
                          <SvgText
                            x={n.x}
                            y={n.y + 5}
                            fontSize={n.radius * 0.9}
                            textAnchor="middle"
                          >
                            {n.emoji}
                          </SvgText>
                        )}

                        {/* Node Label Text */}
                        <SvgText
                          x={n.x}
                          y={n.y + n.radius + 13}
                          fontSize={n.isHub ? 12 : n.isDepartment ? 11 : 9.5}
                          fontWeight={n.isHub || n.isDepartment || isSelected ? 'bold' : '500'}
                          fill={isSelected ? '#FFFFFF' : n.isDepartment ? n.color : '#D4D4D8'}
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

          {/* Floating Zoom & Pan HUD Controls */}
          <View style={styles.hudControls}>
            <TouchableOpacity style={styles.hudBtn} onPress={handleZoomIn} activeOpacity={0.7}>
              <Text style={styles.hudBtnText}>＋</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.hudBtn} onPress={handleZoomOut} activeOpacity={0.7}>
              <Text style={styles.hudBtnText}>－</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.hudBtn} onPress={handleReset} activeOpacity={0.7}>
              <Text style={[styles.hudBtnText, { fontSize: 13 }]}>⟲</Text>
            </TouchableOpacity>

            <View style={styles.hudScaleBadge}>
              <Text style={styles.hudScaleText}>{displayScale}%</Text>
            </View>
          </View>
        </View>

        {/* Selected Node Details Card */}
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

            {selectedNodeEdges.length > 0 && (
              <View style={styles.linksRow}>
                <Text style={styles.linksTitle}>Connected Links ({selectedNodeEdges.length}):</Text>
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
                        <Text style={[styles.linkChipText, { color: otherNode.color }]}>
                          {e.relation.replace(/_/g, ' ')} → {otherNode.name}
                        </Text>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
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
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#FFFFFF' },
  headerSubtitle: { fontSize: 12, color: '#71717A', marginTop: 2 },
  refreshBtn: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6
  },
  refreshBtnText: { color: '#A1A1AA', fontSize: 12, fontWeight: '600' },

  filterBar: { marginBottom: 4 },
  filterScroll: { paddingHorizontal: 16, paddingVertical: 4 },
  filterChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.03)'
  },
  filterChipActive: { borderColor: '#06B6D4', backgroundColor: 'rgba(6,182,212,0.15)' },
  filterChipText: { color: '#A1A1AA', fontSize: 12, fontWeight: '500' },
  filterChipTextActive: { color: '#06B6D4', fontWeight: 'bold' },

  canvasWrapper: { flex: 1, overflow: 'hidden', backgroundColor: '#09090B' },
  animatedContainer: { width: SCREEN_WIDTH, height: GRAPH_HEIGHT },
  svg: { width: SCREEN_WIDTH, height: GRAPH_HEIGHT },

  // Floating HUD Zoom Controls
  hudControls: {
    position: 'absolute', right: 16, bottom: 24,
    backgroundColor: 'rgba(24,24,27,0.85)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    padding: 6, alignItems: 'center', gap: 6
  },
  hudBtn: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center'
  },
  hudBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  hudScaleBadge: {
    paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, marginTop: 2
  },
  hudScaleText: { color: '#71717A', fontSize: 10, fontWeight: '600' },

  // Detail Sheet Card
  detailCard: {
    position: 'absolute', bottom: 12, left: 16, right: 16,
    backgroundColor: 'rgba(24,24,27,0.95)', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5, shadowRadius: 16, elevation: 10
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  detailTitleRow: { flex: 1, marginRight: 8 },
  deptBadge: {
    alignSelf: 'flex-start', borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4
  },
  deptBadgeText: { fontSize: 10, fontWeight: '700' },
  detailName: { fontSize: 16, fontWeight: 'bold', color: '#FFFFFF' },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#71717A', fontSize: 16, fontWeight: 'bold' },
  detailValue: { fontSize: 13, color: '#D4D4D8', lineHeight: 18, marginBottom: 10 },

  linksRow: { marginTop: 4 },
  linksTitle: { fontSize: 11, fontWeight: '600', color: '#A1A1AA', marginBottom: 6 },
  linksScroll: { flexDirection: 'row' },
  linkChip: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    marginRight: 6, backgroundColor: 'rgba(255,255,255,0.04)'
  },
  linkChipText: { fontSize: 11, fontWeight: '500' }
});
