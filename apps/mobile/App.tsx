import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View,
} from 'react-native';

import LeaveScreen from './src/LeaveScreen';
import LoginScreen from './src/LoginScreen';
import PunchScreen from './src/PunchScreen';
import SurveyScreen from './src/SurveyScreen';
import type { Identity } from './src/auth';
import { restore, signOut } from './src/session';
import { theme } from './src/theme';

const c = theme.color;
type Tab = 'punch' | 'leave' | 'survey';

export default function App() {
  const [tab, setTab] = useState<Tab>('punch');
  const [me, setMe] = useState<Identity | null>(null);
  const [checking, setChecking] = useState(true);

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

      {/* Who is signed in, always visible. On a shared-looking device the one
          thing you must never have to guess is whose attendance you are about
          to mark. */}
      <View style={s.who}>
        <Text style={s.whoText} numberOfLines={1}>
          {me.full_name ?? me.email}
          {me.employee_code ? <Text style={s.whoCode}>  {me.employee_code}</Text> : null}
        </Text>
        <Pressable onPress={out} accessibilityRole="button" hitSlop={8}>
          <Text style={s.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {tab === 'punch' ? <PunchScreen />
        : tab === 'leave' ? <LeaveScreen />
        : <SurveyScreen />}

      {/* Survey is a setup tool, not a feature. It comes out before the pilot. */}
      <View style={s.tabs}>
        <Tab label="Check in" active={tab === 'punch'} onPress={() => setTab('punch')} />
        <Tab label="Leave" active={tab === 'leave'} onPress={() => setTab('leave')} />
        <Tab label="Survey" active={tab === 'survey'} onPress={() => setTab('survey')} />
      </View>
    </SafeAreaView>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={s.tab} onPress={onPress}>
      <Text style={[s.tabText, active && s.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ground },
  centre: { alignItems: 'center', justifyContent: 'center' },
  who: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surface,
  },
  whoText: { color: c.ink2, fontSize: 13, flex: 1 },
  whoCode: { color: c.ink3, fontSize: 12 },
  signOut: { color: c.ink3, fontSize: 12 },
  tabs: {
    flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line,
    backgroundColor: c.surface,
  },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: c.ink3, fontSize: 14, fontWeight: '600' },
  tabTextOn: { color: c.accent },
});
