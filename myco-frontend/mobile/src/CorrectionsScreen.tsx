import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';

import { cancelCorrection, getMyCorrections, submitCorrection } from './api';
import { hhmm, plainDate, STATUS_META } from './format';
import { theme } from './theme';
import type { CorrectionItem, MonthDay, PunchDirection } from './types';

const c = theme.color;

const DATE_HINT = 'YYYY-MM-DD';
const TIME_HINT = 'HH:MM';

/**
 * The employee's only route out of a broken day (PRD §11.2): claim the time
 * you actually punched, say why, and HR decides. Nothing here edits
 * attendance - the claimed time becomes a punch only on approval, and the
 * screen says so wherever it could be misread.
 */
export default function CorrectionsScreen({ prefill }: { prefill: MonthDay | null }) {
  const [items, setItems] = useState<CorrectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(prefill !== null);
  const [shiftDate, setShiftDate] = useState(prefill?.date ?? '');
  const [direction, setDirection] = useState<PunchDirection>(
    prefill && prefill.first_in && !prefill.last_out ? 'out' : 'in',
  );
  const [time, setTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [cancelBusy, setCancelBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await getMyCorrections());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load requests');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (prefill) {
      setFormOpen(true);
      setShiftDate(prefill.date);
      setDirection(prefill.first_in && !prefill.last_out ? 'out' : 'in');
      setDone(false);
    }
  }, [prefill]);

  async function submit() {
    setFormError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      setFormError(`The day must look like ${DATE_HINT}.`);
      return;
    }
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      setFormError(`The time must look like ${TIME_HINT}, e.g. 18:30.`);
      return;
    }
    if (!reason.trim()) {
      setFormError('Say why the punch is missing - HR reads this.');
      return;
    }
    setBusy(true);
    // Sent as IST wall clock: "I left at 18:30" means 18:30 at the office.
    const hhmmPadded = time.length === 4 ? `0${time}` : time;
    const refusal = await submitCorrection({
      shiftDate,
      direction,
      claimedAt: `${shiftDate}T${hhmmPadded}:00+05:30`,
      reason: reason.trim(),
    });
    setBusy(false);
    if (refusal) {
      setFormError(refusal);
      return;
    }
    setDone(true);
    setFormOpen(false);
    setShiftDate(''); setTime(''); setReason('');
    void load();
  }

  async function withdraw(id: string) {
    setCancelBusy(id);
    await cancelCorrection(id).catch(() => undefined);
    setCancelBusy(null);
    void load();
  }

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.accent}
          onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
        />
      }
    >
      <Text style={s.title}>Corrections</Text>
      <Text style={s.subtitle}>
        A flagged day gets fixed by asking. Your claim becomes a real punch only
        when HR approves it.
      </Text>

      {done && (
        <View style={s.okBox} accessibilityLiveRegion="polite">
          <Text style={s.okText}>
            ● Submitted. You&apos;ll see the decision here and in your inbox.
          </Text>
        </View>
      )}

      {formOpen ? (
        <View style={s.form}>
          <Text style={s.label}>Which day ({DATE_HINT})</Text>
          <TextInput
            style={s.input} value={shiftDate} onChangeText={setShiftDate}
            placeholder="2026-08-26" placeholderTextColor={c.ink3}
            autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation"
          />

          <Text style={s.label}>What is missing</Text>
          <View style={s.segmented}>
            {(['in', 'out'] as PunchDirection[]).map((d) => (
              <Pressable
                key={d}
                onPress={() => setDirection(d)}
                style={[s.segment, direction === d && s.segmentOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: direction === d }}
              >
                <Text style={[s.segmentText, direction === d && s.segmentTextOn]}>
                  {d === 'in' ? 'Check-in' : 'Check-out'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={s.label}>Time it actually happened ({TIME_HINT}, office time)</Text>
          <TextInput
            style={s.input} value={time} onChangeText={setTime}
            placeholder="18:30" placeholderTextColor={c.ink3}
            autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation"
          />

          <Text style={s.label}>Why - HR reads this</Text>
          <TextInput
            style={[s.input, s.multiline]} value={reason} onChangeText={setReason}
            placeholder="e.g. Phone battery died before I could check out"
            placeholderTextColor={c.ink3} multiline
          />

          {formError && (
            <Text style={s.formError} accessibilityLiveRegion="polite">○ {formError}</Text>
          )}

          <Pressable
            style={[s.submit, busy && s.busy]} onPress={submit} disabled={busy}
            accessibilityRole="button"
          >
            {busy
              ? <ActivityIndicator color={c.accentInk} />
              : <Text style={s.submitText}>Submit for approval</Text>}
          </Pressable>
          <Pressable onPress={() => setFormOpen(false)} accessibilityRole="button">
            <Text style={s.cancelLink}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={s.newBtn} onPress={() => { setFormOpen(true); setDone(false); }}
          accessibilityRole="button"
        >
          <Text style={s.newBtnText}>New correction request</Text>
        </Pressable>
      )}

      <Text style={s.sectionTitle}>YOUR REQUESTS</Text>
      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={load} accessibilityRole="button">
            <Text style={s.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : items === null ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: 20 }} />
      ) : items.length === 0 ? (
        <Text style={s.empty}>
          Nothing yet. When a day of yours is flagged, the request you submit
          here is how it gets fixed.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {items.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.pending;
            return (
              <View key={r.id} style={s.item}>
                <View style={s.itemRow}>
                  <Text style={s.itemDate}>{plainDate(r.shiftDate)}</Text>
                  <Text style={s.itemStatus}>
                    <Text style={s.glyph}>{meta.glyph} </Text>{meta.label}
                  </Text>
                </View>
                <Text style={s.itemDetail}>
                  {r.direction === 'in' ? 'Check-in' : 'Check-out'} at {hhmm(r.claimedAt)}
                </Text>
                <Text style={s.itemReason}>{r.reason}</Text>
                {r.decidedNote && (
                  <Text style={s.itemNote}>HR: {r.decidedNote}</Text>
                )}
                {r.status === 'pending' && (
                  <Pressable
                    onPress={() => withdraw(r.id)}
                    disabled={cancelBusy === r.id}
                    accessibilityRole="button"
                    style={s.withdraw}
                  >
                    <Text style={s.withdrawText}>
                      {cancelBusy === r.id ? 'Withdrawing…' : 'Withdraw'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 20, paddingTop: 24, gap: 12 },
  title: { color: c.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { color: c.ink2, fontSize: 14, lineHeight: 20, marginTop: -6 },

  okBox: {
    backgroundColor: '#12291F', borderColor: c.ok, borderWidth: 1,
    borderRadius: theme.radius.md, padding: 12,
  },
  okText: { color: c.ok, fontSize: 14 },

  newBtn: {
    backgroundColor: c.accent, borderRadius: theme.radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  newBtnText: { color: c.accentInk, fontWeight: '700', fontSize: 15 },

  form: {
    backgroundColor: c.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: c.line, padding: 16, gap: 4,
  },
  label: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.2,
    textTransform: 'uppercase', marginTop: 10,
  },
  input: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11,
    color: c.ink, fontSize: 15, marginTop: 6,
  },
  multiline: { minHeight: 64, textAlignVertical: 'top' },
  segmented: { flexDirection: 'row', gap: 8, marginTop: 6 },
  segment: {
    flex: 1, borderWidth: 1, borderColor: c.line, borderRadius: 8,
    paddingVertical: 10, alignItems: 'center',
  },
  segmentOn: { borderColor: c.accent, backgroundColor: '#33270F' },
  segmentText: { color: c.ink3, fontSize: 14, fontWeight: '600' },
  segmentTextOn: { color: c.accent },
  formError: { color: c.crit, fontSize: 13, lineHeight: 18, marginTop: 10 },
  submit: {
    backgroundColor: c.accent, borderRadius: 8, paddingVertical: 13,
    alignItems: 'center', marginTop: 14,
  },
  busy: { opacity: 0.7 },
  submitText: { color: c.accentInk, fontWeight: '700', fontSize: 15 },
  cancelLink: { color: c.ink3, fontSize: 14, textAlign: 'center', paddingVertical: 10 },

  sectionTitle: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.4, fontWeight: '700', marginTop: 12,
  },
  item: {
    backgroundColor: c.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: c.line, padding: 14, gap: 3,
  },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between' },
  itemDate: { color: c.ink, fontSize: 15, fontWeight: '600' },
  itemStatus: { color: c.ink2, fontSize: 14 },
  glyph: { color: c.ink3 },
  itemDetail: { color: c.ink2, fontSize: 13, fontVariant: ['tabular-nums'] },
  itemReason: { color: c.ink3, fontSize: 13, lineHeight: 18 },
  itemNote: { color: c.ink2, fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
  withdraw: { alignSelf: 'flex-start', marginTop: 6 },
  withdrawText: { color: c.accent, fontSize: 13, fontWeight: '600' },

  empty: { color: c.ink3, fontSize: 14, lineHeight: 20 },
  errorBox: { gap: 8 },
  errorText: { color: c.ink2, fontSize: 14, lineHeight: 20 },
  retry: { color: c.accent, fontWeight: '600', fontSize: 14 },
});
