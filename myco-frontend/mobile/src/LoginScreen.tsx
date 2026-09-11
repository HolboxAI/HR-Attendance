import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View,
} from 'react-native';

import { BoxcodeLogo } from './BoxcodeLogo';
import { MobileParticleEffect } from './MobileParticleEffect';
import { apiBase, setApiBaseOverride } from './config';
import { signIn, requestSignup } from './session';
import type { Identity } from './auth';

/**
 * Mobile authentication screen featuring:
 * 1. Split layout (Left: Welcome to Holbox, Particle Text Effect canvas, enlarged Holbox logo;
 *    Right: Sign-in / Sign-up form and controls).
 * 2. Responsive stacked layout for narrow mobile screens.
 * 3. Sign-in mode with email/password
 * 4. Sign-up / Request to join mode for onboarding new team members awaiting admin approval
 * 5. Confirmation screen for submitted signup applications
 */
export default function LoginScreen({ onSignedIn }: { onSignedIn: (i: Identity) => void }) {
  const { width: windowWidth } = useWindowDimensions();
  const isSplit = windowWidth >= 768;

  const [mode, setMode] = useState<'signin' | 'signup' | 'submitted'>('signin');

  // Sign-in state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Sign-up state
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [signupDept, setSignupDept] = useState('');
  const [signupDesig, setSignupDesig] = useState('');
  const [signupShowPass, setSignupShowPass] = useState(false);

  // General state
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverOpen, setServerOpen] = useState(false);
  const [serverDraft, setServerDraft] = useState('');
  const [serverNow, setServerNow] = useState(apiBase());

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok) onSignedIn(res.identity);
    else setError(res.message);
  }

  async function handleSignup() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await requestSignup({
      full_name: signupName,
      email: signupEmail,
      password: signupPassword,
      phone: signupPhone,
      desired_department: signupDept,
      desired_designation: signupDesig,
    });
    setBusy(false);
    if (res.ok) {
      setMode('submitted');
    } else {
      setError(res.message);
    }
  }

  const renderCard = () => {
    if (mode === 'signin') {
      return (
        <View style={s.card}>
          <Text style={s.cardTitle}>Sign in to Holbox</Text>
          <Text style={s.cardSub}>Attendance, leave and approvals for your team.</Text>

          <View style={s.googleBtn}>
            <Text style={s.googleG}>G</Text>
            <Text style={s.googleText}>Continue with Google</Text>
          </View>
          <Text style={s.googleNote}>
            Google sign-in is not enabled yet — use your email and password.
          </Text>

          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>OR CREDENTIALS</Text>
            <View style={s.dividerLine} />
          </View>

          <View style={s.form}>
            <Text style={s.label}>Email Address</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              placeholder="your.email@holbox.ai"
              placeholderTextColor="rgba(255,255,255,0.3)"
              editable={!busy}
              accessibilityLabel="Email"
            />

            <Text style={s.label}>Password</Text>
            <View style={s.passwordRow}>
              <TextInput
                style={[s.input, s.passwordInput]}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(null); }}
                secureTextEntry={!showPassword}
                textContentType="password"
                placeholder="••••••••••••"
                placeholderTextColor="rgba(255,255,255,0.3)"
                onSubmitEditing={submit}
                returnKeyType="go"
                editable={!busy}
                accessibilityLabel="Password"
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                style={s.showBtn}
              >
                <Text style={s.showText}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>

            {error && (
              <View style={s.errorBox} accessibilityLiveRegion="polite">
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[s.submitBtn, busy && s.submitBtnBusy]}
              onPress={submit}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy
                ? <ActivityIndicator color="#000000" />
                : <Text style={s.submitBtnText}>Sign in  →</Text>}
            </Pressable>

            {/* Sign up toggle button */}
            <View style={s.signupPromptRow}>
              <Text style={s.signupPromptText}>New employee or joiner? </Text>
              <Pressable
                onPress={() => {
                  setError(null);
                  setMode('signup');
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={s.signupPromptLink}>Request to join / Sign up</Text>
              </Pressable>
            </View>
          </View>

          <Text style={s.footerNote}>
            By continuing, you agree to Holbox's Security Policy and Privacy
            Terms.
          </Text>

          <Pressable onPress={() => { setServerDraft(serverNow); setServerOpen((v) => !v); }}>
            <Text style={s.serverRow}>Server · {serverNow.replace(/^https?:\/\//, '')}</Text>
          </Pressable>
          {serverOpen && (
            <View style={s.serverEdit}>
              <TextInput
                style={s.input}
                value={serverDraft}
                onChangeText={setServerDraft}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="http://192.168.x.x:8000"
                placeholderTextColor="rgba(255,255,255,0.3)"
                accessibilityLabel="Server address"
              />
              <Pressable
                style={s.serverSave}
                onPress={async () => {
                  const applied = await setApiBaseOverride(serverDraft);
                  setServerNow(applied);
                  setServerOpen(false);
                }}
              >
                <Text style={s.serverSaveText}>Save</Text>
              </Pressable>
            </View>
          )}
        </View>
      );
    }

    if (mode === 'signup') {
      return (
        <View style={s.card}>
          <Text style={s.cardTitle}>Request to Join</Text>
          <Text style={s.cardSub}>Submit your details for HR and administrator approval.</Text>

          <View style={s.form}>
            <Text style={s.label}>Full Name *</Text>
            <TextInput
              style={s.input}
              value={signupName}
              onChangeText={(t) => { setSignupName(t); setError(null); }}
              autoCapitalize="words"
              placeholder="e.g. Rahul Sharma"
              placeholderTextColor="rgba(255,255,255,0.3)"
              editable={!busy}
            />

            <Text style={s.label}>Work Email Address *</Text>
            <TextInput
              style={s.input}
              value={signupEmail}
              onChangeText={(t) => { setSignupEmail(t); setError(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="your.email@holbox.ai"
              placeholderTextColor="rgba(255,255,255,0.3)"
              editable={!busy}
            />

            <Text style={s.label}>Create Password * (min 8 characters)</Text>
            <View style={s.passwordRow}>
              <TextInput
                style={[s.input, s.passwordInput]}
                value={signupPassword}
                onChangeText={(t) => { setSignupPassword(t); setError(null); }}
                secureTextEntry={!signupShowPass}
                placeholder="••••••••••••"
                placeholderTextColor="rgba(255,255,255,0.3)"
                editable={!busy}
              />
              <Pressable
                onPress={() => setSignupShowPass((v) => !v)}
                hitSlop={10}
                style={s.showBtn}
              >
                <Text style={s.showText}>{signupShowPass ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>

            <Text style={s.label}>Phone Number (optional)</Text>
            <TextInput
              style={s.input}
              value={signupPhone}
              onChangeText={setSignupPhone}
              keyboardType="phone-pad"
              placeholder="+91 98765 43210"
              placeholderTextColor="rgba(255,255,255,0.3)"
              editable={!busy}
            />

            <Text style={s.label}>Department (optional)</Text>
            <TextInput
              style={s.input}
              value={signupDept}
              onChangeText={setSignupDept}
              placeholder="e.g. Engineering, Design, Sales"
              placeholderTextColor="rgba(255,255,255,0.3)"
              editable={!busy}
            />

            <Text style={s.label}>Designation (optional)</Text>
            <TextInput
              style={s.input}
              value={signupDesig}
              onChangeText={setSignupDesig}
              placeholder="e.g. Full Stack Developer"
              placeholderTextColor="rgba(255,255,255,0.3)"
              editable={!busy}
            />

            {error && (
              <View style={s.errorBox} accessibilityLiveRegion="polite">
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={[s.submitBtn, busy && s.submitBtnBusy]}
              onPress={handleSignup}
              disabled={busy}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color="#000000" />
              ) : (
                <Text style={s.submitBtnText}>Submit Application  →</Text>
              )}
            </Pressable>

            {/* Back to sign in */}
            <View style={s.signupPromptRow}>
              <Text style={s.signupPromptText}>Already have an account? </Text>
              <Pressable
                onPress={() => {
                  setError(null);
                  setMode('signin');
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text style={s.signupPromptLink}>Sign in</Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    }

    return (
      <View style={s.card}>
        <View style={s.successIconWrap}>
          <View style={s.successCheckCircle}>
            <Text style={s.successCheckText}>✓</Text>
          </View>
        </View>

        <Text style={[s.cardTitle, { textAlign: 'center' }]}>Application Received!</Text>
        <Text style={[s.cardSub, { textAlign: 'center' }]}>
          Your details have been submitted to the HR & administration team.
        </Text>

        <View style={s.approvalNotice}>
          <Text style={s.approvalNoticeTitle}>⏳ Awaiting Admin Approval</Text>
          <Text style={s.approvalNoticeBody}>
            An administrator will review your application and assign your official Employee Code. Once approved, you will be able to log in immediately using your email and password.
          </Text>
        </View>

        <Pressable
          style={[s.submitBtn, { marginTop: 22 }]}
          onPress={() => {
            setError(null);
            setMode('signin');
          }}
          accessibilityRole="button"
        >
          <Text style={s.submitBtnText}>Back to Sign In  →</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={s.root}>
      <DotGridBackground />
      <View style={s.vignette} pointerEvents="none" />

      <KeyboardAvoidingView style={s.keyboardView} behavior="padding">
        {isSplit ? (
          /* ============================================================ */
          /* SPLIT LAYOUT (Desktop browser / Tablets / Wide viewports)     */
          /* Left: Welcome to Holbox + Particle Text Effect + Large Logo   */
          /* Right: Sign-in / Sign-up form and actions                     */
          /* ============================================================ */
          <View style={s.splitContainer}>
            {/* LEFT COLUMN */}
            <View style={s.leftCol}>
              {/* Corner brand at top-left */}
              <View style={s.cornerBrand}>
                <View style={s.cornerLogoBox}>
                  <BoxcodeLogo size={32} />
                </View>
                <View>
                  <Text style={s.cornerName}>Holbox</Text>
                  <Text style={s.cornerSub}>Attendance Portal</Text>
                </View>
              </View>

              {/* Centered Showcase */}
              <View style={s.leftShowcase}>
                <ShutterText
                  text={mode === 'signup' ? 'JOIN THE TEAM' : 'WELCOME TO'}
                  fontSize={20}
                  gap={5}
                />
                <View style={{ height: 12 }} />
                <ShutterText text="HOLBOX" fontSize={58} gap={2} />
                <View style={{ height: 16 }} />

                {/* Particle Text Effect Canvas */}
                <MobileParticleEffect
                  words={['HOLBOX', 'ATTENDANCE', 'PORTAL']}
                  width={Math.min(520, Math.floor(windowWidth * 0.42))}
                  height={210}
                />

                {/* Enlarged Holbox symbol directly below */}
                <View style={s.enlargedLogoContainer}>
                  <View style={s.enlargedLogoGlow} />
                  <BoxcodeLogo size={130} />
                </View>
              </View>

              {/* Bottom spacer to balance layout */}
              <View style={{ height: 32 }} />
            </View>

            {/* RIGHT COLUMN */}
            <View style={s.rightCol}>
              <ScrollView
                contentContainerStyle={s.rightScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {renderCard()}
              </ScrollView>
            </View>
          </View>
        ) : (
          /* ============================================================ */
          /* SINGLE-COLUMN RESPONSIVE LAYOUT (Narrow Mobile Phones)       */
          /* ============================================================ */
          <ScrollView
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Corner brand */}
            <View style={s.cornerBrand}>
              <View style={s.cornerLogoBox}>
                <BoxcodeLogo size={28} />
              </View>
              <View>
                <Text style={s.cornerName}>Holbox</Text>
                <Text style={s.cornerSub}>Attendance Portal</Text>
              </View>
            </View>

            {/* Welcome block with particle effect and enlarged logo */}
            <View style={s.hero}>
              <ShutterText
                text={mode === 'signup' ? 'JOIN THE TEAM' : 'WELCOME TO'}
                fontSize={16}
                gap={4}
              />
              <View style={{ height: 10 }} />
              <ShutterText text="HOLBOX" fontSize={46} gap={2} />
              <View style={{ height: 12 }} />

              <MobileParticleEffect
                words={['HOLBOX', 'ATTENDANCE', 'PORTAL']}
                width={Math.min(360, windowWidth - 48)}
                height={160}
              />

              <View style={[s.enlargedLogoContainer, { marginTop: 12 }]}>
                <View style={[s.enlargedLogoGlow, { width: 120, height: 120 }]} />
                <BoxcodeLogo size={90} />
              </View>
            </View>

            {/* Form Card */}
            {renderCard()}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Shutter text - animated letter slices                                    */
/* ------------------------------------------------------------------------ */

const SLICES = [
  { top: 0.0, h: 0.35, color: '#8B7CF6', dir: 1, shift: 0 },
  { top: 0.35, h: 0.3, color: '#D4D4D8', dir: -1, shift: 100 },
  { top: 0.65, h: 0.35, color: '#8B7CF6', dir: 1, shift: 200 },
] as const;

const SWEEP_MS = 700;
const PERIOD_MS = 2000;

function LetterSlice({
  char,
  fontSize,
  lineH,
  slice,
  phase,
}: {
  char: string;
  fontSize: number;
  lineH: number;
  slice: (typeof SLICES)[number];
  phase: Animated.Value;
}) {
  const sliceH = lineH * slice.h;
  const sliceTop = lineH * slice.top;

  const translateX = phase.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, slice.dir * (fontSize * 0.22), 0],
  });

  return (
    <View
      style={{
        position: 'absolute',
        top: sliceTop,
        left: 0,
        right: 0,
        height: sliceH,
        overflow: 'hidden',
      }}
      pointerEvents="none"
    >
      <Animated.Text
        style={{
          color: slice.color,
          fontSize,
          lineHeight: lineH,
          fontWeight: '900',
          letterSpacing: -0.5,
          position: 'absolute',
          top: -sliceTop,
          left: 0,
          right: 0,
          transform: [{ translateX }],
        }}
      >
        {char}
      </Animated.Text>
    </View>
  );
}

function AnimatedLetter({
  char,
  fontSize,
  index,
  total,
}: {
  char: string;
  fontSize: number;
  index: number;
  total: number;
}) {
  const phase = useRef(new Animated.Value(0)).current;
  const lineH = Math.round(fontSize * 1.15);

  useEffect(() => {
    const fraction = total > 1 ? index / (total - 1) : 0;
    const letterDelay = fraction * (SWEEP_MS - 200);

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fire = () => {
      if (!active) return;
      phase.setValue(0);
      Animated.timing(phase, {
        toValue: 1,
        duration: 350,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: true,
      }).start(() => {
        if (!active) return;
        timer = setTimeout(fire, Math.max(0, PERIOD_MS - 350));
      });
    };

    timer = setTimeout(fire, letterDelay);

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      phase.stopAnimation();
    };
  }, [index, total, phase]);

  if (char === ' ') {
    return <View style={{ width: fontSize * 0.4 }} />;
  }

  return (
    <View style={{ width: fontSize * 0.65, height: lineH, position: 'relative' }}>
      <Text
        style={{
          color: '#FFFFFF',
          fontSize,
          lineHeight: lineH,
          fontWeight: '900',
          letterSpacing: -0.5,
        }}
      >
        {char}
      </Text>
      {SLICES.map((sDef, sI) => (
        <LetterSlice
          key={sI}
          char={char}
          fontSize={fontSize}
          lineH={lineH}
          slice={sDef}
          phase={phase}
        />
      ))}
    </View>
  );
}

function ShutterText({
  text,
  fontSize = 38,
  gap = 2,
}: {
  text: string;
  fontSize?: number;
  gap?: number;
}) {
  const chars = text.split('');
  return (
    <View style={[s.shutterRow, { gap }]}>
      {chars.map((ch, i) => (
        <AnimatedLetter
          key={`${ch}-${i}`}
          char={ch}
          fontSize={fontSize}
          index={i}
          total={chars.length}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Dot-matrix ground                                                        */
/* ------------------------------------------------------------------------ */

function DotGridBackground() {
  const pulse = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 3500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.25,
          duration: 3500,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const rows = Array.from({ length: 26 });
  const cols = Array.from({ length: 14 });

  return (
    <Animated.View style={[s.dotGrid, { opacity: pulse }]} pointerEvents="none">
      {rows.map((_, r) => (
        <View key={r} style={s.dotRow}>
          {cols.map((_, cI) => (
            <View key={cI} style={s.dot} />
          ))}
        </View>
      ))}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------------ */
/* Styles                                                                   */
/* ------------------------------------------------------------------------ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  keyboardView: { flex: 1, zIndex: 10 },

  // Split view styles
  splitContainer: {
    flex: 1,
    flexDirection: 'row',
    width: '100%',
    height: '100%',
  },
  leftCol: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 36,
    paddingTop: Platform.OS === 'ios' ? 58 : 34,
    paddingBottom: 32,
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  leftShowcase: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginVertical: 'auto',
  },
  rightCol: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  rightScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 32,
    width: '100%',
  },

  // Single-column mobile styles
  scroll: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 58 : 34,
    paddingBottom: 40,
    alignItems: 'center',
    minHeight: '100%',
  },

  dotGrid: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-around',
    paddingVertical: 8,
    zIndex: 1,
  },
  dotRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 10 },
  dot: { width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: '#FFFFFF', opacity: 0.35 },

  vignette: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderColor: 'rgba(0, 0, 0, 0.8)',
    borderWidth: 30,
    zIndex: 2,
  },

  cornerBrand: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cornerLogoBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cornerName: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  cornerSub: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 11 },

  hero: { alignItems: 'center', marginTop: 24, marginBottom: 24 },
  shutterRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },

  enlargedLogoContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
    position: 'relative',
  },
  enlargedLogoGlow: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 45,
  },

  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 24,
    padding: 26,
  },
  cardTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  cardSub: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 13, marginTop: 4, marginBottom: 18 },

  googleBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 12,
    opacity: 0.6,
  },
  googleG: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 14, fontWeight: '800' },
  googleText: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 12, fontWeight: '600' },
  googleNote: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 15,
  },

  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 18,
    width: '100%',
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255, 255, 255, 0.1)' },
  dividerText: { color: 'rgba(255, 255, 255, 0.4)', fontSize: 11, letterSpacing: 1.5 },

  form: { width: '100%' },
  label: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 14,
  },
  passwordRow: { position: 'relative', width: '100%' },
  passwordInput: { paddingRight: 60 },
  showBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  showText: { color: 'rgba(255, 255, 255, 0.45)', fontSize: 12, fontWeight: '600' },

  errorBox: {
    marginTop: 14,
    padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 12 },

  submitBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  submitBtnBusy: { opacity: 0.7 },
  submitBtnText: { color: '#000000', fontSize: 15, fontWeight: '700' },

  signupPromptRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    flexWrap: 'wrap',
  },
  signupPromptText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },
  signupPromptLink: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },

  successIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  successCheckCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCheckText: {
    color: '#10B981',
    fontSize: 28,
    fontWeight: '900',
  },
  approvalNotice: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    marginTop: 10,
  },
  approvalNoticeTitle: {
    color: '#FBBF24',
    fontSize: 13,
    fontWeight: '700',
  },
  approvalNoticeBody: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    lineHeight: 18,
  },

  footerNote: {
    marginTop: 16,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.4)',
  },

  serverRow: {
    marginTop: 14,
    fontSize: 11,
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.3)',
    textDecorationLine: 'underline',
  },
  serverEdit: { marginTop: 10, gap: 8 },
  serverSave: {
    alignSelf: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  serverSaveText: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 12, fontWeight: '600' },
});
