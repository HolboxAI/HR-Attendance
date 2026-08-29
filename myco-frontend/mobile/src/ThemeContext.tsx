/**
 * The appearance switch. One context, two palettes, a preference saved on the
 * device - the same SecureStore pattern as the server override in config.ts,
 * and for the same reason: a choice made on a phone should survive the app
 * being closed without a server round-trip.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { darkColors, lightColors, type ThemeColors } from './theme';

export type ThemeMode = 'dark' | 'light';

const MODE_KEY = 'bx.theme_mode';

const Ctx = createContext<{
  c: ThemeColors;
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}>({ c: darkColors, mode: 'dark', setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'web') return; // web preview keeps the default
        const saved = await SecureStore.getItemAsync(MODE_KEY);
        if (saved === 'light' || saved === 'dark') setModeState(saved);
      } catch {
        /* no saved preference is a fine state */
      }
    })();
  }, []);

  const value = useMemo(() => ({
    c: mode === 'light' ? lightColors : darkColors,
    mode,
    setMode: (m: ThemeMode) => {
      setModeState(m);
      // Fire-and-forget: the in-memory value already applies this run.
      SecureStore.setItemAsync(MODE_KEY, m).catch(() => undefined);
    },
  }), [mode]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
