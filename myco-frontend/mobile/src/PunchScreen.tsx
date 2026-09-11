import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, AppState, Easing, Linking, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { getToday, submitPunch } from './api';
import { formatHoursMins, hhmm } from './format';
import { enqueue } from './queue';
import { flush, pendingCount } from './sync';
import { useTheme } from './ThemeContext';
import { theme, type ThemeColors } from './theme';
import type { PunchResult, TodayStatus } from './types';

/** Local wall-clock time, for telling someone when their punch was saved. */
function hhmmLocal(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
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

  // Real-time minute tick for shift progress
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

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
          ? `No signal - saved on your phone at ${hhmmLocal(capturedAt)} and will send itself when you are back online.`
          : Platform.OS === 'web'
            ? 'Could not reach the server, and the browser preview cannot queue offline punches.'
            : 'Could not check in and could not save it either. Please try again when you have signal.',
      });
    }
  }, [today, ringProgress]);

  // Compute shift progression (same exact logic as web check-in page)
  const shiftInfo = useMemo(() => {
    let startMinutes = 10 * 60;
    let endMinutes = 19 * 60;
    let startStr = '10:00';
    let endStr = '19:00';

    if (today?.shiftStart && today?.shiftEnd) {
      const [sh, sm] = today.shiftStart.split(':').map(Number);
      const [eh, em] = today.shiftEnd.split(':').map(Number);
      if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
        startMinutes = sh * 60 + sm;
        endMinutes = eh * 60 + em;
        startStr = today.shiftStart;
        endStr = today.shiftEnd;
      }
    } else if (today?.shiftLabel && today.shiftLabel.includes('-')) {
      const parts = today.shiftLabel.split('-').map((str) => str.trim());
      if (parts.length === 2) {
        startStr = parts[0];
        endStr = parts[1];
        const [sh, sm] = startStr.split(':').map(Number);
        const [eh, em] = endStr.split(':').map(Number);
        if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
          startMinutes = sh * 60 + sm;
          endMinutes = eh * 60 + em;
        }
      }
    }

    const totalMinutes = endMinutes > startMinutes ? endMinutes - startMinutes : 24 * 60 - startMinutes + endMinutes;
    const now = new Date();
    const currentMinuteOfDay = now.getHours() * 60 + now.getMinutes();

    let elapsedMinutes = 0;
    if (currentMinuteOfDay >= startMinutes) {
      elapsedMinutes = currentMinuteOfDay - startMinutes;
    }

    const remainingMinutes = Math.max(0, totalMinutes - elapsedMinutes);
    const progress = Math.min(100, Math.max(0, (elapsedMinutes / totalMinutes) * 100));
    const isShiftStarted = currentMinuteOfDay >= startMinutes;
    const isShiftEnded = currentMinuteOfDay >= endMinutes;

    return {
      startStr,
      endStr,
      totalMinutes,
      elapsedMinutes,
      remainingMinutes,
      progress,
      isShiftStarted,
      isShiftEnded,
    };
  }, [today]);

  if (loadError) {
    return (
      <View style={[s.screen, s.center, { padding: 24, gap: 12 }]}>
        <Text style={s.errTitle}>Couldn&apos;t reach the office server</Text>
        <Text style={s.errBody}>{loadError}</Text>
        <Pressable style={s.retryBtn} onPress={load} accessibilityRole="button">
          <Text style={s.retryText}>Try again</Text>
        </Pressable>
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
                accessibilityRole="button" accessibilityLabel="Take photo"
              >
                <View style={s.shutterInner} />
              </Pressable>
              <Pressable onPress={() => setPhase('idle')}>
                <Text style={s.cancel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  // When direction is 'out', employee has checked in and next action is Check Out.
  const isCurrentlyIn = today.direction === 'out' || (!!today.checkedInAt && !today.checkedOutAt);
  const camDenied = camPerm && !camPerm.granted && !camPerm.canAskAgain;
  const locDenied = locPerm === 'denied';

  // Circle Dimensions for SVG Progress Ring
  const CIRCLE_SIZE = 240;
  const RADIUS = 96;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ~603.18
  const strokeDashoffset = CIRCUMFERENCE * (1 - shiftInfo.progress / 100);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      {/* Top Header & Dynamic Greeting */}
      <View style={s.headerBox}>
        <Text style={s.eyebrow}>{today.officeName.toUpperCase()} · BIO GATEWAY</Text>
        <Text style={s.greeting}>
          {getGreeting()}, {today.fullName.split(' ')[0]}
        </Text>
        <Text style={s.shift}>
          {isCurrentlyIn
            ? 'Shift in Progress · You are currently checked in'
            : 'Ready to Check In · Tap below to record your punch'}
        </Text>
      </View>

      {/*
        Anything still waiting is stated plainly and permanently, not as a
        banner that disappears with the next screen. If a punch has not landed,
        the person needs to know that every time they open the app - not once.
      */}
      {pending > 0 && (
        <View style={s.pendingRow}>
          <Text style={s.pendingGlyph}>◌</Text>
          <Text style={s.pendingText}>
            {pending === 1 ? '1 punch' : `${pending} punches`} saved on this phone, waiting for signal.{' '}
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

      {/* Punch Result Banner */}
      {phase === 'result' && result && (
        <View
          style={[s.banner, result.accepted ? s.bannerOk : queued ? s.bannerWarn : s.bannerBad]}
          accessibilityLiveRegion="polite"
        >
          <Text style={s.bannerGlyph}>{result.accepted ? '✓' : queued ? '◌' : '✕'}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={s.bannerTitle}>{result.message}</Text>
            {result.distanceM !== null && (
              <Text style={s.bannerSub}>{Math.round(result.distanceM)}m from office</Text>
            )}
            {result.faceSimilarity !== null && (
              <Text style={s.bannerSub}>Face match {result.faceSimilarity.toFixed(1)}%</Text>
            )}
          </View>
        </View>
      )}

      {/* Dynamic Shift Hour Progress Ring & Centered Interactive Punch Button */}
      <View style={s.circleContainer}>
        <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="shiftGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={isCurrentlyIn ? '#fb7185' : '#38bdf8'} />
              <Stop offset="100%" stopColor={isCurrentlyIn ? '#e11d48' : '#2563eb'} />
            </LinearGradient>
          </Defs>
          {/* Background Track Ring */}
          <Circle
            cx={CIRCLE_SIZE / 2}
            cy={CIRCLE_SIZE / 2}
            r={RADIUS}
            stroke={c.surface2}
            strokeWidth={10}
            fill="none"
          />
          {/* Dynamic Shift Progress Arc */}
          <Circle
            cx={CIRCLE_SIZE / 2}
            cy={CIRCLE_SIZE / 2}
            r={RADIUS}
            stroke="url(#shiftGradient)"
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={strokeDashoffset}
            fill="none"
            transform={`rotate(-90 ${CIRCLE_SIZE / 2} ${CIRCLE_SIZE / 2})`}
          />
        </Svg>

        {/* Center Interactive Circular Button */}
        <Pressable
          style={({ pressed }) => [
            s.punchCircle,
            isCurrentlyIn ? s.punchCircleOut : s.punchCircleIn,
            pressed && s.pressed,
          ]}
          onPress={startPunch}
          accessibilityRole="button"
          accessibilityLabel={isCurrentlyIn ? 'Check out with camera' : 'Check in with camera'}
        >
          <Text style={[s.circleIcon, isCurrentlyIn ? s.circleIconOut : s.circleIconIn]}>
            {isCurrentlyIn ? '⇥' : '⇤'}
          </Text>
          <Text style={[s.circleLabel, isCurrentlyIn ? s.circleLabelOut : s.circleLabelIn]}>
            {isCurrentlyIn ? 'Check Out' : 'Check In'}
          </Text>
          <Text style={[s.circleSub, isCurrentlyIn ? s.circleSubOut : s.circleSubIn]}>
            {isCurrentlyIn && today.checkedInAt ? `In at ${hhmm(today.checkedInAt)}` : 'Tap to punch'}
          </Text>
        </Pressable>
      </View>

      {/* Live Shift Tracker Pill Indicator */}
      <View style={s.shiftProgressPill}>
        <View style={[s.pulseDot, { backgroundColor: isCurrentlyIn ? '#10b981' : '#3b82f6' }]} />
        <Text style={s.shiftProgressText}>
          Live Shift Tracker · {Math.round(shiftInfo.progress)}% Elapsed ·{' '}
          {shiftInfo.isShiftEnded
            ? 'Shift completed for today'
            : !shiftInfo.isShiftStarted
            ? `Starts in ${formatHoursMins(Math.max(0, -shiftInfo.elapsedMinutes))}`
            : `${formatHoursMins(shiftInfo.remainingMinutes)} remaining`}
        </Text>
      </View>

      {/* Daily Metrics Bento Cards (Hours Worked Today, Late By Today, Shift Schedule) */}
      <View style={s.metricsGrid}>
        {/* Card 1: Hours Worked Today */}
        <View style={s.metricCard}>
          <View style={s.metricHeader}>
            <Text style={s.metricLabel}>WORKED TODAY</Text>
            <Text style={s.metricGlyph}>⏱</Text>
          </View>
          <Text style={s.metricVal}>{formatHoursMins(today.workedMinutes)}</Text>
          <Text style={s.metricSub}>
            {isCurrentlyIn ? 'Active session' : 'Clocked today'}
          </Text>
        </View>

        {/* Card 2: Late By Today */}
        <View style={s.metricCard}>
          <View style={s.metricHeader}>
            <Text style={s.metricLabel}>LATE BY</Text>
            <Text style={s.metricGlyph}>⏳</Text>
          </View>
          <Text style={[s.metricVal, { color: today.lateMinutes > 0 ? '#f59e0b' : '#10b981' }]}>
            {today.lateMinutes > 0 ? formatHoursMins(today.lateMinutes) : '0 hrs'}
          </Text>
          <Text style={s.metricSub}>
            {today.lateMinutes > 0 ? `${today.lateMinutes}m after grace` : 'On time today'}
          </Text>
        </View>
      </View>

      {/* Card 3: Today's Shift Schedule */}
      <View style={s.shiftCard}>
        <View style={s.metricHeader}>
          <Text style={s.metricLabel}>TODAY&apos;S SHIFT</Text>
          <Text style={s.metricGlyph}>📅</Text>
        </View>
        <View style={s.shiftRow}>
          <Text style={s.shiftScheduleVal}>{today.shiftLabel}</Text>
          <Text style={s.shiftTimingSub}>
            {shiftInfo.startStr} &ndash; {shiftInfo.endStr}
          </Text>
        </View>
        <Text style={s.metricSub}>
          {today.checkedInAt
            ? `Checked in at ${hhmm(today.checkedInAt)}${today.checkedOutAt ? ` · Out at ${hhmm(today.checkedOutAt)}` : ''}`
            : 'Awaiting punch-in for today'}
        </Text>
      </View>

      {/* Bottom Check-In / Check-Out Primary Action Button */}
      <Pressable
        style={({ pressed }) => [
          s.bottomActionBtn,
          isCurrentlyIn ? s.bottomActionBtnOut : s.bottomActionBtnIn,
          pressed && s.pressed,
        ]}
        onPress={startPunch}
        accessibilityRole="button"
        accessibilityLabel={isCurrentlyIn ? 'Check out' : 'Check in'}
      >
        <Text style={s.bottomActionBtnText}>
          {isCurrentlyIn ? 'Check Out' : 'Check In'}
        </Text>
        <Text style={s.bottomActionBtnSub}>
          {isCurrentlyIn ? 'Tap to open camera & record checkout' : 'Tap to open camera & record check-in'}
        </Text>
      </Pressable>

      {/* Permission Prompts */}
      {(!camPerm?.granted || locPerm !== 'granted') && (
        <View style={s.permCard}>
          <Text style={s.permTitle}>
            {camDenied || locDenied ? 'Permission switched off' : 'Two permissions needed'}
          </Text>
          <Text style={s.permBody}>
            Camera confirms your identity; location confirms you are at the office. Both are required for biometric check-in.
          </Text>
          <Pressable
            style={s.permBtn}
            onPress={camDenied || locDenied ? () => Linking.openSettings() : askPermissions}
            accessibilityRole="button"
          >
            <Text style={s.permBtnText}>{camDenied || locDenied ? 'Open Settings' : 'Allow Permissions'}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 36, paddingBottom: 40, gap: 16 },

  headerBox: { gap: 4 },
  eyebrow: { color: c.accent, fontSize: 11, letterSpacing: 1.5, fontWeight: '700' },
  greeting: { color: c.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  shift: { color: c.ink3, fontSize: 13, marginTop: -2 },

  circleContainer: {
    width: 240, height: 240,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', marginVertical: 8,
  },
  punchCircle: {
    width: 172, height: 172, borderRadius: 86,
    alignItems: 'center', justifyContent: 'center', gap: 2,
    boxShadow: '0px 10px 24px rgba(0,0,0,0.3)', elevation: 12,
  },
  punchCircleIn: {
    backgroundColor: c.surface,
    borderWidth: 2, borderColor: '#3b82f6',
  },
  punchCircleOut: {
    backgroundColor: c.surface,
    borderWidth: 2, borderColor: '#ef4444',
  },
  pressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },

  circleIcon: { fontSize: 28, marginBottom: 2 },
  circleIconIn: { color: '#3b82f6' },
  circleIconOut: { color: '#ef4444' },

  circleLabel: { fontSize: 22, fontWeight: '900', letterSpacing: -0.3 },
  circleLabelIn: { color: '#3b82f6' },
  circleLabelOut: { color: '#ef4444' },

  circleSub: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  circleSubIn: { color: c.ink3 },
  circleSubOut: { color: '#fb7185' },

  shiftProgressPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: c.surface, borderRadius: 9999,
    borderWidth: 1, borderColor: c.line, alignSelf: 'center',
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4 },
  shiftProgressText: { color: c.ink2, fontSize: 12, fontWeight: '600' },

  metricsGrid: { flexDirection: 'row', gap: 12 },
  metricCard: {
    flex: 1, backgroundColor: c.surface, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: c.line, gap: 4,
  },
  metricHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { color: c.ink3, fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  metricGlyph: { fontSize: 13 },
  metricVal: { color: c.ink, fontSize: 24, fontWeight: '800', marginVertical: 2 },
  metricSub: { color: c.ink3, fontSize: 11 },

  shiftCard: {
    backgroundColor: c.surface, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: c.line, gap: 4,
  },
  shiftRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginVertical: 2 },
  shiftScheduleVal: { color: c.ink, fontSize: 20, fontWeight: '800' },
  shiftTimingSub: { color: c.ink3, fontSize: 13, fontWeight: '600' },

  bottomActionBtn: {
    borderRadius: 16, paddingVertical: 16, alignItems: 'center',
    boxShadow: '0px 6px 20px rgba(0,0,0,0.2)', elevation: 8, marginTop: 4,
  },
  bottomActionBtnIn: { backgroundColor: '#2563eb' },
  bottomActionBtnOut: { backgroundColor: '#e11d48' },
  bottomActionBtnText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  camera: { flex: 1 },
  cameraOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 54, paddingTop: 24, alignItems: 'center', gap: 18,
    backgroundColor: 'rgba(14,19,22,0.75)',
  },
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
    backgroundColor: c.accent, borderRadius: 8,
    paddingVertical: 11, paddingHorizontal: 28,
  },
  retryText: { color: c.accentInk, fontWeight: '700', fontSize: 15 },
});
