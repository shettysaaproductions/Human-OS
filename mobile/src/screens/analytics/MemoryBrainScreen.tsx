import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, TextInput, ScrollView, SectionList, Alert, Modal, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

// ── Wardrobe Life Domain Definitions ──────────────────────────────────────────
const DOMAINS: Array<{ key: string; label: string; emoji: string; color: string }> = [
  { key: 'family',    label: 'Family',    emoji: '👨‍👩‍👧', color: '#EC4899' },
  { key: 'work',      label: 'Career',    emoji: '👔', color: '#3B82F6' },
  { key: 'goals',     label: 'Goals',     emoji: '🎯', color: '#10B981' },
  { key: 'lifestyle', label: 'Lifestyle', emoji: '🧘', color: '#F59E0B' },
  { key: 'identity',  label: 'Identity',  emoji: '📌', color: '#8B5CF6' },
];

const DOMAIN_META_MAP: Record<string, { label: string; emoji: string; color: string }> = {
  family:    { label: 'Family & Relationships', emoji: '👨‍👩‍👧', color: '#EC4899' },
  work:      { label: 'Career & Professional',  emoji: '👔', color: '#3B82F6' },
  goals:     { label: 'Goals & Ambitions',      emoji: '🎯', color: '#10B981' },
  lifestyle: { label: 'Lifestyle & Rhythm',     emoji: '🧘', color: '#F59E0B' },
  identity:  { label: 'Core Identity',          emoji: '📌', color: '#8B5CF6' },
};

// ── Human-readable memory type labels ─────────────────────────────────────────
const MEMORY_TYPE_LABEL: Record<string, string> = {
  family:      'Family',
  work:        'Career',
  goals:       'Goal',
  lifestyle:   'Lifestyle',
  preferences: 'Preference',
  personal:    'Identity',
  identity:    'Identity',
  semantic:    'Fact',
  episodic:    'Memory',
  working:     'Active Context',
  procedural:  'Skill',
};

// ── Category meta with custom styling — ZERO fallback cardboard box ───────────
const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  family:        { color: '#EC4899', emoji: '👨‍👩‍👧' },
  work:          { color: '#3B82F6', emoji: '👔' },
  goals:         { color: '#10B981', emoji: '🎯' },
  lifestyle:     { color: '#F59E0B', emoji: '🧘' },
  preferences:   { color: '#F59E0B', emoji: '✨' },
  personal:      { color: '#8B5CF6', emoji: '📌' },
  identity:      { color: '#8B5CF6', emoji: '📌' },
  memories:      { color: '#8B5CF6', emoji: '🧠' },
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
  uncategorized: { color: '#8B5CF6', emoji: '💡' }, // Sleek lightbulb fallback
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
  if (!key) return '';
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

function inferDomain(item: any): string {
  if (item.domain && DOMAIN_META_MAP[item.domain]) return item.domain;
  const k = (item.key || '').toLowerCase();
  const mt = (item.memory_type || '').toLowerCase();
  if (mt === 'family' || /wife|son|mother|father|daughter|sister|brother|baby|child|family/.test(k)) return 'family';
  if (mt === 'work' || /company|office|schedule|hours|days|timing|candidate|job|work/.test(k)) return 'work';
  if (mt === 'goals' || /goal|target|passion|vision|ambition/.test(k)) return 'goals';
  if (mt === 'preferences' || mt === 'lifestyle' || /favourite|food|drink|beverage|color|routine/.test(k)) return 'lifestyle';
  return 'identity';
}

