import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, TextInput, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  memories:      { color: '#8B5CF6', emoji: '🧠' },
  goals:         { color: '#10B981', emoji: '🎯' },
  wishes:        { color: '#F59E0B', emoji: '✨' },
  skills:        { color: '#3B82F6', emoji: '⚡' },
  people:        { color: '#EC4899', emoji: '👥' },
  places:        { color: '#06B6D4', emoji: '📍' },
  projects:      { color: '#F97316', emoji: '🚀' },
  lessons:       { color: '#A78BFA', emoji: '📚' },
  uncategorized: { color: '#6B7280', emoji: '📦' },
};

export const MemoryBrainScreen = React.memo(function MemoryBrainScreen() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);

  useEffect(() => { fetchMemories(); }, []);

  const fetchMemories = async () => {
    try {
      setLoading(true);
      const res = await api.get('/analytics/memories');
      setData(res.data.data);
    } catch (err) {
      console.error('Failed to fetch memories', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMemories = useMemo(() => {
    let list = data?.recentMemories || [];
    if (selectedType) list = list.filter((m: any) => m.memory_type === selectedType);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((m: any) =>
        m.key?.toLowerCase().includes(q) || m.value?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, searchQuery, selectedType]);

  const categories = useMemo(() => Object.entries(data?.categories || {}), [data]);

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color="#8B5CF6" /></View>;
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Text style={s.title}>Memory Brain</Text>

      {/* Total Count */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statNum}>{data?.totalMemories || 0}</Text>
          <Text style={s.statLabel}>Total</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#10B981' }]}>{categories.length}</Text>
          <Text style={s.statLabel}>Categories</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#F59E0B' }]}>
            {(data?.recentMemories || []).filter((m: any) => {
              const d = new Date(m.created_at);
              return Date.now() - d.getTime() < 7 * 86400000;
            }).length}
          </Text>
          <Text style={s.statLabel}>This Week</Text>
        </View>
      </View>

      {/* Search */}
      <View style={s.searchBar}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={s.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search memories..."
          placeholderTextColor="#555"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={s.clearBtn}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Category Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll}>
        <TouchableOpacity
          style={[s.filterChip, !selectedType && s.filterChipActive]}
          onPress={() => setSelectedType(null)}
        >
          <Text style={[s.filterText, !selectedType && s.filterTextActive]}>All</Text>
        </TouchableOpacity>
        {categories.map(([type, count]) => {
          const meta = CATEGORY_META[type] || CATEGORY_META.uncategorized;
          const isActive = selectedType === type;
          return (
            <TouchableOpacity
              key={type}
              style={[s.filterChip, isActive && { borderColor: meta.color, backgroundColor: `${meta.color}20` }]}
              onPress={() => setSelectedType(isActive ? null : type)}
            >
              <Text style={s.filterText}>{meta.emoji} {type} ({String(count)})</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Heatmap row */}
      <View style={s.heatmapRow}>
        {categories.slice(0, 7).map(([type, count]) => {
          const meta = CATEGORY_META[type] || CATEGORY_META.uncategorized;
          const max = Math.max(...categories.map(([, c]) => Number(c)), 1);
          const pct = Number(count) / max;
          return (
            <View key={type} style={s.heatCell}>
              <View style={[s.heatBar, { height: Math.max(4, pct * 40), backgroundColor: meta.color }]} />
              <Text style={s.heatLabel}>{meta.emoji}</Text>
            </View>
          );
        })}
      </View>

      {/* Memory List */}
      <FlatList
        data={filteredMemories}
        keyExtractor={(item) => item.id}
        removeClippedSubviews
        windowSize={10}
        renderItem={({ item }) => {
          const meta = CATEGORY_META[item.memory_type] || CATEGORY_META.uncategorized;
          return (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <View style={[s.badge, { backgroundColor: `${meta.color}20`, borderColor: meta.color }]}>
                  <Text style={[s.badgeText, { color: meta.color }]}>{meta.emoji} {item.memory_type || 'unknown'}</Text>
                </View>
                <Text style={s.importanceText}>imp: {item.importance}</Text>
              </View>
              <Text style={s.cardKey}>{item.key}</Text>
              <Text style={s.cardVal}>{item.value}</Text>
            </View>
          );
        }}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={<Text style={s.emptyText}>No memories found.</Text>}
      />
    </SafeAreaView>
  );
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginHorizontal: 16, marginTop: 8, marginBottom: 12 },
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 16, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold', color: '#8B5CF6' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10,
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, color: '#fff', paddingVertical: 10, fontSize: 15 },
  clearBtn: { color: '#666', fontSize: 18, paddingLeft: 8 },
  filterScroll: { marginBottom: 12, paddingLeft: 16 },
  filterChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.03)'
  },
  filterChipActive: { borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.15)' },
  filterText: { color: '#999', fontSize: 13 },
  filterTextActive: { color: '#8B5CF6' },
  heatmapRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end', marginHorizontal: 16, marginBottom: 16, height: 52 },
  heatCell: { alignItems: 'center', flex: 1 },
  heatBar: { width: 28, borderRadius: 4, marginBottom: 4 },
  heatLabel: { fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  importanceText: { fontSize: 11, color: '#555' },
  cardKey: { fontSize: 13, fontWeight: '700', color: '#06B6D4', marginBottom: 4 },
  cardVal: { fontSize: 14, color: '#ccc', lineHeight: 20 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 15 },
});
