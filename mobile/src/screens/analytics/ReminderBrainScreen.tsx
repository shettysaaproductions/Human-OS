import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, RefreshControl, Modal, TextInput,
  ScrollView, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api';
import { BrainHeader } from '../../components/BrainHeader';

export interface ReminderItem {
  id: string;
  user_id: string;
  text: string;
  trigger_at: string | null;
  recurrence_type?: string | null;
  recurrence_interval?: number | null;
  recurrence_count?: number;
  recurrence_limit?: number | null;
  active_days?: string[] | null;
  active_months?: string[] | null;
  status: 'active' | 'completed' | 'cancelled' | 'expired' | 'paused';
  urgency?: 'low' | 'medium' | 'high';
  accountability_status?: 'pending' | 'reminded' | 'completed_confirmed' | 'missed';
  batch_group_id?: string | null;
  notes?: string | null;
  created_at: string;
}

const DAY_OPTIONS = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

const MONTH_OPTIONS = [
  { key: 'january', label: 'Jan' },
  { key: 'february', label: 'Feb' },
  { key: 'march', label: 'Mar' },
  { key: 'april', label: 'Apr' },
  { key: 'may', label: 'May' },
  { key: 'june', label: 'Jun' },
  { key: 'july', label: 'Jul' },
  { key: 'august', label: 'Aug' },
  { key: 'september', label: 'Sep' },
  { key: 'october', label: 'Oct' },
  { key: 'november', label: 'Nov' },
  { key: 'december', label: 'Dec' },
];

function getReminderDomainIcon(text: string): string {
  const lower = (text || '').toLowerCase();
  if (/workout|gym|exercise|fitness|run|walk|cardio|pushup/i.test(lower)) return '🏋️';
  if (/water|paani|drink|hydrate/i.test(lower)) return '💧';
  if (/bill|pay|bank|pf|money|tax|rent|salary/i.test(lower)) return '💳';
  if (/medicine|tablet|pill|dawa|doctor|hospital/i.test(lower)) return '💊';
  if (/read|book|study|class|exam|course/i.test(lower)) return '📚';
  if (/call|meet|talk|phone|dost|friend/i.test(lower)) return '📞';
  return '⏰';
}

function formatTriggerTime(triggerAtStr: string | null): string {
  if (!triggerAtStr) return 'Event Triggered';
  const d = new Date(triggerAtStr);
  if (isNaN(d.getTime())) return triggerAtStr;

  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();

  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const timePart = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  if (isToday) return `Today at ${timePart}`;
  if (isTomorrow) return `Tomorrow at ${timePart}`;
  return `${d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} at ${timePart}`;
}

