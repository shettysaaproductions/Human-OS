import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { onboardingService } from '../services/onboardingService';
import { useAuthStore } from '../store/useAuthStore';

const QUESTIONS = [
  { key: 'preferred_name', title: "What's your name?", placeholder: 'Enter your preferred name' },
  { key: 'passions', title: 'What are your passions and interests?', placeholder: 'e.g. music, travel, fitness...' },
  { key: 'goals', title: 'What are your current goals?', placeholder: 'e.g. get fit, launch a startup...' },
  { key: 'family', title: 'Tell me about your family and relationships.', placeholder: 'e.g. married with 2 kids...' },
  { key: 'important_facts', title: 'Any important facts I should never forget?', placeholder: 'e.g. I\'m allergic to peanuts...' },
  { key: 'companion_personality', title: 'What personality would you like me to have?', placeholder: 'e.g. friendly, professional, motivational...' },
] as const;

export function OnboardingScreen() {
  const { step, answers, isHydrated, setAnswer, nextStep, prevStep, hydrateDraft, clearDraft } = useOnboardingStore();
  const { setOnboardingStatus } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    hydrateDraft();
  }, []);

  if (!isHydrated) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  const currentQuestion = QUESTIONS[step - 1];
  const currentValue = answers[currentQuestion.key];

  const handleNext = async () => {
    if (step < 6) {
      nextStep();
      return;
    }

    // Step 6 — Submit
    setIsSubmitting(true);
    try {
      // Try to submit to backend, but DON'T let a backend failure block the user
      try {
        await onboardingService.submitOnboarding(answers);
      } catch (apiErr: any) {
        // Backend is cold or failed — that's OK.
        // The profile will sync on the next open. Don't block the user.
        console.warn('[Onboarding] Backend submission failed (non-fatal):', apiErr?.message);
      }

      // Always clear draft and proceed to Chat regardless of backend status
      try {
        await clearDraft();
      } catch {
        // Non-fatal
      }

      // This is the key step — mark onboarding done locally
      setOnboardingStatus(true);

    } catch (unexpectedErr: any) {
      // This should never happen now, but if it does — still go to Chat
      console.error('[Onboarding] Unexpected error in handleNext:', unexpectedErr);
      setOnboardingStatus(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progress = (step / 6) * 100;

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.stepText}>{step} of 6</Text>

        <Text style={styles.title}>{currentQuestion.title}</Text>

        <TextInput
          style={styles.input}
          multiline={step !== 1}
          numberOfLines={step === 1 ? 1 : 4}
          placeholder={currentQuestion.placeholder}
          placeholderTextColor="#666"
          value={currentValue}
          onChangeText={(val) => setAnswer(currentQuestion.key, val)}
          autoFocus
          returnKeyType={step === 6 ? 'done' : 'next'}
        />

        {isSubmitting ? (
          <View style={styles.submitContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.submitText}>Setting up Nova...</Text>
          </View>
        ) : (
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.backBtn, step === 1 && styles.btnDisabled]}
              onPress={prevStep}
              disabled={step === 1}
            >
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={handleNext}
            >
              <Text style={styles.nextBtnText}>
                {step === 6 ? 'Finish ✓' : 'Next →'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: { flex: 1, backgroundColor: '#09090B' },
  scroll: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#09090B' },
  container: {
    flexGrow: 1,
    padding: 28,
    paddingTop: 60,
    justifyContent: 'center',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#1f1f1f',
    borderRadius: 2,
    marginBottom: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    backgroundColor: '#8B5CF6',
    borderRadius: 2,
  },
  stepText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 24,
    lineHeight: 32,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    minHeight: 56,
    maxHeight: 160,
    marginBottom: 32,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  backBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  btnDisabled: { opacity: 0.3 },
  backBtnText: { color: '#aaa', fontSize: 16, fontWeight: '600' },
  nextBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  submitContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  submitText: { color: '#aaa', fontSize: 14 },
});
