import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { OFFICE_NAME, getToday, submitPunch } from './api';
import { theme } from './theme';
import type { PunchResult, SimulateCase, TodayStatus } from './types';

const c = theme.color;

type Phase = 'idle' | 'camera' | 'working' | 'result';

export default function PunchScreen() {
  const [today, setToday] = useState<TodayStatus | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<PunchResult | null>(null);
  const [queued, setQueued] = useState(false);
  const [simulate, setSimulate] = useState<SimulateCase>('success');

  const [camPerm, requestCam] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState<boolean | null>(null);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    getToday().then(setToday);
    Location.getForegroundPermissionsAsync().then((p) => setLocPerm(p.granted));
  }, []);

  const askPermissions = useCallback(async () => {
    const cam = await requestCam();
    const loc = await Location.requestForegroundPermissionsAsync();
    setLocPerm(loc.granted);
    return cam.granted && loc.granted;
  }, [requestCam]);

  const startPunch = useCallback(async () => {
    if (!camPerm?.granted || !locPerm) {
      const ok = await askPermissions();
      if (!ok) return;
    }
    setResult(null);
    setPhase('camera');
  }, [camPerm, locPerm, askPermissions]);

  const capture = useCallback(async () => {
    if (!today) return;
    setPhase('working');
    try {
      // Photo and position are taken in the same moment on purpose - never
      // compare a selfie taken here against a location recorded elsewhere.
      const [photo, position] = await Promise.all([
        cameraRef.current?.takePictureAsync({ quality: 0.6, skipProcessing: true }),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      ]);

      const res = await submitPunch({
        photoUri: photo?.uri ?? '',
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? null,
        isMocked: (position as { mocked?: boolean }).mocked ?? false,
        direction: today.direction,
        simulate,
      });

      setResult(res);
      setPhase('result');
      if (res.accepted) setToday(await getToday());
    } catch {
      // Never lose a punch to a dead connection. It syncs when signal returns.
      setQueued(true);
      setPhase('result');
      setResult({
        accepted: false, direction: today.direction,
        punchedAt: new Date().toISOString(), distanceM: null, faceSimilarity: null,
        message: 'No signal - saved on your phone and will sync automatically',
      });
    }
  }, [today, simulate]);

  if (!today) {
    return (
      <View style={[s.screen, s.center]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  if (phase === 'camera' || phase === 'working') {
    return (
      <View style={s.screen}>
        <CameraView ref={cameraRef} style={s.camera} facing="front" />
        <View style={s.cameraOverlay}>
          <Text style={s.cameraHint}>
            {phase === 'working' ? 'Checking…' : 'Look at the camera'}
          </Text>
          {phase === 'working' ? (
            <ActivityIndicator color={c.accent} size="large" />
          ) : (
            <>
              <Pressable style={s.shutter} onPress={capture}>
                <View style={s.shutterInner} />
              </Pressable>
              <Pressable onPress={() => setPhase('idle')} hitSlop={12}>
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const goingIn = today.direction === 'in';

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>{OFFICE_NAME.toUpperCase()}</Text>
      <Text style={s.greeting}>{goingIn ? 'Good morning' : 'Have a good evening'}</Text>
      <Text style={s.shift}>Your shift &middot; {today.shiftLabel}</Text>

      {phase === 'result' && result && (
        <View style={[s.banner, result.accepted ? s.bannerOk : queued ? s.bannerWarn : s.bannerBad]}>
          <Text style={s.bannerTitle}>{result.message}</Text>
          {result.distanceM !== null && (
            <Text style={s.bannerSub}>{Math.round(result.distanceM)}m from the office</Text>
          )}
          {result.faceSimilarity !== null && (
            <Text style={s.bannerSub}>Face match {result.faceSimilarity.toFixed(1)}%</Text>
          )}
        </View>
      )}

      <Pressable
        style={({ pressed }) => [s.punch, goingIn ? s.punchIn : s.punchOut, pressed && s.pressed]}
        onPress={startPunch}
        accessibilityRole="button"
        accessibilityLabel={goingIn ? 'Check in' : 'Check out'}
      >
        <Text style={s.punchLabel}>{goingIn ? 'Check In' : 'Check Out'}</Text>
        <Text style={s.punchSub}>Tap - the camera will open</Text>
      </Pressable>

      <View style={s.card}>
        <Text style={s.cardTitle}>Today</Text>
        <Row label="Checked in" value={today.checkedInAt ?? '—'} />
        <Row label="Checked out" value={today.checkedOutAt ?? '—'} />
        <Row
          label="Hours"
          value={today.workedMinutes
            ? `${Math.floor(today.workedMinutes / 60)}h ${today.workedMinutes % 60}m`
            : '—'}
        />
      </View>

      {(!camPerm?.granted || !locPerm) && (
        <View style={s.permCard}>
          <Text style={s.permTitle}>Two permissions needed</Text>
          <Text style={s.permBody}>
            The camera confirms it&apos;s you. Location confirms you&apos;re at the office.
            Without both, checking in can&apos;t work.
          </Text>
          <Pressable style={s.permBtn} onPress={askPermissions}>
            <Text style={s.permBtnText}>Allow</Text>
          </Pressable>
        </View>
      )}

      {/* Dev panel - delete before the pilot. Lets us show every rejection
          path to HR without anyone driving to the car park. */}
      <View style={s.devCard}>
        <Text style={s.devTitle}>DEMO: force a result</Text>
        <View style={s.devRow}>
          {(['success', 'too_far', 'mock_gps', 'wrong_wifi', 'face_mismatch', 'no_signal'] as SimulateCase[])
            .map((k) => (
              <Pressable
                key={k}
                onPress={() => { setSimulate(k); setQueued(false); }}
                style={[s.devChip, simulate === k && s.devChipOn]}
              >
                <Text style={[s.devChipText, simulate === k && s.devChipTextOn]}>
                  {k.replace(/_/g, ' ')}
                </Text>
              </Pressable>
            ))}
        </View>
      </View>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 24, paddingTop: 72, gap: 16 },

  eyebrow: { color: c.accent, fontSize: 12, letterSpacing: 1.6, fontWeight: '600' },
  greeting: { color: c.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  shift: { color: c.ink3, fontSize: 14, marginTop: -10 },

  punch: {
    borderRadius: theme.radius.lg, paddingVertical: 34, alignItems: 'center', gap: 4,
    marginTop: 8,
  },
  punchIn: { backgroundColor: c.accent },
  punchOut: { backgroundColor: c.surface2, borderWidth: 1, borderColor: c.accent },
  pressed: { opacity: 0.85 },
  punchLabel: { fontSize: 26, fontWeight: '800', color: c.accentInk, letterSpacing: -0.3 },
  punchSub: { fontSize: 13, color: c.accentInk, opacity: 0.7 },

  banner: { borderRadius: theme.radius.md, padding: 16, borderWidth: 1, gap: 2 },
  bannerOk: { backgroundColor: '#12291F', borderColor: c.ok },
  bannerBad: { backgroundColor: '#2A1512', borderColor: c.crit },
  bannerWarn: { backgroundColor: '#2A2213', borderColor: c.warn },
  bannerTitle: { color: c.ink, fontSize: 16, fontWeight: '600' },
  bannerSub: { color: c.ink3, fontSize: 13 },

  card: {
    backgroundColor: c.surface, borderRadius: theme.radius.md, padding: 18,
    borderWidth: 1, borderColor: c.line, gap: 2,
  },
  cardTitle: { color: c.ink3, fontSize: 12, letterSpacing: 1.4, fontWeight: '600', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  rowLabel: { color: c.ink2, fontSize: 15 },
  rowValue: { color: c.ink, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },

  permCard: {
    backgroundColor: c.surface, borderRadius: theme.radius.md, padding: 18,
    borderWidth: 1, borderColor: c.warn, gap: 8,
  },
  permTitle: { color: c.ink, fontSize: 16, fontWeight: '700' },
  permBody: { color: c.ink2, fontSize: 14, lineHeight: 20 },
  permBtn: {
    backgroundColor: c.accent, borderRadius: theme.radius.sm,
    paddingVertical: 11, alignItems: 'center', marginTop: 4,
  },
  permBtnText: { color: c.accentInk, fontWeight: '700', fontSize: 15 },

  camera: { flex: 1 },
  cameraOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 54, paddingTop: 24, alignItems: 'center', gap: 18,
    backgroundColor: 'rgba(14,19,22,0.72)',
  },
  cameraHint: { color: c.ink, fontSize: 16, fontWeight: '600' },
  shutter: {
    width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: c.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: c.accent },
  cancel: { color: c.ink3, fontSize: 15 },

  devCard: {
    borderRadius: theme.radius.md, padding: 14, borderWidth: 1,
    borderColor: c.line, borderStyle: 'dashed', gap: 10, marginTop: 8,
  },
  devTitle: { color: c.ink3, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  devChip: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: theme.radius.pill,
    borderWidth: 1, borderColor: c.line,
  },
  devChipOn: { borderColor: c.accent, backgroundColor: '#33270F' },
  devChipText: { color: c.ink3, fontSize: 12 },
  devChipTextOn: { color: c.accent, fontWeight: '600' },
});
