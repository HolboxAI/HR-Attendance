import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { setPassword } from './api';
import { CameraView, useCameraPermissions } from 'expo-camera';

import * as ImagePicker from 'expo-image-picker';

import SurveyScreen from './SurveyScreen';
import {
  cancelEnrolmentPhoto, getEnrolmentStatus, submitEnrolmentPhoto, type EnrolmentStatus,
} from './api';
import { useTheme, type ThemeMode } from './ThemeContext';
import { theme, type ThemeColors } from './theme';
import type { Identity } from './auth';

/**
 * Account things: who is signed in, changing the temporary password HR handed
 * over, the internal Survey tool, and sign out. Survey lives here rather than
 * in the tab bar because it is a setup instrument, not something an employee
 * uses twice.
 */
export default function ProfileScreen({
  me, onSignOut,
}: {
  me: Identity;
  onSignOut: () => void;
}) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [survey, setSurvey] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [enrolStatus, setEnrolStatus] = useState<EnrolmentStatus | null>(null);
  const [enrolError, setEnrolError] = useState<string | null>(null);

  const loadEnrol = useCallback(async () => {
    setEnrolError(null);
    try {
      setEnrolStatus(await getEnrolmentStatus());
    } catch (err) {
      setEnrolError(err instanceof Error ? err.message : 'Could not load enrolment');
    }
  }, []);

  useEffect(() => { void loadEnrol(); }, [loadEnrol]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEnrol();
    setRefreshing(false);
  }, [loadEnrol]);

  if (survey) {
    return (
      <View style={s.screen}>
        <Pressable onPress={() => setSurvey(false)} style={s.back} accessibilityRole="button">
          <Text style={s.backText}>‹ Back to profile</Text>
        </Pressable>
        <SurveyScreen />
      </View>
    );
  }

  return (
    <ScrollView 
      style={s.screen} 
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} />}
    >
      <Text style={s.title}>Profile</Text>

      <View style={s.card}>
        <Text style={s.name}>{me.full_name ?? me.email}</Text>
        <Text style={s.meta}>
          {me.employee_code ? `${me.employee_code} · ` : ''}{me.email}
        </Text>
        <Text style={s.meta}>Role: {me.role.replace('_', ' ')}</Text>
      </View>

      <WorkplaceCard me={me} />

      <FaceEnrolmentCard status={enrolStatus} error={enrolError} onUpdateStatus={setEnrolStatus} />

      <PasswordCard />

      <AppearanceCard />

      <PreferencesCard />

      {(me.role === 'admin' || me.role === 'hr') && (
        <View style={s.card}>
          <Text style={s.cardTitle}>OFFICE SETUP</Text>
          <Text style={s.body}>
            Calibrated GPS survey tool to record coordinates and calibrate the
            office geofence perimeter.
          </Text>
          <Pressable style={s.secondaryBtn} onPress={() => setSurvey(true)} accessibilityRole="button">
            <Text style={s.secondaryText}>Open Survey</Text>
          </Pressable>
        </View>
      )}

      <Pressable style={s.signOut} onPress={onSignOut} accessibilityRole="button">
        <Text style={s.signOutText}>Sign out</Text>
      </Pressable>
      <Text style={s.note}>
        Signing out preserves your device registration on this phone.
      </Text>
    </ScrollView>
  );
}

/**
 * Workplace and employment policy metadata (matches web settings).
 */
function WorkplaceCard({ me }: { me: Identity }) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>WORKPLACE & EMPLOYMENT</Text>
      <View style={s.detailGrid}>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>ORGANIZATION</Text>
          <Text style={s.detailValue}>Holbox AI / IIMA Ventures</Text>
        </View>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>{me.role === 'admin' ? 'ADMIN CODE' : 'EMPLOYEE CODE'}</Text>
          <Text style={s.detailValueMono}>{me.employee_code || 'HB001'}</Text>
        </View>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>ATTENDANCE PUNCH</Text>
          <Text style={[s.detailValue, { color: '#10b981', fontWeight: '700' }]}>
            ✓ Allowed on Handset / Web
          </Text>
        </View>
        <View style={s.detailRow}>
          <Text style={s.detailLabel}>MONTHLY CORRECTION LIMIT</Text>
          <Text style={s.detailValueMono}>7 requests / month</Text>
        </View>
      </View>
    </View>
  );
}

/**
 * Display & alert preferences.
 */
