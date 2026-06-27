import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Canvas, Circle, Line, Group, Text as SkiaText, useFont, matchFont } from '@shopify/react-native-skia';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';
import * as d3 from 'd3-force';
import { api } from '../../services/api';

const { width, height } = Dimensions.get('window');

type GraphNode = d3.SimulationNodeDatum & { id: string, name: string, entity_type: string };
type GraphEdge = d3.SimulationLinkDatum<GraphNode> & { source_node_id: string, target_node_id: string };

const ENTITY_COLORS: Record<string, string> = {
  person: '#EC4899',
  place: '#06B6D4',
  concept: '#8B5CF6',
  goal: '#10B981',
  default: '#888'
};

export function KgExplorerScreen() {
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<any[]>([]);

  // We use standard React state to hold the D3 tick updates because Skia Canvas
  // can natively react to state changes fast enough for <100 nodes.
  const [tick, setTick] = useState(0);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const fontStyle = { fontFamily: 'System', fontSize: 12, fontWeight: 'bold' };
  const font = matchFont(fontStyle as any);

  useEffect(() => {
    fetchGraph();
  }, []);

  const fetchGraph = async () => {
    try {
      setLoading(true);
      const res = await api.get('/analytics/kg');
      const { nodes: apiNodes, edges: apiEdges } = res.data.data;
      
      const d3Nodes: GraphNode[] = apiNodes.map((n: any) => ({ ...n, x: width/2 + (Math.random() - 0.5) * 100, y: height/2 + (Math.random() - 0.5) * 100 }));
      const d3Edges: GraphEdge[] = apiEdges.map((e: any) => ({
        source: e.source_node_id,
        target: e.target_node_id,
        ...e
      })).filter((e: any) => d3Nodes.some(n => n.id === e.source) && d3Nodes.some(n => n.id === e.target));

      const simulation = d3.forceSimulation<GraphNode>(d3Nodes)
        .force('link', d3.forceLink<GraphNode, GraphEdge>(d3Edges).id(d => d.id).distance(80))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(width / 2, height / 3))
        .force('collide', d3.forceCollide().radius(30));

      simulation.on('tick', () => {
        setNodes([...d3Nodes]);
        setEdges([...d3Edges]);
        setTick(t => t + 1);
      });

    } catch (err) {
      console.error('Failed to fetch kg', err);
    } finally {
      setLoading(false);
    }
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => { scale.value = savedScale.value * e.scale; })
    .onEnd(() => { savedScale.value = scale.value; });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composed = Gesture.Simultaneous(pinchGesture, panGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value }
    ],
  }));

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#06B6D4" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Knowledge Graph</Text>
        </View>

        <GestureDetector gesture={composed}>
          <Animated.View style={[styles.canvasContainer, animatedStyle]}>
            <Canvas style={styles.canvas}>
              <Group>
                {/* Draw Edges */}
                {edges.map((e, i) => {
                  const source = e.source as GraphNode;
                  const target = e.target as GraphNode;
                  if (!source.x || !target.x) return null;
                  return (
                    <Line
                      key={`edge-${i}`}
                      p1={{ x: source.x, y: source.y! }}
                      p2={{ x: target.x, y: target.y! }}
                      color="rgba(255,255,255,0.2)"
                      strokeWidth={1}
                    />
                  );
                })}

                {/* Draw Nodes */}
                {nodes.map((n) => {
                  if (!n.x || !n.y) return null;
                  const color = ENTITY_COLORS[n.entity_type] || ENTITY_COLORS.default;
                  return (
                    <Group key={`node-${n.id}`}>
                      <Circle cx={n.x} cy={n.y} r={15} color={color} opacity={0.9} />
                      {font && (
                        <SkiaText
                          x={n.x - (font.getTextWidth(n.name) / 2)}
                          y={n.y + 30}
                          text={n.name}
                          font={font}
                          color="#ddd"
                        />
                      )}
                    </Group>
                  );
                })}
              </Group>
            </Canvas>
          </Animated.View>
        </GestureDetector>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  header: { padding: 16, zIndex: 10 },
  headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  canvasContainer: { flex: 1 },
  canvas: { flex: 1 }
});
