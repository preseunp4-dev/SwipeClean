import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const ColorContext = createContext();

const STORAGE_KEY = 'swipeclean_colorblind';
const THEME_KEY = 'swipeclean_theme';

const NORMAL = {
  red: '#FF3B30',
  green: '#4CD964',
  undo: '#FFD60A',
  undoBg: 'rgba(255, 214, 10, 0.1)',
  redBg: 'rgba(255, 59, 48, 0.15)',
  greenBg: 'rgba(76, 217, 100, 0.15)',
  redBgStrong: 'rgba(255, 59, 48, 0.8)',
  redBgSubtle: 'rgba(255, 59, 48, 0.12)',
  redBgLight: 'rgba(255, 59, 48, 0.1)',
  greenBgLight: 'rgba(76, 217, 100, 0.1)',
};

const COLORBLIND_BASE = {
  red: '#007AFF',
  green: '#FFD60A',
  redBg: 'rgba(0, 122, 255, 0.15)',
  greenBg: 'rgba(255, 214, 10, 0.15)',
  redBgStrong: 'rgba(0, 122, 255, 0.8)',
  redBgSubtle: 'rgba(0, 122, 255, 0.12)',
  redBgLight: 'rgba(0, 122, 255, 0.1)',
  greenBgLight: 'rgba(255, 214, 10, 0.1)',
};

const DARK_THEME = {
  bg: '#111',
  card: '#1c1c1e',
  border: '#333',
  text: '#fff',
  textSecondary: '#888',
  textTertiary: '#666',
  textQuaternary: '#555',
  overlay: 'rgba(0,0,0,0.7)',
  overlayLight: 'rgba(0,0,0,0.3)',
  overlaySubtle: 'rgba(0,0,0,0.25)',
  headerGradient: ['rgba(17,17,17,1)', 'rgba(17,17,17,1)', 'rgba(17,17,17,0.92)', 'rgba(17,17,17,0.78)', 'rgba(17,17,17,0.58)', 'rgba(17,17,17,0.35)', 'rgba(17,17,17,0.15)', 'rgba(17,17,17,0.05)', 'rgba(17,17,17,0)'],
  pill: 'rgba(0,0,0,0.5)',
  progressBg: 'rgba(255,255,255,0.2)',
  progressFill: '#fff',
  accent: '#5856D6',
  dotInactive: '#333',
  selectCircle: 'rgba(0,0,0,0.3)',
  shareBtn: 'rgba(255,255,255,0.08)',
  modalBg: 'rgba(0,0,0,0.95)',
  thumbBorder: 'rgba(255,255,255,0.6)',
  isDark: true,
};

const LIGHT_THEME = {
  bg: '#f2f2f7',
  card: '#fff',
  border: '#d1d1d6',
  text: '#000',
  textSecondary: '#666',
  textTertiary: '#888',
  textQuaternary: '#aaa',
  overlay: 'rgba(0,0,0,0.5)',
  overlayLight: 'rgba(0,0,0,0.15)',
  overlaySubtle: 'rgba(0,0,0,0.1)',
  headerGradient: ['rgba(242,242,247,1)', 'rgba(242,242,247,1)', 'rgba(242,242,247,0.92)', 'rgba(242,242,247,0.78)', 'rgba(242,242,247,0.58)', 'rgba(242,242,247,0.35)', 'rgba(242,242,247,0.15)', 'rgba(242,242,247,0.05)', 'rgba(242,242,247,0)'],
  pill: 'rgba(0,0,0,0.4)',
  progressBg: 'rgba(0,0,0,0.12)',
  progressFill: '#333',
  accent: '#5856D6',
  dotInactive: '#c7c7cc',
  selectCircle: 'rgba(0,0,0,0.1)',
  shareBtn: 'rgba(0,0,0,0.06)',
  modalBg: 'rgba(0,0,0,0.85)',
  thumbBorder: 'rgba(0,0,0,0.15)',
  isDark: false,
};

export function ColorProvider({ children }) {
  const [colorblind, setColorblind] = useState(false);
  const [isDark, setIsDark] = useState(Appearance.getColorScheme() !== 'light');

  const hasManualTheme = useRef(false);

  useEffect(() => {
    Promise.all([
      SecureStore.getItemAsync(STORAGE_KEY),
      SecureStore.getItemAsync(THEME_KEY),
    ]).then(([cbVal, themeVal]) => {
      if (cbVal === 'true') setColorblind(true);
      if (themeVal) {
        hasManualTheme.current = true;
        setIsDark(themeVal !== 'light');
      }
    }).catch((e) => console.warn('Failed to load settings:', e.message));
  }, []);

  // Follow system theme changes unless user has manually toggled
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      if (!hasManualTheme.current) {
        setIsDark(colorScheme !== 'light');
      }
    });
    return () => sub.remove();
  }, []);

  const toggle = useCallback(() => {
    setColorblind((prev) => !prev);
  }, []);

  const toggleTheme = useCallback(() => {
    hasManualTheme.current = true;
    setIsDark((prev) => !prev);
  }, []);

  useEffect(() => {
    SecureStore.setItemAsync(STORAGE_KEY, colorblind ? 'true' : 'false').catch(() => {});
  }, [colorblind]);

  useEffect(() => {
    SecureStore.setItemAsync(THEME_KEY, isDark ? 'dark' : 'light').catch(() => {});
  }, [isDark]);

  const colors = colorblind
    ? { ...COLORBLIND_BASE, undo: isDark ? '#FFFFFF' : '#333333', undoBg: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)' }
    : NORMAL;
  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  return (
    <ColorContext.Provider value={{ colors, colorblind, toggle, theme, isDark, toggleTheme }}>
      {children}
    </ColorContext.Provider>
  );
}

export function useColors() {
  const context = useContext(ColorContext);
  if (!context) throw new Error('useColors must be used within ColorProvider');
  return context;
}