function PreferencesCard() {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('12h');
  const [punchAlerts, setPunchAlerts] = useState(true);
  const [leaveAlerts, setLeaveAlerts] = useState(true);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>PREFERENCES & NOTIFICATIONS</Text>
      <Text style={s.body}>Customize time display and alerts.</Text>

      <Text style={s.label}>Time Format</Text>
      <View style={s.modeRow}>
        {(['12h', '24h'] as const).map((fmt) => (
          <Pressable
            key={fmt}
            style={[s.modeBtn, timeFormat === fmt && s.modeBtnOn]}
            onPress={() => setTimeFormat(fmt)}
            accessibilityRole="button"
          >
            <Text style={[s.modeText, timeFormat === fmt && s.modeTextOn]}>
              {fmt === '12h' ? '12-Hour (AM/PM)' : '24-Hour (14:00)'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[s.label, { marginTop: 14 }]}>Alert Notifications</Text>
      <Pressable
        style={s.toggleRow}
        onPress={() => setPunchAlerts(!punchAlerts)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: punchAlerts }}
      >
        <Text style={s.toggleLabel}>🔔 Daily shift punch reminders</Text>
        <View style={[s.toggleSwitch, punchAlerts && s.toggleSwitchOn]}>
          <View style={[s.toggleKnob, punchAlerts && s.toggleKnobOn]} />
        </View>
      </Pressable>
      <Pressable
        style={s.toggleRow}
        onPress={() => setLeaveAlerts(!leaveAlerts)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: leaveAlerts }}
      >
        <Text style={s.toggleLabel}>📅 Leave status & approval alerts</Text>
        <View style={[s.toggleSwitch, leaveAlerts && s.toggleSwitchOn]}>
          <View style={[s.toggleKnob, leaveAlerts && s.toggleKnobOn]} />
        </View>
      </Pressable>
    </View>
  );
}

/**
 * Dark or light, chosen by the person holding the phone and remembered on
 * the device. Two named options, not a toggle - a switch labelled only by
 * position violates the "always a word and a glyph" rule.
 */
