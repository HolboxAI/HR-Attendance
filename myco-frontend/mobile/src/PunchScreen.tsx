import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, Easing, Linking, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { getToday, submitPunch } from './api';
import { hhmm, hoursLabel } from './format';
import { enqueue } from './queue';
import { flush, pendingCount } from './sync';
import { useTheme } from './ThemeContext';
import { theme, type ThemeColors } from './theme';
import type { PunchResult, TodayStatus } from './types';

/** Local wall-clock time, for telling someone when their punch was saved. */
function hhmmLocal(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

type Phase = 'idle' | 'camera' | 'working' | 'result';

/**
 * How long the verification ring takes to sweep to full - and the MINIMUM
 * time before any verdict is shown. Rekognition often answers in a couple
 * hundred milliseconds, and an instant "you are too far" reads as the app
 * not having looked at all. 0.7s is long enough to feel like a check
 * happened, short enough to never feel like waiting.
 */
const RING_MS = 700;

/**
 * The "circle completing" animation shown while a punch verifies: a ring of
 * dots lighting up clockwise from 12 o'clock. Pure Animated views - no SVG
 * dependency - each dot's opacity keyed to its slice of the shared progress
 * value, so one native-driven timing animation sweeps the whole ring.
 */
const RING_DOTS = 28;
const RING_SIZE = 132;
const RING_RADIUS = 54;
const RING_DOT = 9;

function VerifyRing({ progress }: { progress: Animated.Value }) {
  return (
    <View style={{ width: RING_SIZE, height: RING_SIZE }} accessibilityLabel="Verifying">
      {Array.from({ length: RING_DOTS }, (_, i) => {
        const angle = (i / RING_DOTS) * 2 * Math.PI - Math.PI / 2;
        const x = RING_SIZE / 2 + Math.cos(angle) * RING_RADIUS - RING_DOT / 2;
        const y = RING_SIZE / 2 + Math.sin(angle) * RING_RADIUS - RING_DOT / 2;
        const opacity = progress.interpolate({
          inputRange: [i / RING_DOTS, Math.min(1, (i + 1) / RING_DOTS)],
          outputRange: [0.18, 1],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute', left: x, top: y,
              width: RING_DOT, height: RING_DOT, borderRadius: RING_DOT / 2,
              backgroundColor: '#FFFFFF', opacity,
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * The most important screen in the product. One dominant action - Check In or
 * Check Out, whichever applies - and a truthful answer to "am I checked in?"
 * within the first glance. Front camera only, no gallery, by PRD §7.2: a
 * photo you pick is not evidence of who is standing here now.
 */
export default function PunchScreen() {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [today, setToday] = useState<TodayStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<PunchResult | null>(null);
  const [queued, setQueued] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const [camPerm, requestCam] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState<Location.PermissionStatus | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const ringProgress = useRef(new Animated.Value(0)).current;

  const load = useCallback(() => {
    setLoadError(null);
    getToday()
      .then(setToday)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load today'));
  }, []);

  useEffect(() => {
    setPending(pendingCount());
    load();
    Location.getForegroundPermissionsAsync().then((p) => setLocPerm(p.status));
  }, [load]);

  // Reopening the app after checking in must show "Check Out", not the
  // morning's stale answer - `direction` feeds the next punch, so a stale
  // screen here is not cosmetic. Reload whenever the app comes forward.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => sub.remove();
  }, [load]);

  const askPermissions = useCallback(async () => {
    const cam = await requestCam();
    const loc = await Location.requestForegroundPermissionsAsync();
    setLocPerm(loc.status);
    return cam.granted && loc.granted;
  }, [requestCam]);

  const startPunch = useCallback(async () => {
    if (!camPerm?.granted || locPerm !== 'granted') {
      const ok = await askPermissions();
      if (!ok) return;
    }
    setResult(null);
    setQueued(false);
    setPhase('camera');
  }, [camPerm, locPerm, askPermissions]);

  const capture = useCallback(async () => {
    if (!today) return;
    setPhase('working');
    // Start the ring the moment they tap, and refuse to show ANY verdict
    // before it completes. The server usually answers faster than RING_MS,
    // and an instant rejection feels like the app never looked.
    ringProgress.setValue(0);
    Animated.timing(ringProgress, {
      toValue: 1, duration: RING_MS,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
    const revealAt = Date.now() + RING_MS;
    const holdForRing = async () => {
      const wait = revealAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    };
    // The moment the person actually tapped. If this ends up queued, this is
    // the time that travels with it - not the time it eventually syncs.
    const capturedAt = new Date();
    let photoUri = '';
    let coords: { lat: number | null; lng: number | null;
                  accuracyM: number | null; mocked: boolean } = {
      lat: null, lng: null, accuracyM: null, mocked: false,
    };

    try {
      // Photo and position are taken in the same moment on purpose - never
      // compare a selfie taken here against a location recorded elsewhere.
      const [photo, position] = await Promise.all([
        cameraRef.current?.takePictureAsync({
          // 0.9, not 0.6: this image is what Rekognition compares against the
          // enrolled photo, and 0.6 JPEG on a dim front camera reads as the
          // "photo too blurry" refusal. Bytes are cheap; a false reject at
          // the door is not.
          quality: 0.9,
          skipProcessing: true,
        }),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      ]);
      photoUri = photo?.uri ?? '';
      coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy ?? null,
        mocked: (position as { mocked?: boolean }).mocked ?? false,
      };

      const res = await submitPunch({
        photoUri,
        lat: coords.lat,
        lng: coords.lng,
        accuracyM: coords.accuracyM,
        isMocked: coords.mocked,
        direction: today.direction,
      });

      await holdForRing();
      setResult(res);
      setPhase('result');
      if (res.accepted) {
        setToday(await getToday());
        // A working connection is the best moment to clear anything stranded.
        void flush().then((r) => setPending(r.remaining));
      }
    } catch {
      // The connection died. Save the punch properly - photo, position and the
      // time it was taken - and only then tell the person it is safe.
      const saved = photoUri
        ? await enqueue({
            photoUri,
            capturedAt,
            direction: today.direction,
            lat: coords.lat,
            lng: coords.lng,
            accuracyM: coords.accuracyM,
            isMocked: coords.mocked,
          })
        : null;

      await holdForRing();
      setQueued(saved !== null);
      setPending(pendingCount());
      setPhase('result');
      setResult({
        accepted: false, direction: today.direction,
        punchedAt: capturedAt.toISOString(), distanceM: null, faceSimilarity: null,
        // Two different messages, because they are two different situations
        // and the difference matters enormously to the person reading it.
        message: saved
          ? `No signal - saved on your phone at ${hhmmLocal(capturedAt)} and will `
            + 'send itself when you are back online.'
          : Platform.OS === 'web'
            ? 'Could not reach the server, and the browser preview cannot '
              + 'queue offline punches - that part needs the phone app.'
            : 'Could not check in and could not save it either. Please try again '
              + 'when you have signal.',
      });
    }
  }, [today, ringProgress]);

  if (loadError) {
    return (
      <View style={[s.screen, s.center, { padding: 24, gap: 12 }]}>
        <Text style={s.errTitle}>Couldn&apos;t reach the office server</Text>
        <Text style={s.errBody}>{loadError}</Text>
        <Pressable style={s.retryBtn} onPress={load} accessibilityRole="button">
          <Text style={s.retryText}>Try again</Text>
        </Pressable>
        {pending > 0 && (
          <Text style={s.errBody}>
            {pending === 1 ? '1 punch is' : `${pending} punches are`} still saved
            on this phone and will sync once the server is reachable.
          </Text>
        )}
      </View>
    );
  }

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
            {phase === 'working' ? 'Verifying attendance…' : 'Look at the camera'}
          </Text>
          {phase === 'working' ? (
            <VerifyRing progress={ringProgress} />
          ) : (
            <>
              <Pressable
                style={s.shutter} onPress={capture}
                accessibilityRole="button" accessibilityLabel="Take the check-in photo"
              >
                <View style={s.shutterInner} />
              </Pressable>
              <Pressable onPress={() => setPhase('idle')} hitSlop={12} accessibilityRole="button">
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const goingIn = today.direction === 'in';
  const checkedIn = !!today.checkedInAt && !today.checkedOutAt;
  const camDenied = camPerm && !camPerm.granted && !camPerm.canAskAgain;
  const locDenied = locPerm === 'denied';

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>{today.officeName.toUpperCase()}</Text>

      {/*
        Anything still waiting is stated plainly and permanently, not as a
        banner that disappears with the next screen. If a punch has not landed,
        the person needs to know that every time they open the app - not once.
      */}
      {pending > 0 && (
        <View style={s.pendingRow}>
          <Text style={s.pendingGlyph}>◌</Text>
          <Text style={s.pendingText}>
            {pending === 1 ? '1 punch' : `${pending} punches`} saved on this phone,
            waiting for signal.{' '}
            <Text
              style={s.pendingLink}
              onPress={async () => {
                const r = await flush();
                setPending(r.remaining);
                if (r.sent > 0) setToday(await getToday());
                if (r.messages.length) setSyncNote(r.messages[0]);
              }}
            >
              Try now
            </Text>
          </Text>
        </View>
      )}
      {syncNote && <Text style={s.syncNote}>{syncNote}</Text>}

      <Text style={s.greeting}>
        {checkedIn ? 'You are checked in' : goingIn ? 'Good morning' : 'Have a good evening'}
      </Text>
      <Text style={s.shift}>
        {today.fullName.split(' ')[0]} · shift {today.shiftLabel}
      </Text>

      {phase === 'result' && result && (
        <View
          style={[s.banner, result.accepted ? s.bannerOk : queued ? s.bannerWarn : s.bannerBad]}
          accessibilityLiveRegion="polite"
        >
          <Text style={s.bannerGlyph}>
            {result.accepted ? '✓' : queued ? '◌' : '✕'}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.bannerTitle}>{result.message}</Text>
            {result.distanceM !== null && (
              <Text style={s.bannerSub}>{Math.round(result.distanceM)}m from the office</Text>
            )}
            {result.faceSimilarity !== null && (
              <Text style={s.bannerSub}>Face match {result.faceSimilarity.toFixed(1)}%</Text>
            )}
            {queued && (
              <Text style={s.bannerSub}>
                Saved, not checked in - it counts once the server accepts it.
              </Text>
            )}
          </View>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [s.punch, goingIn ? s.punchIn : s.punchOut, pressed && s.pressed]}
        onPress={startPunch}
        accessibilityRole="button"
        accessibilityLabel={goingIn ? 'Check in' : 'Check out'}
      >
        <Text style={[s.punchLabel, !goingIn && s.punchLabelOut]}>
          {goingIn ? 'Check In' : 'Check Out'}
        </Text>
        <Text style={[s.punchSub, !goingIn && s.punchLabelOut]}>Tap - the camera will open</Text>
      </Pressable>

      <View style={s.card}>
        <Text style={s.cardTitle}>TODAY</Text>
        <Row label="Checked in" value={hhmm(today.checkedInAt)} />
        <Row label="Checked out" value={hhmm(today.checkedOutAt)} />
        <Row label="Hours" value={hoursLabel(today.workedMinutes)} />
      </View>

      {(!camPerm?.granted || locPerm !== 'granted') && (
        <View style={s.permCard}>
          <Text style={s.permTitle}>
            {camDenied || locDenied ? 'Permission switched off' : 'Two permissions needed'}
          </Text>
          <Text style={s.permBody}>
            {camDenied && locDenied
              ? 'Camera and location are both off for Holbox in Settings. The camera confirms it’s you; location confirms you’re at the office. Checking in needs both.'
              : camDenied
                ? 'The camera is off for Holbox in Settings. It confirms it’s you - checking in can’t work without it.'
                : locDenied
                  ? 'Location is off for Holbox in Settings. It confirms you’re at the office - checking in can’t work without it.'
                  : 'The camera confirms it’s you. Location confirms you’re at the office. Without both, checking in can’t work.'}
          </Text>
          {camDenied || locDenied ? (
            <Pressable
              style={s.permBtn}
              onPress={() => Linking.openSettings()}
              accessibilityRole="button"
            >
              <Text style={s.permBtnText}>
                {Platform.OS === 'ios' ? 'Open Settings' : 'Open app settings'}
              </Text>
            </Pressable>
          ) : (
            <Pressable style={s.permBtn} onPress={askPermissions} accessibilityRole="button">
              <Text style={s.permBtnText}>Allow</Text>
            </Pressable>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  pendingRow: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: c.surface2, borderColor: c.warn, borderWidth: 1,
    borderRadius: 8, padding: 12, marginBottom: 4,
  },
  pendingGlyph: { color: c.warn, fontSize: 14, lineHeight: 20 },
  pendingText: { color: c.ink2, fontSize: 14, lineHeight: 20, flex: 1 },
  pendingLink: { color: c.accent, fontWeight: '600' },
  syncNote: { color: c.warn, fontSize: 13, lineHeight: 19 },
  screen: { flex: 1, backgroundColor: c.ground },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 24, paddingTop: 40, gap: 16 },

  eyebrow: { color: c.accent, fontSize: 12, letterSpacing: 1.6, fontWeight: '600' },
  greeting: { color: c.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  shift: { color: c.ink3, fontSize: 14, marginTop: -10 },

  // A circle, not a bar: the one action of the whole product gets the shape
  // of a button you press, centred where a thumb naturally rests.
  punch: {
    width: 208, height: 208, borderRadius: 104,
    alignItems: 'center', justifyContent: 'center', gap: 4,
    alignSelf: 'center', marginTop: 16, marginBottom: 8,
    boxShadow: '0px 8px 18px rgba(0,0,0,0.25)', elevation: 10,
  },
  punchIn: { backgroundColor: c.accent },
  punchOut: { backgroundColor: c.surface2, borderWidth: 2, borderColor: c.accent },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  punchLabel: {
    fontSize: 25, fontWeight: '800', color: c.accentInk,
    letterSpacing: -0.3, textAlign: 'center',
  },
  punchLabelOut: { color: c.accent },
  punchSub: {
    fontSize: 12, color: c.accentInk, opacity: 0.7,
    textAlign: 'center', paddingHorizontal: 24,
  },

  banner: {
    borderRadius: theme.radius.md, padding: 16, borderWidth: 1,
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
  },
  bannerOk: { backgroundColor: c.okBg, borderColor: c.ok },
  bannerBad: { backgroundColor: c.badBg, borderColor: c.crit },
  bannerWarn: { backgroundColor: c.warnBg, borderColor: c.warn },
  bannerGlyph: { color: c.ink, fontSize: 18, fontWeight: '700', lineHeight: 22 },
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
  // The camera overlay is a dark scrim in BOTH themes - white controls always.
  cameraHint: { color: '#FAFAFA', fontSize: 16, fontWeight: '600' },
  shutter: {
    width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF' },
  cancel: { color: '#A1A1AA', fontSize: 15 },

  errTitle: { color: c.ink, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  errBody: { color: c.ink2, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  retryBtn: {
    backgroundColor: c.accent, borderRadius: theme.radius.sm,
    paddingVertical: 11, paddingHorizontal: 28,
  },
  retryText: { color: c.accentInk, fontWeight: '700', fontSize: 15 },
});
