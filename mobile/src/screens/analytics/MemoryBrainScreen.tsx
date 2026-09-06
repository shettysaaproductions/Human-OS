import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, TextInput, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

// ── Human-readable memory type labels ─────────────────────────────────────────
const MEMORY_TYPE_LABEL: Record<string, string> = {
  semantic:  'Fact',
  episodic:  'Memory',
  working:   'Context',
  procedural:'Skill',
};

// ── Category meta for the filter chips & heatmap ──────────────────────────────
const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  memories:      { color: '#8B5CF6', emoji: '🧠' },
  goals:         { color: '#10B981', emoji: '🎯' },
  wishes:        { color: '#F59E0B', emoji: '✨' },
  skills:        { color: '#3B82F6', emoji: '⚡' },
  people:        { color: '#EC4899', emoji: '👥' },
  places:        { color: '#06B6D4', emoji: '📍' },
  projects:      { color: '#F97316', emoji: '🚀' },
  lessons:       { color: '#A78BFA', emoji: '📚' },
  semantic:      { color: '#8B5CF6', emoji: '🧠' },
  episodic:      { color: '#EC4899', emoji: '💬' },
  working:       { color: '#06B6D4', emoji: '⚡' },
  procedural:    { color: '#10B981', emoji: '🔧' },
  uncategorized: { color: '#6B7280', emoji: '📦' },
};

// ── Authority badge ────────────────────────────────────────────────────────────
const AUTHORITY_META: Record<string, { label: string; color: string }> = {
  explicit_user:          { label: 'You told me',  color: '#10B981' },
  deterministic:          { label: 'Confirmed',    color: '#3B82F6' },
  confirmed_memory:       { label: 'Reinforced',   color: '#8B5CF6' },
  subconscious_inference: { label: 'Inferred',     color: '#6B7280' },
  needs_review:           { label: 'Unverified',   color: '#F59E0B' },
};

// ── Human-readable key label ───────────────────────────────────────────────────
function toLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Relative timestamp ─────────────────────────────────────────────────────────
function relativeTime(iso: string | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

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

  // Fix: use updated_at (not created_at) for "This Week" calculation
  const thisWeekCount = useMemo(() => {
    return (data?.recentMemories || []).filter((m: any) => {
      const ts = m.updated_at || m.created_at;
      return ts && Date.now() - new Date(ts).getTime() < 7 * 86400000;
    }).length;
  }, [data]);

  const categories = useMemo(() => Object.entries(data?.categories || {}), [data]);

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color="#8B5CF6" /></View>;
  }

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Text style={s.title}>Brain</Text>

      {/* Stats row */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statNum}>{data?.totalMemories || 0}</Text>
          <Text style={s.statLabel}>Total</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#10B981' }]}>{categories.length}</Text>
          <Text style={s.statLabel}>Types</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#F59E0B' }]}>{thisWeekCount}</Text>
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
          const typeLabel = MEMORY_TYPE_LABEL[type] || type;
          return (
            <TouchableOpacity
              key={type}
              style={[s.filterChip, isActive && { borderColor: meta.color, backgroundColor: `${meta.color}20` }]}
              onPress={() => setSelectedType(isActive ? null : type)}
            >
              <Text style={[s.filterText, isActive && { color: meta.color }]}>
                {meta.emoji} {typeLabel} ({String(count)})
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Heatmap */}
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
          const typeMeta = CATEGORY_META[item.memory_type] || CATEGORY_META.uncategorized;
          const typeLabel = MEMORY_TYPE_LABEL[item.memory_type] || item.memory_type || 'memory';
          const authMeta = AUTHORITY_META[item.source_authority] || AUTHORITY_META.subconscious_inference;
          const timeStr = relativeTime(item.updated_at || item.created_at);

          return (
            <View style={s.card}>
              {/* Header row: type badge + authority badge + timestamp */}
              <View style={s.cardHeader}>
                <View style={[s.badge, { backgroundColor: `${typeMeta.color}20`, borderColor: typeMeta.color }]}>
                  <Text style={[s.badgeText, { color: typeMeta.color }]}>
                    {typeMeta.emoji} {typeLabel}
                  </Text>
                </View>
                <View style={s.cardHeaderRight}>
                  <View style={[s.authBadge, { borderColor: authMeta.color }]}>
                    <Text style={[s.authBadgeText, { color: authMeta.color }]}>{authMeta.label}</Text>
                  </View>
                  {timeStr ? <Text style={s.timeText}>{timeStr}</Text> : null}
                </View>
              </View>

              {/* Human-readable key label */}
              <Text style={s.cardKey}>{toLabel(item.key)}</Text>

              {/* Value */}
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
  heatmapRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-end',
    marginHorizontal: 16, marginBottom: 16, height: 52
  },
  heatCell: { alignItems: 'center', flex: 1 },
  heatBar: { width: 28, borderRadius: 4, marginBottom: 4 },
  heatLabel: { fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  authBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  authBadgeText: { fontSize: 10, fontWeight: '500' },
  timeText: { fontSize: 10, color: '#555' },
  cardKey: { fontSize: 13, fontWeight: '700', color: '#06B6D4', marginBottom: 4 },
  cardVal: { fontSize: 14, color: '#ccc', lineHeight: 20 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 15 },
});
