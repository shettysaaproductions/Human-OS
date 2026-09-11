import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';
import { BrainHeader } from '../../components/BrainHeader';

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

function formatGoalDeadline(deadlineStr?: string): string {
  if (!deadlineStr) return '';
  const parsed = new Date(deadlineStr);
  if (!isNaN(parsed.getTime()) && /^\d{4}/.test(deadlineStr)) {
    return parsed.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return deadlineStr;
}

function formatGoalCreated(createdStr?: string): string {
  if (!createdStr) return '';
  const parsed = new Date(createdStr);
  if (!isNaN(parsed.getTime())) {
    return `Added ${parsed.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`;
  }
  return `Added ${createdStr}`;
}

function ProgressRing({ progress, color, size = 60 }: { progress: number; color: string; size?: number }) {
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
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchGoals();
  }, []);

  const allGoals: Goal[] = data?.activeGoals || [];
  const activeGoals = useMemo(() => allGoals.filter(g => g.attributes?.status !== 'completed'), [allGoals]);
  const completedGoals = useMemo(() => allGoals.filter(g => g.attributes?.status === 'completed'), [allGoals]);
  const displayGoals = tab === 'active' ? activeGoals : completedGoals;

  const overallProgress = useMemo(() => {
    if (activeGoals.length === 0) return 0;
    const total = activeGoals.reduce((sum, g) => sum + (g.attributes?.progress || 0), 0);
    return total / activeGoals.length;
  }, [activeGoals]);

  if (loading && !data) {
    return <View style={gr.center}><ActivityIndicator size="large" color="#10B981" /></View>;
  }

  return (
    <SafeAreaView style={gr.container} edges={['top']}>
      <BrainHeader
        title="Goals & Milestones"
        subtitle={`${activeGoals.length} active · ${completedGoals.length} completed`}
        icon="🎯"
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
      />

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
          <ProgressRing progress={overallProgress} color="#10B981" size={50} />
          <Text style={gr.statLabel}>Avg Progress</Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#10B981" />}
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
                  {item.attributes?.description ? (
                    <Text style={gr.goalDesc}>{item.attributes.description}</Text>
                  ) : null}
                </View>
                <ProgressRing progress={progress} color={color} size={44} />
              </View>

              {/* Progress bar */}
              <View style={gr.progressTrack}>
                <View style={[gr.progressFill, { width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: color }]} />
              </View>

              <View style={gr.goalFooter}>
                {deadline ? (
                  <Text style={gr.deadline}>📅 {formatGoalDeadline(deadline)}</Text>
                ) : <View />}
                {item.created_at ? (
                  <Text style={gr.addedDate}>{formatGoalCreated(item.created_at)}</Text>
                ) : null}
              </View>
            </View>
          );
        }}
        contentContainerStyle={gr.listContent}
        ListEmptyComponent={
          <View style={gr.lifestyleCard}>
            <View style={gr.lifestyleIconWrap}>
              <Text style={gr.lifestyleEmoji}>🎯</Text>
            </View>
            <Text style={gr.lifestyleTitle}>
              {tab === 'active' ? 'No Active Goals Yet' : 'No Completed Goals Yet'}
            </Text>
            <Text style={gr.lifestyleSubtitle}>
              {tab === 'active'
                ? 'Whether fitness targets, career promotions, creative projects, or daily routines — Nova tracks progress automatically from your chats.'
                : 'Keep conversing with Nova as you hit milestones. Completed achievements will shine here!'}
            </Text>

            <View style={gr.lifestyleQuoteBox}>
              <Text style={gr.lifestyleQuoteLabel}>💡 GOAL IDEAS FOR YOUR LIFESTYLE:</Text>
              <Text style={gr.lifestyleQuoteText}>• "My goal is working out 4x a week and drinking 3L water."</Text>
              <Text style={gr.lifestyleQuoteText}>• "I want to finish our startup beta by next month."</Text>
              <Text style={gr.lifestyleQuoteText}>• "I aim to read 1 chapter every night before bed."</Text>
            </View>

            <TouchableOpacity
              style={gr.lifestyleChatBtn}
              onPress={() => navigation.navigate('Chat')}
              activeOpacity={0.8}
            >
              <Text style={gr.lifestyleChatBtnText}>💬 Set a Goal with Nova</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
});

const gr = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginTop: 14, marginBottom: 14, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  tabRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, gap: 8 },
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
  goalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deadline: { fontSize: 11, color: '#F59E0B' },
  addedDate: { fontSize: 11, color: '#555' },
  ringOuter: { alignItems: 'center', justifyContent: 'center', borderWidth: 3 },
  ringInner: { alignItems: 'center', justifyContent: 'center' },
  ringText: { fontSize: 9, fontWeight: 'bold' },

  // Lifestyle Empty Card
  lifestyleCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    marginTop: 16,
  },
  lifestyleIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(16,185,129,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(16,185,129,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  lifestyleEmoji: {
    fontSize: 26,
  },
  lifestyleTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
    textAlign: 'center',
  },
  lifestyleSubtitle: {
    fontSize: 13,
    color: '#A1A1AA',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  lifestyleQuoteBox: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  lifestyleQuoteLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  lifestyleQuoteText: {
    fontSize: 12,
    color: '#D4D4D8',
    lineHeight: 18,
  },
  lifestyleChatBtn: {
    backgroundColor: '#10B981',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lifestyleChatBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
