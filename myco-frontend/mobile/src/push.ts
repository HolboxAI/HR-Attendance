/**
 * Real push registration - the phone half of the pipeline.
 *
 *   sign in -> ask permission -> Expo push token -> POST /mobile/push-token
 *   backend notify() -> Expo push service -> FCM -> banner on the handset
 *
 * Runs ONLY on a physical device in a standalone build: Expo web has no
 * push, simulators have no push service, and Expo Go dropped remote push
 * entirely - every one of those exits early and silently.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';

import { authHeaders } from './session';
import { apiBase } from './config';

const isExpoGo =
  Constants.appOwnership === 'expo' ||
  (Constants as any).executionEnvironment === 'storeClient';

/**
 * Call after every successful sign-in or session restore. Safe to call
 * repeatedly. Silent exit in Expo Go & Web where remote push is not supported.
 */
export async function registerForPush(): Promise<void> {
  // Completely bypass in Expo Go, Web, or simulators to prevent SDK 53+ push warnings
  if (isExpoGo || Platform.OS === 'web' || !Device.isDevice) return;

  try {
    const Notifications = await import('expo-notifications');

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('attendance', {
        name: 'Attendance',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    const { status } = await Notifications.getPermissionsAsync();
    let granted = status === 'granted';
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    const res = await fetch(`${apiBase()}/api/v1/mobile/push-token`, {
      method: 'POST',
      headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ push_token: token }),
    });
    if (!res.ok) {
      console.warn('push token not stored:', res.status);
    }
  } catch (err) {
    console.warn('push registration skipped:', err);
  }
}
