import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

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
  items.forEach(item => {
    const date = new Date(item.created_at).toLocaleDateString('en', {
      month: 'long', day: 'numeric', year: 'numeric'
    });
    if (!groups[date]) groups[date] = [];
    groups[date].push(item);
  });
  return Object.entries(groups).map(([date, items]) => ({ date, items }));
}

export const LifeTimelineScreen = React.memo(function LifeTimelineScreen() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TimelineItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'moment' | 'episodic'>('all');

  useEffect(() => { fetchTimeline(); }, []);

  const fetchTimeline = async () => {
    try {
      setLoading(true);
      const [timelineRes, reflectionsRes] = await Promise.all([
        api.get('/analytics/timeline'),
        api.get('/analytics/memories'), // reuse for reflection count context
      ]);
      setData(timelineRes.data.data || []);
    } catch (err) {
      console.error('Failed to fetch timeline', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredData = useMemo(() => {
    if (filter === 'all') return data;
    return data.filter(item => item.type === filter);
  }, [data, filter]);

  const grouped = useMemo(() => groupByDate(filteredData), [filteredData]);

  if (loading) {
    return <View style={lt.center}><ActivityIndicator size="large" color="#F59E0B" /></View>;
  }

  return (
    <SafeAreaView style={lt.container} edges={['top']}>
      <Text style={lt.title}>Life Timeline</Text>

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
          <Text style={[lt.statNum, { color: '#06B6D4' }]}>{data.length}</Text>
          <Text style={lt.statLabel}>📅 Total</Text>
        </View>
      </View>

      {/* Filter tabs */}
      <View style={lt.filterRow}>
        {(['all', 'moment', 'episodic'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[lt.filterBtn, filter === f && lt.filterBtnActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[lt.filterText, filter === f && lt.filterTextActive]}>
              {f === 'all' ? 'All' : f === 'moment' ? 'Moments' : 'Memories'}
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
        renderItem={({ item: group }) => (
          <View style={lt.group}>
            <Text style={lt.groupDate}>{group.date}</Text>
            {group.items.map(item => {
              const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.episodic;
              const text = item.title || item.summary || item.body || '';
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
                      <Text style={lt.nodeTime}>
                        {new Date(item.created_at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
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
        ListEmptyComponent={<Text style={lt.emptyText}>No timeline events yet. Start talking to Nova!</Text>}
      />
    </SafeAreaView>
  );
});

const lt = StyleSheet.create({
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
  filterRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 16, gap: 8 },
  filterBtn: {
    flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  filterBtnActive: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#F59E0B' },
  filterText: { color: '#888', fontSize: 12, fontWeight: '600' },
  filterTextActive: { color: '#F59E0B' },
  listContent: { paddingBottom: 40 },
  group: { marginHorizontal: 16, marginBottom: 8 },
  groupDate: { fontSize: 13, fontWeight: '700', color: '#555', marginBottom: 8, marginLeft: 24 },
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
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 14, marginHorizontal: 32 },
});
