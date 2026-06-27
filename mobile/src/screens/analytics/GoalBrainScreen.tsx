import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  ScrollView, TouchableOpacity, Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

interface Goal {
  id: string;
  name: string;
  entity_type: string;
  attributes: {
    status?: string;
    progress?: number;
    deadline?: string;
    description?: string;
  };
  created_at: string;
}

function ProgressRing({ progress, color, size = 60 }: { progress: number; color: string; size?: number }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - Math.min(1, Math.max(0, progress / 100)));

  // SVG-like rendering using View (no Skia needed for simple rings)
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[
        gr.ringOuter,
        { width: size, height: size, borderRadius: size / 2, borderColor: `${color}25` }
      ]}>
        <View style={[
          gr.ringInner,
          {
            width: size - 12, height: size - 12, borderRadius: (size - 12) / 2,
            borderColor: color, borderTopColor: `${color}30`,
            borderWidth: 3,
          }
        ]}>
          <Text style={[gr.ringText, { color }]}>{Math.round(progress)}%</Text>
        </View>
      </View>
    </View>
  );
}

export const GoalBrainScreen = React.memo(function GoalBrainScreen() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'active' | 'completed'>('active');

  useEffect(() => { fetchGoals(); }, []);

  const fetchGoals = async () => {
    try {
      setLoading(true);
      const res = await api.get('/analytics/goals');
      setData(res.data.data);
    } catch (err) {
      console.error('Failed to fetch goals', err);
    } finally {
      setLoading(false);
    }
  };

  const allGoals: Goal[] = data?.activeGoals || [];
  const activeGoals = useMemo(() => allGoals.filter(g => g.attributes?.status !== 'completed'), [allGoals]);
  const completedGoals = useMemo(() => allGoals.filter(g => g.attributes?.status === 'completed'), [allGoals]);
  const displayGoals = tab === 'active' ? activeGoals : completedGoals;

  const overallProgress = useMemo(() => {
    if (activeGoals.length === 0) return 0;
    const total = activeGoals.reduce((sum, g) => sum + (g.attributes?.progress || 0), 0);
    return total / activeGoals.length;
  }, [activeGoals]);

  if (loading) {
    return <View style={gr.center}><ActivityIndicator size="large" color="#10B981" /></View>;
  }

  return (
    <SafeAreaView style={gr.container} edges={['top']}>
      <Text style={gr.title}>Goal Constellations</Text>

      {/* Summary Stats */}
      <View style={gr.statsRow}>
        <View style={gr.statCard}>
          <Text style={[gr.statNum, { color: '#10B981' }]}>{activeGoals.length}</Text>
          <Text style={gr.statLabel}>Active</Text>
        </View>
        <View style={gr.statCard}>
          <Text style={[gr.statNum, { color: '#A78BFA' }]}>{completedGoals.length}</Text>
          <Text style={gr.statLabel}>Completed</Text>
        </View>
        <View style={gr.statCard}>
          <ProgressRing progress={overallProgress} color="#10B981" size={52} />
          <Text style={gr.statLabel}>Overall</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={gr.tabRow}>
        <TouchableOpacity style={[gr.tab, tab === 'active' && gr.tabActive]} onPress={() => setTab('active')}>
          <Text style={[gr.tabText, tab === 'active' && gr.tabTextActive]}>Active ({activeGoals.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[gr.tab, tab === 'completed' && gr.tabActive]} onPress={() => setTab('completed')}>
          <Text style={[gr.tabText, tab === 'completed' && gr.tabTextActive]}>Completed ({completedGoals.length})</Text>
        </TouchableOpacity>
      </View>

      {/* Goal List */}
      <FlatList
        data={displayGoals}
        keyExtractor={(item) => item.id}
        removeClippedSubviews
        renderItem={({ item }) => {
          const progress = item.attributes?.progress || 0;
          const deadline = item.attributes?.deadline;
          const isCompleted = item.attributes?.status === 'completed';
          const color = isCompleted ? '#A78BFA' : '#10B981';
          return (
            <View style={gr.goalCard}>
              <View style={gr.goalHeader}>
                <Text style={gr.starIcon}>{isCompleted ? '⭐' : '🌟'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[gr.goalName, { color }]}>{item.name}</Text>
                  {item.attributes?.description && (
                    <Text style={gr.goalDesc}>{item.attributes.description}</Text>
                  )}
                </View>
                <ProgressRing progress={progress} color={color} size={48} />
              </View>

              {/* Progress bar */}
              <View style={gr.progressTrack}>
                <View style={[gr.progressFill, { width: `${Math.min(100, progress)}%`, backgroundColor: color }]} />
              </View>

              <View style={gr.goalFooter}>
                {deadline ? <Text style={gr.deadline}>📅 {new Date(deadline).toLocaleDateString()}</Text> : null}
                <Text style={gr.addedDate}>Added {new Date(item.created_at).toLocaleDateString()}</Text>
              </View>
            </View>
          );
        }}
        contentContainerStyle={gr.listContent}
        ListEmptyComponent={
          <Text style={gr.emptyText}>
            {tab === 'active' ? 'No active goals. Tell Nova about a goal to get started!' : 'No completed goals yet. Keep going!'}
          </Text>
        }
      />
    </SafeAreaView>
  );
});

const gr = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginHorizontal: 16, marginTop: 8, marginBottom: 12 },
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 16, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  tabRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 16, gap: 8 },
  tab: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  tabActive: { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: '#10B981' },
  tabText: { color: '#888', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#10B981' },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  goalCard: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 12
  },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  starIcon: { fontSize: 20, marginRight: 10, marginTop: 2 },
  goalName: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  goalDesc: { fontSize: 13, color: '#999', lineHeight: 18 },
  progressTrack: {
    height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2,
    overflow: 'hidden', marginBottom: 10
  },
  progressFill: { height: '100%', borderRadius: 2 },
  goalFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  deadline: { fontSize: 11, color: '#F59E0B' },
  addedDate: { fontSize: 11, color: '#555' },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 14, marginHorizontal: 32 },
  ringOuter: { alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  ringInner: { alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 9, fontWeight: 'bold' },
});
