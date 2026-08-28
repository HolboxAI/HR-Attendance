import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Platform,
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';

import { signIn } from './session';
import { theme } from './theme';
import { BoxcodeLogo } from './BoxcodeLogo';
import type { Identity } from './auth';

const c = theme.color;

/**
 * The web sign-in, ported the way the frontend PRD §6.2 asks: the split
 * panel does not apply on a phone (the web version itself hides it below
 * 1024px), so this is the centred lockup, "Welcome to" + HOLBOX with the
 * shutter treatment, then the form. Same credentials, same endpoint, no
 * Google button (there is no OAuth backend - a dead button on a phone is
 * worse than none), and the same honest no-signup footer.
 */
export default function LoginScreen({ onSignedIn }: { onSignedIn: (i: Identity) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await signIn(email, password);
    setBusy(false);
    if (res.ok) onSignedIn(res.identity);
    else setError(res.message);
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 12 }}>
          <BoxcodeLogo size={48} color={c.ink} />
        </View>
        <Text style={s.brand}>Boxcode</Text>

        <View style={s.lockup}>
          <Text style={s.welcome}>Welcome to</Text>
          <HolboxShutter />
        </View>

        <Text style={s.label}>Email</Text>
        <TextInput
          style={s.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          placeholder="you@boxcode.ai"
          placeholderTextColor={c.ink3}
          editable={!busy}
          accessibilityLabel="Email"
        />

        <Text style={s.label}>Password</Text>
        <View style={s.passwordRow}>
          <TextInput
            style={[s.input, s.passwordInput]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            textContentType="password"
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
          <View style={s.error} accessibilityLiveRegion="polite">
            <Text style={s.errorGlyph}>○</Text>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          style={[s.button, busy && s.buttonBusy]}
          onPress={submit}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy
            ? <ActivityIndicator color={c.accentInk} />
            : <Text style={s.buttonText}>Sign in</Text>}
        </Pressable>


        <Text style={s.note}>
          There is no self-service signup — HR creates your account.{'\n'}
          Signing in registers this phone to you; if you have changed handset,
          ask HR to unbind the old one first.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const WORD = 'HOLBOX'.split('');

/**
 * The shutter treatment from the approved web sign-in, rebuilt with RN
 * Animated instead of CSS keyframes. One amber slice sweeps each letter,
 * staggered along the word; only `translateX` animates, on the native driver.
 * The rule the web version learned the hard way carries over verbatim: the
 * LETTERS never animate opacity - if the animation fails, you get a plain
 * HOLBOX, never a blank screen.
 */
function HolboxShutter() {
  const sweeps = useRef(WORD.map(() => new Animated.Value(-1))).current;

  useEffect(() => {
    const anims = sweeps.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, {
            toValue: 1, duration: 700,
            easing: Easing.inOut(Easing.ease), useNativeDriver: true,
          }),
          Animated.delay(2300 - i * 140),
          Animated.timing(v, { toValue: -1, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [sweeps]);

  return (
    <View style={s.word} accessibilityLabel="HOLBOX">
      {WORD.map((ch, i) => (
        <View key={i} style={s.letterBox}>
          <Text style={s.letter} allowFontScaling={false}>{ch}</Text>
          <Animated.View
            pointerEvents="none"
            style={[
              s.slice,
              {
                transform: [{
                  translateX: sweeps[i].interpolate({
                    inputRange: [-1, 1], outputRange: [-34, 34],
                  }),
                }],
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ground },
  scroll: { padding: 24, paddingTop: 72, gap: 8 },
  brand: {
    color: c.ink, fontSize: 22, fontWeight: '800', letterSpacing: -0.5,
    textAlign: 'center',
  },
  lockup: { alignItems: 'center', marginTop: 28, marginBottom: 28, gap: 2 },
  welcome: { color: c.ink3, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' },
  word: { flexDirection: 'row', marginTop: 4 },
  letterBox: {
    width: 34, height: 46, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  letter: { color: c.ink, fontSize: 38, fontWeight: '900', letterSpacing: 0 },
  slice: {
    position: 'absolute', top: 4, bottom: 4, width: 12,
    backgroundColor: c.accent, opacity: 0.85, borderRadius: 2,
  },

  label: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.4,
    textTransform: 'uppercase', marginTop: 12,
  },
  input: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12,
    color: c.ink, fontSize: 16, marginTop: 6,
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 64 },
  showBtn: {
    position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center',
  },
  showText: { color: c.accent, fontSize: 13, fontWeight: '600', marginTop: 6 },
  error: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'flex-start' },
  errorGlyph: { color: c.crit, fontSize: 14, lineHeight: 20 },
  errorText: { color: c.crit, fontSize: 14, flex: 1, lineHeight: 20 },
  button: {
    backgroundColor: c.accent, borderRadius: 8, paddingVertical: 15,
    alignItems: 'center', marginTop: 24,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: c.accentInk, fontSize: 16, fontWeight: '700' },
  demoButton: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingVertical: 13, alignItems: 'center', marginTop: 10,
  },
  demoButtonText: { color: c.ink, fontSize: 14, fontWeight: '600' },
  note: {
    color: c.ink3, fontSize: 12, lineHeight: 18, marginTop: 20, textAlign: 'center',
  },
});
