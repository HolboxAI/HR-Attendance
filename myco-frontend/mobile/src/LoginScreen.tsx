import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { BoxcodeLogo } from './BoxcodeLogo';
import { apiBase, setApiBaseOverride } from './config';
import { signIn, requestSignup } from './session';
import type { Identity } from './auth';

/**
 * Mobile authentication screen featuring:
 * 1. The official Holbox branding & shutter animation
 * 2. Sign-in mode with email/password
 * 3. Sign-up / Request to join mode for onboarding new team members awaiting admin approval
 * 4. Confirmation screen for submitted signup applications
 */
export default function LoginScreen({ onSignedIn }: { onSignedIn: (i: Identity) => void }) {
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

  return (
    <View style={s.root}>
      <DotGridBackground />
      <View style={s.vignette} pointerEvents="none" />

      <KeyboardAvoidingView style={s.keyboardView} behavior="padding">
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {/* Corner brand */}
          <View style={s.cornerBrand}>
            <View style={s.cornerLogoBox}>
              <BoxcodeLogo size={30} />
            </View>
            <View>
              <Text style={s.cornerName}>Holbox</Text>
              <Text style={s.cornerSub}>Attendance Portal</Text>
            </View>
          </View>

          {/* Welcome block with enlarged logo and particle effect */}
          <View style={s.hero}>
            <ShutterText text={mode === 'signup' ? 'JOIN THE TEAM' : 'WELCOME TO'} fontSize={17} gap={5} />
            <View style={{ height: 14 }} />
            <ShutterText text="HOLBOX" fontSize={54} gap={2} />
            <View style={{ height: 16 }} />
            <LogoParticleEffect logoSize={120} />
          </View>

          {/* Card: Mode-driven */}
          {mode === 'signin' && (
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
                      setError(null);
                    }}
                  >
                    <Text style={s.serverSaveText}>Save server address</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {mode === 'signup' && (
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
          )}

          {mode === 'submitted' && (
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
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Shutter text - the web effect, in Animated                               */
/* ------------------------------------------------------------------------ */

const SLICES = [
  { top: 0.0, h: 0.35, color: '#8B7CF6', dir: 1, shift: 0 },
  { top: 0.35, h: 0.3, color: '#D4D4D8', dir: -1, shift: 100 },
  { top: 0.65, h: 0.35, color: '#8B7CF6', dir: 1, shift: 200 },
] as const;

const SWEEP_MS = 700;
const PERIOD_MS = 2000; // "repeats every 2 seconds" is the whole loop

/**
 * Per-character slice shutter. Each character carries three clipped copies
 * of itself (purple / light / purple thirds) that sweep across on a 2s
 * loop, staggered per character and per slice - the same recipe as the
 * CSS keyframes in the web app's globals.css.
 *
 * ONE clock per word, not one timer per slice. The first version ran a
 * separate Animated loop for every slice of every character - 48 timers
 * for these two words - which the JS driver (what Animated falls back to
 * on Expo web) visibly choked on. Now a single 0->1 clock ticks the whole
 * 2s period and every slice reads its own window out of it through
 * interpolate(), which the native driver runs entirely off-thread on a
 * real phone.
 */
function ShutterText({
  text, fontSize, gap = 2,
}: { text: string; fontSize: number; gap?: number }) {
  const chars = text.split('');
  const clock = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // The reset is an explicit zero-duration timing, not loop()'s own
    // resetBeforeIteration - react-native-web failed to restart the latter,
    // leaving the clock parked at 1 and the word permanently at rest.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(clock, {
          toValue: 1, duration: PERIOD_MS,
          easing: Easing.linear, useNativeDriver: true, isInteraction: false,
        }),
        Animated.timing(clock, {
          toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [clock]);

  return (
    <View
      style={[s.shutterRow, { columnGap: gap }]}
      accessibilityLabel={text}
      accessibilityRole="image"
    >
      {chars.map((ch, i) => (
        <ShutterChar key={`${i}-${ch}`} char={ch} index={i} fontSize={fontSize} clock={clock} />
      ))}
    </View>
  );
}

function ShutterChar({
  char, index, fontSize, clock,
}: { char: string; index: number; fontSize: number; clock: Animated.Value }) {
  const lineH = Math.round(fontSize * 1.06);
  const [w, setW] = useState(Math.ceil(fontSize * 0.8));

  const baseStyle = {
    fontSize, lineHeight: lineH, fontWeight: '900' as const,
    letterSpacing: -0.5, color: '#FAFAFA',
  };

  if (char === ' ') return <View style={{ width: fontSize * 0.5 }} />;

  return (
    <View
      style={{ height: lineH, overflow: 'hidden' }}
      onLayout={(e) => setW(Math.max(4, Math.round(e.nativeEvent.layout.width)))}
    >
      <Text style={baseStyle} allowFontScaling={false}>{char}</Text>
      {SLICES.map((slice, n) => {
        // This slice's window on the shared 2s clock: 50ms base + 40ms per
        // character + 100ms per layer, sweeping for 700ms, resting after -
        // the web's animation-delay arithmetic, as interpolation ranges.
        const start = (50 + index * 40 + slice.shift) / PERIOD_MS;
        const end = start + SWEEP_MS / PERIOD_MS;
        return (
          <View
            key={n}
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, right: 0,
              top: slice.top * lineH, height: slice.h * lineH,
              overflow: 'hidden',
            }}
          >
            <Animated.Text
              allowFontScaling={false}
              style={[
                baseStyle,
                {
                  position: 'absolute', left: 0, top: -slice.top * lineH,
                  color: slice.color,
                  opacity: clock.interpolate({
                    inputRange: [0, start, (start + end) / 2, end, 1],
                    outputRange: [0, 0, 1, 0, 0],
                  }),
                  transform: [{
                    translateX: clock.interpolate({
                      inputRange: [0, start, end, 1],
                      outputRange: [
                        -w * slice.dir, -w * slice.dir,
                        w * slice.dir, w * slice.dir,
                      ],
                    }),
                  }],
                },
              ]}
            >
              {char}
            </Animated.Text>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Logo with particle ambiance effect                                      */
/* ------------------------------------------------------------------------ */

const PARTICLES = [
  { angle: 0, dist: 78, size: 4, color: '#38BDF8' },
  { angle: 25, dist: 94, size: 3, color: '#60A5FA' },
  { angle: 55, dist: 86, size: 5, color: '#818CF8' },
  { angle: 85, dist: 98, size: 3.5, color: '#38BDF8' },
  { angle: 115, dist: 82, size: 4.5, color: '#FFFFFF' },
  { angle: 145, dist: 95, size: 3, color: '#60A5FA' },
  { angle: 175, dist: 88, size: 5, color: '#818CF8' },
  { angle: 205, dist: 97, size: 3.5, color: '#38BDF8' },
  { angle: 235, dist: 84, size: 4, color: '#FFFFFF' },
  { angle: 265, dist: 92, size: 5, color: '#60A5FA' },
  { angle: 295, dist: 85, size: 3, color: '#818CF8' },
  { angle: 325, dist: 100, size: 4, color: '#38BDF8' },
  { angle: 350, dist: 80, size: 3, color: '#93C5FD' },
] as const;

function LogoParticleEffect({ logoSize = 120 }: { logoSize?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = logoSize / 100;

  return (
    <View style={{ width: logoSize * 1.6, height: logoSize * 1.6, alignItems: 'center', justifyContent: 'center' }}>
      {/* Radiant ambient glow */}
      <Animated.View
        style={{
          position: 'absolute',
          width: logoSize * 1.3,
          height: logoSize * 1.3,
          borderRadius: (logoSize * 1.3) / 2,
          backgroundColor: 'rgba(59, 130, 246, 0.22)',
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 1.25],
              }),
            },
          ],
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.35, 0.75],
          }),
        }}
      />

      {/* Dynamic particles hovering around the logo */}
      {PARTICLES.map((p, idx) => {
        const rad = (p.angle * Math.PI) / 180;
        const x = Math.cos(rad) * p.dist * scale;
        const y = Math.sin(rad) * p.dist * scale;

        return (
          <Animated.View
            key={idx}
            style={{
              position: 'absolute',
              width: p.size * scale,
              height: p.size * scale,
              borderRadius: (p.size * scale) / 2,
              backgroundColor: p.color,
              shadowColor: p.color,
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.9,
              shadowRadius: 6,
              elevation: 4,
              transform: [
                { translateX: x },
                { translateY: y },
                {
                  scale: pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [idx % 2 === 0 ? 0.7 : 1.3, idx % 2 === 0 ? 1.3 : 0.7],
                  }),
                },
              ],
            }}
          />
        );
      })}

      {/* Enlarged Holbox symbol */}
      <BoxcodeLogo size={logoSize} />
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* The Holbox cube, in Views - no SVG dependency                            */
/* ------------------------------------------------------------------------ */