export const ReminderBrainScreen = React.memo(function ReminderBrainScreen({
  embedded = false,
  onBack
}: {
  embedded?: boolean;
  onBack?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [tab, setTab] = useState<'all' | 'active' | 'recurring' | 'completed'>('active');

  // Edit / Create Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [editingReminder, setEditingReminder] = useState<ReminderItem | null>(null);
  const [formText, setFormText] = useState('');
  const [formHour, setFormHour] = useState('08');
  const [formMinute, setFormMinute] = useState('00');
  const [formAmPm, setFormAmPm] = useState<'AM' | 'PM'>('AM');
  const [formRecurrence, setFormRecurrence] = useState<'none' | 'daily' | 'specific_days' | 'monthly' | 'batch'>('none');
  const [formActiveDays, setFormActiveDays] = useState<string[]>(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
  const [formExcludedMonths, setFormExcludedMonths] = useState<string[]>([]);
  const [formBatchCount, setFormBatchCount] = useState('4');
  const [formBatchInterval, setFormBatchInterval] = useState('15');
  const [formUrgency, setFormUrgency] = useState<'low' | 'medium' | 'high'>('medium');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReminders();
  }, []);

  const fetchReminders = async () => {
    try {
      setLoading(true);
      const res = await api.get('/reminders?status=all');
      if (res.data?.reminders) {
        setReminders(res.data.reminders);
      }
    } catch (err) {
      console.error('Failed to fetch reminders', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchReminders();
  }, []);

  const activeReminders = useMemo(() => reminders.filter(r => r.status === 'active'), [reminders]);
  const recurringReminders = useMemo(() => reminders.filter(r => r.status === 'active' && !!r.recurrence_type), [reminders]);
  const completedReminders = useMemo(() => reminders.filter(r => r.status === 'completed'), [reminders]);

  const displayedReminders = useMemo(() => {
    if (tab === 'active') return activeReminders;
    if (tab === 'recurring') return recurringReminders;
    if (tab === 'completed') return completedReminders;
    return reminders;
  }, [tab, reminders, activeReminders, recurringReminders, completedReminders]);

  const openCreateModal = () => {
    setEditingReminder(null);
    setFormText('');
    setFormHour('08');
    setFormMinute('00');
    setFormAmPm('AM');
    setFormRecurrence('none');
    setFormActiveDays(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']);
    setFormExcludedMonths([]);
    setFormBatchCount('4');
    setFormBatchInterval('15');
    setFormUrgency('medium');
    setModalVisible(true);
  };

  const openEditModal = (r: ReminderItem) => {
    setEditingReminder(r);
    setFormText(r.text);
    if (r.trigger_at) {
      const d = new Date(r.trigger_at);
      let h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      setFormHour(String(h).padStart(2, '0'));
      setFormMinute(String(m).padStart(2, '0'));
      setFormAmPm(ampm);
    }
    if (r.recurrence_type === 'days' && r.active_days && r.active_days.length < 7) {
      setFormRecurrence('specific_days');
      setFormActiveDays(r.active_days.map(d => d.toLowerCase()));
    } else if (r.recurrence_type === 'days' || r.recurrence_type === 'daily') {
      setFormRecurrence('daily');
    } else if (r.recurrence_type === 'months') {
      setFormRecurrence('monthly');
      if (r.active_months) {
        const excl = MONTH_OPTIONS.map(m => m.key).filter(k => !r.active_months?.includes(k));
        setFormExcludedMonths(excl);
      }
    } else {
      setFormRecurrence('none');
    }
    setFormUrgency(r.urgency || 'medium');
    setModalVisible(true);
  };

  const toggleDay = (key: string) => {
    if (formActiveDays.includes(key)) {
      if (formActiveDays.length === 1) return; // keep at least 1 day
      setFormActiveDays(formActiveDays.filter(d => d !== key));
    } else {
      setFormActiveDays([...formActiveDays, key]);
    }
  };

  const toggleMonthExclusion = (key: string) => {
    if (formExcludedMonths.includes(key)) {
      setFormExcludedMonths(formExcludedMonths.filter(m => m !== key));
    } else {
      if (formExcludedMonths.length >= 11) return; // don't exclude all
      setFormExcludedMonths([...formExcludedMonths, key]);
    }
  };

  const handleSaveReminder = async () => {
    if (!formText.trim()) {
      Alert.alert('Error', 'Please enter a reminder title.');
      return;
    }

    try {
      setSubmitting(true);
      let hh = parseInt(formHour, 10);
      const mm = parseInt(formMinute, 10) || 0;
      if (formAmPm === 'PM' && hh < 12) hh += 12;
      if (formAmPm === 'AM' && hh === 12) hh = 0;

      const triggerDate = new Date();
      triggerDate.setHours(hh, mm, 0, 0);
      if (triggerDate.getTime() <= Date.now()) {
        triggerDate.setDate(triggerDate.getDate() + 1);
      }

      if (formRecurrence === 'batch') {
        const count = parseInt(formBatchCount, 10) || 4;
        const interval = parseInt(formBatchInterval, 10) || 15;
        await api.post('/reminders', {
          text: formText.trim(),
          batch_count: count,
          batch_interval_minutes: interval,
          urgency: formUrgency
        });
      } else if (editingReminder) {
        // Update existing
        let activeDaysPayload: string[] | null = null;
        let activeMonthsPayload: string[] | null = null;
        let recType: string | null = null;
        let recInterval: number | null = null;

        if (formRecurrence === 'daily') {
          recType = 'days';
          recInterval = 1;
        } else if (formRecurrence === 'specific_days') {
          recType = 'days';
          recInterval = 1;
          activeDaysPayload = formActiveDays;
        } else if (formRecurrence === 'monthly') {
          recType = 'months';
          recInterval = 1;
          if (formExcludedMonths.length > 0) {
            activeMonthsPayload = MONTH_OPTIONS.map(m => m.key).filter(k => !formExcludedMonths.includes(k));
          }
        }

        await api.patch(`/reminders/${editingReminder.id}`, {
          text: formText.trim(),
          trigger_at: triggerDate.toISOString(),
          recurrence_type: recType,
          recurrence_interval: recInterval,
          active_days: activeDaysPayload,
          active_months: activeMonthsPayload,
          urgency: formUrgency
        });
      } else {
        // Create new single / recurring
        let activeDaysPayload: string[] | null = null;
        let activeMonthsPayload: string[] | null = null;
        let recType: string | null = null;
        let recInterval: number | null = null;

        if (formRecurrence === 'daily') {
          recType = 'days';
          recInterval = 1;
        } else if (formRecurrence === 'specific_days') {
          recType = 'days';
          recInterval = 1;
          activeDaysPayload = formActiveDays;
        } else if (formRecurrence === 'monthly') {
          recType = 'months';
          recInterval = 1;
          if (formExcludedMonths.length > 0) {
            activeMonthsPayload = MONTH_OPTIONS.map(m => m.key).filter(k => !formExcludedMonths.includes(k));
          }
        }

        await api.post('/reminders', {
          text: formText.trim(),
          trigger_at: triggerDate.toISOString(),
          recurrence_type: recType,
          recurrence_interval: recInterval,
          active_days: activeDaysPayload,
          active_months: activeMonthsPayload,
          urgency: formUrgency
        });
      }

      setModalVisible(false);
      await fetchReminders();
    } catch (err: any) {
      Alert.alert('Save Failed', err.response?.data?.error || err.message || 'Could not save reminder');
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkComplete = async (id: string) => {
    try {
      await api.post(`/reminders/${id}/complete`);
      setReminders(prev => prev.map(r => r.id === id ? { ...r, status: 'completed', accountability_status: 'completed_confirmed' } : r));
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to complete reminder');
    }
  };

  const handleDeleteReminder = (id: string) => {
    Alert.alert('Delete Reminder', 'Are you sure you want to delete this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/reminders/${id}`);
            setReminders(prev => prev.filter(r => r.id !== id));
          } catch (err: any) {
            Alert.alert('Error', err.response?.data?.error || 'Failed to delete reminder');
          }
        }
      }
    ]);
  };

  const content = (
    <View style={styles.innerContainer}>
      {!embedded && (
        <BrainHeader
          title="Nova Reminders"
          subtitle={`${activeReminders.length} active · ${recurringReminders.length} recurring`}
          icon="⏰"
          onRefresh={handleRefresh}
          isRefreshing={refreshing}
        />
      )}

      {/* Summary Stats Cards */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: '#10B981' }]}>{activeReminders.length}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: '#6366F1' }]}>{recurringReminders.length}</Text>
          <Text style={styles.statLabel}>Recurring</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, { color: '#A78BFA' }]}>{completedReminders.length}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <TouchableOpacity style={styles.addReminderBtn} onPress={openCreateModal}>
          <Text style={styles.addBtnPlus}>＋</Text>
          <Text style={styles.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'active' && styles.tabActive]} onPress={() => setTab('active')}>
          <Text style={[styles.tabText, tab === 'active' && styles.tabTextActive]}>Active ({activeReminders.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'recurring' && styles.tabActive]} onPress={() => setTab('recurring')}>
          <Text style={[styles.tabText, tab === 'recurring' && styles.tabTextActive]}>Recurring ({recurringReminders.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'completed' && styles.tabActive]} onPress={() => setTab('completed')}>
          <Text style={[styles.tabText, tab === 'completed' && styles.tabTextActive]}>Done ({completedReminders.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'all' && styles.tabActive]} onPress={() => setTab('all')}>
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>All ({reminders.length})</Text>
        </TouchableOpacity>
      </View>

      {/* Reminders List */}
      {loading && !refreshing && reminders.length === 0 ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#6366F1" />
        </View>
      ) : displayedReminders.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyEmoji}>⏰</Text>
          <Text style={styles.emptyTitle}>No Reminders Here</Text>
          <Text style={styles.emptySubtitle}>
            {tab === 'active' ? 'You have no pending reminders. Ask Nova or tap "New" to create one!' : 'No items match this filter.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedReminders}
          keyExtractor={(item) => item.id}
          removeClippedSubviews
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#6366F1" />}
          contentContainerStyle={{ paddingBottom: 40 }}
          renderItem={({ item }) => {
            const domainIcon = getReminderDomainIcon(item.text);
            const isCompleted = item.status === 'completed';
            const urgencyColor = item.urgency === 'high' ? '#EF4444' : item.urgency === 'medium' ? '#F59E0B' : '#10B981';

            // Recurrence badge text
            let recBadge = '';
            if (item.active_days && item.active_days.length < 7) {
              const excluded = DAY_OPTIONS.map(d => d.key).filter(k => !item.active_days?.includes(k));
              if (excluded.length > 0) {
                recBadge = `Daily (Excl. ${excluded.map(k => k.slice(0, 3).toUpperCase()).join(', ')})`;
              } else {
                recBadge = `Days: ${item.active_days.map(d => d.slice(0, 3).toUpperCase()).join(', ')}`;
              }
            } else if (item.recurrence_type === 'days' || item.recurrence_type === 'daily') {
              recBadge = 'Every day';
            } else if (item.recurrence_type === 'months') {
              recBadge = 'Monthly';
              if (item.active_months && item.active_months.length < 12) {
                const excl = MONTH_OPTIONS.map(m => m.key).filter(k => !item.active_months?.includes(k));
                recBadge += ` (Excl. ${excl.map(m => m.slice(0, 3).toUpperCase()).join(', ')})`;
              }
            } else if (item.batch_group_id) {
              recBadge = 'Sequential Batch';
            }

            return (
              <View style={[styles.reminderCard, isCompleted && styles.reminderCardCompleted]}>
                <View style={styles.cardHeader}>
                  <View style={styles.domainAvatar}>
                    <Text style={styles.domainEmoji}>{domainIcon}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.reminderTitle, isCompleted && styles.reminderTitleDone]}>
                      {item.text}
                    </Text>
                    <Text style={styles.triggerTimeText}>
                      📅 {formatTriggerTime(item.trigger_at)}
                    </Text>
                  </View>
                  <View style={[styles.urgencyPill, { borderColor: `${urgencyColor}40`, backgroundColor: `${urgencyColor}15` }]}>
                    <Text style={[styles.urgencyText, { color: urgencyColor }]}>
                      {(item.urgency || 'med').toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Badges row */}
                <View style={styles.badgesRow}>
                  {recBadge ? (
                    <View style={styles.recBadge}>
                      <Text style={styles.recBadgeText}>🔁 {recBadge}</Text>
                    </View>
                  ) : (
                    <View style={styles.oneTimeBadge}>
                      <Text style={styles.oneTimeBadgeText}>🔔 One-time</Text>
                    </View>
                  )}

                  {item.accountability_status === 'completed_confirmed' && (
                    <View style={styles.accountabilityBadgeDone}>
                      <Text style={styles.accountabilityBadgeText}>✨ Verified Completed</Text>
                    </View>
                  )}
                  {item.accountability_status === 'reminded' && (
                    <View style={styles.accountabilityBadgePending}>
                      <Text style={styles.accountabilityBadgeText}>⏳ Reminded</Text>
                    </View>
                  )}
                </View>

                {/* Card Actions */}
                <View style={styles.cardActionsRow}>
                  {!isCompleted ? (
                    <TouchableOpacity style={styles.completeBtn} onPress={() => handleMarkComplete(item.id)}>
                      <Text style={styles.completeBtnText}>✓ Mark Done</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.doneStatus}>
                      <Text style={styles.doneStatusText}>Completed</Text>
                    </View>
                  )}

                  <View style={styles.rightActions}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => openEditModal(item)}>
                      <Text style={styles.actionIcon}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteReminder(item.id)}>
                      <Text style={styles.actionIcon}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── CREATE / EDIT MODAL ── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingReminder ? 'Edit Reminder' : 'New Reminder'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
              {/* Task Title */}
              <Text style={styles.fieldLabel}>REMINDER TASK</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Workout, Drink water, Pay credit card bill"
                placeholderTextColor="#71717A"
                value={formText}
                onChangeText={setFormText}
              />

              {/* Time Selector */}
              <Text style={styles.fieldLabel}>TIME OF DAY</Text>
              <View style={styles.timePickerRow}>
                <TextInput
                  style={styles.timeInput}
                  keyboardType="numeric"
                  maxLength={2}
                  value={formHour}
                  onChangeText={setFormHour}
                />
                <Text style={styles.timeColon}>:</Text>
                <TextInput
                  style={styles.timeInput}
                  keyboardType="numeric"
                  maxLength={2}
                  value={formMinute}
                  onChangeText={setFormMinute}
                />
                <View style={styles.ampmSwitch}>
                  <TouchableOpacity
                    style={[styles.ampmBtn, formAmPm === 'AM' && styles.ampmActive]}
                    onPress={() => setFormAmPm('AM')}
                  >
                    <Text style={[styles.ampmText, formAmPm === 'AM' && styles.ampmTextActive]}>AM</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.ampmBtn, formAmPm === 'PM' && styles.ampmActive]}
                    onPress={() => setFormAmPm('PM')}
                  >
                    <Text style={[styles.ampmText, formAmPm === 'PM' && styles.ampmTextActive]}>PM</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Recurrence Type */}
              <Text style={styles.fieldLabel}>RECURRENCE SCHEDULE</Text>
              <View style={styles.recTypeGrid}>
                <TouchableOpacity
                  style={[styles.recChip, formRecurrence === 'none' && styles.recChipActive]}
                  onPress={() => setFormRecurrence('none')}
                >
                  <Text style={[styles.recChipText, formRecurrence === 'none' && styles.recChipTextActive]}>One-Time</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recChip, formRecurrence === 'daily' && styles.recChipActive]}
                  onPress={() => setFormRecurrence('daily')}
                >
                  <Text style={[styles.recChipText, formRecurrence === 'daily' && styles.recChipTextActive]}>Every Day</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recChip, formRecurrence === 'specific_days' && styles.recChipActive]}
                  onPress={() => setFormRecurrence('specific_days')}
                >
                  <Text style={[styles.recChipText, formRecurrence === 'specific_days' && styles.recChipTextActive]}>Select Days</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recChip, formRecurrence === 'monthly' && styles.recChipActive]}
                  onPress={() => setFormRecurrence('monthly')}
                >
                  <Text style={[styles.recChipText, formRecurrence === 'monthly' && styles.recChipTextActive]}>Monthly</Text>
                </TouchableOpacity>
                {!editingReminder && (
                  <TouchableOpacity
                    style={[styles.recChip, formRecurrence === 'batch' && styles.recChipActive]}
                    onPress={() => setFormRecurrence('batch')}
                  >
                    <Text style={[styles.recChipText, formRecurrence === 'batch' && styles.recChipTextActive]}>Multi-Step</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Specific Days Picker */}
              {formRecurrence === 'specific_days' && (
                <View style={styles.subConfigSection}>
                  <Text style={styles.subSectionTitle}>Active Days of the Week (tap to toggle):</Text>
                  <View style={styles.daysRow}>
                    {DAY_OPTIONS.map(d => {
                      const isActive = formActiveDays.includes(d.key);
                      return (
                        <TouchableOpacity
                          key={d.key}
                          style={[styles.dayCircle, isActive && styles.dayCircleActive]}
                          onPress={() => toggleDay(d.key)}
                        >
                          <Text style={[styles.dayCircleText, isActive && styles.dayCircleTextActive]}>{d.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Monthly Month Exclusions */}
              {formRecurrence === 'monthly' && (
                <View style={styles.subConfigSection}>
                  <Text style={styles.subSectionTitle}>Exclude Months (tap to exclude/include):</Text>
                  <View style={styles.monthsGrid}>
                    {MONTH_OPTIONS.map(m => {
                      const isExcluded = formExcludedMonths.includes(m.key);
                      return (
                        <TouchableOpacity
                          key={m.key}
                          style={[styles.monthChip, isExcluded && styles.monthChipExcluded]}
                          onPress={() => toggleMonthExclusion(m.key)}
                        >
                          <Text style={[styles.monthChipText, isExcluded && styles.monthChipTextExcluded]}>
                            {m.label} {isExcluded ? '✕' : ''}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Multi-step Batch Inputs */}
              {formRecurrence === 'batch' && (
                <View style={styles.subConfigSection}>
                  <Text style={styles.subSectionTitle}>Sequential Step Config:</Text>
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>REPEAT COUNT</Text>
                      <TextInput
                        style={styles.textInput}
                        keyboardType="numeric"
                        value={formBatchCount}
                        onChangeText={setFormBatchCount}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>EVERY (MINS)</Text>
                      <TextInput
                        style={styles.textInput}
                        keyboardType="numeric"
                        value={formBatchInterval}
                        onChangeText={setFormBatchInterval}
                      />
                    </View>
                  </View>
                </View>
              )}

              {/* Urgency */}
              <Text style={styles.fieldLabel}>URGENCY</Text>
              <View style={styles.urgencyRow}>
                {(['low', 'medium', 'high'] as const).map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.urgencyChip, formUrgency === u && styles.urgencyChipActive]}
                    onPress={() => setFormUrgency(u)}
                  >
                    <Text style={[styles.urgencyChipText, formUrgency === u && styles.urgencyChipTextActive]}>
                      {u.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Action Buttons */}
              <TouchableOpacity
                style={styles.saveSubmitBtn}
                onPress={handleSaveReminder}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveSubmitText}>
                    {editingReminder ? 'Save Changes' : 'Create Reminder'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );

  if (embedded) {
    return content;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {content}
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  innerContainer: {
    flex: 1,
    backgroundColor: '#09090B',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 40,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#18181B',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  statNum: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    color: '#A1A1AA',
    marginTop: 2,
  },
  addReminderBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnPlus: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  tabActive: {
    backgroundColor: '#27272A',
    borderColor: '#6366F1',
  },
  tabText: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#F4F4F5',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F4F4F5',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 18,
  },
  reminderCard: {
    backgroundColor: '#18181B',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  reminderCardCompleted: {
    opacity: 0.65,
    backgroundColor: '#121214',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  domainAvatar: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#27272A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  domainEmoji: {
    fontSize: 20,
  },
  reminderTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F4F4F5',
    marginBottom: 2,
  },
  reminderTitleDone: {
    textDecorationLine: 'line-through',
    color: '#71717A',
  },
  triggerTimeText: {
    fontSize: 12,
    color: '#A1A1AA',
  },
  urgencyPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  urgencyText: {
    fontSize: 10,
    fontWeight: '700',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  recBadge: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: 'rgba(99, 102, 241, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recBadgeText: {
    fontSize: 11,
    color: '#818CF8',
    fontWeight: '500',
  },
  oneTimeBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  oneTimeBadgeText: {
    fontSize: 11,
    color: '#A1A1AA',
  },
  accountabilityBadgeDone: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  accountabilityBadgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  accountabilityBadgeText: {
    fontSize: 11,
    color: '#E4E4E7',
  },
  cardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
  },
  completeBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  completeBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  doneStatus: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#27272A',
  },
  doneStatusText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
  },
  rightActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#27272A',
  },
  actionIcon: {
    fontSize: 14,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#18181B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F4F4F5',
  },
  modalClose: {
    fontSize: 18,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#71717A',
    marginBottom: 6,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: '#09090B',
    borderRadius: 10,
    padding: 12,
    color: '#F4F4F5',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  timePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeInput: {
    backgroundColor: '#09090B',
    borderRadius: 10,
    width: 60,
    height: 48,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#F4F4F5',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  timeColon: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F4F4F5',
  },
  ampmSwitch: {
    flexDirection: 'row',
    backgroundColor: '#09090B',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    height: 48,
  },
  ampmBtn: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ampmActive: {
    backgroundColor: '#6366F1',
  },
  ampmText: {
    color: '#71717A',
    fontWeight: '700',
    fontSize: 13,
  },
  ampmTextActive: {
    color: '#FFFFFF',
  },
  recTypeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  recChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  recChipActive: {
    borderColor: '#6366F1',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  recChipText: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '600',
  },
  recChipTextActive: {
    color: '#818CF8',
  },
  subConfigSection: {
    marginTop: 10,
    padding: 12,
    backgroundColor: '#09090B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  subSectionTitle: {
    fontSize: 12,
    color: '#A1A1AA',
    marginBottom: 8,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  dayCircleActive: {
    backgroundColor: '#6366F1',
    borderColor: '#818CF8',
  },
  dayCircleText: {
    fontSize: 11,
    color: '#71717A',
    fontWeight: '700',
  },
  dayCircleTextActive: {
    color: '#FFFFFF',
  },
  monthsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  monthChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  monthChipExcluded: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  monthChipText: {
    fontSize: 11,
    color: '#A1A1AA',
  },
  monthChipTextExcluded: {
    color: '#EF4444',
  },
  urgencyRow: {
    flexDirection: 'row',
    gap: 10,
  },
  urgencyChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  urgencyChipActive: {
    borderColor: '#6366F1',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  urgencyChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#71717A',
  },
  urgencyChipTextActive: {
    color: '#818CF8',
  },
  saveSubmitBtn: {
    marginTop: 20,
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveSubmitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
