import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import PunchScreen from './src/PunchScreen';
import SurveyScreen from './src/SurveyScreen';
import { theme } from './src/theme';

const c = theme.color;
type Tab = 'punch' | 'survey';

export default function App() {
  const [tab, setTab] = useState<Tab>('punch');

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="light" />
      {tab === 'punch' ? <PunchScreen /> : <SurveyScreen />}

      {/* Survey is a setup tool, not a feature. It comes out before the pilot. */}
      <View style={s.tabs}>
        <Tab label="Check in" active={tab === 'punch'} onPress={() => setTab('punch')} />
        <Tab label="Survey (setup)" active={tab === 'survey'} onPress={() => setTab('survey')} />
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
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: c.ink3, fontSize: 14, fontWeight: '600' },
  tabTextOn: { color: c.accent },
});
