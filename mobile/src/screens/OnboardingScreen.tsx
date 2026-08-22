import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Animated, KeyboardAvoidingView,
  Platform, ScrollView, Dimensions,
} from 'react-native';
import { useOnboardingStore } from '../store/useOnboardingStore';
import { onboardingService } from '../services/onboardingService';
import { useAuthStore } from '../store/useAuthStore';

const { width } = Dimensions.get('window');

// Nova-branded, conversational questions — written as if Nova is asking them
const QUESTIONS = [
  {
    key: 'preferred_name',
    nova: 'Hey! Main Nova hoon — tumhari apni best friend. 😊\n\nPehle bata, tumhara naam kya hai? Jo naam se tum chahte ho main tumhe bulaun?',
    placeholder: 'e.g. Rahul, Priya, Sonu...',
    multiline: false,
    emoji: '👋',
  },
  {
    key: 'passions',
    nova: 'Bahut acha naam hai!\n\nAb bata — kya cheez hai jo tumhe genuinely excite karti hai? Koi hobby, interest, subject — jo tumhara time bhi jata hai aur mood bhi acha rehta hai?',
    placeholder: 'e.g. coding, music, cricket, cooking, travel...',
    multiline: true,
    emoji: '🔥',
  },
  {
    key: 'goals',
    nova: 'Nice! Mujhe ye janna tha.\n\nAbhi is time mein tumhara koi goal hai? Kuch jo tum achieve karna chahte ho — career, health, habit, kuch bhi?',
    placeholder: 'e.g. startup build karni hai, 10kg lose karna hai, UPSC crack karna...',
    multiline: true,
    emoji: '🎯',
  },
  {
    key: 'family',
    nova: 'Goals sun ke acha laga! Main help karungi.\n\nAb apne baare mein thoda aur bata — ghar mein kaun kaun hai? Aur koi close friend ya important relationship jo mujhe pata hona chahiye?',
    placeholder: 'e.g. parents, siblings, partner, best friend...',
    multiline: true,
    emoji: '❤️',
  },
  {
    key: 'important_facts',
    nova: 'Acha! Tumhare baare mein ek important cheez aur —\n\nKuch aisa jo tum chahte ho main kabhi bhool na jaun? Koi health issue, allergy, koi old dream, ya kuch aise facts jo tum hamesha mujhe yaad dilwana chahte ho?',
    placeholder: 'e.g. diabetic hoon, ex se heartbreak hua tha, lawyer banana hai...',
    multiline: true,
    emoji: '📌',
  },
] as const;

type QuestionKey = typeof QUESTIONS[number]['key'];
type Answers = Record<QuestionKey, string>;

const TOTAL = QUESTIONS.length;

export function OnboardingScreen() {
  const { step, answers, isHydrated, setAnswer, nextStep, prevStep, hydrateDraft, clearDraft } = useOnboardingStore();
  const { setOnboardingStatus } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const prevStep_ = useRef(step);

  useEffect(() => { hydrateDraft(); }, []);

  // Animate question transitions
  useEffect(() => {
    if (!isHydrated) return;
    const dir = step >= prevStep_.current ? 30 : -30;
    prevStep_.current = step;
    fadeAnim.setValue(0);
    slideAnim.setValue(dir);
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 14, useNativeDriver: true }),
    ]).start();
  }, [step, isHydrated]);

  if (!isHydrated) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={s.loadingText}>Loading...</Text>
      </View>
    );
  }

  const q = QUESTIONS[step - 1];
  const currentValue = (answers as Answers)[q.key] ?? '';

  const handleNext = async () => {
    if (!currentValue.trim()) {
      Alert.alert('Ek second', 'Thoda kuch likh do pehle! Main wait kar sakti hoon 😊');
      return;
    }
    if (step < TOTAL) {
      nextStep();
    } else {
      setIsSubmitting(true);
      try {
        await onboardingService.submitOnboarding(answers);
        await clearDraft();
        setOnboardingStatus(true);
      } catch (err: any) {
        Alert.alert('Oops!', err.response?.data?.error || err.message || 'Kuch gadbad ho gayi. Dobara try karo.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
    >
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header: Nova avatar + progress */}
        <View style={s.header}>
          <View style={s.avatarRing}>
            <Text style={s.avatarEmoji}>{q.emoji}</Text>
          </View>
          <Text style={s.novaLabel}>Nova</Text>
        </View>

        {/* Progress dots */}
        <View style={s.dots}>
          {QUESTIONS.map((_, i) => (
            <View
              key={i}
              style={[
                s.dot,
                i + 1 === step && s.dotActive,
                i + 1 < step && s.dotDone,
              ]}
            />
          ))}
        </View>

        {/* Nova's message bubble */}
        <Animated.View
          style={[s.novaBubble, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        >
          <Text style={s.novaText}>{q.nova}</Text>
        </Animated.View>

        {/* User input */}
        <Animated.View
          style={[s.inputWrapper, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        >
          <TextInput
            style={[s.input, q.multiline && s.inputMultiline]}
            placeholder={q.placeholder}
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={currentValue}
            onChangeText={(val) => setAnswer(q.key, val)}
            multiline={q.multiline}
            autoFocus
            returnKeyType={q.multiline ? 'default' : 'done'}
          />
        </Animated.View>

        {/* Nav buttons */}
        <View style={s.nav}>
          {step > 1 && (
            <TouchableOpacity style={s.backBtn} onPress={prevStep}>
              <Text style={s.backBtnText}>← Back</Text>
            </TouchableOpacity>
          )}
          {isSubmitting ? (
            <View style={s.nextBtn}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <TouchableOpacity style={s.nextBtn} onPress={handleNext}>
              <Text style={s.nextBtnText}>
                {step === TOTAL ? 'Start Chatting 🚀' : 'Next →'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={s.hint}>{step} of {TOTAL}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const PURPLE = '#8B5CF6';
const DARK = '#09090B';

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: DARK },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 40 },
  loadingContainer: { flex: 1, backgroundColor: DARK, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: '#999', fontSize: 14 },
  header: { alignItems: 'center', marginBottom: 20 },
  avatarRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderWidth: 2, borderColor: 'rgba(139,92,246,0.4)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 8,
  },
  avatarEmoji: { fontSize: 30 },
  novaLabel: { color: PURPLE, fontWeight: '700', fontSize: 16, letterSpacing: 0.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 28 },
  dot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dotActive: { backgroundColor: PURPLE, width: 24 },
  dotDone: { backgroundColor: 'rgba(139,92,246,0.4)' },
  novaBubble: {
    backgroundColor: 'rgba(139,92,246,0.12)',
    borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
    borderRadius: 16, borderTopLeftRadius: 4,
    padding: 18, marginBottom: 24,
  },
  novaText: { color: '#E8E8F0', fontSize: 16, lineHeight: 24 },
  inputWrapper: { marginBottom: 24 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12, padding: 16,
    fontSize: 16, color: '#FFFFFF',
    minHeight: 52,
  },
  inputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  nav: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  backBtn: {
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  backBtnText: { color: '#aaa', fontSize: 15 },
  nextBtn: {
    flex: 1, backgroundColor: PURPLE,
    paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  nextBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center', marginTop: 20 },
});
