/**
 * Session storage for the phone.
 *
 * Tokens go in expo-secure-store, which is the Keychain on iOS and
 * EncryptedSharedPreferences on Android. Never AsyncStorage: that is a plain
 * file on disk, readable by anything with access to the sandbox, and a
 * long-lived refresh token sitting in cleartext is the whole game.
 *
 * The install id is generated once per installation and identifies the HANDSET,
 * not the person. It is what the server binds to an employee, so that a stolen
 * password alone is not enough to punch.
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
};

export type Session = { access: string; refresh: string; identity: Identity };

let cached: Session | null = null;

function uuid(): string {
  // Good enough to be unique per install; it is an identifier, not a secret -
  // the server decides what it is allowed to do.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function installId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL);
  if (existing) return existing;
  const fresh = uuid();
  await SecureStore.setItemAsync(INSTALL, fresh);
  return fresh;
}

export async function loadSession(): Promise<Session | null> {
  if (cached) return cached;
  const [access, refresh, identity] = await Promise.all([
    SecureStore.getItemAsync(ACCESS),
    SecureStore.getItemAsync(REFRESH),
    SecureStore.getItemAsync(IDENTITY),
  ]);
  if (!access || !refresh || !identity) return null;
  cached = { access, refresh, identity: JSON.parse(identity) as Identity };
  return cached;
}

export async function saveSession(s: Session): Promise<void> {
  cached = s;
  await Promise.all([
    SecureStore.setItemAsync(ACCESS, s.access),
    SecureStore.setItemAsync(REFRESH, s.refresh),
    SecureStore.setItemAsync(IDENTITY, JSON.stringify(s.identity)),
  ]);
}

export async function clearSession(): Promise<void> {
  cached = null;
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS),
    SecureStore.deleteItemAsync(REFRESH),
    SecureStore.deleteItemAsync(IDENTITY),
  ]);
  // The install id deliberately SURVIVES sign-out. It identifies the handset,
  // and wiping it on every sign-out would make each sign-in look like a brand
  // new phone and burn through the employee's device binding.
}

export function platformName(): string {
  return Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown';
}
