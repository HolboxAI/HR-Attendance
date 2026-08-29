/**
 * Real push registration - the phone half of the pipeline.
 *
 *   sign in -> ask permission -> Expo push token -> POST /mobile/push-token
 *   backend notify() -> Expo push service -> FCM -> banner on the handset
 *
 * Runs ONLY on a physical device in a standalone build: Expo web has no
 * push, simulators have no push service, and Expo Go dropped remote push
 * entirely - every one of those exits early and silently, because a missing
 * banner must never break sign-in. The Inbox row remains the source of
 * truth either way (the PRD's rule); the banner is the courtesy on top.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { authHeaders } from './session';
import { apiBase } from './config';

// A notification arriving while the app is OPEN still shows as a banner -
// "you haven't punched out" is exactly as relevant with the app foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Call after every successful sign-in or session restore. Safe to call
 * repeatedly - re-registering the same token is an overwrite, and every
 * early exit below is deliberate, not an error.
 */
export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS === 'web') return;          // browsers use the web app
    if (!Device.isDevice) return;               // simulators cannot receive push

    if (Platform.OS === 'android') {
      // HIGH importance is what makes an attendance nudge a real banner
      // with sound instead of a silent tray line. The channel id matches
      // channelId in the backend's ExpoPushSender.
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
    if (!granted) return;                       // their call; the Inbox still works

    // The EAS project id is stamped into the build by `eas init`. Its
    // absence means this is not a standalone build - nothing to register.
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
    // Push is a courtesy. A registration failure must never surface as a
    // sign-in problem - log it and move on; the next launch retries.
    console.warn('push registration skipped:', err);
  }
}
