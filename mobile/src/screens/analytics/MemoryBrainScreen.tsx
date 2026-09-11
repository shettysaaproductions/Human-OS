import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, TextInput, ScrollView, SectionList, Alert, Modal, KeyboardAvoidingView, Platform,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';
import { BrainHeader } from '../../components/BrainHeader';

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

// ── Lifestyle Starter Guidance For Users With Different Lifestyles ─────────────
const LIFESTYLE_PROMPTS: Record<string, { title: string; subtitle: string; example: string; emoji: string; color: string }> = {
  family: {
    title: 'Family & Relationships',
    subtitle: 'Nova maps your family members, spouse, children, nicknames, and special milestones.',
    example: '"My wife Sakshi is a self-taught nail artist and my son Shreshth (nickname Tiku) is 6 months old."',
    emoji: '👨‍👩‍👧',
    color: '#EC4899',
  },
  work: {
    title: 'Career, Projects & Ambitions',
    subtitle: 'Track your current company, office timings, candidates, clients, or freelancing work.',
    example: '"I work as a senior designer at Acme, in the office Monday through Friday 10am to 7pm."',
    emoji: '👔',
    color: '#3B82F6',
  },
  goals: {
    title: 'Goals & Ambitions',
    subtitle: 'Stay focused on your active sprint targets and long-term life aspirations.',
    example: '"My primary goal for Q3 is launching our beta product and reading 2 books a month."',
    emoji: '🎯',
    color: '#10B981',
  },
  lifestyle: {
    title: 'Lifestyle, Habits & Daily Rhythm',
    subtitle: 'Preserve your daily routines, coffee preferences, workout schedule, and diet.',
    example: '"I drink oat milk cold brew in the morning and workout at the gym 4 days a week."',
    emoji: '🧘',
    color: '#F59E0B',
  },
  identity: {
    title: 'Core Identity & Values',
    subtitle: 'Anchor your core philosophies, personal quirks, birth details, and values.',
    example: '"I value craftsmanship, deep intellectual focus, and honest communication."',
    emoji: '📌',
    color: '#8B5CF6',
  },
  all: {
    title: 'Living Memory Tree',
    subtitle: 'As you converse naturally with Nova, she synthesizes and interconnects your world into a living neural tree.',
    example: '"Chat with Nova about your day, projects, family, or routines to grow your branches."',
    emoji: '🌳',
    color: '#8B5CF6',
  }
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
  if (
    mt === 'family' ||
    /wife|son|mother|father|daughter|sister|brother|baby|child|family|husband|partner|pet|dog|cat|bird|puppy|kitten|cousin|uncle|aunt/.test(k)
  ) return 'family';
  if (
    mt === 'work' ||
    /company|office|schedule|hours|days|timing|candidate|job|work|project|repo|app|software|client|stack|career|colleague|coworker|mentor/.test(k)
  ) return 'work';
  if (
    mt === 'goals' ||
    /goal|target|passion|vision|ambition|marathon|milestone|deadline|aim|sprint/.test(k)
  ) return 'goals';
  if (
    mt === 'preferences' || mt === 'lifestyle' ||
    /favourite|food|drink|beverage|color|routine|habit|gym|workout|fitness|diet|sleep|car|bike|vehicle|guitar|piano|music|travel|trip|doctor|health|hobby|sport/.test(k)
  ) return 'lifestyle';
  return 'identity';
}

