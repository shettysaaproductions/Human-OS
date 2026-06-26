import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface OnboardingAnswers {
  preferred_name: string;
  passions: string;
  goals: string;
  family: string;
  important_facts: string;
  companion_personality: string;
}

interface OnboardingState {
  step: number;
  answers: OnboardingAnswers;
  isHydrated: boolean;
  
  setAnswer: (key: keyof OnboardingAnswers, value: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  hydrateDraft: () => Promise<void>;
  clearDraft: () => Promise<void>;
}

const defaultAnswers: OnboardingAnswers = {
  preferred_name: '',
  passions: '',
  goals: '',
  family: '',
  important_facts: '',
  companion_personality: ''
};

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  step: 1,
  answers: defaultAnswers,
  isHydrated: false,

  setAnswer: async (key, value) => {
    set((state) => {
      const newAnswers = { ...state.answers, [key]: value };
      // Save draft in background
      SecureStore.setItemAsync('onboardingDraft', JSON.stringify({ step: state.step, answers: newAnswers })).catch(console.error);
      return { answers: newAnswers };
    });
  },

  nextStep: async () => {
    set((state) => {
      const newStep = Math.min(state.step + 1, 6);
      SecureStore.setItemAsync('onboardingDraft', JSON.stringify({ step: newStep, answers: state.answers })).catch(console.error);
      return { step: newStep };
    });
  },

  prevStep: async () => {
    set((state) => {
      const newStep = Math.max(state.step - 1, 1);
      SecureStore.setItemAsync('onboardingDraft', JSON.stringify({ step: newStep, answers: state.answers })).catch(console.error);
      return { step: newStep };
    });
  },

  hydrateDraft: async () => {
    try {
      const draft = await SecureStore.getItemAsync('onboardingDraft');
      if (draft) {
        const parsed = JSON.parse(draft);
        set({ step: parsed.step || 1, answers: parsed.answers || defaultAnswers, isHydrated: true });
      } else {
        set({ isHydrated: true });
      }
    } catch (error) {
      console.error('Failed to load onboarding draft', error);
      set({ isHydrated: true });
    }
  },

  clearDraft: async () => {
    await SecureStore.deleteItemAsync('onboardingDraft');
    set({ step: 1, answers: defaultAnswers });
  }
}));
