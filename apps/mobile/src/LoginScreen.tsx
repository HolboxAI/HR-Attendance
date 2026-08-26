import { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';

import { signIn } from './session';
import { theme } from './theme';
import type { Identity } from './auth';

const c = theme.color;

/**
 * The same login as the dashboard. There is no separate employee credential
 * and no signup - HR creates the account and hands over a temporary password.
 */
export default function LoginScreen({ onSignedIn }: { onSignedIn: (i: Identity) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        <Text style={s.brand}>Boxcode</Text>
        <Text style={s.title}>Sign in to check in</Text>

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
        />

        <Text style={s.label}>Password</Text>
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
          editable={!busy}
        />

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
          Signing in registers this phone to you. If you have changed handset,
          ask HR to remove the old one first.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ground },
  scroll: { padding: 24, paddingTop: 64, gap: 8 },
  brand: { color: c.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  title: { color: c.ink2, fontSize: 15, marginBottom: 20 },
  label: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.4,
    textTransform: 'uppercase', marginTop: 12,
  },
  input: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12,
    color: c.ink, fontSize: 16, marginTop: 6,
  },
  error: { flexDirection: 'row', gap: 8, marginTop: 16, alignItems: 'flex-start' },
  errorGlyph: { color: c.crit, fontSize: 14, lineHeight: 20 },
  errorText: { color: c.crit, fontSize: 14, flex: 1, lineHeight: 20 },
  button: {
    backgroundColor: c.accent, borderRadius: 8, paddingVertical: 15,
    alignItems: 'center', marginTop: 24,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: c.accentInk, fontSize: 16, fontWeight: '700' },
  note: { color: c.ink3, fontSize: 12, lineHeight: 18, marginTop: 20 },
});
