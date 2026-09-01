import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { OFFICE, haversineM } from './geo';
import { useTheme } from './ThemeContext';
import { theme, type ThemeColors } from './theme';

type Sample = {
  at: string;
  lat: number;
  lng: number;
  accuracy: number;
  distance: number;
  label: string;
};

/**
 * Location survey.
 *
 * A map pin can sit 100m from the building you actually work in, and 100m is
 * most of a geofence. So instead of trusting the pin, walk the building with
 * this screen open and record real readings: at your desk, at reception, at
 * the gate, in the car park.
 *
 * Two things fall out of that walk:
 *   1. the true office centre (average of the indoor samples)
 *   2. the radius that admits every desk and excludes the car park
 *
 * If those two can't both be satisfied, that is itself the finding - it means
 * GPS alone won't do it here and we go WIFI_REQUIRED.
 */
export default function SurveyScreen() {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [live, setLive] = useState<Location.LocationObject | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sub = useRef<Location.LocationSubscription | null>(null);

  useEffect(() => {
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setError('Location permission is needed to survey the office');
        return;
      }
      sub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1500, distanceInterval: 0 },
        setLive,
      );
    })();
    return () => sub.current?.remove();
  }, []);

  const record = useCallback((label: string) => {
    if (!live) return;
    const { latitude, longitude, accuracy } = live.coords;
    setSamples((prev) => [
      {
        at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        lat: latitude,
        lng: longitude,
        accuracy: accuracy ?? -1,
        distance: haversineM(latitude, longitude, OFFICE.lat, OFFICE.lng),
        label,
      },
      ...prev,
    ]);
  }, [live]);

  const indoor = samples.filter((s) => s.label === 'Desk' || s.label === 'Reception');
  const suggestedLat = indoor.length ? indoor.reduce((a, s) => a + s.lat, 0) / indoor.length : null;
  const suggestedLng = indoor.length ? indoor.reduce((a, s) => a + s.lng, 0) / indoor.length : null;

  const acc = live?.coords.accuracy ?? null;
  const dist = live ? haversineM(live.coords.latitude, live.coords.longitude, OFFICE.lat, OFFICE.lng) : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>LOCATION SURVEY</Text>
      <Text style={s.title}>Walk the building</Text>
      <Text style={s.body}>
        Stand somewhere, wait for the accuracy number to settle, then tap where you are.
        Do all four spots. The numbers below decide the real geofence.
      </Text>

      {error && <Text style={s.error}>{error}</Text>}

      <View style={s.live}>
        <Text style={s.liveLabel}>RIGHT NOW</Text>
        {live ? (
          <>
            <Text style={s.coords}>
              {live.coords.latitude.toFixed(6)}, {live.coords.longitude.toFixed(6)}
            </Text>
            <View style={s.metrics}>
              <Metric
                label="Accuracy"
                value={acc !== null ? `${acc.toFixed(0)}m` : '—'}
                tone={acc === null ? 'dim' : acc <= 20 ? 'ok' : acc <= 60 ? 'warn' : 'bad'}
              />
              <Metric
                label="From pin"
                value={dist !== null ? `${dist.toFixed(0)}m` : '—'}
                tone={dist === null ? 'dim' : dist <= OFFICE.radiusM ? 'ok' : 'bad'}
              />
            </View>
          </>
        ) : (
          <Text style={s.waiting}>Acquiring GPS…</Text>
        )}
      </View>

      <View style={s.buttons}>
        {['Desk', 'Reception', 'Gate', 'Car park'].map((label) => (
          <Pressable key={label} style={s.recBtn} onPress={() => record(label)} disabled={!live}>
            <Text style={s.recBtnText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {suggestedLat !== null && suggestedLng !== null && (
        <View style={s.suggest}>
          <Text style={s.suggestLabel}>SUGGESTED OFFICE CENTRE</Text>
          <Text style={s.coords}>
            {suggestedLat.toFixed(6)}, {suggestedLng.toFixed(6)}
          </Text>
          <Text style={s.suggestNote}>
            Averaged from {indoor.length} indoor reading{indoor.length === 1 ? '' : 's'}.
            Send these to replace the provisional numbers.
          </Text>
        </View>
      )}

      {samples.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>READINGS</Text>
          {samples.map((sm, i) => (
            <View key={i} style={s.sample}>
              <Text style={s.sampleLabel}>{sm.label}</Text>
              <Text style={s.sampleCoords}>
                {sm.lat.toFixed(6)}, {sm.lng.toFixed(6)}
              </Text>
              <Text style={s.sampleMeta}>
                ±{sm.accuracy.toFixed(0)}m · {sm.distance.toFixed(0)}m from pin · {sm.at}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'dim' }) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const color = tone === 'ok' ? c.ok : tone === 'warn' ? c.warn : tone === 'bad' ? c.crit : c.ink3;
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 24, paddingTop: 40, gap: 14 },
  eyebrow: { color: c.accent, fontSize: 12, letterSpacing: 1.6, fontWeight: '600' },
  title: { color: c.ink, fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  body: { color: c.ink2, fontSize: 15, lineHeight: 21 },
  error: { color: c.crit, fontSize: 14 },

  live: {
    backgroundColor: c.surface, borderRadius: theme.radius.md, padding: 18,
    borderWidth: 1, borderColor: c.line, gap: 10,
  },
  liveLabel: { color: c.ink3, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  coords: { color: c.ink, fontSize: 19, fontWeight: '600', fontVariant: ['tabular-nums'] },
  waiting: { color: c.ink3, fontSize: 15 },
  metrics: { flexDirection: 'row', gap: 28 },
  metric: { gap: 2 },
  metricLabel: { color: c.ink3, fontSize: 12 },
  metricValue: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },

  buttons: { flexDirection: 'column', gap: 8 },
  recBtn: {
    flexGrow: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.accent,
    borderRadius: theme.radius.sm, paddingVertical: 13, alignItems: 'center',
  },
  recBtnText: { color: c.accent, fontWeight: '700', fontSize: 15 },

  suggest: {
    backgroundColor: c.hiBg, borderRadius: theme.radius.md, padding: 16,
    borderWidth: 1, borderColor: c.accent, gap: 6,
  },
  suggestLabel: { color: c.accent, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  suggestNote: { color: c.ink2, fontSize: 13, lineHeight: 18 },

  card: {
    backgroundColor: c.surface, borderRadius: theme.radius.md, padding: 16,
    borderWidth: 1, borderColor: c.line, gap: 12,
  },
  cardTitle: { color: c.ink3, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  sample: { gap: 2, borderTopWidth: 1, borderTopColor: c.line, paddingTop: 10 },
  sampleLabel: { color: c.accent, fontSize: 13, fontWeight: '700' },
  sampleCoords: { color: c.ink, fontSize: 15, fontVariant: ['tabular-nums'] },
  sampleMeta: { color: c.ink3, fontSize: 12, fontVariant: ['tabular-nums'] },
});
