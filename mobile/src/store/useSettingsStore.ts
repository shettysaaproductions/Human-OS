import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as SecureStore from 'expo-secure-store';

export type LanguagePreference = 'en' | 'hi' | 'auto';

interface SettingsState {
  language: LanguagePreference;
  setLanguage: (lang: LanguagePreference) => void;
}

const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await SecureStore.getItemAsync(name)) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await SecureStore.deleteItemAsync(name);
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      language: 'auto',
      setLanguage: (lang) => set({ language: lang }),
    }),
    {
      name: 'app-settings',
      storage: createJSONStorage(() => secureStorage),
    }
  )
);
