import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, TextInput, Alert, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';

type Memory = {
  id: string;
  key: string;
  value: string;
  memory_type: string;
  importance: number;
  confidence: number;
  frequency: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export function MemoryManagementScreen() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const fetchMemories = useCallback(async () => {
    try {
      setRefreshing(true);
      const params: any = { limit: 100, archived: showArchived ? 'true' : 'false' };
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await api.get('/memories', { params });
      setMemories(res.data.data || []);
    } catch (err) {
      console.error('Failed to fetch memories', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, showArchived]);

  useEffect(() => { fetchMemories(); }, [showArchived]);

  const handleSearch = useCallback(() => { fetchMemories(); }, [fetchMemories]);

  const handleDelete = useCallback((id: string, key: string) => {
    Alert.alert(
      'Delete Memory',
      `Delete "${key}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/memories/${id}`);
              setMemories(prev => prev.filter(m => m.id !== id));
            } catch (err) {
              Alert.alert('Error', 'Failed to delete memory');
            }
          }
        }
      ]
    );
  }, []);

  const handleArchive = useCallback(async (id: string, isArchived: boolean) => {
    try {
      await api.patch(`/memories/${id}/archive`, { archived: !isArchived });
      setMemories(prev => prev.map(m => m.id === id ? { ...m, is_archived: !isArchived } : m));
    } catch (err) {
      Alert.alert('Error', 'Failed to archive memory');
    }
  }, []);

  const handleEdit = useCallback((memory: Memory) => {
    setEditingId(memory.id);
    setEditValue(memory.value);
  }, []);

  const handleSaveEdit = useCallback(async (id: string) => {
    try {
      await api.patch(`/memories/${id}`, { value: editValue });
      setMemories(prev => prev.map(m => m.id === id ? { ...m, value: editValue } : m));
      setEditingId(null);
    } catch (err) {
      Alert.alert('Error', 'Failed to save edit');
    }
  }, [editValue]);

  const filteredMemories = useMemo(() => {
    if (!searchQuery.trim()) return memories;
    const q = searchQuery.toLowerCase();
    return memories.filter(m => m.key.toLowerCase().includes(q) || m.value.toLowerCase().includes(q));
  }, [memories, searchQuery]);

  if (loading) {
    return <View style={ms.center}><ActivityIndicator size="large" color="#06B6D4" /></View>;
  }

  return (
    <SafeAreaView style={ms.container} edges={['top']}>
      <View style={ms.header}>
        <Text style={ms.title}>My Memories</Text>
        <TouchableOpacity
          style={[ms.archiveToggle, showArchived && ms.archiveToggleActive]}
          onPress={() => setShowArchived(v => !v)}
        >
          <Text style={[ms.archiveToggleText, showArchived && ms.archiveToggleTextActive]}>
            {showArchived ? '📦 Archived' : 'Active'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={ms.searchRow}>
        <View style={ms.searchBar}>
          <Text>🔍 </Text>
          <TextInput
            style={ms.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            placeholder="Search memories..."
            placeholderTextColor="#555"
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => { setSearchQuery(''); fetchMemories(); }}>
              <Text style={ms.clearBtn}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <Text style={ms.countText}>{filteredMemories.length} memories</Text>

      <FlatList
        data={filteredMemories}
        keyExtractor={(item) => item.id}
        removeClippedSubviews
        windowSize={10}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchMemories} tintColor="#06B6D4" />}
        renderItem={({ item }) => {
          const isEditing = editingId === item.id;
          return (
            <View style={ms.card}>
              <View style={ms.cardTop}>
                <View style={ms.typeBadge}>
                  <Text style={ms.typeText}>{item.memory_type || 'unknown'}</Text>
                </View>
                <Text style={ms.importance}>imp: {item.importance}</Text>
              </View>

              <Text style={ms.keyText}>{item.key}</Text>

              {isEditing ? (
                <View style={ms.editArea}>
                  <TextInput
                    style={ms.editInput}
                    value={editValue}
                    onChangeText={setEditValue}
                    multiline
                    autoFocus
                  />
                  <View style={ms.editActions}>
                    <TouchableOpacity style={ms.saveBtn} onPress={() => handleSaveEdit(item.id)}>
                      <Text style={ms.saveBtnText}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={ms.cancelBtn} onPress={() => setEditingId(null)}>
                      <Text style={ms.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={ms.valueText}>{item.value}</Text>
              )}

              <View style={ms.actions}>
                {!isEditing && (
                  <TouchableOpacity style={ms.actionBtn} onPress={() => handleEdit(item)}>
                    <Text style={ms.actionText}>✏️ Edit</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={ms.actionBtn} onPress={() => handleArchive(item.id, item.is_archived)}>
                  <Text style={ms.actionText}>{item.is_archived ? '📤 Unarchive' : '📦 Archive'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[ms.actionBtn, ms.deleteBtn]} onPress={() => handleDelete(item.id, item.key)}>
                  <Text style={ms.deleteText}>🗑 Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        contentContainerStyle={ms.listContent}
        ListEmptyComponent={<Text style={ms.emptyText}>No memories found.</Text>}
      />
    </SafeAreaView>
  );
}

const ms = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 8, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  archiveToggle: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5
  },
  archiveToggleActive: { borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.1)' },
  archiveToggleText: { color: '#888', fontSize: 12 },
  archiveToggleTextActive: { color: '#F59E0B' },
  searchRow: { marginHorizontal: 16, marginBottom: 8 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, paddingHorizontal: 12
  },
  searchInput: { flex: 1, color: '#fff', paddingVertical: 10, fontSize: 15 },
  clearBtn: { color: '#666', fontSize: 18 },
  countText: { fontSize: 12, color: '#555', marginHorizontal: 16, marginBottom: 8 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  typeBadge: { backgroundColor: 'rgba(6,182,212,0.1)', borderColor: '#06B6D4', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  typeText: { fontSize: 11, color: '#06B6D4', fontWeight: '600' },
  importance: { fontSize: 11, color: '#555' },
  keyText: { fontSize: 13, fontWeight: '700', color: '#06B6D4', marginBottom: 6 },
  valueText: { fontSize: 14, color: '#ccc', lineHeight: 20, marginBottom: 12 },
  editArea: { marginBottom: 10 },
  editInput: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 10,
    color: '#fff', fontSize: 14, borderWidth: 1, borderColor: '#06B6D4', marginBottom: 8
  },
  editActions: { flexDirection: 'row', gap: 8 },
  saveBtn: { backgroundColor: '#06B6D4', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 },
  saveBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  cancelBtn: { borderWidth: 1, borderColor: '#555', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 },
  cancelBtnText: { color: '#888', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionBtn: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5 },
  actionText: { color: '#aaa', fontSize: 12 },
  deleteBtn: { borderColor: 'rgba(239,68,68,0.3)' },
  deleteText: { color: '#EF4444', fontSize: 12 },
  emptyText: { color: '#555', textAlign: 'center', marginTop: 48, fontSize: 15 },
});
