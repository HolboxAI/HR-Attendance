/**
 * Where the API lives - configuration, not code, and since the standalone
 * APK exists, not even a rebuild.
 *
 * Three layers, weakest first:
 *   1. fallback 127.0.0.1 - keeps the iOS simulator and Expo web working
 *      with zero setup (they share the laptop's network; a phone does not).
 *   2. EXPO_PUBLIC_API_BASE - baked in at build time (eas.json env for EAS
 *      builds, .env for local expo start).
 *   3. a runtime override saved on the device - set from the login screen's
 *      "Server" row. This exists because the baked address is the laptop's
 *      LAN IP *on the day of the build*, and the first real APK died the
 *      moment the laptop changed networks. An address that can rot must be
 *      editable where it is used.
 *
 * The API must be started with ./run.sh --lan, and phone + laptop on the
 * same network, hotspots included.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const env = (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_BASE;

const BUILT_IN = (env ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');

const OVERRIDE_KEY = 'bx.api_base_override';

let current = BUILT_IN;

/** The address every request should use RIGHT NOW. */
export function apiBase(): string {
  return current;
}

export const API_BASE_DEFAULT = BUILT_IN;

/** Call once at startup, before anything fetches. */
export async function loadApiBaseOverride(): Promise<void> {
  try {
    if (Platform.OS === 'web') return; // web preview always reaches 127.0.0.1
    const saved = await SecureStore.getItemAsync(OVERRIDE_KEY);
    if (saved) current = saved.replace(/\/+$/, '');
  } catch {
    /* no override is a fine state */
  }
}

/** Empty/null clears the override and returns to the built-in address. */
export async function setApiBaseOverride(url: string | null): Promise<string> {
  const cleaned = (url ?? '').trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      current = cleaned.startsWith('http') ? cleaned : `http://${cleaned}`;
      await SecureStore.setItemAsync(OVERRIDE_KEY, current);
    } else {
      current = BUILT_IN;
      await SecureStore.deleteItemAsync(OVERRIDE_KEY);
    }
  } catch {
    /* storage refused (web) - the in-memory value still applies this run */
  }
  return current;
}