export const MemoryBrainScreen = React.memo(function MemoryBrainScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'wardrobes' | 'facts'>('wardrobes');
  const [expandedWardrobes, setExpandedWardrobes] = useState<Record<string, boolean>>({});
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
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMemories();
  }, []);

  const toggleWardrobe = useCallback((id: string) => {
    setExpandedWardrobes(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Auto-expand wardrobes whose traits match active search query
  useEffect(() => {
    if (searchQuery.trim() && data?.entityWardrobes) {
      const q = searchQuery.toLowerCase();
      const autoExp: Record<string, boolean> = {};
      data.entityWardrobes.forEach((w: any) => {
        const hasTrait = (w.traits || []).some((t: any) =>
          String(t.label || '').toLowerCase().includes(q) ||
          String(t.value || '').toLowerCase().includes(q)
        );
        if (hasTrait) autoExp[w.id] = true;
      });
      if (Object.keys(autoExp).length > 0) {
        setExpandedWardrobes(prev => ({ ...prev, ...autoExp }));
      }
    }
  }, [searchQuery, data]);

  const filteredWardrobes = useMemo(() => {
    if (!data?.entityWardrobes) return [];
    let list: any[] = data.entityWardrobes;
    if (selectedType && selectedType !== 'all') {
      list = list.filter((w: any) => w.domain === selectedType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((w: any) => {
        const name = String(w.name || '').toLowerCase();
        const summary = String(w.summary || '').toLowerCase();
        const role = String(w.roleTitle || '').toLowerCase();
        const hasTrait = (w.traits || []).some((t: any) =>
          String(t.label || '').toLowerCase().includes(q) ||
          String(t.value || '').toLowerCase().includes(q)
        );
        return name.includes(q) || summary.includes(q) || role.includes(q) || hasTrait;
      });
    }
    return list;
  }, [data, selectedType, searchQuery]);

  const sections = useMemo(() => {
    const list: any[] = [];
    if (!data) return list;

    const matchesSearch = (item: any) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const k = String(item.key || '').toLowerCase();
      const v = String(item.value || '').toLowerCase();
      const l = String(item.label || '').toLowerCase();
      return k.includes(q) || v.includes(q) || l.includes(q);
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
  }, [confirmDelete]);

  const handleLongPressTrait = useCallback((trait: any, _wardrobe: any) => {
    if (trait.isWorkingContext) return;
    Alert.alert(
      'Manage Trait',
      `What would you like to do with "${trait.label}: ${trait.value}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit', onPress: () => {
            setEditMemory({
              id: trait.sourceMemoryId || trait.id,
              sourceMemoryId: trait.sourceMemoryId,
              key: trait.key,
              value: trait.value
            });
            setEditValue(trait.value);
            setEditModalVisible(true);
        }},
        { text: 'Delete', style: 'destructive', onPress: () => {
            const memoryId = trait.sourceMemoryId || (data?.currentMemories?.find((m: any) => m.key?.toLowerCase() === trait.key?.toLowerCase())?.id);
            if (memoryId) {
              confirmDelete({ id: memoryId, key: trait.key, label: trait.label });
            } else {
              Alert.alert('Notice', 'This trait is part of an integrated wardrobe. You can edit its value instead.');
            }
        }}
      ]
    );
  }, [data, confirmDelete]);

  const saveEdit = async () => {
    if (!editMemory || !editValue.trim()) return;
    setIsSaving(true);
    try {
      let targetId = editMemory.sourceMemoryId;
      if (!targetId && editMemory.id && !String(editMemory.id).startsWith('trait-')) {
        targetId = editMemory.id;
      }
      if (!targetId && editMemory.key) {
        const match = data?.currentMemories?.find((m: any) => m.key?.toLowerCase() === editMemory.key?.toLowerCase());
        if (match?.id) {
          targetId = match.id;
        }
      }

      if (targetId) {
        await api.patch(`/memories/${targetId}`, { value: editValue.trim() });
        setEditModalVisible(false);
        fetchMemories();
      } else {
        Alert.alert('Error', 'Unable to resolve memory record for update.');
      }
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
      <BrainHeader
        title="Memory Tree"
        subtitle={`${data?.totalCount || 0} facts across ${data?.entityWardrobes?.length || 0} branches`}
        icon="🌳"
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
      />

      {/* Stats row */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statNum}>{data?.wardrobeCount || data?.entityWardrobes?.length || 0}</Text>
          <Text style={s.statLabel}>Wardrobes</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#10B981' }]}>
            {data?.totalCount || 0}
          </Text>
          <Text style={s.statLabel}>Total Facts</Text>
        </View>
        <View style={s.statCard}>
          <Text style={[s.statNum, { color: '#F59E0B' }]}>{connectedDots.length}</Text>
          <Text style={s.statLabel}>Connected Dots</Text>
        </View>
      </View>

      {/* View Switcher: Wardrobes vs All Facts */}
      <View style={s.tabSwitch}>
        <TouchableOpacity
          style={[s.tabBtn, viewMode === 'wardrobes' && s.tabBtnActive]}
          onPress={() => setViewMode('wardrobes')}
          activeOpacity={0.8}
        >
          <Text style={[s.tabBtnText, viewMode === 'wardrobes' && s.tabBtnTextActive]}>
            🌳 Living Memory Tree ({filteredWardrobes.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, viewMode === 'facts' && s.tabBtnActive]}
          onPress={() => setViewMode('facts')}
          activeOpacity={0.8}
        >
          <Text style={[s.tabBtnText, viewMode === 'facts' && s.tabBtnTextActive]}>
            📝 All Facts ({data?.totalCount || 0})
          </Text>
        </TouchableOpacity>
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
          <Text style={[s.filterText, !selectedType && s.filterTextActive]}>All Branches</Text>
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
            <Text style={s.dotsTitle}>🕸️ Cross-Branch Neural Bridges</Text>
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

      {/* Main Content Area */}
      {viewMode === 'wardrobes' ? (
        <ScrollView
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#A78BFA" />}
        >
          {filteredWardrobes.length === 0 ? (
            searchQuery.trim() ? (
              <View style={s.searchEmptyCard}>
                <Text style={s.searchEmptyIcon}>🔍</Text>
                <Text style={s.searchEmptyTitle}>No memories match "{searchQuery}"</Text>
                <TouchableOpacity style={s.searchEmptyBtn} onPress={() => setSearchQuery('')}>
                  <Text style={s.searchEmptyBtnText}>Clear Search</Text>
                </TouchableOpacity>
              </View>
            ) : (
              (() => {
                const prompt = LIFESTYLE_PROMPTS[selectedType || 'all'] || LIFESTYLE_PROMPTS.all;
                return (
                  <View style={s.lifestyleCard}>
                    <View style={[s.lifestyleIconWrap, { backgroundColor: `${prompt.color}20`, borderColor: `${prompt.color}60` }]}>
                      <Text style={s.lifestyleEmoji}>{prompt.emoji}</Text>
                    </View>
                    <Text style={s.lifestyleTitle}>{prompt.title}</Text>
                    <Text style={s.lifestyleSubtitle}>{prompt.subtitle}</Text>

                    <View style={s.lifestyleQuoteBox}>
                      <Text style={[s.lifestyleQuoteLabel, { color: prompt.color }]}>💡 TRY TELLING NOVA IN CHAT:</Text>
                      <Text style={s.lifestyleQuoteText}>{prompt.example}</Text>
                    </View>

                    <TouchableOpacity
                      style={[s.lifestyleChatBtn, { backgroundColor: prompt.color }]}
                      onPress={() => navigation.navigate('Chat')}
                      activeOpacity={0.8}
                    >
                      <Text style={s.lifestyleChatBtnText}>💬 Open Chat with Nova</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()
            )
          ) : (
            <View style={s.treeContainer}>
              {/* Vertical Tree Spine */}
              <View style={s.treeSpine} />

              {filteredWardrobes.map((w: any) => {
                const isExpanded = !!expandedWardrobes[w.id];
                return (
                  <View key={w.id} style={s.treeBranchRow}>
                    {/* Branch Stem & Joint Node */}
                    <View style={s.branchStem}>
                      <View style={[s.branchJoint, { backgroundColor: w.color, borderColor: `${w.color}90` }]} />
                      <View style={[s.branchArm, { backgroundColor: `${w.color}60` }]} />
                    </View>

                    {/* Branch Wardrobe Card */}
                    <View style={[s.wardrobeCard, s.branchCard, { borderLeftColor: w.color, borderLeftWidth: 4 }]}>
                      <TouchableOpacity
                        activeOpacity={0.8}
                        onPress={() => toggleWardrobe(w.id)}
                        style={s.wardrobeHeader}
                      >
                        <View style={s.wardrobeHeaderLeft}>
                          <View style={[s.wardrobeAvatar, { backgroundColor: `${w.color}20`, borderColor: `${w.color}60` }]}>
                            <Text style={s.wardrobeAvatarText}>{w.avatarEmoji}</Text>
                          </View>
                          <View style={s.wardrobeTitleCol}>
                            <View style={s.wardrobeNameRow}>
                              <Text style={s.wardrobeName}>{w.name}</Text>
                              <View style={[s.wardrobeRoleBadge, { backgroundColor: `${w.color}15`, borderColor: w.color }]}>
                                <Text style={[s.wardrobeRoleText, { color: w.color }]}>
                                  {w.roleTitle || w.domain}
                                </Text>
                              </View>
                            </View>
                            <Text style={s.wardrobeSummary} numberOfLines={isExpanded ? undefined : 2}>
                              {w.summary}
                            </Text>
                          </View>
                        </View>
                        <Text style={s.wardrobeExpandIcon}>{isExpanded ? '▲' : '▼'}</Text>
                      </TouchableOpacity>

                      {/* Connected Dots Box */}
                      {w.connectedDots && w.connectedDots.length > 0 && (
                        <View style={s.wardrobeDotsBox}>
                          <View style={s.branchBridgeHeader}>
                            <Text style={s.branchBridgeTitle}>🌿 Cross-Branch Neural Link</Text>
                          </View>
                          {w.connectedDots.map((cd: any, idx: number) => (
                            <View key={idx} style={s.wardrobeDotRow}>
                              <Text style={s.wardrobeDotBadge}>{cd.badge}</Text>
                              <Text style={s.wardrobeDotInsight}>{cd.insight}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Trait Leaf Chips Grid */}
                      <View style={s.traitsWrap}>
                        {w.traits.map((t: any) => (
                          <TouchableOpacity
                            key={t.id}
                            style={[s.traitChip, t.isWorkingContext && s.traitChipWorking]}
                            onLongPress={() => handleLongPressTrait(t, w)}
                            delayLongPress={400}
                            activeOpacity={0.8}
                          >
                            <Text style={s.leafIcon}>{t.isWorkingContext ? '💭' : '🍃'}</Text>
                            <Text style={[s.traitLabel, { color: w.color }]}>{t.label}:</Text>
                            <Text style={s.traitValue}>{t.value}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : (
        /* Granular Fact Sections (SectionList) */
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => item.id || `item-${index}`}
          removeClippedSubviews
          windowSize={10}
          contentContainerStyle={s.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#A78BFA" />}
          ListEmptyComponent={
            searchQuery.trim() ? (
              <View style={s.searchEmptyCard}>
                <Text style={s.searchEmptyIcon}>🔍</Text>
                <Text style={s.searchEmptyTitle}>No facts match "{searchQuery}"</Text>
                <TouchableOpacity style={s.searchEmptyBtn} onPress={() => setSearchQuery('')}>
                  <Text style={s.searchEmptyBtnText}>Clear Search</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.lifestyleCard}>
                <Text style={s.lifestyleTitle}>No Facts Found</Text>
                <Text style={s.lifestyleSubtitle}>As you chat, Nova extracts key durable facts into this compartment.</Text>
                <TouchableOpacity
                  style={[s.lifestyleChatBtn, { backgroundColor: '#8B5CF6', marginTop: 12 }]}
                  onPress={() => navigation.navigate('Chat')}
                >
                  <Text style={s.lifestyleChatBtnText}>💬 Chat with Nova</Text>
                </TouchableOpacity>
              </View>
            )
          }
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
      )}

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
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 14, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold', color: '#8B5CF6' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },

  // View Switcher (Tabs)
  tabSwitch: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#8B5CF6',
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
  },
  tabBtnTextActive: {
    color: '#fff',
  },

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

  // Living Memory Tree Layout
  treeContainer: {
    position: 'relative',
    paddingLeft: 6,
    paddingRight: 2,
  },
  treeSpine: {
    position: 'absolute',
    top: 14,
    bottom: 24,
    left: 19,
    width: 3,
    backgroundColor: 'rgba(139, 92, 246, 0.35)',
    borderRadius: 2,
    zIndex: 0,
  },
  treeBranchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    position: 'relative',
  },
  branchStem: {
    width: 28,
    alignItems: 'center',
    paddingTop: 22,
    position: 'relative',
  },
  branchJoint: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    zIndex: 2,
  },
  branchArm: {
    position: 'absolute',
    top: 28,
    left: 14,
    width: 16,
    height: 2,
    zIndex: 1,
  },
  branchCard: {
    flex: 1,
    marginBottom: 0,
    marginLeft: 6,
  },
  branchBridgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  branchBridgeTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A78BFA',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  leafIcon: {
    fontSize: 11,
    marginRight: 2,
  },

  // Wardrobe Cards
  wardrobeCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  wardrobeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  wardrobeHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  wardrobeAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wardrobeAvatarText: {
    fontSize: 22,
  },
  wardrobeTitleCol: {
    flex: 1,
  },
  wardrobeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  wardrobeName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  wardrobeRoleBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  wardrobeRoleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  wardrobeSummary: {
    fontSize: 12,
    color: '#A1A1AA',
    lineHeight: 16,
  },
  wardrobeExpandIcon: {
    color: '#71717A',
    fontSize: 12,
    marginLeft: 8,
  },
  wardrobeDotsBox: {
    backgroundColor: 'rgba(139,92,246,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    marginBottom: 10,
    gap: 6,
  },
  wardrobeDotRow: {
    flexDirection: 'column',
    gap: 2,
  },
  wardrobeDotBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C084FC',
  },
  wardrobeDotInsight: {
    fontSize: 11,
    color: '#D4D4D8',
    lineHeight: 15,
  },
  traitsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  traitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 4,
  },
  traitChipWorking: {
    borderColor: '#06B6D440',
    backgroundColor: '#06B6D410',
  },
  traitLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  traitValue: {
    fontSize: 12,
    color: '#E4E4E7',
  },

  // Standard Facts & Compartments
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
  modalBtnText: { color: '#ccc', fontSize: 15, fontWeight: '600' },

  // Lifestyle Empty State Styles
  lifestyleCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 24,
  },
  lifestyleIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  lifestyleEmoji: {
    fontSize: 28,
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
    paddingHorizontal: 8,
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
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  lifestyleQuoteText: {
    fontSize: 12,
    color: '#E4E4E7',
    fontStyle: 'italic',
    lineHeight: 17,
  },
  lifestyleChatBtn: {
    paddingVertical: 11,
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

  // Search Empty Styles
  searchEmptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
  },
  searchEmptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  searchEmptyTitle: {
    fontSize: 14,
    color: '#71717A',
    marginBottom: 12,
    textAlign: 'center',
  },
  searchEmptyBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  searchEmptyBtnText: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '600',
  },
});
