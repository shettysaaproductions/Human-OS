import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';
import { BrainHeader } from '../../components/BrainHeader';

type TimelineItem = {
  id: string;
  type: 'moment' | 'episodic' | 'reflection';
  title?: string;
  body?: string;
  summary?: string;
  emotion?: string;
  created_at: string;
};

const TYPE_CONFIG = {
  moment:    { icon: '⚡', color: '#F59E0B', label: 'Moment' },
  episodic:  { icon: '🧠', color: '#8B5CF6', label: 'Memory' },
  reflection:{ icon: '📖', color: '#06B6D4', label: 'Reflection' },
};

function groupByDate(items: TimelineItem[]): Array<{ date: string; items: TimelineItem[] }> {
  const groups: Record<string, TimelineItem[]> = {};
  (items || []).forEach(item => {
    if (!item?.created_at) return;
    const dateObj = new Date(item.created_at);
    if (isNaN(dateObj.getTime())) return;
    const date = dateObj.toLocaleDateString('en', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  });
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

export const LifeTimelineScreen = React.memo(function LifeTimelineScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<TimelineItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'moment' | 'episodic' | 'reflection'>('all');

  useEffect(() => { fetchTimeline(); }, []);

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      const [timelineRes] = await Promise.all([
        api.get('/analytics/timeline'),
        api.get('/analytics/memories').catch(() => ({})), // resilience
      ]);
      setData(timelineRes.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch timeline', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchTimeline();
  }, []);

  const filteredData = useMemo(() => {
    if (filter === 'all') return data;
    return data.filter(item => item.type === filter);
  }, [data, filter]);

  const grouped = useMemo(() => groupByDate(filteredData), [filteredData]);

  if (loading && !data.length) {
    return <View style={lt.center}><ActivityIndicator size="large" color="#F59E0B" /></View>;
  }

  return (
    <SafeAreaView style={lt.container} edges={['top']}>
      <BrainHeader
        title="Life Timeline"
        subtitle={`${data.length} chronological moments`}
        icon="⏳"
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
      />

      {/* Stats Row */}
      <View style={lt.statsRow}>
        <View style={lt.statCard}>
          <Text style={[lt.statNum, { color: '#F59E0B' }]}>{data.filter(d => d.type === 'moment').length}</Text>
          <Text style={lt.statLabel}>⚡ Moments</Text>
        </View>
        <View style={lt.statCard}>
          <Text style={[lt.statNum, { color: '#8B5CF6' }]}>{data.filter(d => d.type === 'episodic').length}</Text>
          <Text style={lt.statLabel}>🧠 Memories</Text>
        </View>
        <View style={lt.statCard}>
          <Text style={[lt.statNum, { color: '#06B6D4' }]}>{data.filter(d => d.type === 'reflection').length}</Text>
          <Text style={lt.statLabel}>📖 Reflections</Text>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={lt.filterRow}>
        {(['all', 'moment', 'episodic', 'reflection'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[lt.filterBtn, filter === f && lt.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[lt.filterText, filter === f && lt.filterTextActive]}>
              {f === 'all' ? 'All' : f === 'moment' ? 'Moments' : f === 'episodic' ? 'Memories' : 'Reflections'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Grouped Timeline */}
      <FlatList
        data={grouped}
        keyExtractor={(item) => item.date}
        removeClippedSubviews
        windowSize={10}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#F59E0B" />}
        renderItem={({ item: group }) => (
          <View style={lt.group}>
            <Text style={lt.groupDate}>{group.date}</Text>
            {group.items.map(item => {
              const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.episodic;
              const text = item.title || item.summary || item.body || '';
              const timeStr = item.created_at
                ? new Date(item.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <View key={item.id} style={lt.timelineRow}>
                  <View style={lt.timelineLine}>
                    <View style={[lt.dot, { backgroundColor: cfg.color }]} />
                    <View style={lt.lineSegment} />
                  </View>
                  <View style={[lt.nodeCard, { borderColor: `${cfg.color}30` }]}>
                    <View style={lt.nodeHeader}>
                      <Text style={lt.nodeIcon}>{cfg.icon}</Text>
                      <Text style={[lt.nodeType, { color: cfg.color }]}>{cfg.label}</Text>
                      {timeStr ? <Text style={lt.nodeTime}>{timeStr}</Text> : null}
                    </View>
                    <Text style={lt.nodeText} numberOfLines={3}>{text}</Text>
                    {item.emotion && <Text style={lt.emotionTag}>💭 {item.emotion}</Text>}
                  </View>
                </View>
              );
            })}
          </View>
        )}
        contentContainerStyle={lt.listContent}
        ListEmptyComponent={
          <View style={lt.lifestyleCard}>
            <View style={lt.lifestyleIconWrap}>
              <Text style={lt.lifestyleEmoji}>⏳</Text>
            </View>
            <Text style={lt.lifestyleTitle}>Chronological Life Moments</Text>
            <Text style={lt.lifestyleSubtitle}>
              As you share important stories, accomplishments, or daily happenings with Nova, she curates them into a beautiful, chronological narrative of your journey.
            </Text>
            <TouchableOpacity
              style={lt.lifestyleChatBtn}
              onPress={() => navigation.navigate('Chat')}
              activeOpacity={0.8}
            >
              <Text style={lt.lifestyleChatBtnText}>💬 Share a Moment in Chat</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </SafeAreaView>
  );
});

const lt = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginTop: 14, marginBottom: 14, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  filterRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, gap: 8 },
  filterBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  filterBtnActive: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B' },
  filterText: { color: '#888', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#F59E0B' },
  listContent: { paddingBottom: 40 },
  group: { marginHorizontal: 16, marginBottom: 8 },
  groupDate: { fontSize: 13, fontWeight: '700', color: '#71717A', marginBottom: 8, marginLeft: 24 },
  timelineRow: { flexDirection: 'row', marginBottom: 8 },
  timelineLine: { width: 24, alignItems: 'center', paddingTop: 14 },
  dot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  lineSegment: { flex: 1, width: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  nodeCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1,
    borderRadius: 12, padding: 12, marginLeft: 8
  },
  nodeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  nodeIcon: { fontSize: 14, marginRight: 6 },
  nodeType: { fontSize: 11, fontWeight: '700', flex: 1 },
  nodeTime: { fontSize: 11, color: '#555' },
  nodeText: { fontSize: 13, color: '#ccc', lineHeight: 19 },
  emotionTag: { fontSize: 11, color: '#888', marginTop: 6, fontStyle: 'italic' },

  // Lifestyle Empty Card
  lifestyleCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.2)',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
  },
  lifestyleIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,158,11,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(245,158,11,0.4)',
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
  lifestyleChatBtn: {
    backgroundColor: '#F59E0B',
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
