import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { onboardingService } from '../services/onboardingService';

export function PreferencesScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [preferredName, setPreferredName] = useState('');
  const [passions, setPassions] = useState('');
  const [goals, setGoals] = useState('');
  const [family, setFamily] = useState('');
  const [importantFacts, setImportantFacts] = useState('');
  const [companionPersonality, setCompanionPersonality] = useState('');

  useEffect(() => {
    async function loadPreferences() {
      try {
        const data = await onboardingService.getStatus();
        if (data && data.onboarding_completed) {
          const answers = data.answers || {};
          setPreferredName(answers.preferred_name || data.preferred_name || '');
          setCompanionPersonality(answers.companion_personality || data.companion_personality || '');
          setPassions(answers.passions || '');
          setGoals(answers.goals || '');
          setFamily(answers.family || '');
          setImportantFacts(answers.important_facts || '');
        }
      } catch (err) {
        console.error('Failed to load preferences:', err);
        Alert.alert('Error', 'Failed to load onboarding preferences.');
      } finally {
        setLoading(false);
      }
    }
    loadPreferences();
  }, []);

  const handleSave = async () => {
    if (!preferredName.trim()) {
      Alert.alert('Required', 'Preferred name is required.');
      return;
    }

    setSaving(true);
    try {
      await onboardingService.submitOnboarding({
        preferred_name: preferredName.trim(),
        passions: passions.trim(),
        goals: goals.trim(),
        family: family.trim(),
        important_facts: importantFacts.trim(),
        companion_personality: companionPersonality.trim()
      });
      Alert.alert('Success', 'Preferences updated successfully.');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || err.message || 'Failed to save preferences.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[st.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={st.center}>
          <ActivityIndicator size="large" color="#8B5CF6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Text style={st.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[st.title, { color: colors.textPrimary }]}>Edit Preferences</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={st.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[st.label, { color: colors.textSecondary }]}>What is your preferred name?</Text>
        <TextInput
          style={[st.input, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
          value={preferredName}
          onChangeText={setPreferredName}
          placeholder="Name"
          placeholderTextColor={colors.placeholder}
        />

        <Text style={[st.label, { color: colors.textSecondary }]}>What are your passions and interests?</Text>
        <TextInput
          style={[st.inputMultiline, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
          value={passions}
          onChangeText={setPassions}
          placeholder="Passions & Interests"
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={3}
        />

        <Text style={[st.label, { color: colors.textSecondary }]}>What are your current goals?</Text>
        <TextInput
          style={[st.inputMultiline, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
          value={goals}
          onChangeText={setGoals}
          placeholder="Goals"
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={3}
        />

        <Text style={[st.label, { color: colors.textSecondary }]}>Tell me about your family and relationships.</Text>
        <TextInput
          style={[st.inputMultiline, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
          value={family}
          onChangeText={setFamily}
          placeholder="Family & Relationships"
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={3}
        />

        <Text style={[st.label, { color: colors.textSecondary }]}>Any important facts I should never forget?</Text>
        <TextInput
          style={[st.inputMultiline, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
          value={importantFacts}
          onChangeText={setImportantFacts}
          placeholder="Important facts"
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={3}
        />

        <Text style={[st.label, { color: colors.textSecondary }]}>What personality would you like me to have?</Text>
        <TextInput
          style={[st.inputMultiline, { color: colors.textPrimary, backgroundColor: colors.inputBg, borderColor: colors.border }]}
          value={companionPersonality}
          onChangeText={setCompanionPersonality}
          placeholder="Personality (e.g. friendly, professional, curious)"
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={3}
        />

        <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={st.saveBtnText}>Save Preferences</Text>
          )}
        </TouchableOpacity>
        
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backBtn: { width: 60 },
  backText: { color: '#8B5CF6', fontSize: 18 },
  title: { fontSize: 18, fontWeight: 'bold' },
  scrollContent: { padding: 16 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 16
  },
  inputMultiline: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16
  },
  saveBtn: {
    backgroundColor: '#8B5CF6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold'
  }
});
