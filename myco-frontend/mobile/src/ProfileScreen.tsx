import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { setPassword } from './api';
import { CameraView, useCameraPermissions } from 'expo-camera';

import SurveyScreen from './SurveyScreen';
import {
  getEnrolmentStatus, submitEnrolmentPhoto, type EnrolmentStatus,
} from './api';
import { theme } from './theme';
import type { Identity } from './auth';

const c = theme.color;

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
  const [survey, setSurvey] = useState(false);

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
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.title}>Profile</Text>

      <View style={s.card}>
        <Text style={s.name}>{me.full_name ?? me.email}</Text>
        <Text style={s.meta}>
          {me.employee_code ? `${me.employee_code} · ` : ''}{me.email}
        </Text>
        <Text style={s.meta}>Role: {me.role.replace('_', ' ')}</Text>
      </View>

      <FaceEnrolmentCard />

      <PasswordCard />

      <View style={s.card}>
        <Text style={s.cardTitle}>OFFICE SETUP</Text>
        <Text style={s.body}>
          The Survey tool records real GPS readings around the office so the
          geofence can be set from measurements instead of a map pin. Internal
          use - it comes out before the pilot.
        </Text>
        <Pressable style={s.secondaryBtn} onPress={() => setSurvey(true)} accessibilityRole="button">
          <Text style={s.secondaryText}>Open Survey</Text>
        </Pressable>
      </View>

      <Pressable style={s.signOut} onPress={onSignOut} accessibilityRole="button">
        <Text style={s.signOutText}>Sign out</Text>
      </Pressable>
      <Text style={s.note}>
        Signing out keeps this phone registered to you - you will not burn your
        device binding by signing back in.
      </Text>
    </ScrollView>
  );
}

/**
 * Your reference photo, from your own phone. Submitting never enrols - it
 * queues the photo for an admin to vouch that the face is yours, which is
 * the one step self-service must not remove: the reference photo is what
 * every future check-in is compared against.
 */
function FaceEnrolmentCard() {
  const [status, setStatus] = useState<EnrolmentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camPerm, requestCam] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setStatus(await getEnrolmentStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load enrolment');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function openCamera() {
    setError(null);
    if (!camPerm?.granted) {
      const r = await requestCam();
      if (!r.granted) {
        setError('Camera permission is needed to take your reference photo.');
        return;
      }
    }
    setCamera(true);
  }

  async function capture() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await cameraRef.current?.takePictureAsync({
        // Full quality: this photo is compared against for YEARS. Bytes are
        // the cheapest part of a reference photo.
        quality: 0.95,
        skipProcessing: true,
      });
      if (!shot?.uri) throw new Error('Could not capture a photo');
      const next = await submitEnrolmentPhoto(shot.uri);
      setStatus(next);
      setCamera(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the photo');
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

      {camera ? (
        <>
          <CameraView ref={cameraRef} style={s.enrolCamera} facing="front" />
          <Pressable
            style={s.secondaryBtn}
            onPress={capture}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={s.secondaryText}>
              {busy ? 'Submitting…' : 'Capture & submit for approval'}
            </Text>
          </Pressable>
          <Pressable
            style={s.secondaryBtn}
            onPress={() => setCamera(false)}
            accessibilityRole="button"
          >
            <Text style={s.secondaryText}>Cancel</Text>
          </Pressable>
        </>
      ) : (
        <Pressable style={s.secondaryBtn} onPress={openCamera} accessibilityRole="button">
          <Text style={s.secondaryText}>
            {status?.enrolled || status?.pending ? 'Submit a new photo' : 'Take my reference photo'}
          </Text>
        </Pressable>
      )}

      {error && <Text style={s.enrolError}>○ {error}</Text>}
      <Text style={s.note}>
        Straight at the camera, good light, nobody else in frame. An admin
        approves it before it goes live - it never activates itself.
      </Text>
    </View>
  );
}


function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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

const s = StyleSheet.create({
  enrolCamera: {
    height: 300, borderRadius: 12, overflow: 'hidden', marginTop: 10,
  },
  enrolError: { color: c.crit, marginTop: 8, fontSize: 13 },
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 20, paddingTop: 24, gap: 14 },
  title: { color: c.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },

  card: {
    backgroundColor: c.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: c.line, padding: 16, gap: 4,
  },
  cardTitle: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.4, fontWeight: '700', marginBottom: 4,
  },
  name: { color: c.ink, fontSize: 18, fontWeight: '700' },
  meta: { color: c.ink3, fontSize: 13 },
  body: { color: c.ink2, fontSize: 13, lineHeight: 19, marginBottom: 6 },

  label: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.2,
    textTransform: 'uppercase', marginTop: 8,
  },
  input: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11,
    color: c.ink, fontSize: 15, marginTop: 6,
  },
  showLink: { color: c.accent, fontSize: 13, fontWeight: '600', marginTop: 10 },
  error: { color: c.crit, fontSize: 13, lineHeight: 18, marginTop: 10 },
  ok: { color: c.ok, fontSize: 13, lineHeight: 18, marginTop: 10 },

  primaryBtn: {
    backgroundColor: c.accent, borderRadius: 8, paddingVertical: 13,
    alignItems: 'center', marginTop: 12,
  },
  busy: { opacity: 0.7 },
  primaryText: { color: c.accentInk, fontWeight: '700', fontSize: 15 },
  secondaryBtn: {
    borderColor: c.accent, borderWidth: 1, borderRadius: 8, paddingVertical: 12,
    alignItems: 'center', marginTop: 8,
  },
  secondaryText: { color: c.accent, fontWeight: '600', fontSize: 14 },

  signOut: {
    borderColor: c.line, borderWidth: 1, borderRadius: 8, paddingVertical: 13,
    alignItems: 'center', marginTop: 8,
  },
  signOutText: { color: c.ink2, fontWeight: '600', fontSize: 15 },
  note: { color: c.ink3, fontSize: 12, lineHeight: 17, textAlign: 'center' },

  back: { paddingHorizontal: 20, paddingVertical: 10 },
  backText: { color: c.accent, fontSize: 15, fontWeight: '600' },
});
