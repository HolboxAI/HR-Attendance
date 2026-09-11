import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, AppState, KeyboardAvoidingView, Pressable,
  StyleSheet, Text, View,
} from 'react-native';
import {
  SafeAreaProvider, SafeAreaView, useSafeAreaInsets,
} from 'react-native-safe-area-context';

import CorrectionsScreen from './src/CorrectionsScreen';
import InboxScreen from './src/InboxScreen';
import LeaveScreen from './src/LeaveScreen';
import LoginScreen from './src/LoginScreen';
import MonthScreen from './src/MonthScreen';
import ProfileScreen from './src/ProfileScreen';
import PunchScreen from './src/PunchScreen';
import WFHRequestScreen from './src/WFHRequestScreen';
import { getUnreadCount, getEnrolmentStatus } from './src/api';
import OnboardingGuideModal from './src/OnboardingGuideModal';
import type { Identity } from './src/auth';
import { loadApiBaseOverride } from './src/config';
import { registerForPush } from './src/push';
import { restore, signOut } from './src/session';
import { flush } from './src/sync';
import { TubelightTabBar } from './src/TubelightTabBar';
import { ThemeProvider, useTheme } from './src/ThemeContext';
import type { ThemeColors } from './src/theme';
import type { MonthDay } from './src/types';

type Tab = 'home' | 'attendance' | 'leave' | 'inbox' | 'profile';
type AttendanceView = 'month' | 'corrections' | 'wfh';

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * The employee's attendance companion, arranged around one question: can I
 * check in right now? Check-in sits in the CENTRE of the tab bar - the main
 * action lives where thumbs live. Attendance holds the month and the
 * correction flow (the way out of a broken day), Leave and Inbox are theirs,
 * Profile holds account things, appearance and the internal Survey tool.
 * Deliberately no navigation library - five tabs and one sub-view do not
 * justify a dependency.
 */
function AppInner() {
  const { c, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(c), [c]);

  const [tab, setTab] = useState<Tab>('home');
  const [attendanceView, setAttendanceView] = useState<AttendanceView>('month');
  const [correctionPrefill, setCorrectionPrefill] = useState<MonthDay | null>(null);
  const [me, setMe] = useState<Identity | null>(null);
  const [checking, setChecking] = useState(true);
  const [unread, setUnread] = useState(0);
  const [showGuide, setShowGuide] = useState(false);

  // Reopening the app must not ask for a password. This silently renews the
  // session from the refresh token in the Keychain; it only lands on the login
  // screen if that token is gone, expired, or HR has unbound the phone.
  useEffect(() => {
    // The saved server override must be in force before restore() makes the
    // first request, or a phone on a new network signs in against a dead IP.
    loadApiBaseOverride()
      .then(restore)
      .then(setMe)
      .finally(() => setChecking(false));
  }, []);

  // Whoever is signed in gets their phone registered for push - after
  // login AND after a silent restore, because a reinstalled app or a
  // rotated token re-announces itself here. Every failure mode inside is
  // swallowed on purpose; a banner is a courtesy, the Inbox is the truth.
  useEffect(() => {
    if (me) registerForPush();
  }, [me]);

  // First-time onboarding guide: if employee has no face enrolled yet,
  // guide them with blurred backdrop and auto-approval.
  useEffect(() => {
    if (!me || !me.employee_id) return;
    if (me.face_enrolled === false) {
      setShowGuide(true);
      return;
    }
    getEnrolmentStatus()
      .then((st) => {
        if (!st.enrolled) setShowGuide(true);
      })
      .catch(() => {});
  }, [me]);

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

  const statusBar = <StatusBar style={mode === 'light' ? 'dark' : 'light'} />;

  if (checking) {
    return (
      <SafeAreaView style={[s.root, s.centre]}>
        {statusBar}
        <ActivityIndicator color={c.accent} />
      </SafeAreaView>
    );
  }

  if (!me) {
    return (
      // The login screen is a brand surface and stays dark in both themes.
      <SafeAreaView style={s.loginRoot}>
        <StatusBar style="light" />
        <LoginScreen onSignedIn={setMe} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      {statusBar}

      {/* Android with edge-to-edge no longer resizes the window for the
          keyboard, so without this padding a focused field near the bottom
          of any form disappears under it. Wrapping content AND tab bar means
          the bar rides above the keyboard rather than being buried. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {tab === 'attendance' && (
          <View style={s.segmented}>
            {(['month', 'corrections', 'wfh'] as AttendanceView[]).map((v) => (
              <Pressable
                key={v}
                onPress={() => { setAttendanceView(v); if (v === 'month') setCorrectionPrefill(null); }}
                style={[s.segment, attendanceView === v && s.segmentOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: attendanceView === v }}
              >
                <Text style={[s.segmentText, attendanceView === v && s.segmentTextOn]}>
                  {v === 'month' ? 'Month' : v === 'corrections' ? 'Corrections' : 'WFH'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'home' ? <PunchScreen />
          : tab === 'attendance' ? (
            attendanceView === 'month'
              ? <MonthScreen onRequestCorrection={openCorrection} />
              : attendanceView === 'corrections'
                ? <CorrectionsScreen prefill={correctionPrefill} />
                : <WFHRequestScreen prefill={null} />
          )
          : tab === 'leave' ? <LeaveScreen />
          : tab === 'inbox' ? <InboxScreen onUnreadChange={setUnread} />
          : <ProfileScreen me={me} onSignOut={out} />}

        {/* bottomInset keeps the pill clear of Android's gesture/nav bar
            and the iPhone home indicator; phones with hardware keys get the
            small base padding. Check in keeps the centre - thumbs live there. */}
        <TubelightTabBar
          items={[
            { key: 'leave', label: 'Leave' },
            { key: 'attendance', label: 'Month' },
            { key: 'home', label: 'Check in' },
            { key: 'inbox', label: 'Inbox', badge: unread },
            { key: 'profile', label: 'Profile' },
          ]}
          activeKey={tab}
          onPress={(key) => setTab(key as Tab)}
          bottomInset={insets.bottom}
        />
      </KeyboardAvoidingView>

      <OnboardingGuideModal
        visible={showGuide}
        employeeName={me.full_name}
        employeeCode={me.employee_code}
        onCompleted={() => {
          setShowGuide(false);
          setMe((prev) => (prev ? { ...prev, face_enrolled: true } : prev));
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ground },
  loginRoot: { flex: 1, backgroundColor: '#000000' },
  centre: { alignItems: 'center', justifyContent: 'center' },

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
