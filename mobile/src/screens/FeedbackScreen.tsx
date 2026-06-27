import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';

type FeedbackType = 'bug' | 'idea' | 'emotional_reaction' | 'general';

const FEEDBACK_TYPES: Array<{ key: FeedbackType; label: string; emoji: string; color: string }> = [
  { key: 'bug', label: 'Bug Report', emoji: '🐛', color: '#EF4444' },
  { key: 'idea', label: 'Feature Idea', emoji: '💡', color: '#F59E0B' },
  { key: 'emotional_reaction', label: 'Emotional Reaction', emoji: '💭', color: '#EC4899' },
  { key: 'general', label: 'General', emoji: '💬', color: '#8B5CF6' },
];

export function FeedbackScreen() {
  const navigation = useNavigation<any>();
  const [type, setType] = useState<FeedbackType>('general');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!message.trim()) {
      Alert.alert('Missing message', 'Please write your feedback before submitting.');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/feedback', {
        feedback_type: type,
        message: message.trim(),
        rating,
      });
      Alert.alert(
        'Thank you! 🙏',
        'Your feedback has been received. It genuinely helps us make Nova better.',
        [{ text: 'Done', onPress: () => navigation.goBack() }]
      );
    } catch (err) {
      Alert.alert('Failed to submit', 'Please try again in a moment.');
    } finally {
      setSubmitting(false);
    }
  }, [type, message, rating]);

  const selectedType = FEEDBACK_TYPES.find(t => t.key === type)!;

  return (
    <SafeAreaView style={fb.container} edges={['top']}>
      <View style={fb.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={fb.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={fb.title}>Send Feedback</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={fb.content}>

        <Text style={fb.subtitle}>Help us make Nova better. Every piece of feedback is read.</Text>

        {/* Type Picker */}
        <Text style={fb.label}>What kind of feedback?</Text>
        <View style={fb.typeGrid}>
          {FEEDBACK_TYPES.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[fb.typeBtn, type === t.key && { borderColor: t.color, backgroundColor: `${t.color}18` }]}
              onPress={() => setType(t.key)}
            >
              <Text style={fb.typeEmoji}>{t.emoji}</Text>
              <Text style={[fb.typeLabel, type === t.key && { color: t.color }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Message */}
        <Text style={fb.label}>Your {selectedType.label}</Text>
        <TextInput
          style={fb.textArea}
          value={message}
          onChangeText={setMessage}
          placeholder={
            type === 'bug' ? 'Describe what happened and how to reproduce it...' :
            type === 'idea' ? 'Describe your idea for a new feature...' :
            type === 'emotional_reaction' ? 'How did Nova make you feel? What surprised you?' :
            'Share anything on your mind...'
          }
          placeholderTextColor="#555"
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        {/* Rating */}
        <Text style={fb.label}>Overall rating (optional)</Text>
        <View style={fb.ratingRow}>
          {[1, 2, 3, 4, 5].map(star => (
            <TouchableOpacity key={star} onPress={() => setRating(r => r === star ? null : star)}>
              <Text style={[fb.star, rating !== null && star <= rating && fb.starActive]}>
                {rating !== null && star <= rating ? '⭐' : '☆'}
              </Text>
            </TouchableOpacity>
          ))}
          {rating && <Text style={fb.ratingLabel}>{rating}/5</Text>}
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[fb.submitBtn, submitting && fb.submitDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={fb.submitText}>Send Feedback</Text>
          }
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const fb = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#09090B' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backText: { color: '#8B5CF6', fontSize: 18, width: 60 },
  title: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  content: { padding: 16, paddingBottom: 48 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 28, lineHeight: 20 },
  label: { fontSize: 13, fontWeight: '700', color: '#888', marginBottom: 10, letterSpacing: 0.4 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  typeBtn: {
    width: '47%', padding: 14, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)'
  },
  typeEmoji: { fontSize: 24, marginBottom: 6 },
  typeLabel: { fontSize: 12, fontWeight: '600', color: '#888', textAlign: 'center' },
  textArea: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)', color: '#fff', padding: 14, fontSize: 15,
    minHeight: 140, marginBottom: 24, lineHeight: 22
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  star: { fontSize: 28, color: '#555' },
  starActive: { color: '#F59E0B' },
  ratingLabel: { fontSize: 13, color: '#888', marginLeft: 8 },
  submitBtn: {
    backgroundColor: '#8B5CF6', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center'
  },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
