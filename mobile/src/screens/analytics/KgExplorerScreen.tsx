import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, ActivityIndicator,
  TouchableOpacity, ScrollView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { G, Line, Circle, Text as SvgText, Defs, RadialGradient, Stop } from 'react-native-svg';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as d3 from 'd3-force';
import { api } from '../../services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const CANVAS_SIZE = Math.max(SCREEN_WIDTH, SCREEN_HEIGHT) * 1.5;

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
      const res = await api.get('/analytics/kg');
      const { nodes: apiNodes, edges: apiEdges, departments: apiDepts } = res.data.data;

      setDepartments(apiDepts || []);

      const centerX = CANVAS_SIZE / 2;
      const centerY = CANVAS_SIZE / 2;

      // Position nodes with initial radial layout around center
      const d3Nodes: GraphNode[] = (apiNodes || []).map((n: any, idx: number) => {
        let initialX = centerX;
        let initialY = centerY;

        if (n.isHub) {
          initialX = centerX;
          initialY = centerY;
        } else if (n.isDepartment) {
          const angle = (idx * 2 * Math.PI) / 5;
          initialX = centerX + Math.cos(angle) * 140;
          initialY = centerY + Math.sin(angle) * 140;
        } else {
          const angle = Math.random() * 2 * Math.PI;
          const dist = 180 + Math.random() * 100;
          initialX = centerX + Math.cos(angle) * dist;
          initialY = centerY + Math.sin(angle) * dist;
        }

        return {
          ...n,
          x: initialX,
          y: initialY,
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

      // D3 Force Simulation
      if (simulationRef.current) simulationRef.current.stop();

      const simulation = d3.forceSimulation<GraphNode>(d3Nodes)
        .force('link', d3.forceLink<GraphNode, GraphEdge>(d3Edges)
          .id(d => d.id)
          .distance(d => {
            if ((d as any).isCrossDomain) return 130;
            if ((d as any).target?.isDepartment || (d as any).source?.isHub) return 100;
            return 70;
          })
          .strength(d => (d as any).isCrossDomain ? 0.2 : 0.7)
        )
        .force('charge', d3.forceManyBody<GraphNode>().strength(d => {
          if (d.isHub) return -600;
          if (d.isDepartment) return -350;
          return -180;
        }))
        .force('center', d3.forceCenter(centerX, centerY))
        .force('collide', d3.forceCollide<GraphNode>().radius(d => d.radius + 16))
        .alphaDecay(0.04);

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
      console.error('Failed to fetch knowledge graph', err);
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
        <Text style={styles.loadingText}>Synthesizing Knowledge Graph...</Text>
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
              <Svg width={CANVAS_SIZE} height={CANVAS_SIZE} style={styles.svg}>
                <Defs>
                  <RadialGradient id="glow-purple" cx="50%" cy="50%" r="50%">
                    <Stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.5" />
                    <Stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
                  </RadialGradient>
                </Defs>

                {/* Draw Edges */}
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

                {/* Draw Nodes */}
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
                        {/* Glow halo for hubs */}
                        {(n.isHub || n.isDepartment || isSelected) && (
                          <Circle
                            cx={n.x}
                            cy={n.y}
                            r={n.radius + (isSelected ? 10 : 8)}
                            fill={n.color}
                            opacity={isSelected ? 0.35 : 0.15}
                          />
                        )}

                        {/* Core Node Circle */}
                        <Circle
                          cx={n.x}
                          cy={n.y}
                          r={n.radius}
                          fill={n.color}
                          stroke={isSelected ? '#FFFFFF' : n.isDepartment ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)'}
                          strokeWidth={isSelected ? 3 : n.isDepartment ? 2 : 1}
                        />

                        {/* Emoji inside hub */}
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
                          y={n.y + n.radius + 14}
                          fontSize={n.isHub ? 13 : n.isDepartment ? 12 : 10}
                          fontWeight={n.isHub || n.isDepartment || isSelected ? 'bold' : 'normal'}
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

        {/* Selected Node Details Glass Card */}
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
  animatedContainer: { width: CANVAS_SIZE, height: CANVAS_SIZE },
  svg: { width: CANVAS_SIZE, height: CANVAS_SIZE },

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
