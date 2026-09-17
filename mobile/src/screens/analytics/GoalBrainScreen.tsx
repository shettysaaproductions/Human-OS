import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, RefreshControl, Modal, TextInput,
  Alert, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../../services/api';
import { BrainHeader } from '../../components/BrainHeader';
import { ReminderBrainScreen } from './ReminderBrainScreen';

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

const CATEGORY_PRESETS = ['Goals', 'Career', 'Fitness', 'Learning', 'Finance', 'Personal'];

export const GoalBrainScreen = React.memo(function GoalBrainScreen() {
  const navigation = useNavigation<any>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [viewMode, setViewMode] = useState<'goals' | 'reminders'>('goals');

  // Detail & Edit Modal State
  const [selectedGoal, setSelectedGoal] = useState<any | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editCategory, setEditCategory] = useState('Goals');
  const [editDeadline, setEditDeadline] = useState('');
  const [editProgress, setEditProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  // New Goal Modal State
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('Goals');
  const [newDeadline, setNewDeadline] = useState('');
  const [newProgress, setNewProgress] = useState(0);
  const [creating, setCreating] = useState(false);

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

  const allGoals: any[] = useMemo(() => {
    const raw = (data?.activeGoals || []).concat(data?.completedGoals || []);
    const dedupMap = new Map<string, any>();
    for (const g of raw) {
      if (!g || !g.id) continue;
      dedupMap.set(g.id, g);
    }
    return Array.from(dedupMap.values());
  }, [data]);

  const activeGoals = useMemo(() => allGoals.filter(g => {
    const st = g.attributes?.status || g.status;
    return st !== 'completed' && st !== 'done';
  }), [allGoals]);

  const completedGoals = useMemo(() => allGoals.filter(g => {
    const st = g.attributes?.status || g.status;
    return st === 'completed' || st === 'done';
  }), [allGoals]);

  const displayGoals = tab === 'active' ? activeGoals : completedGoals;

  const overallProgress = useMemo(() => {
    if (activeGoals.length === 0) return 0;
    const total = activeGoals.reduce((sum, g) => sum + (g.attributes?.progress ?? g.progress ?? 0), 0);
    return total / activeGoals.length;
  }, [activeGoals]);

  const handleOpenGoalDetail = (goal: any) => {
    setSelectedGoal(goal);
    setIsEditing(false);
    setEditTitle(goal.name || goal.title || '');
    setEditDesc(goal.attributes?.description || goal.description || '');
    setEditCategory(goal.category || goal.attributes?.category || 'Goals');
    setEditDeadline(goal.attributes?.deadline || goal.targetDate || goal.deadline || '');
    setEditProgress(goal.attributes?.progress ?? goal.progress ?? 0);
  };

  const handleAdjustProgress = async (newVal: number) => {
    if (!selectedGoal) return;
    const clamped = Math.min(100, Math.max(0, newVal));
    setEditProgress(clamped);
    const newStatus = clamped >= 100 ? 'completed' : 'active';
    try {
      await api.put(`/analytics/goals/${selectedGoal.id}`, {
        progress: clamped,
        status: newStatus
      });
      setSelectedGoal((prev: any) => prev ? {
        ...prev,
        progress: clamped,
        status: newStatus,
        attributes: { ...(prev.attributes || {}), progress: clamped, status: newStatus }
      } : null);
      fetchGoals();
    } catch (err: any) {
      console.warn('Failed to update goal progress', err);
    }
  };

  const handleSaveGoalEdit = async () => {
    if (!selectedGoal || !editTitle.trim()) {
      Alert.alert('Validation Error', 'Goal title is required.');
      return;
    }
    try {
      setSaving(true);
      await api.put(`/analytics/goals/${selectedGoal.id}`, {
        title: editTitle.trim(),
        description: editDesc.trim(),
        category: editCategory.trim(),
        target_date: editDeadline.trim() || null,
        progress: editProgress
      });
      setIsEditing(false);
      setSelectedGoal((prev: any) => prev ? {
        ...prev,
        name: editTitle.trim(),
        title: editTitle.trim(),
        description: editDesc.trim(),
        category: editCategory.trim(),
        targetDate: editDeadline.trim() || null,
        progress: editProgress,
        attributes: {
          ...(prev.attributes || {}),
          name: editTitle.trim(),
          description: editDesc.trim(),
          category: editCategory.trim(),
          deadline: editDeadline.trim() || null,
          progress: editProgress
        }
      } : null);
      fetchGoals();
      Alert.alert('Success', 'Goal updated successfully.');
    } catch (err: any) {
      Alert.alert('Update Failed', err.response?.data?.error || err.message || 'Could not update goal.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleComplete = async () => {
    if (!selectedGoal) return;
    const currentStatus = selectedGoal.attributes?.status || selectedGoal.status;
    const isNowComplete = currentStatus !== 'completed' && currentStatus !== 'done';
    const newStatus = isNowComplete ? 'completed' : 'active';
    const newProg = isNowComplete ? 100 : (selectedGoal.progress >= 100 ? 50 : selectedGoal.progress);

    try {
      await api.put(`/analytics/goals/${selectedGoal.id}`, {
        title: selectedGoal.name || selectedGoal.title,
        status: newStatus,
        progress: newProg
      });
      setSelectedGoal((prev: any) => prev ? {
        ...prev,
        status: newStatus,
        progress: newProg,
        attributes: { ...(prev.attributes || {}), status: newStatus, progress: newProg }
      } : null);
      fetchGoals();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Could not update goal status.');
    }
  };

  const handleDeleteGoal = () => {
    if (!selectedGoal) return;
    const targetTitle = selectedGoal.name || selectedGoal.title || '';
    const goalId = selectedGoal.id;

    Alert.alert(
      'Delete Goal',
      `Are you sure you want to delete "${targetTitle}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Optimistic UI update immediately so user never sees orphaned item
              setData((prev: any) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  activeGoals: (prev.activeGoals || []).filter((g: any) => g.id !== goalId),
                  completedGoals: (prev.completedGoals || []).filter((g: any) => g.id !== goalId)
                };
              });
              setSelectedGoal(null);

              await api.delete(`/analytics/goals/${goalId}`, {
                params: { title: targetTitle }
              });

              fetchGoals();
            } catch (err: any) {
              Alert.alert('Delete Failed', err.response?.data?.error || 'Could not delete goal.');
              fetchGoals();
            }
          }
        }
      ]
    );
  };

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) {
      Alert.alert('Validation Error', 'Goal title is required.');
      return;
    }
    try {
      setCreating(true);
      await api.post('/analytics/goals', {
        title: newTitle.trim(),
        description: newDesc.trim(),
        category: newCategory.trim() || 'Goals',
        target_date: newDeadline.trim() || null,
        progress: newProgress
      });
      setCreateModalVisible(false);
      setNewTitle('');
      setNewDesc('');
      setNewDeadline('');
      setNewProgress(0);
      fetchGoals();
    } catch (err: any) {
      Alert.alert('Creation Failed', err.response?.data?.error || err.message || 'Could not create goal.');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !data) {
    return <View style={gr.center}><ActivityIndicator size="large" color="#10B981" /></View>;
  }

  return (
    <SafeAreaView style={gr.container} edges={['top']}>
      <BrainHeader
        title={viewMode === 'goals' ? 'Goals & Milestones' : 'Nova Reminders'}
        subtitle={viewMode === 'goals' ? `${activeGoals.length} active · ${completedGoals.length} completed` : 'Manage all alarms & recurring schedules'}
        icon={viewMode === 'goals' ? '🎯' : '⏰'}
        onRefresh={handleRefresh}
        isRefreshing={refreshing}
      />

      {/* Top Mode Switcher: Goals vs Reminders */}
      <View style={gr.modeSwitcherRow}>
        <TouchableOpacity
          style={[gr.modeBtn, viewMode === 'goals' && gr.modeBtnActiveGoal]}
          onPress={() => setViewMode('goals')}
        >
          <Text style={[gr.modeBtnText, viewMode === 'goals' && gr.modeBtnTextActiveGoal]}>🎯 Goals & Ambitions</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[gr.modeBtn, viewMode === 'reminders' && gr.modeBtnActiveReminder]}
          onPress={() => setViewMode('reminders')}
        >
          <Text style={[gr.modeBtnText, viewMode === 'reminders' && gr.modeBtnTextActiveReminder]}>⏰ Reminders Hub</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'reminders' ? (
        <ReminderBrainScreen embedded={true} />
      ) : (
        <>
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

          {/* Tabs + '+ New Goal' action */}
          <View style={gr.tabRow}>
            <TouchableOpacity style={[gr.tab, tab === 'active' && gr.tabActive]} onPress={() => setTab('active')}>
              <Text style={[gr.tabText, tab === 'active' && gr.tabTextActive]}>Active ({activeGoals.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[gr.tab, tab === 'completed' && gr.tabActive]} onPress={() => setTab('completed')}>
              <Text style={[gr.tabText, tab === 'completed' && gr.tabTextActive]}>Completed ({completedGoals.length})</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={gr.addGoalHeaderBtn}
              onPress={() => setCreateModalVisible(true)}
              activeOpacity={0.8}
            >
              <Text style={gr.addGoalHeaderBtnText}>＋ New Goal</Text>
            </TouchableOpacity>
          </View>

          {/* Goal List */}
          <FlatList
            data={displayGoals}
            keyExtractor={(item) => item.id}
            removeClippedSubviews
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#10B981" />}
            renderItem={({ item }) => {
              const goalName = item.name || item.title || 'Milestone';
              const goalDesc = item.attributes?.description || item.description || '';
              const progress = item.attributes?.progress ?? item.progress ?? 35;
              const deadline = item.attributes?.deadline || item.targetDate || item.deadline;
              const st = item.attributes?.status || item.status;
              const isCompleted = st === 'completed' || st === 'done';
              const isReminder = item.source === 'reminder' || item.entity_type === 'reminder_goal' || item.id?.startsWith('reminder-');
              const color = isCompleted ? '#A78BFA' : (isReminder ? '#38BDF8' : '#10B981');
              return (
                <TouchableOpacity
                  style={gr.goalCard}
                  activeOpacity={0.7}
                  onPress={() => handleOpenGoalDetail(item)}
                >
                  <View style={gr.goalHeader}>
                    <Text style={gr.starIcon}>{isCompleted ? '⭐' : (isReminder ? '⏰' : '🌟')}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <Text style={[gr.goalName, { color }]}>{goalName}</Text>
                        {isReminder && (
                          <View style={{ backgroundColor: 'rgba(56,189,248,0.15)', borderColor: '#38BDF8', borderWidth: 0.8, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ color: '#38BDF8', fontSize: 9, fontWeight: '700' }}>REMINDER</Text>
                          </View>
                        )}
                        {item.category && item.category !== 'Goals' && (
                          <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ color: '#A1A1AA', fontSize: 10 }}>{item.category}</Text>
                          </View>
                        )}
                      </View>
                      {goalDesc ? (
                        <Text style={gr.goalDesc} numberOfLines={2}>{goalDesc}</Text>
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
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {(item.created_at || item.createdAt) ? (
                        <Text style={gr.addedDate}>{formatGoalCreated(item.created_at || item.createdAt)}</Text>
                      ) : null}
                      <Text style={{ color: '#71717A', fontSize: 12 }}>Tap for details ›</Text>
                    </View>
                  </View>
                </TouchableOpacity>
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
                    ? 'Whether fitness targets, career promotions, creative projects, or daily routines — Nova tracks progress automatically from your chats, or you can add one manually!'
                    : 'Keep conversing with Nova as you hit milestones. Completed achievements will shine here!'}
                </Text>

                <TouchableOpacity
                  style={gr.lifestyleChatBtn}
                  onPress={() => setCreateModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <Text style={gr.lifestyleChatBtnText}>＋ Create a New Goal</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </>
      )}

      {/* ── GOAL DETAIL & EDIT MODAL ── */}
      <Modal
        visible={!!selectedGoal}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedGoal(null)}
      >
        <View style={gr.modalOverlay}>
          <View style={gr.modalContent}>
            <View style={gr.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={gr.modalHeaderTag}>
                  {selectedGoal?.category || 'Goal Details'}
                </Text>
                <Text style={gr.modalHeaderTitle} numberOfLines={1}>
                  {selectedGoal?.name || selectedGoal?.title}
                </Text>
              </View>
              <TouchableOpacity
                style={gr.modalCloseBtn}
                onPress={() => setSelectedGoal(null)}
              >
                <Text style={gr.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              {!isEditing ? (
                <>
                  {/* Progress Header Box */}
                  <View style={gr.detailProgressBox}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <Text style={gr.progressSectionLabel}>Current Progress</Text>
                      <Text style={gr.progressPercentLarge}>{Math.round(editProgress)}%</Text>
                    </View>
                    <View style={gr.progressTrackModal}>
                      <View style={[gr.progressFill, { width: `${Math.min(100, Math.max(0, editProgress))}%`, backgroundColor: '#10B981' }]} />
                    </View>

                    {/* Quick Adjust Buttons */}
                    <View style={gr.quickAdjustRow}>
                      <TouchableOpacity style={gr.adjustChip} onPress={() => handleAdjustProgress(editProgress - 10)}>
                        <Text style={gr.adjustChipText}>-10%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={gr.adjustChip} onPress={() => handleAdjustProgress(editProgress + 10)}>
                        <Text style={gr.adjustChipText}>+10%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={gr.adjustChip} onPress={() => handleAdjustProgress(editProgress + 25)}>
                        <Text style={gr.adjustChipText}>+25%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={gr.adjustChip} onPress={() => handleAdjustProgress(50)}>
                        <Text style={gr.adjustChipText}>50%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[gr.adjustChip, { backgroundColor: 'rgba(16,185,129,0.2)' }]} onPress={() => handleAdjustProgress(100)}>
                        <Text style={[gr.adjustChipText, { color: '#10B981' }]}>100% (Done)</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Goal Metadata */}
                  <View style={gr.infoSection}>
                    <Text style={gr.infoLabel}>Description</Text>
                    <Text style={gr.infoValue}>
                      {selectedGoal?.attributes?.description || selectedGoal?.description || 'No description provided.'}
                    </Text>

                    {selectedGoal?.attributes?.deadline || selectedGoal?.targetDate ? (
                      <View style={{ marginTop: 12 }}>
                        <Text style={gr.infoLabel}>Target Date</Text>
                        <Text style={[gr.infoValue, { color: '#F59E0B' }]}>
                          📅 {formatGoalDeadline(selectedGoal?.attributes?.deadline || selectedGoal?.targetDate)}
                        </Text>
                      </View>
                    ) : null}

                    {selectedGoal?.created_at || selectedGoal?.createdAt ? (
                      <View style={{ marginTop: 12 }}>
                        <Text style={gr.infoLabel}>Created</Text>
                        <Text style={gr.infoValue}>
                          {formatGoalCreated(selectedGoal?.created_at || selectedGoal?.createdAt)}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Actions Row */}
                  <View style={gr.actionsGrid}>
                    <TouchableOpacity
                      style={gr.actionEditBtn}
                      onPress={() => setIsEditing(true)}
                    >
                      <Text style={gr.actionBtnText}>✏️ Edit Goal</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[gr.actionCompleteBtn, (selectedGoal?.attributes?.status === 'completed' || selectedGoal?.status === 'completed') && { backgroundColor: '#4C1D95' }]}
                      onPress={handleToggleComplete}
                    >
                      <Text style={gr.actionBtnText}>
                        {(selectedGoal?.attributes?.status === 'completed' || selectedGoal?.status === 'completed')
                          ? '↺ Reopen Goal'
                          : '✓ Mark Complete'}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={gr.actionDeleteBtn}
                      onPress={handleDeleteGoal}
                    >
                      <Text style={[gr.actionBtnText, { color: '#EF4444' }]}>🗑️ Delete</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                /* Inline Edit Form */
                <View style={gr.editForm}>
                  <Text style={gr.fieldLabel}>Goal Title *</Text>
                  <TextInput
                    style={gr.input}
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="e.g. Master React Native Architecture"
                    placeholderTextColor="#52525B"
                  />

                  <Text style={gr.fieldLabel}>Description</Text>
                  <TextInput
                    style={[gr.input, { height: 75, textAlignVertical: 'top' }]}
                    value={editDesc}
                    onChangeText={setEditDesc}
                    placeholder="Why this goal matters and key milestones..."
                    placeholderTextColor="#52525B"
                    multiline
                  />

                  <Text style={gr.fieldLabel}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                    {CATEGORY_PRESETS.map((cat) => (
                      <TouchableOpacity
                        key={cat}
                        style={[gr.categoryChip, editCategory === cat && gr.categoryChipActive]}
                        onPress={() => setEditCategory(cat)}
                      >
                        <Text style={[gr.categoryChipText, editCategory === cat && gr.categoryChipTextActive]}>
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  <Text style={gr.fieldLabel}>Target Date (YYYY-MM-DD)</Text>
                  <TextInput
                    style={gr.input}
                    value={editDeadline}
                    onChangeText={setEditDeadline}
                    placeholder="e.g. 2026-12-31"
                    placeholderTextColor="#52525B"
                  />

                  <Text style={gr.fieldLabel}>Progress ({Math.round(editProgress)}%)</Text>
                  <View style={gr.quickAdjustRow}>
                    <TouchableOpacity style={gr.adjustChip} onPress={() => setEditProgress(Math.max(0, editProgress - 10))}>
                      <Text style={gr.adjustChipText}>-10%</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={gr.adjustChip} onPress={() => setEditProgress(Math.min(100, editProgress + 10))}>
                      <Text style={gr.adjustChipText}>+10%</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={gr.adjustChip} onPress={() => setEditProgress(50)}>
                      <Text style={gr.adjustChipText}>50%</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={gr.adjustChip} onPress={() => setEditProgress(100)}>
                      <Text style={gr.adjustChipText}>100%</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                    <TouchableOpacity
                      style={gr.cancelBtn}
                      onPress={() => setIsEditing(false)}
                    >
                      <Text style={gr.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={gr.saveBtn}
                      onPress={handleSaveGoalEdit}
                      disabled={saving}
                    >
                      <Text style={gr.saveBtnText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── CREATE NEW GOAL MODAL ── */}
      <Modal
        visible={createModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateModalVisible(false)}
      >
        <View style={gr.modalOverlay}>
          <View style={gr.modalContent}>
            <View style={gr.modalHeader}>
              <View>
                <Text style={gr.modalHeaderTag}>New Ambition</Text>
                <Text style={gr.modalHeaderTitle}>＋ Create a Goal</Text>
              </View>
              <TouchableOpacity
                style={gr.modalCloseBtn}
                onPress={() => setCreateModalVisible(false)}
              >
                <Text style={gr.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={gr.fieldLabel}>Goal Title *</Text>
              <TextInput
                style={gr.input}
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="e.g. Run 5km 3x a week, Buy First Home"
                placeholderTextColor="#52525B"
              />

              <Text style={gr.fieldLabel}>Description / Milestones</Text>
              <TextInput
                style={[gr.input, { height: 75, textAlignVertical: 'top' }]}
                value={newDesc}
                onChangeText={setNewDesc}
                placeholder="What does success look like?"
                placeholderTextColor="#52525B"
                multiline
              />

              <Text style={gr.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {CATEGORY_PRESETS.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[gr.categoryChip, newCategory === cat && gr.categoryChipActive]}
                    onPress={() => setNewCategory(cat)}
                  >
                    <Text style={[gr.categoryChipText, newCategory === cat && gr.categoryChipTextActive]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={gr.fieldLabel}>Target Date (YYYY-MM-DD or Month)</Text>
              <TextInput
                style={gr.input}
                value={newDeadline}
                onChangeText={setNewDeadline}
                placeholder="e.g. 2026-11-30"
                placeholderTextColor="#52525B"
              />

              <Text style={gr.fieldLabel}>Initial Progress ({newProgress}%)</Text>
              <View style={gr.quickAdjustRow}>
                <TouchableOpacity style={gr.adjustChip} onPress={() => setNewProgress(0)}>
                  <Text style={gr.adjustChipText}>0%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={gr.adjustChip} onPress={() => setNewProgress(25)}>
                  <Text style={gr.adjustChipText}>25%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={gr.adjustChip} onPress={() => setNewProgress(50)}>
                  <Text style={gr.adjustChipText}>50%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={gr.adjustChip} onPress={() => setNewProgress(75)}>
                  <Text style={gr.adjustChipText}>75%</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[gr.saveBtn, { marginTop: 24 }]}
                onPress={handleCreateGoal}
                disabled={creating}
              >
                <Text style={gr.saveBtnText}>{creating ? 'Creating Goal...' : '✓ Create Goal'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
});

const gr = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  modeSwitcherRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    gap: 8,
    backgroundColor: '#18181B',
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActiveGoal: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  modeBtnActiveReminder: {
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  modeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#71717A',
  },
  modeBtnTextActiveGoal: {
    color: '#10B981',
    fontWeight: '700',
  },
  modeBtnTextActiveReminder: {
    color: '#818CF8',
    fontWeight: '700',
  },
  statsRow: { flexDirection: 'row', marginHorizontal: 12, marginTop: 14, marginBottom: 14, gap: 8 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center'
  },
  statNum: { fontSize: 22, fontWeight: 'bold' },
  statLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  tabRow: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14, gap: 8, alignItems: 'center' },
  tab: {
    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  tabActive: { backgroundColor: 'rgba(16,185,129,0.15)', borderColor: '#10B981' },
  tabText: { color: '#888', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#10B981' },
  addGoalHeaderBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addGoalHeaderBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 12,
  },
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

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#18181B',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  modalHeaderTag: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  modalHeaderTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#A1A1AA',
    fontSize: 16,
    fontWeight: '700',
  },
  detailProgressBox: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    marginBottom: 16,
  },
  progressSectionLabel: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
  },
  progressPercentLarge: {
    color: '#10B981',
    fontSize: 18,
    fontWeight: '800',
  },
  progressTrackModal: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  quickAdjustRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  adjustChip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  adjustChipText: {
    color: '#E4E4E7',
    fontSize: 11,
    fontWeight: '700',
  },
  infoSection: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    marginBottom: 18,
  },
  infoLabel: {
    color: '#71717A',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: '#F4F4F5',
    fontSize: 14,
    lineHeight: 20,
  },
  actionsGrid: {
    gap: 10,
  },
  actionEditBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionCompleteBtn: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionDeleteBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#FAFAFA',
    fontSize: 13,
    fontWeight: '700',
  },

  // Form Fields
  editForm: {
    gap: 10,
  },
  fieldLabel: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  input: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FAFAFA',
    fontSize: 14,
    marginBottom: 6,
  },
  categoryChip: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
  },
  categoryChipActive: {
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderColor: '#10B981',
  },
  categoryChipText: {
    color: '#71717A',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#10B981',
    fontWeight: '700',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#A1A1AA',
    fontSize: 13,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#000',
    fontSize: 13,
    fontWeight: '700',
  },

  // Empty state
  lifestyleCard: {
    backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderRadius: 16, padding: 20, alignItems: 'center', marginTop: 10
  },
  lifestyleIconWrap: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(16,185,129,0.15)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 14
  },
  lifestyleEmoji: { fontSize: 28 },
  lifestyleTitle: { fontSize: 17, fontWeight: 'bold', color: '#fff', marginBottom: 8, textAlign: 'center' },
  lifestyleSubtitle: { fontSize: 13, color: '#888', textAlign: 'center', lineHeight: 18, marginBottom: 16 },
  lifestyleChatBtn: {
    backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20,
    alignItems: 'center', width: '100%'
  },
  lifestyleChatBtnText: { color: '#000', fontWeight: 'bold', fontSize: 14 },
});
