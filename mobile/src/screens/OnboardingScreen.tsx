import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { onboardingService } from '../services/onboardingService';
import { useAuthStore } from '../store/useAuthStore';

const QUESTIONS = [
  { key: 'preferred_name', title: 'What is your preferred name?' },
  { key: 'passions', title: 'What are your passions and interests?' },
  { key: 'goals', title: 'What are your current goals?' },
  { key: 'family', title: 'Tell me about your family and relationships.' },
  { key: 'important_facts', title: 'Any important facts I should never forget?' },
  { key: 'companion_personality', title: 'What personality would you like me to have?' }
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
      <View style={styles.container}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const currentQuestion = QUESTIONS[step - 1];
  const currentValue = answers[currentQuestion.key];

  const handleNext = async () => {
    if (!currentValue.trim()) {
      Alert.alert('Required', 'Please enter an answer to continue.');
      return;
    }

    if (step < 6) {
      nextStep();
    } else {
      // Submit
      setIsSubmitting(true);
      try {
        await onboardingService.submitOnboarding(answers);
        await clearDraft();
        setOnboardingStatus(true); // Triggers navigation to Chat
      } catch (err: any) {
        Alert.alert('Error', err.response?.data?.error || err.message || 'Failed to submit onboarding');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>Step {step} of 6</Text>
      <Text style={styles.title}>{currentQuestion.title}</Text>
      
      <TextInput
        style={styles.input}
        multiline={step !== 1} // Name is single line
        placeholder="Type your answer here..."
        value={currentValue}
        onChangeText={(val) => setAnswer(currentQuestion.key, val)}
      />

      {isSubmitting ? (
        <ActivityIndicator size="large" />
      ) : (
        <View style={styles.buttonRow}>
          <Button title="Back" onPress={prevStep} disabled={step === 1} color="#888" />
          <Button title={step === 6 ? "Finish" : "Next"} onPress={handleNext} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#09090B',
  },
  progress: {
    fontSize: 14,
    color: '#A1A1AA',
    marginBottom: 8,
    textAlign: 'center'
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
    color: '#FFFFFF',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    minHeight: 50,
    maxHeight: 150,
    marginBottom: 32,
    textAlignVertical: 'top',
    color: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20
  }
});

