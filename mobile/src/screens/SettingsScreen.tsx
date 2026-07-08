import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, Linking, Modal, FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { useTheme, ThemeMode } from '../theme/ThemeContext';
import { useChatStore } from '../store/useChatStore';

const APP_VERSION = '0.2.0-beta';

// Countries Nova understands for local time + weekend detection
const COUNTRIES = [
  { code: 'IN', flag: '🇮🇳', name: 'India',          tz: 'IST (UTC+5:30)',  weekend: 'Sat–Sun' },
  { code: 'US', flag: '🇺🇸', name: 'United States',  tz: 'EST (UTC−5)',     weekend: 'Sat–Sun' },
  { code: 'UK', flag: '🇬🇧', name: 'United Kingdom', tz: 'GMT (UTC+0)',     weekend: 'Sat–Sun' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia',      tz: 'AEST (UTC+10)',  weekend: 'Sat–Sun' },
  { code: 'CA', flag: '🇨🇦', name: 'Canada',         tz: 'EST (UTC−5)',    weekend: 'Sat–Sun' },
  { code: 'AE', flag: '🇦🇪', name: 'UAE',            tz: 'GST (UTC+4)',    weekend: 'Fri–Sat' },
  { code: 'SA', flag: '🇸🇦', name: 'Saudi Arabia',   tz: 'AST (UTC+3)',    weekend: 'Fri–Sat' },
  { code: 'PK', flag: '🇵🇰', name: 'Pakistan',       tz: 'PKT (UTC+5)',    weekend: 'Sat–Sun' },
  { code: 'BD', flag: '🇧🇩', name: 'Bangladesh',     tz: 'BST (UTC+6)',    weekend: 'Fri–Sat' },
  { code: 'SG', flag: '🇸🇬', name: 'Singapore',      tz: 'SGT (UTC+8)',    weekend: 'Sat–Sun' },
  { code: 'JP', flag: '🇯🇵', name: 'Japan',          tz: 'JST (UTC+9)',    weekend: 'Sat–Sun' },
  { code: 'DE', flag: '🇩🇪', name: 'Germany',        tz: 'CET (UTC+1)',    weekend: 'Sat–Sun' },
  { code: 'FR', flag: '🇫🇷', name: 'France',         tz: 'CET (UTC+1)',    weekend: 'Sat–Sun' },
  { code: 'BR', flag: '🇧🇷', name: 'Brazil',         tz: 'BRT (UTC−3)',    weekend: 'Sat–Sun' },
  { code: 'ZA', flag: '🇿🇦', name: 'South Africa',   tz: 'SAST (UTC+2)',   weekend: 'Sat–Sun' },
  { code: 'NG', flag: '🇳🇬', name: 'Nigeria',        tz: 'WAT (UTC+1)',    weekend: 'Sat–Sun' },
  { code: 'KE', flag: '🇰🇪', name: 'Kenya',          tz: 'EAT (UTC+3)',    weekend: 'Sat–Sun' },
  { code: 'NZ', flag: '🇳🇿', name: 'New Zealand',    tz: 'NZST (UTC+12)',  weekend: 'Sat–Sun' },
];

export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const { colors, themeMode, setThemeMode } = useTheme();
  const { developerMode, setDeveloperMode } = useChatStore();

  // Notification settings (local state — could persist to backend)
  const [momentNotifs, setMomentNotifs] = useState(true);
  const [reflectionNotifs, setReflectionNotifs] = useState(true);
  const [goalNotifs, setGoalNotifs] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Country / timezone selector
  const [country, setCountry] = useState('IN');
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [savingCountry, setSavingCountry] = useState(false);

  // Load saved country from profile on mount
  useEffect(() => {
    api.get('/onboarding/status').then(res => {
      const c = res.data?.country || res.data?.profile?.country;
      if (c) setCountry(c);
    }).catch(() => {});
  }, []);

  const handleSelectCountry = useCallback(async (code: string) => {
    setCountryModalVisible(false);
    if (code === country) return;
    setSavingCountry(true);
    setCountry(code);
    try {
      await api.patch('/onboarding/profile', { country: code });
    } catch {
      Alert.alert('Error', 'Could not save country. Please try again.');
      setCountry(country); // revert
    } finally {
      setSavingCountry(false);
    }
  }, [country]);

  const selectedCountry = COUNTRIES.find(c => c.code === country) || COUNTRIES[0];

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

        {/* ── Location & Time ───────────────────────────── */}
        <Text style={[st.sectionLabel, { color: colors.textSecondary }]}>🌍 LOCATION & TIME</Text>
        <View style={[st.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={st.row} onPress={() => setCountryModalVisible(true)} disabled={savingCountry}>
            <View>
              <Text style={[st.rowLabel, { color: colors.textPrimary }]}>
                {selectedCountry.flag}  {selectedCountry.name}
              </Text>
              <Text style={[st.rowSub, { color: colors.textSecondary }]}>
                {selectedCountry.tz}  ·  Weekend: {selectedCountry.weekend}
              </Text>
            </View>
            <Text style={[st.chevron, { color: colors.textSecondary }]}>
              {savingCountry ? '...' : '›'}
            </Text>
          </TouchableOpacity>
          <View style={[st.divider, { backgroundColor: colors.divider }]} />
          <View style={st.row}>
            <Text style={[st.rowSub, { color: colors.textSecondary, flex: 1 }]}>
              Nova uses this to know your current time, day of the week, and what counts as a weekend for you.
            </Text>
          </View>
        </View>

        {/* ── Country Picker Modal ──────────────────────── */}
        <Modal visible={countryModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCountryModalVisible(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[st.modalHeader, { borderBottomColor: colors.divider }]}>
              <Text style={[st.modalTitle, { color: colors.textPrimary }]}>Select Your Country</Text>
              <TouchableOpacity onPress={() => setCountryModalVisible(false)}>
                <Text style={{ color: '#8B5CF6', fontSize: 16, fontWeight: '600' }}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={COUNTRIES}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[st.countryRow, { borderBottomColor: colors.divider },
                    item.code === country && { backgroundColor: colors.card }]}
                  onPress={() => handleSelectCountry(item.code)}
                >
                  <Text style={{ fontSize: 26, marginRight: 12 }}>{item.flag}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ fontSize: 15, fontWeight: '500' }, { color: colors.textPrimary }]}>{item.name}</Text>
                    <Text style={[{ fontSize: 12 }, { color: colors.textSecondary }]}>{item.tz}  ·  Weekend: {item.weekend}</Text>
                  </View>
                  {item.code === country && <Text style={{ color: '#8B5CF6', fontWeight: 'bold', fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
              )}
            />
          </SafeAreaView>
        </Modal>

        {/* ── Theme ────────────────────────────────────── */}
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
  rowSub: { fontSize: 12, marginTop: 2 },
  rowValue: { fontSize: 15 },
  chevron: { fontSize: 20 },
  checkmark: { color: '#8B5CF6', fontWeight: 'bold', fontSize: 16 },
  divider: { height: 1, marginHorizontal: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  countryRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
});