/**
 * The brand cube from the web's HolboxMark, built from transformed Views:
 * a scaled-rotated square for the dark top face, skewed rectangles for the
 * white and blue side faces, and a rotated bordered square for the ring.
 * Brand colours are fixed hex - a logo does not re-theme.
 */
function HolboxCube({ size }: { size: number }) {
  // Derived from the web SVG's coordinates (viewBox 0 0 100 100), scaled by
  // k. Each face slopes 23.5 units over 45 of width -> skew 27.6deg, and
  // because skewY pivots a View around its own centre, the pre-skew rect
  // top is the wanted top plus half the total shear (11.75 units).
  const k = size / 100;
  const skew = '27.6deg';
  const face = { w: 45 * k, h: 47 * k, top: 38.25 * k };
  const diamondSide = 63.6 * k;                   // 90k wide after rotation
  const ringSide = 23.3 * k;

  return (
    <View style={{ width: 100 * k, height: 100 * k }} accessibilityLabel="Holbox logo">
      {/* left face - white, top edge sloping DOWN towards the centre seam */}
      <View
        style={{
          position: 'absolute', left: 5 * k, top: face.top,
          width: face.w, height: face.h, backgroundColor: '#FFFFFF',
          transform: [{ skewY: skew }],
        }}
      />
      {/* right face - vivid blue, mirrored slope */}
      <View
        style={{
          position: 'absolute', left: 50 * k, top: face.top,
          width: face.w, height: face.h, backgroundColor: '#2E5BFF',
          transform: [{ skewY: `-${skew}` }],
        }}
      />
      {/* top face: a square squashed and rotated into the isometric diamond,
          drawn LAST so its lower edges sit cleanly over the face tops */}
      <View
        style={{
          position: 'absolute',
          left: 50 * k - diamondSide / 2, top: 26.5 * k - diamondSide / 2,
          width: diamondSide, height: diamondSide, backgroundColor: '#141BC8',
          transform: [{ scaleY: 0.522 }, { rotate: '45deg' }],
        }}
      />
      {/* diamond ring set into the lower front */}
      <View
        style={{
          position: 'absolute',
          left: 50 * k - ringSide / 2, top: 71 * k - ringSide / 2,
          width: ringSide, height: ringSide,
          borderWidth: Math.max(1.5, 5 * k), borderColor: '#2E5BFF',
          backgroundColor: 'transparent',
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Dot-matrix ground - the web canvas effect's honest native cousin         */
/* ------------------------------------------------------------------------ */

function DotGridBackground() {
  const pulse = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55, duration: 3500,
          easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.25, duration: 3500,
          easing: Easing.inOut(Easing.quad), useNativeDriver: true,
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
          {cols.map((_, cI) => <View key={cI} style={s.dot} />)}
        </View>
      ))}
    </Animated.View>
  );
}

