import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'system' | 'dark' | 'light';

export const darkColors = {
  background: '#09090B',
  card: '#18181B',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1AA',
  border: 'rgba(255, 255, 255, 0.08)',
  inputBg: 'rgba(255, 255, 255, 0.07)',
  placeholder: '#71717A',
  buttonText: '#FFFFFF',
  userBubble: '#8B5CF6',
  assistantBubble: 'rgba(255, 255, 255, 0.07)',
  assistantText: '#E8E8E8',
  divider: 'rgba(255, 255, 255, 0.06)',
};

export const lightColors = {
  background: '#F4F4F5',
  card: '#FFFFFF',
  textPrimary: '#18181B',
  textSecondary: '#71717A',
  border: 'rgba(0, 0, 0, 0.08)',
  inputBg: '#E4E4E7',
  placeholder: '#8E8E93',
  buttonText: '#FFFFFF',
  userBubble: '#8B5CF6',
  assistantBubble: '#FFFFFF',
  assistantText: '#18181B',
  divider: 'rgba(0, 0, 0, 0.06)',
};

interface ThemeContextType {
  themeMode: ThemeMode;
  isDark: boolean;
  colors: typeof darkColors;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('dark');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTheme() {
      try {
        const storedLaunch = await SecureStore.getItemAsync('hasLaunchedBefore');
        const storedTheme = await SecureStore.getItemAsync('themeMode');
        
        if (!storedLaunch) {
          // New user -> Default to System
          await SecureStore.setItemAsync('hasLaunchedBefore', 'true');
          await SecureStore.setItemAsync('themeMode', 'system');
          setThemeModeState('system');
        } else {
          // Existing user -> Default to Dark if not set
          const initialMode = (storedTheme as ThemeMode) || 'dark';
          setThemeModeState(initialMode);
        }
      } catch (err) {
        console.warn('Failed to load theme configuration:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTheme();
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    try {
      setThemeModeState(mode);
      await SecureStore.setItemAsync('themeMode', mode);
    } catch (err) {
      console.warn('Failed to save theme configuration:', err);
    }
  };

  const isDark =
    themeMode === 'system' ? systemColorScheme === 'dark' : themeMode === 'dark';

  const colors = isDark ? darkColors : lightColors;

  if (loading) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ themeMode, isDark, colors, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
