import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, TextInput, Alert, Platform, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';

const APP_VERSION = '0.2.0-beta';

export function SettingsScreen() {
  const navigation = useNavigation<any>();

  // Notification settings (local state — could persist to backend)
  const [momentNotifs, setMomentNotifs] = useState(true);
  const [reflectionNotifs, setReflectionNotifs] = useState(true);
  const [goalNotifs, setGoalNotifs] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [devMode, setDevMode] = useState(false);
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

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Text style={st.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={st.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Moments & Notifications */}
        <Text style={st.sectionLabel}>⚡ MOMENTS & NOTIFICATIONS</Text>
        <View style={st.section}>
          <SettingsRow label="Moment notifications" value={momentNotifs} onToggle={setMomentNotifs} />
          <Divider />
          <SettingsRow label="Reflection notifications" value={reflectionNotifs} onToggle={setReflectionNotifs} />
          <Divider />
          <SettingsRow label="Goal check-ins" value={goalNotifs} onToggle={setGoalNotifs} />
          <Divider />
          <SettingsRow label="Quiet hours (10pm – 8am)" value={quietHoursEnabled} onToggle={setQuietHoursEnabled} />
        </View>

        {/* Privacy */}
        <Text style={st.sectionLabel}>🔒 PRIVACY</Text>
        <View style={st.section}>
          <TouchableOpacity style={st.row} onPress={() => Alert.alert('Privacy', 'All your data is encrypted at rest and never shared with third parties.')}>
            <Text style={st.rowLabel}>Privacy Policy</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={st.row} onPress={() => Alert.alert('Data', 'Nova stores your memories, emotions, goals, and reflections on secure servers using Supabase with encryption.')}>
            <Text style={st.rowLabel}>How Nova stores your data</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Data Export */}
        <Text style={st.sectionLabel}>📦 DATA</Text>
        <View style={st.section}>
          <TouchableOpacity style={st.row} onPress={handleExport} disabled={exporting}>
            <Text style={[st.rowLabel, { color: '#06B6D4' }]}>{exporting ? 'Exporting...' : 'Export My Data'}</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Brain', { screen: 'Memories' })}>
            <Text style={st.rowLabel}>Manage Memories</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={st.row} onPress={handleDeleteAccount}>
            <Text style={[st.rowLabel, { color: '#EF4444' }]}>Delete All Data</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Feedback */}
        <Text style={st.sectionLabel}>💬 FEEDBACK</Text>
        <View style={st.section}>
          <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Feedback')}>
            <Text style={st.rowLabel}>Send Feedback</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
          <Divider />
          <TouchableOpacity style={st.row} onPress={() => Linking.openURL('mailto:hello@nova.ai?subject=Nova Feedback')}>
            <Text style={st.rowLabel}>Email the team</Text>
            <Text style={st.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        {/* About */}
        <Text style={st.sectionLabel}>ℹ️ ABOUT NOVA</Text>
        <View style={st.section}>
          <View style={st.row}>
            <Text style={st.rowLabel}>Version</Text>
            <Text style={st.rowValue}>{APP_VERSION}</Text>
          </View>
          <Divider />
          <View style={st.row}>
            <Text style={st.rowLabel}>Build</Text>
            <Text style={st.rowValue}>Beta</Text>
          </View>
          <Divider />
          <SettingsRow label="Developer Mode" value={devMode} onToggle={setDevMode} />
          {devMode && (
            <>
              <Divider />
              <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Diagnostics')}>
                <Text style={[st.rowLabel, { color: '#F59E0B' }]}>View Diagnostics</Text>
                <Text style={st.chevron}>›</Text>
              </TouchableOpacity>
              <Divider />
              <TouchableOpacity style={st.row} onPress={() => navigation.navigate('Brain', { screen: 'Founder' })}>
                <Text style={[st.rowLabel, { color: '#F59E0B' }]}>Founder Dashboard</Text>
                <Text style={st.chevron}>›</Text>
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
  return (
    <View style={st.row}>
      <Text style={st.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ true: '#8B5CF6', false: 'rgba(255,255,255,0.1)' }}
        thumbColor={value ? '#fff' : '#666'}
      />
    </View>
  );
}

function Divider() {
  return <View style={st.divider} />;
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backBtn: { width: 60 },
  backText: { color: '#8B5CF6', fontSize: 18 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#555', marginHorizontal: 16, marginTop: 24, marginBottom: 6, letterSpacing: 0.8 },
  section: {
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)', marginHorizontal: 12
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel: { fontSize: 15, color: '#ddd' },
  rowValue: { fontSize: 15, color: '#666' },
  chevron: { color: '#555', fontSize: 20 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginHorizontal: 16 },
});
