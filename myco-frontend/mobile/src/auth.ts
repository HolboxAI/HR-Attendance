/**
 * Session storage for the phone with web preview fallback.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ACCESS = 'bx.access';
const REFRESH = 'bx.refresh';
const IDENTITY = 'bx.identity';
const INSTALL = 'bx.install_id';

export type Identity = {
  user_id: string;
  email: string;
  role: string;
  employee_id: string | null;
  employee_code: string | null;
  full_name: string | null;
  can_punch: boolean;
  is_admin: boolean;
  correction_limit: number;
};

export type Session = { access: string; refresh: string; identity: Identity };

let cached: Session | null = null;

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getStorageItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {}
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {}
}

async function deleteStorageItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch {}
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}

export async function installId(): Promise<string> {
  const existing = await getStorageItem(INSTALL);
  if (existing) return existing;
  const fresh = uuid();
  await setStorageItem(INSTALL, fresh);
  return fresh;
}

export async function loadSession(): Promise<Session | null> {
  if (cached) return cached;
  const [access, refresh, identity] = await Promise.all([
    getStorageItem(ACCESS),
    getStorageItem(REFRESH),
    getStorageItem(IDENTITY),
  ]);
  if (!access || !refresh || !identity) return null;
  try {
    cached = { access, refresh, identity: JSON.parse(identity) as Identity };
    return cached;
  } catch {
    return null;
  }
}

export async function saveSession(s: Session): Promise<void> {
  cached = s;
  await Promise.all([
    setStorageItem(ACCESS, s.access),
    setStorageItem(REFRESH, s.refresh),
    setStorageItem(IDENTITY, JSON.stringify(s.identity)),
  ]);
}

export async function clearSession(): Promise<void> {
  cached = null;
  await Promise.all([
    deleteStorageItem(ACCESS),
    deleteStorageItem(REFRESH),
    deleteStorageItem(IDENTITY),
  ]);
}

export function platformName(): string {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
}