export const MemoryBrainScreen = React.memo(function MemoryBrainScreen() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editMemory, setEditMemory] = useState<any>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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

  const sections = useMemo(() => {
    const list: any[] = [];
    if (!data) return list;

    const matchesSearch = (item: any) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return item.key?.toLowerCase().includes(q) || item.value?.toLowerCase().includes(q);
    };

    const compartments = data.domainCompartments || {};

    DOMAINS.forEach(({ key: dKey, label, emoji, color }) => {
      if (selectedType && selectedType !== 'all' && selectedType !== dKey) {
        return;
      }

      const domainData = compartments[dKey];
      let memories = domainData
        ? (domainData.memories || [])
        : (data.currentMemories || []).filter((m: any) => inferDomain(m) === dKey);
      let context = domainData
        ? (domainData.workingContext || [])
        : (data.workingContext || []).filter((w: any) => inferDomain(w) === dKey);

      memories = (memories || []).filter(matchesSearch);
      context = (context || [])
        .filter(matchesSearch)
        .map((c: any) => ({ ...c, isWorkingContext: true }));

      const allItems = [...memories, ...context];
      if (allItems.length > 0) {
        list.push({
          title: DOMAIN_META_MAP[dKey]?.label || label,
          emoji,
          color,
          domain: dKey,
          data: allItems,
          count: allItems.length,
          type: 'domain'
        });
      }
    });

    // History section
    const archived = (data.archivedMemories || []).filter(matchesSearch);
    if (archived.length > 0) {
      if (historyExpanded) {
        list.push({ title: 'History & Provenance', data: archived, type: 'archived', count: archived.length });
      } else {
        list.push({ title: 'History & Provenance', data: [], type: 'archived_collapsed', count: archived.length });
      }
    }

    return list;
  }, [data, searchQuery, selectedType, historyExpanded]);

  const handleLongPress = useCallback((item: any) => {
    if (item.isWorkingContext) return; // Working context managed ephemerally
    Alert.alert(
      'Manage Memory',
      `What would you like to do with "${toLabel(item.key)}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit', onPress: () => {
            setEditMemory(item);
            setEditValue(item.value);
            setEditModalVisible(true);
        }},
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(item) }
      ]
    );
  }, []);

  const confirmDelete = useCallback((item: any) => {
    Alert.alert('Delete Memory?', 'Are you sure you want to archive this memory? It will be moved to History.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
         try {
           await api.delete(`/memories/${item.id}`);
           fetchMemories();
         } catch (err) {
           Alert.alert('Error', 'Failed to delete memory.');
         }
      }}
    ]);
  }, []);

  const saveEdit = async () => {
    if (!editMemory || !editValue.trim()) return;
    setIsSaving(true);
    try {
      await api.patch(`/memories/${editMemory.id}`, { value: editValue });
      setEditModalVisible(false);
      fetchMemories();
    } catch (err) {
      Alert.alert('Error', 'Failed to update memory.');
    } finally {
      setIsSaving(false);
    }
  };

  if (loading && !data) {
    return <View style={s.center}><ActivityIndicator size="large" color="#8B5CF6" /></View>;
  }

  const connectedDots = data?.connectedDots || [];

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <Text style={s.title}>Brain</Text>

      {/* Stats row */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statNum}>{data?.totalCount || 0}</Text>
          <Text style={s.statLabel}>Total Facts</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#10B981' }]}>
            {Object.keys(data?.domainCompartments || {}).length || 5}
          </Text>
          <Text style={s.statLabel}>Domains</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#F59E0B' }]}>{data?.thisWeekCount || 0}</Text>
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
          placeholder="Search memories across wardrobe..."
          placeholderTextColor="#666"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={s.clearBtn}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Wardrobe Domain Filter Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll}>
        <TouchableOpacity
          style={[s.filterChip, !selectedType && s.filterChipActive]}
          onPress={() => setSelectedType(null)}
        >
          <Text style={[s.filterText, !selectedType && s.filterTextActive]}>All Wardrobe</Text>
        </TouchableOpacity>
        {DOMAINS.map(d => {
          const isActive = selectedType === d.key;
          const count = data?.domainCompartments?.[d.key]?.count ?? 0;
          return (
            <TouchableOpacity
              key={d.key}
              style={[s.filterChip, isActive && { borderColor: d.color, backgroundColor: `${d.color}20` }]}
              onPress={() => setSelectedType(isActive ? null : d.key)}
            >
              <Text style={[s.filterText, isActive && { color: d.color }]}>
                {d.emoji} {d.label} {count > 0 ? `(${count})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Neural Connected Dots (Cross-Domain Links) */}
      {connectedDots.length > 0 && !selectedType ? (
        <View style={s.dotsContainer}>
          <View style={s.dotsHeader}>
            <Text style={s.dotsTitle}>🕸️ Neural Connected Dots</Text>
            <Text style={s.dotsSubtitle}>Nova bridges context across your life domains</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.dotsScroll}>
            {connectedDots.map((dot: any) => (
              <View key={dot.id} style={s.dotCard}>
                <View style={s.dotBadge}>
                  <Text style={s.dotBadgeText}>{dot.badge}</Text>
                </View>
                <Text style={s.dotTitle}>{dot.title}</Text>
                <Text style={s.dotInsight} numberOfLines={3}>{dot.insight}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Memory Compartment Sections */}
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => item.id || `item-${index}`}
        removeClippedSubviews
        windowSize={10}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={<Text style={s.emptyText}>No memories found in this compartment.</Text>}
        renderSectionHeader={({ section }: any) => {
          if (section.type === 'archived' || section.type === 'archived_collapsed') {
            return (
              <View style={s.sectionHeader}>
                <TouchableOpacity onPress={() => setHistoryExpanded(!historyExpanded)} style={s.historyHeaderRow}>
                  <Text style={s.sectionTitle}>{section.title} ({section.count})</Text>
                  <Text style={s.historyHeaderIcon}>{historyExpanded ? '▼' : '▶'}</Text>
                </TouchableOpacity>
              </View>
            );
          }

          return (
            <View style={[s.sectionHeader, { borderLeftColor: section.color, borderLeftWidth: 4, paddingLeft: 8 }]}>
              <Text style={s.sectionTitle}>
                {section.emoji} {section.title} <Text style={[s.sectionCount, { color: section.color }]}>({section.count})</Text>
              </Text>
            </View>
          );
        }}
        renderItem={({ item, section }: any) => {
          const isArchived = section.type === 'archived';

          if (item.isWorkingContext) {
            const timeStr = relativeTime(item.updated_at || item.created_at);
            return (
              <View style={[s.card, s.cardWorking]}>
                <View style={s.cardHeader}>
                  <View style={[s.badge, { backgroundColor: '#06B6D420', borderColor: '#06B6D4' }]}>
                    <Text style={[s.badgeText, { color: '#06B6D4' }]}>⚡ Active Context</Text>
                  </View>
                  {timeStr ? <Text style={s.timeText}>{timeStr}</Text> : null}
                </View>
                <Text style={[s.cardKey, { color: '#06B6D4' }]}>{toLabel(item.key)}</Text>
                <Text style={s.cardVal}>{item.value}</Text>
              </View>
            );
          }

          const domainKey = inferDomain(item);
          const domainMeta = DOMAIN_META_MAP[domainKey] || CATEGORY_META[item.memory_type] || CATEGORY_META.uncategorized;
          const typeMeta = CATEGORY_META[item.memory_type] || domainMeta;
          const typeLabel = MEMORY_TYPE_LABEL[item.memory_type] || domainMeta.label || 'Fact';
          const authMeta = AUTHORITY_META[item.source_authority] || AUTHORITY_META.subconscious_inference;
          const timeStr = relativeTime(item.updated_at || item.created_at);

          return (
            <TouchableOpacity 
              style={[s.card, isArchived && s.cardArchived]}
              onLongPress={() => !isArchived && handleLongPress(item)}
              delayLongPress={400}
              activeOpacity={isArchived ? 1 : 0.7}
            >
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
              <Text style={[s.cardKey, { color: domainMeta.color }]}>{toLabel(item.key)}</Text>
              <Text style={s.cardVal}>{item.value}</Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Edit Modal */}
      <Modal visible={editModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Edit Memory</Text>
            <Text style={s.modalSubtitle}>{editMemory ? toLabel(editMemory.key) : ''}</Text>
            
            <TextInput
              style={s.modalInput}
              value={editValue}
              onChangeText={setEditValue}
              multiline
              autoFocus
              placeholder="Memory value..."
              placeholderTextColor="#666"
            />
            
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalBtn} onPress={() => setEditModalVisible(false)} disabled={isSaving}>
                <Text style={s.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalBtn, s.modalBtnPrimary]} onPress={saveEdit} disabled={isSaving}>
                {isSaving ? (
                   <ActivityIndicator size="small" color="#fff" />
                ) : (
                   <Text style={[s.modalBtnText, { color: '#fff' }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

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
  filterScroll: { marginBottom: 14, paddingLeft: 16 },
  filterChip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6, marginRight: 8, backgroundColor: 'rgba(255,255,255,0.03)'
  },
  filterChipActive: { borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.15)' },
  filterText: { color: '#999', fontSize: 13 },
  filterTextActive: { color: '#8B5CF6' },

  // Dots Carousel
  dotsContainer: { marginHorizontal: 16, marginBottom: 16 },
  dotsHeader: { marginBottom: 8 },
  dotsTitle: { fontSize: 15, fontWeight: '700', color: '#E4E4E7' },
  dotsSubtitle: { fontSize: 11, color: '#71717A', marginTop: 2 },
  dotsScroll: { marginTop: 6 },
  dotCard: {
    width: 250, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)', borderRadius: 12, padding: 12, marginRight: 10
  },
  dotBadge: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(139,92,246,0.15)',
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6
  },
  dotBadgeText: { fontSize: 10, fontWeight: '700', color: '#A78BFA' },
  dotTitle: { fontSize: 13, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  dotInsight: { fontSize: 12, color: '#A1A1AA', lineHeight: 16 },

  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionHeader: { marginTop: 14, marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: '#fff' },
  sectionCount: { fontSize: 14, fontWeight: '600' },
  historyHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  historyHeaderIcon: { color: '#999', fontSize: 14, fontWeight: 'bold' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10
  },
  cardWorking: { backgroundColor: 'rgba(6,182,212,0.03)', borderColor: 'rgba(6,182,212,0.2)' },
  cardArchived: { opacity: 0.6, backgroundColor: 'rgba(255,255,255,0.01)' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  authBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 },
  authBadgeText: { fontSize: 10, fontWeight: '500' },
  timeText: { fontSize: 10, color: '#555' },
  cardKey: { fontSize: 13, fontWeight: '700', marginBottom: 4 },
  cardVal: { fontSize: 14, color: '#ccc', lineHeight: 20 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 15 },
  
  // Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181B', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, color: '#06B6D4', marginBottom: 16, fontWeight: '600' },
  modalInput: { 
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, color: '#fff', 
    padding: 12, minHeight: 80, fontSize: 15, textAlignVertical: 'top', marginBottom: 20
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  modalBtnPrimary: { backgroundColor: '#8B5CF6' },
  modalBtnText: { color: '#ccc', fontSize: 15, fontWeight: '600' }
});