/* ------------------------------------------------------------------------ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  keyboardView: { flex: 1, zIndex: 10 },
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
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cornerLogoBox: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  cornerName: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  cornerSub: { color: 'rgba(255,255,255,0.5)', fontSize: 11 },

  hero: { alignItems: 'center', marginTop: 28, marginBottom: 28 },
  shutterRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },

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
  cardSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4, marginBottom: 18 },

  googleBtn: {
    width: '100%',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
    borderRadius: 999, paddingVertical: 12,
    opacity: 0.6,
  },
  googleG: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '800' },
  googleText: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  googleNote: {
    color: 'rgba(255,255,255,0.4)', fontSize: 11, textAlign: 'center',
    marginTop: 8, lineHeight: 15,
  },

  dividerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginVertical: 18, width: '100%',
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  dividerText: { color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: 1.5 },

  form: { width: '100%' },
  label: {
    color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600',
    marginTop: 10, marginBottom: 6,
  },
  input: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12,
    color: '#FFFFFF', fontSize: 14,
  },
  passwordRow: { position: 'relative', width: '100%' },
  passwordInput: { paddingRight: 60 },
  showBtn: {
    position: 'absolute', right: 14, top: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  showText: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '600' },

  errorBox: {
    marginTop: 14, padding: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)', borderWidth: 1,
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
    color: 'rgba(255,255,255,0.6)',
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
    marginTop: 16, fontSize: 11, lineHeight: 16, textAlign: 'center',
    color: 'rgba(255,255,255,0.4)',
  },

  serverRow: {
    marginTop: 14, fontSize: 11, textAlign: 'center',
    color: 'rgba(255,255,255,0.3)', textDecorationLine: 'underline',
  },
  serverEdit: { marginTop: 10, gap: 8 },
  serverSave: {
    alignSelf: 'center', borderRadius: 999, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)', paddingVertical: 8, paddingHorizontal: 16,
  },
  serverSaveText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
});
