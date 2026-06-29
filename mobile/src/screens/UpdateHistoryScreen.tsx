import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import updateHistory from '../config/updateHistory.json';

export function UpdateHistoryScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();

  const handleUndoUpdate = () => {
    Alert.alert('Coming Soon', 'Rollback support is coming soon.');
  };

  return (
    <SafeAreaView style={[st.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[st.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Text style={st.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[st.title, { color: colors.textPrimary }]}>Update History</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.scrollContent}>
        {updateHistory.map((update, index) => (
          <View key={update.version} style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={st.cardHeader}>
              <View>
                <Text style={st.versionTag}>v{update.version}</Text>
                <Text style={[st.updateTitle, { color: colors.textPrimary }]}>{update.title}</Text>
              </View>
              <TouchableOpacity style={st.undoBtn} onPress={handleUndoUpdate}>
                <Text style={st.undoBtnText}>Undo Update</Text>
              </TouchableOpacity>
            </View>
            
            <View style={st.notesContainer}>
              {update.message.map((note, i) => (
                <View key={i} style={st.noteRow}>
                  <Text style={st.bullet}>•</Text>
                  <Text style={[st.noteText, { color: colors.textSecondary }]}>{note}</Text>
                </View>
              ))}
            </View>
            <Text style={[st.dateText, { color: colors.textSecondary }]}>{update.date}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 16,
    borderBottomWidth: 1
  },
  backBtn: { width: 60 },
  backText: { color: '#8B5CF6', fontSize: 18 },
  title: { fontSize: 18, fontWeight: 'bold' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  versionTag: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 8,
  },
  updateTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  undoBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  undoBtnText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
  notesContainer: {
    marginBottom: 12,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  bullet: {
    fontSize: 16,
    color: '#8B5CF6',
    marginRight: 8,
    lineHeight: 20,
  },
  noteText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dateText: {
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  }
});