function AppearanceCard() {
  const { c, mode, setMode } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>APPEARANCE</Text>
      <Text style={s.body}>How the app looks on this phone.</Text>
      <View style={s.modeRow}>
        {([['dark', '◑ Dark'], ['light', '○ Light']] as [ThemeMode, string][]).map(([m, label]) => (
          <Pressable
            key={m}
            style={[s.modeBtn, mode === m && s.modeBtnOn]}
            onPress={() => setMode(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[s.modeText, mode === m && s.modeTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function FaceEnrolmentCard({ 
  status, error, onUpdateStatus 
}: { 
  status: EnrolmentStatus | null; 
  error: string | null; 
  onUpdateStatus: (s: EnrolmentStatus) => void; 
}) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const displayError = localError || error;

  async function openCamera() {
    setLocalError(null);
    if (!camPerm?.granted) {
      const r = await requestCam();
      if (!r.granted) {
        setLocalError('Camera permission is needed to take your reference photo.');
        return;
      }
    }
    setCamera(true);
  }

  async function capture() {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const shot = await cameraRef.current?.takePictureAsync({
        quality: 0.7,
        skipProcessing: true,
      });
      if (!shot?.uri) throw new Error('Could not capture a photo');
      const next = await submitEnrolmentPhoto(shot.uri);
      onUpdateStatus(next);
      setCamera(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not submit the photo');
    } finally {
      setBusy(false);
    }
  }

  async function pickImage() {
    setLocalError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setBusy(true);
        const next = await submitEnrolmentPhoto(result.assets[0].uri);
        onUpdateStatus(next);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not upload the photo');
    } finally {
      setBusy(false);
    }
  }

  async function cancelSubmission() {
    if (busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const next = await cancelEnrolmentPhoto();
      onUpdateStatus(next);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not cancel the submission');
    } finally {
      setBusy(false);
    }
  }

  const line = !status
    ? 'Loading…'
    : status.enrolled && status.pending
      ? 'Enrolled · a replacement photo is waiting for approval'
      : status.enrolled
        ? 'Enrolled · check-ins verify against your photo'
        : status.pending
          ? 'Waiting for an admin to approve your photo'
          : status.lastDecision === 'rejected'
            ? `Rejected: ${status.lastNote ?? 'retake and submit again'}`
            : 'Not enrolled - without a reference photo the face check cannot run';

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>FACE ENROLMENT</Text>
      <Text style={s.body}>{line}</Text>

      <Modal visible={camera} animationType="slide" onRequestClose={() => setCamera(false)}>
        <View style={s.modalScreen}>
          <CameraView ref={cameraRef} style={s.modalCamera} facing="front" />
          <View style={s.modalOverlay}>
            <Text style={s.modalHint}>Look at the camera</Text>
            <Pressable
              style={s.modalShutter} onPress={capture}
              accessibilityRole="button" accessibilityLabel="Take the photo"
              disabled={busy}
            >
              <View style={s.modalShutterInner} />
            </Pressable>
            <Pressable onPress={() => setCamera(false)} hitSlop={12} accessibilityRole="button">
              <Text style={s.modalCancel}>Cancel</Text>
            </Pressable>
            {busy && (
              <View style={[StyleSheet.absoluteFill, s.modalBusy]}>
                <ActivityIndicator color={c.accent} size="large" />
                <Text style={s.modalHint}>Submitting…</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {status?.pending ? (
        <Pressable style={s.secondaryBtn} onPress={cancelSubmission} disabled={busy} accessibilityRole="button">
          <Text style={s.secondaryText}>{busy ? 'Cancelling...' : 'Take that image back'}</Text>
        </Pressable>
      ) : (
        <View style={s.actionRow}>
          <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={openCamera} accessibilityRole="button">
            <Text style={s.secondaryText}>{status?.enrolled ? 'New (Camera)' : 'Camera'}</Text>
          </Pressable>
          <Pressable style={[s.secondaryBtn, { flex: 1 }]} onPress={pickImage} disabled={busy} accessibilityRole="button">
            <Text style={s.secondaryText}>{busy ? '...' : (status?.enrolled ? 'New (Files)' : 'Upload File')}</Text>
          </Pressable>
        </View>
      )}

      {displayError && <Text style={s.enrolError}>○ {displayError}</Text>}
      <Text style={s.note}>
        Straight at the camera, good light, nobody else in frame. An admin
        approves it before it goes live - it never activates itself.
      </Text>
    </View>
  );
}


function PasswordCard() {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const getPasswordStrength = (pwd: string) => {
    if (!pwd) return 0;
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (pwd.length >= 12) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd) || /[^A-Za-z0-9]/.test(pwd)) score += 1;
    return score;
  };
  const strength = getPasswordStrength(next);
  const strengthLabels = ['', 'Weak', 'Fair', 'Strong', 'Excellent'];
  const strengthColors = ['', '#f43f5e', '#f59e0b', '#3b82f6', '#10b981'];

  async function submit() {
    setError(null);
    setDone(false);
    if (!current || !next) {
      setError('Enter your current password and the new one.');
      return;
    }
    if (next !== confirm) {
      setError('The new password and its confirmation do not match.');
      return;
    }
    setBusy(true);
    // Length and sameness rules are the server's; whatever it refuses with is
    // shown verbatim rather than inventing client-side rules it may not have.
    const refusal = await setPassword(current, next);
    setBusy(false);
    if (refusal) {
      setError(refusal);
      return;
    }
    setDone(true);
    setCurrent(''); setNext(''); setConfirm('');
  }

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>CHANGE PASSWORD</Text>
      <Text style={s.body}>
        New hires: this is where the temporary password HR handed you gets
        replaced. Changing it signs out your other sessions.
      </Text>

      <Text style={s.label}>Current password</Text>
      <TextInput
        style={s.input} value={current} onChangeText={setCurrent}
        secureTextEntry={!show} editable={!busy}
        accessibilityLabel="Current password"
      />
      <Text style={s.label}>New password</Text>
      <TextInput
        style={s.input} value={next} onChangeText={setNext}
        secureTextEntry={!show} editable={!busy}
        accessibilityLabel="New password"
      />
      {next.length > 0 && (
        <View style={s.strengthBox}>
          <View style={s.strengthBars}>
            {[1, 2, 3, 4].map((level) => (
              <View
                key={level}
                style={[
                  s.strengthBar,
                  level <= strength && { backgroundColor: strengthColors[strength] },
                ]}
              />
            ))}
          </View>
          <Text style={[s.strengthText, { color: strengthColors[strength] }]}>
            {strengthLabels[strength]}
          </Text>
        </View>
      )}
      <Text style={s.label}>Confirm new password</Text>
      <TextInput
        style={s.input} value={confirm} onChangeText={setConfirm}
        secureTextEntry={!show} editable={!busy}
        accessibilityLabel="Confirm new password"
      />
      <Pressable onPress={() => setShow((v) => !v)} accessibilityRole="button" hitSlop={8}>
        <Text style={s.showLink}>{show ? 'Hide passwords' : 'Show passwords'}</Text>
      </Pressable>

      {error && (
        <Text style={s.error} accessibilityLiveRegion="polite">○ {error}</Text>
      )}
      {done && (
        <Text style={s.ok} accessibilityLiveRegion="polite">
          ● Password changed. Other sessions are signed out; this one stays.
        </Text>
      )}

      <Pressable
        style={[s.primaryBtn, busy && s.busy]} onPress={submit} disabled={busy}
        accessibilityRole="button"
      >
        {busy
          ? <ActivityIndicator color={c.accentInk} />
          : <Text style={s.primaryText}>Change password</Text>}
      </Pressable>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: 10 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  modeBtn: {
    flex: 1, borderWidth: 1, borderColor: c.line, borderRadius: 8,
    paddingVertical: 11, alignItems: 'center',
  },
  modeBtnOn: { borderColor: c.accent, backgroundColor: c.hiBg },
  modeText: { color: c.ink3, fontSize: 14, fontWeight: '600' },
  modeTextOn: { color: c.accent },
  
  modalScreen: { flex: 1, backgroundColor: '#000' },
  modalCamera: { flex: 1 },
  modalOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 60, paddingTop: 40, alignItems: 'center',
  },
  modalHint: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 30, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  modalShutter: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 30,
  },
  modalShutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  modalCancel: { color: '#fff', fontSize: 16, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  modalBusy: { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },

  enrolError: { color: c.crit, marginTop: 8, fontSize: 13 },
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 20, paddingTop: 24, gap: 14 },
  title: { color: c.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },

  card: {
    backgroundColor: c.surface, borderRadius: 20,
    borderWidth: 1, borderColor: c.line, padding: 18, gap: 4,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' } as any : {}),
  },
  cardTitle: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.4, fontWeight: '700', marginBottom: 4,
  },
  name: { color: c.ink, fontSize: 18, fontWeight: '700' },
  meta: { color: c.ink3, fontSize: 13 },
  body: { color: c.ink2, fontSize: 13, lineHeight: 19, marginBottom: 6 },

  label: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.2,
    textTransform: 'uppercase', marginTop: 8, fontWeight: '700',
  },
  input: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: c.ink, fontSize: 15, marginTop: 6,
  },
  showLink: { color: c.accent, fontSize: 13, fontWeight: '600', marginTop: 10 },
  error: { color: c.crit, fontSize: 13, lineHeight: 18, marginTop: 10 },
  ok: { color: c.ok, fontSize: 13, lineHeight: 18, marginTop: 10 },

  primaryBtn: {
    backgroundColor: c.accent, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', marginTop: 12,
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  },
  busy: { opacity: 0.7 },
  primaryText: { color: c.accentInk, fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    borderColor: c.line, borderWidth: 1, borderRadius: 14, paddingVertical: 12,
    alignItems: 'center', marginTop: 8, backgroundColor: c.surface2,
  },
  secondaryText: { color: c.ink, fontWeight: '700', fontSize: 14 },

  /* Workplace Details Styles */
  detailGrid: { gap: 10, marginTop: 4 },
  detailRow: {
    backgroundColor: c.surface2, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: c.line, gap: 2,
  },
  detailLabel: { color: c.ink3, fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  detailValue: { color: c.ink, fontSize: 14, fontWeight: '600' },
  detailValueMono: { color: c.ink, fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  /* Preferences & Notifications Styles */
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.line,
  },
  toggleLabel: { color: c.ink, fontSize: 13, fontWeight: '600', flex: 1 },
  toggleSwitch: {
    width: 44, height: 26, borderRadius: 13, backgroundColor: c.surface2,
    borderWidth: 1, borderColor: c.line, padding: 2, justifyContent: 'center',
  },
  toggleSwitchOn: { backgroundColor: c.accent, borderColor: c.accent },
  toggleKnob: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: c.ink3,
  },
  toggleKnobOn: {
    backgroundColor: c.accentInk, alignSelf: 'flex-end',
  },

  /* Password Strength Styles */
  strengthBox: { marginTop: 6, gap: 4 },
  strengthBars: { flexDirection: 'row', gap: 4 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.line },
  strengthText: { fontSize: 11, fontWeight: '700', alignSelf: 'flex-end' },

  signOut: {
    borderColor: c.line, borderWidth: 1, borderRadius: 8, paddingVertical: 13,
    alignItems: 'center', marginTop: 8,
  },
  signOutText: { color: c.ink2, fontWeight: '600', fontSize: 15 },
  note: { color: c.ink3, fontSize: 12, lineHeight: 17, textAlign: 'center' },

  back: { paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: c.accent, fontSize: 15, fontWeight: '600' },
});
