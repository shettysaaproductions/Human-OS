import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { useTheme, ThemeMode } from '../theme/ThemeContext';
import { useChatStore } from '../store/useChatStore';
import { useSettingsStore, LanguagePreference } from '../store/useSettingsStore';
import * as Updates from 'expo-updates';
import { triggerTestCrash, triggerTestError } from '../services/logger';

const APP_VERSION = '0.2.0-beta';

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { colors, themeMode, setThemeMode } = useTheme();
  const { developerMode, setDeveloperMode } = useChatStore();
  const { language, setLanguage } = useSettingsStore();

  // Notification settings (local state — could persist to backend)
  const [momentNotifs, setMomentNotifs] = useState(true);
  const [reflectionNotifs, setReflectionNotifs] = useState(true);
  const [goalNotifs, setGoalNotifs] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    try {
      setExporting(true);
      const res = await api.get('/memories/export');
      const exported = res.data.data;
      Alert.alert(
        'Export Ready',
        `Your data export is ready:\n• ${exported?.memoriesCount || 0} memories\n• ${exported?.reflectionsCount || 0} reflections\n• ${exported?.momentsCount || 0} moments\n\nIn production, this would be emailed to you.`,
        [{ text: 'OK' }]
      );
    } catch (err) {
      Alert.alert('Export Failed', 'Could not export data. Please try again.');
    } finally {
      setExporting(false);
    }
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete all your memories, goals, and reflections. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything', style: 'destructive',
          onPress: () => Alert.alert('Coming Soon', 'Account deletion will be available in the next update.')
        }
      ]
    );
  }, []);

  const handleSelectTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
  };

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Text style={st.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[st.title, { color: colors.textPrimary }]}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Theme Settings */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>🎨 THEME</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={st.row} onPress={() => handleSelectTheme('system')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>System Default</Text>
            {themeMode === 'system' && <Text style={st.checkmark}>✓</Text>}
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => handleSelectTheme('dark')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Dark Mode</Text>
            {themeMode === 'dark' && <Text style={st.checkmark}>✓</Text>}
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => handleSelectTheme('light')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Light Mode</Text>
            {themeMode === 'light' && <Text style={st.checkmark}>✓</Text>}
          </TouchableOpacity>
        </View>

        {/* Language Settings */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>🗣️ LANGUAGE</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={st.row} onPress={() => setLanguage('auto')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Auto (Default)</Text>
            {language === 'auto' && <Text style={st.checkmark}>✓</Text>}
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => setLanguage('en')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>English</Text>
            {language === 'en' && <Text style={st.checkmark}>✓</Text>}
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => setLanguage('hi')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Hindi</Text>
            {language === 'hi' && <Text style={st.checkmark}>✓</Text>}
          </TouchableOpacity>
        </View>

        {/* Moments & Notifications */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>⚡ MOMENTS & NOTIFICATIONS</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingsRow label="Moment notifications" value={momentNotifs} onToggle={setMomentNotifs} />
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <SettingsRow label="Reflection notifications" value={reflectionNotifs} onToggle={setReflectionNotifs} />
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <SettingsRow label="Goal check-ins" value={goalNotifs} onToggle={setGoalNotifs} />
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <SettingsRow label="Quiet hours (10pm – 8am)" value={quietHoursEnabled} onToggle={setQuietHoursEnabled} />
        </View>

        {/* Privacy */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>🔒 PRIVACY</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={st.row} onPress={() => Alert.alert('Privacy', 'All your data is encrypted at rest and never shared with third parties.')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Privacy Policy</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => Alert.alert('Data', 'Nova stores your memories, emotions, goals, and reflections on secure servers using Supabase with encryption.')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>How Nova stores your data</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Data Export */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>📦 DATA</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={st.row} onPress={handleExport} disabled={exporting}>
            <Text style={[st.rowLabel, { color: '#06B6D4' }]}>{exporting ? 'Exporting...' : 'Export My Data'}</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Brain', { screen: 'Memories' })}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Manage Memories</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={handleDeleteAccount}>
            <Text style={[st.rowLabel, { color: '#EF4444' }]}>Delete All Data</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Feedback */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>💬 FEEDBACK</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Feedback')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Send Feedback</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => Linking.openURL('mailto:hello@nova.ai?subject=Nova Feedback')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Email the team</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>ℹ️ ABOUT NOVA</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={st.row}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Version</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary }]}>{APP_VERSION}</Text>
          </View>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <View style={st.row}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Build</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary }]}>Beta</Text>
          </View>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <TouchableOpacity style={st.row} onPress={() => navigation.navigate('UpdateHistory')}>
            <Text style={[st.rowLabel, { color: colors.textPrimary }]}>Update History</Text>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          
          {/* Internal Diagnostics (TEMPORARY: ALWAYS VISIBLE FOR R&D) */}
          <View style={[st.row, { paddingVertical: 8 }]}>
            <Text style={[st.rowLabel, { color: '#F59E0B', fontSize: 13 }]}>App Version</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary, fontSize: 13 }]}>{APP_VERSION}</Text>
          </View>
          <View style={[st.row, { paddingVertical: 8 }]}>
            <Text style={[st.rowLabel, { color: '#F59E0B', fontSize: 13 }]}>Runtime Version</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary, fontSize: 13 }]}>{Updates.runtimeVersion || 'Unknown'}</Text>
          </View>
          <View style={[st.row, { paddingVertical: 8 }]}>
            <Text style={[st.rowLabel, { color: '#F59E0B', fontSize: 13 }]}>Update ID</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary, fontSize: 11 }]} selectable>{Updates.updateId || 'Embedded'}</Text>
          </View>
          <View style={[st.row, { paddingVertical: 8 }]}>
            <Text style={[st.rowLabel, { color: '#F59E0B', fontSize: 13 }]}>Channel / Branch</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary, fontSize: 13 }]}>{Updates.channel || 'development'}</Text>
          </View>
          <View style={[st.row, { paddingVertical: 8 }]}>
            <Text style={[st.rowLabel, { color: '#F59E0B', fontSize: 13 }]}>Build Date</Text>
            <Text style={[st.rowValue, { color: colors.textSecondary, fontSize: 11 }]}>{Updates.createdAt ? new Date(Updates.createdAt).toLocaleString() : 'N/A'}</Text>
          </View>
          
          <SettingsRow label="Developer Mode" value={developerMode} onToggle={setDeveloperMode} />
          {developerMode && (
            <>
              <View style={[st.divider, { backgroundColor: colors.divider }]} />
              <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Diagnostics')}>
                <Text style={[st.rowLabel, { color: '#F59E0B' }]}>View Diagnostics</Text>
                <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
              </TouchableOpacity>
              <View style={[st.divider, { backgroundColor: colors.divider }]} />
              <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Brain', { screen: 'Founder' })}>
                <Text style={[st.rowLabel, { color: '#F59E0B' }]}>Founder Dashboard</Text>
                <Text style={[st.chevron, { color: colors.textSecondary }]}>›</Text>
              </TouchableOpacity>
              <View style={[st.divider, { backgroundColor: colors.divider }]} />
              <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: 'bold', marginBottom: 8 }}>TEST CRASH REPORTING</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={st.testButton} onPress={triggerTestError}>
                    <Text style={st.testButtonText}>Send Test Error</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.testButton, { backgroundColor: '#EF4444' }]} onPress={triggerTestCrash}>
                    <Text style={st.testButtonText}>Force Crash</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingsRow({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={st.row}>
      <Text style={[st.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ true: '#8B5CF6', false: colors.border }}
        thumbColor={value ? '#fff' : '#666'}
      />
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backBtn: { width: 60 },
  backText: { color: '#8B5CF6', fontSize: 18 },
  title: { fontSize: 18, fontWeight: 'bold' },
  sectionLabel: { fontSize: 11, fontWeight: '700', marginHorizontal: 16, marginTop: 24, marginBottom: 6, letterSpacing: 0.8 },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 12
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel: { fontSize: 15 },
  rowValue: { fontSize: 15 },
  chevron: { fontSize: 20 },
  checkmark: { color: '#8B5CF6', fontWeight: 'bold', fontSize: 16 },
  divider: { height: 1, marginHorizontal: 16 },
  testButton: {
    flex: 1,
    backgroundColor: '#374151',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
