import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, TextInput, Alert, ScrollView, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

const CATEGORY_ORDER = ['Personal', 'Family', 'Work', 'Preferences'];
const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  Personal:       { color: '#8B5CF6', emoji: '👤' },
  Family:         { color: '#EC4899', emoji: '👨‍👩‍👧‍👦' },
  Work:           { color: '#3B82F6', emoji: '💼' },
  Preferences:    { color: '#10B981', emoji: '⚙️' },
};

type MemoryItem = {
  id: string;
  canonicalKey: string;
  label: string;
  category: string;
  value: string;
  memoryType: string;
  importance: number;
  confidence: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

type CategoryData = {
  [category: string]: MemoryItem[];
};

export function MemoryBrowserScreen() {
  const [categories, setCategories] = useState<CategoryData>({
    Personal: [],
    Family: [],
    Work: [],
    Preferences: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    Personal: true,
    Family: true,
    Work: true,
    Preferences: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(true);

  const fetchMemoryPolicy = useCallback(async () => {
    try {
      const res = await api.get('/memories/settings');
      const enabled = res.data?.data?.memory_enabled;
      if (typeof enabled === 'boolean') setMemoryEnabled(enabled);
    } catch {}
  }, []);

  const fetchMemories = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await api.get('/memories/browser');
      setCategories(res.data.data || {
        Personal: [],
        Family: [],
        Work: [],
        Preferences: [],
      });
    } catch (err) {
      console.error('Failed to fetch memories', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchMemories(); fetchMemoryPolicy(); }, [fetchMemories, fetchMemoryPolicy]);

  const handleForget = useCallback(async (memory: MemoryItem) => {
    Alert.alert(
      'Forget this memory?',
      `Nova will no longer use "${memory.label}" (${memory.value}). The history is preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/memories/${memory.id}`);
              setCategories(prev => ({
                ...prev,
                [memory.category]: prev[memory.category].filter(m => m.id !== memory.id),
              }));
            } catch (err) {
              Alert.alert('Error', 'Failed to forget memory');
            }
          }
        }
      ]
    );
  }, []);

  const handleEdit = useCallback((memory: MemoryItem) => {
    if (!memoryEnabled) {
      Alert.alert('Memory Paused', 'Editing requires memory to be enabled. Enable memory in Settings to edit memories.');
      return;
    }
    setEditingId(memory.id);
    setEditValue(memory.value);
  }, [memoryEnabled]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditValue('');
  }, []);

  const handleSaveEdit = useCallback(async (id: string) => {
    try {
      await api.patch(`/memories/${id}`, { value: editValue });
      setEditingId(null);
      setEditValue('');
      // Server-authoritative: refetch browser state instead of optimistic local patch.
      // Uses server as source of truth; works even if server normalized value or rotated id.
      await fetchMemories();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || '';
      if (msg.toLowerCase().includes('memory is paused') || msg.toLowerCase().includes('memory is paused')) {
        Alert.alert('Memory Paused', 'Editing requires memory to be enabled. Enable memory in Settings.');
      } else {
        Alert.alert('Error', 'Failed to save edit');
      }
    }
  }, [editValue, fetchMemories]);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const totalMemories = useMemo(() =>
    Object.values(categories).reduce((sum, arr) => sum + arr.length, 0),
    [categories]
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#06B6D4" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Nova's Memory</Text>
        <Text style={styles.subtitle}>{totalMemories} memories</Text>
      </View>
      {!memoryEnabled && (
        <View style={styles.pausedBanner}>
          <Text style={styles.pausedText}>Memory is paused — Nova won't save or use persistent memories while this is off. Editing is disabled.</Text>
        </View>
      )}

      <FlatList
        data={CATEGORY_ORDER}
        keyExtractor={cat => cat}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={fetchMemories} tintColor="#06B6D4" />
        }
        renderItem={({ item: category }) => {
          const memories = categories[category] || [];
          const meta = CATEGORY_META[category];
          const isExpanded = expandedCategories[category];

          if (memories.length === 0 && !isExpanded) return null;

          return (
            <View style={styles.categorySection}>
              <TouchableOpacity style={styles.categoryHeader} onPress={() => toggleCategory(category)}>
                <View style={styles.categoryHeaderLeft}>
                  <View style={[styles.categoryEmoji, { backgroundColor: `${meta.color}20` }]}>
                    <Text style={styles.emojiText}>{meta.emoji}</Text>
                  </View>
                  <View>
                    <Text style={styles.categoryTitle}>{category}</Text>
                    <Text style={styles.categoryCount}>{memories.length} memorie{memories.length !== 1 ? 's' : ''}</Text>
                  </View>
                </View>
                <Text style={[styles.chevron, { color: meta.color }]}>
                  {isExpanded ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.categoryContent}>
                  {memories.map(memory => (
                    <MemoryCard
                      key={memory.id}
                      memory={memory}
                      categoryColor={meta.color}
                      onEdit={handleEdit}
                      onForget={handleForget}
                      editingId={editingId}
                      editValue={editValue}
                      setEditValue={setEditValue}
                      onSaveEdit={handleSaveEdit}
                      onCancelEdit={handleCancelEdit}
                      memoryEnabled={memoryEnabled}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        }}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No memories yet</Text>
            <Text style={styles.emptySub}>Nova will build memories as you chat</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function MemoryCard({
  memory,
  categoryColor,
  onEdit,
  onForget,
  editingId,
  editValue,
  setEditValue,
  onSaveEdit,
  onCancelEdit,
  memoryEnabled,
}: {
  memory: MemoryItem;
  categoryColor: string;
  onEdit: (m: MemoryItem) => void;
  onForget: (m: MemoryItem) => void;
  editingId: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  memoryEnabled: boolean;
}) {
  const isEditing = editingId === memory.id;

  return (
    <View style={[styles.card, { borderColor: `${categoryColor}40` }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.typeBadge, { borderColor: categoryColor }]}>
          <Text style={[styles.typeText, { color: categoryColor }]}>
            {memory.memoryType || 'semantic'}
          </Text>
        </View>
        <Text style={styles.importance}>imp: {memory.importance}</Text>
      </View>

      <Text style={styles.labelText}>{memory.label}</Text>

      {isEditing ? (
        <View style={styles.editArea}>
          <TextInput
            style={styles.editInput}
            value={editValue}
            onChangeText={setEditValue}
            multiline
            autoFocus
            placeholder="Enter new value"
          />
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.saveBtn} onPress={() => onSaveEdit(memory.id)}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancelEdit}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.valueText}>{memory.value}</Text>
      )}

      <View style={styles.actions}>
        {!isEditing && (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: memoryEnabled ? categoryColor : '#333' }, !memoryEnabled && { opacity: 0.5 }]}
            onPress={() => onEdit(memory)}
            disabled={!memoryEnabled}
          >
            <Text style={[styles.actionText, { color: memoryEnabled ? categoryColor : '#666' }]}>✏️ Edit</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.actionBtn} onPress={() => onForget(memory)}>
          <Text style={styles.forgetText}>🗑 Forget</Text>
        </TouchableOpacity>
      </View>
      {!memoryEnabled && !isEditing && (
        <Text style={styles.pausedNote}>Editing requires memory to be enabled</Text>
      )}

      <Text style={styles.updatedText}>Updated {formatRelativeTime(memory.updatedAt)}</Text>
    </View>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 2 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  categorySection: { marginBottom: 16 },
  categoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  categoryHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  categoryEmoji: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  emojiText: { fontSize: 18 },
  categoryTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  categoryCount: { fontSize: 12, color: '#666' },
  chevron: { fontSize: 14, fontWeight: 'bold' },
  categoryContent: { paddingTop: 4 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  typeBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3 },
  typeText: { fontSize: 11, fontWeight: '600' },
  importance: { fontSize: 11, color: '#555' },
  labelText: { fontSize: 16, fontWeight: '700', color: '#06B6D4', marginBottom: 6 },
  valueText: { fontSize: 15, color: '#ddd', lineHeight: 22, marginBottom: 12 },
  editArea: { marginBottom: 10 },
  editInput: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#06B6D4',
    marginBottom: 10,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', gap: 8 },
  saveBtn: { backgroundColor: '#06B6D4', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  cancelBtn: { borderWidth: 1, borderColor: '#555', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 8 },
  cancelBtnText: { color: '#888', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  actionBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  actionText: { color: '#aaa', fontSize: 13 },
  forgetText: { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  updatedText: { fontSize: 11, color: '#444' },
  pausedBanner: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.3)', borderRadius: 8, padding: 12, marginHorizontal: 16, marginBottom: 12 },
  pausedText: { fontSize: 13, color: '#F59E0B', lineHeight: 18 },
  pausedNote: { fontSize: 11, color: '#F59E0B', marginTop: 6, fontStyle: 'italic' },
  emptyContainer: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontSize: 18, fontWeight: '600', color: '#555', marginBottom: 4 },
  emptySub: { fontSize: 14, color: '#333' },
});