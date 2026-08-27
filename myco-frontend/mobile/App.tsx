import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, AppState, Pressable, SafeAreaView, StyleSheet, Text, View,
} from 'react-native';

import CorrectionsScreen from './src/CorrectionsScreen';
import InboxScreen from './src/InboxScreen';
import LeaveScreen from './src/LeaveScreen';
import LoginScreen from './src/LoginScreen';
import MonthScreen from './src/MonthScreen';
import ProfileScreen from './src/ProfileScreen';
import PunchScreen from './src/PunchScreen';
import { getUnreadCount } from './src/api';
import type { Identity } from './src/auth';
import { restore, signOut } from './src/session';
import { flush } from './src/sync';
import { theme } from './src/theme';
import type { MonthDay } from './src/types';

const c = theme.color;

type Tab = 'home' | 'attendance' | 'leave' | 'inbox' | 'profile';
type AttendanceView = 'month' | 'corrections';

/**
 * The employee's attendance companion, arranged around one question: can I
 * check in right now? Home is the punch screen and nothing else. Attendance
 * holds the month and the correction flow (the way out of a broken day),
 * Leave and Inbox are theirs, Profile holds account things and the internal
 * Survey tool. Deliberately no navigation library - five tabs and one
 * sub-view do not justify a dependency.
 */
export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [attendanceView, setAttendanceView] = useState<AttendanceView>('month');
  const [correctionPrefill, setCorrectionPrefill] = useState<MonthDay | null>(null);
  const [me, setMe] = useState<Identity | null>(null);
  const [checking, setChecking] = useState(true);
  const [unread, setUnread] = useState(0);

  // Reopening the app must not ask for a password. This silently renews the
  // session from the refresh token in the Keychain; it only lands on the login
  // screen if that token is gone, expired, or HR has unbound the phone.
  useEffect(() => {
    restore()
      .then(setMe)
      .finally(() => setChecking(false));
  }, []);

  const out = useCallback(async () => {
    await signOut();
    setMe(null);
    setTab('home');
  }, []);

  // Drain anything stranded whenever the app comes back to the foreground -
  // walking out of the basement, or opening it the next morning, is exactly
  // when the connection has returned. Signed in only: a queued punch needs a
  // token to send, and retrying without one would just burn the queue.
  useEffect(() => {
    if (!me) return;
    void flush();
    void getUnreadCount().then(setUnread);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void flush();
        void getUnreadCount().then(setUnread);
      }
    });
    return () => sub.remove();
  }, [me]);

  const openCorrection = useCallback((day: MonthDay) => {
    setCorrectionPrefill(day);
    setAttendanceView('corrections');
  }, []);

  if (checking) {
    return (
      <SafeAreaView style={[s.root, s.centre]}>
        <StatusBar style="light" />
        <ActivityIndicator color={c.accent} />
      </SafeAreaView>
    );
  }

  if (!me) {
    return (
      <SafeAreaView style={s.root}>
        <StatusBar style="light" />
        <LoginScreen onSignedIn={setMe} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />

      {tab === 'attendance' && (
        <View style={s.segmented}>
          {(['month', 'corrections'] as AttendanceView[]).map((v) => (
            <Pressable
              key={v}
              onPress={() => { setAttendanceView(v); if (v === 'month') setCorrectionPrefill(null); }}
              style={[s.segment, attendanceView === v && s.segmentOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: attendanceView === v }}
            >
              <Text style={[s.segmentText, attendanceView === v && s.segmentTextOn]}>
                {v === 'month' ? 'Month' : 'Corrections'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {tab === 'home' ? <PunchScreen />
        : tab === 'attendance' ? (
          attendanceView === 'month'
            ? <MonthScreen onRequestCorrection={openCorrection} />
            : <CorrectionsScreen prefill={correctionPrefill} />
        )
        : tab === 'leave' ? <LeaveScreen />
        : tab === 'inbox' ? <InboxScreen onUnreadChange={setUnread} />
        : <ProfileScreen me={me} onSignOut={out} />}

      <View style={s.tabs}>
        <TabButton label="Check in" active={tab === 'home'} onPress={() => setTab('home')} />
        <TabButton label="Month" active={tab === 'attendance'} onPress={() => setTab('attendance')} />
        <TabButton label="Leave" active={tab === 'leave'} onPress={() => setTab('leave')} />
        <TabButton
          label="Inbox" active={tab === 'inbox'} badge={unread}
          onPress={() => setTab('inbox')}
        />
        <TabButton label="Profile" active={tab === 'profile'} onPress={() => setTab('profile')} />
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  label, active, badge = 0, onPress,
}: {
  label: string; active: boolean; badge?: number; onPress: () => void;
}) {
  return (
    <Pressable
      style={s.tab} onPress={onPress}
      accessibilityRole="tab" accessibilityState={{ selected: active }}
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
    >
      <View>
        <Text style={[s.tabText, active && s.tabTextOn]}>{label}</Text>
        {badge > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ground },
  centre: { alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line,
    backgroundColor: c.surface,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: c.ink3, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: c.accent },
  badge: {
    position: 'absolute', top: -6, right: -16, minWidth: 16, height: 16,
    borderRadius: 8, backgroundColor: c.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: c.accentInk, fontSize: 10, fontWeight: '800' },

  segmented: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: c.ground,
  },
  segment: {
    flex: 1, borderWidth: 1, borderColor: c.line, borderRadius: 8,
    paddingVertical: 9, alignItems: 'center',
  },
  segmentOn: { borderColor: c.ink, backgroundColor: c.surface2 },
  segmentText: { color: c.ink3, fontSize: 13, fontWeight: '600' },
  segmentTextOn: { color: c.ink },
});
