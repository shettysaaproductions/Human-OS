import { api } from './api';

export interface OnboardingAnswers {
  preferred_name: string;
  passions: string;
  goals: string;
  family: string;
  important_facts: string;
  companion_personality: string;
}

export const onboardingService = {
  submitOnboarding: async (answers: OnboardingAnswers) => {
    const response = await api.post('/onboarding', answers);
    return response.data;
  },

  getStatus: async () => {
    const response = await api.get('/onboarding/status');
    return response.data;
  }
};
