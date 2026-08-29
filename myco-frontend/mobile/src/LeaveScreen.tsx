import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';

import { applyForLeave, cancelLeave, getLeaveBalance, getMyLeave } from './api';
import MiniCalendar from './MiniCalendar';
import { useTheme } from './ThemeContext';
import type { ThemeColors } from './theme';
import type { LeaveBalance, LeaveRequestItem } from './types';

/** Dates are YYYY-MM-DD - typed, or picked from the calendar beside the field. */
const DATE_HINT = 'YYYY-MM-DD';
const looksLikeDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function LeaveScreen() {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const STATUS: Record<LeaveRequestItem['status'], { label: string; glyph: string; tone: string }> = {
    pending: { label: 'Pending', glyph: '◌', tone: c.warn },
    approved: { label: 'Approved', glyph: '●', tone: c.ok },
    rejected: { label: 'Rejected', glyph: '○', tone: c.crit },
    cancelled: { label: 'Cancelled', glyph: '–', tone: c.ink3 },
  };

  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [code, setCode] = useState('CL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Which field the calendar is filling; only one grid open at a time.
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([getLeaveBalance(), getMyLeave()]);
      setBalances(b);
      setRequests(r);
      if (b.length && !b.some((x) => x.code === code)) setCode(b[0].code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your leave');
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  async function submit() {
    setError(null);
    setSent(false);
    if (!looksLikeDate(from)) {
      setError(`Start date must look like ${DATE_HINT}`);
      return;
    }
    if (to && !looksLikeDate(to)) {
      setError(`End date must look like ${DATE_HINT}`);
      return;
    }
    setBusy(true);
    const problem = await applyForLeave({ code, from, to, halfDay: false, reason });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setFrom(''); setTo(''); setReason('');
    setPicking(null);
    setSent(true);
    load();
  }

  if (!balances) {
    return (
      <View style={[s.root, s.centre]}>
        <ActivityIndicator color={c.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={s.root}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={c.ink3} />}
    >
      <Text style={s.h1}>Leave</Text>

      <Text style={s.label}>Your balance</Text>
      <View style={s.cards}>
        {balances.map((b) => (
          <View key={b.code} style={s.card}>
            <Text style={s.cardName}>{b.name}</Text>
            <Text style={s.cardValue}>
              {b.available}
              <Text style={s.cardUnit}> left</Text>
            </Text>
            <Text style={s.cardSub}>{b.accrued} earned · {b.used} taken</Text>
          </View>
        ))}
      </View>

      <Text style={s.label}>Apply</Text>
      <View style={s.form}>
        <View style={s.chips}>
          {balances.map((b) => (
            <Pressable
              key={b.code} onPress={() => setCode(b.code)}
              style={[s.chip, code === b.code && s.chipOn]}
              accessibilityRole="button"
            >
              <Text style={[s.chipText, code === b.code && s.chipTextOn]}>{b.code}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.dateRow}>
          <TextInput
            style={[s.input, { flex: 1 }]} value={from} onChangeText={setFrom}
            placeholder={`From  ${DATE_HINT}`} placeholderTextColor={c.ink3}
            autoCapitalize="none" autoCorrect={false} editable={!busy}
          />
          <Pressable
            style={[s.pickBtn, picking === 'from' && s.pickBtnOn]}
            onPress={() => setPicking(picking === 'from' ? null : 'from')}
            accessibilityRole="button"
            accessibilityLabel="Pick the start date from a calendar"
          >
            <Text style={[s.pickText, picking === 'from' && s.pickTextOn]}>▦</Text>
          </Pressable>
        </View>
        {picking === 'from' && (
          <MiniCalendar
            value={from}
            onPick={(d) => { setFrom(d); setPicking(null); }}
          />
        )}

        <View style={s.dateRow}>
          <TextInput
            style={[s.input, { flex: 1 }]} value={to} onChangeText={setTo}
            placeholder={`To  ${DATE_HINT}  (same day if blank)`} placeholderTextColor={c.ink3}
            autoCapitalize="none" autoCorrect={false} editable={!busy}
          />
          <Pressable
            style={[s.pickBtn, picking === 'to' && s.pickBtnOn]}
            onPress={() => setPicking(picking === 'to' ? null : 'to')}
            accessibilityRole="button"
            accessibilityLabel="Pick the end date from a calendar"
          >
            <Text style={[s.pickText, picking === 'to' && s.pickTextOn]}>▦</Text>
          </Pressable>
        </View>
        {picking === 'to' && (
          <MiniCalendar
            value={to || from}
            onPick={(d) => { setTo(d); setPicking(null); }}
          />
        )}

        <TextInput
          style={s.input} value={reason} onChangeText={setReason}
          placeholder="Reason" placeholderTextColor={c.ink3} editable={!busy}
        />

        {error && (
          <View style={s.msg} accessibilityLiveRegion="polite">
            <Text style={[s.msgGlyph, { color: c.crit }]}>○</Text>
            <Text style={[s.msgText, { color: c.crit }]}>{error}</Text>
          </View>
        )}
        {sent && (
          <View style={s.msg}>
            <Text style={[s.msgGlyph, { color: c.ok }]}>●</Text>
            <Text style={[s.msgText, { color: c.ok }]}>
              Sent. It stays Pending until someone decides.
            </Text>
          </View>
        )}

        <Pressable
          style={[s.button, busy && s.buttonBusy]} onPress={submit} disabled={busy}
          accessibilityRole="button"
        >
          {busy
            ? <ActivityIndicator color={c.accentInk} />
            : <Text style={s.buttonText}>Apply for leave</Text>}
        </Pressable>
      </View>

      <Text style={s.label}>Your requests</Text>
      {requests.length === 0 ? (
        <Text style={s.empty}>You haven&apos;t applied for anything yet.</Text>
      ) : (
        requests.map((r) => {
          const st = STATUS[r.status];
          const live = r.status === 'pending' || r.status === 'approved';
          return (
            <View key={r.id} style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>
                  {r.code} · {r.fromDate}{r.toDate !== r.fromDate ? ` → ${r.toDate}` : ''}
                </Text>
                <Text style={[s.rowStatus, { color: st.tone }]}>
                  {st.glyph} {st.label} · {r.days} day{r.days === 1 ? '' : 's'}
                </Text>
                {r.note ? <Text style={s.rowNote}>{r.note}</Text> : null}
              </View>
              {live && (
                <Pressable
                  onPress={async () => { await cancelLeave(r.id); load(); }}
                  style={s.cancel} accessibilityRole="button"
                >
                  <Text style={s.cancelText}>Cancel</Text>
                </Pressable>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.ground },
  centre: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 10, paddingBottom: 40 },
  h1: { color: c.ink, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  label: {
    color: c.ink3, fontSize: 11, letterSpacing: 1.4,
    textTransform: 'uppercase', marginTop: 16,
  },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: {
    flexGrow: 1, minWidth: 100, backgroundColor: c.surface, borderColor: c.line,
    borderWidth: 1, borderRadius: 10, padding: 12,
  },
  cardName: { color: c.ink3, fontSize: 11 },
  cardValue: { color: c.ink, fontSize: 22, fontWeight: '800', marginTop: 2 },
  cardUnit: { color: c.ink3, fontSize: 12, fontWeight: '400' },
  cardSub: { color: c.ink3, fontSize: 11, marginTop: 2 },
  form: {
    backgroundColor: c.surface, borderColor: c.line, borderWidth: 1,
    borderRadius: 10, padding: 12, gap: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderColor: c.line, borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { color: c.ink2, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: c.accentInk },
  input: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: c.ink, fontSize: 15,
  },
  dateRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pickBtn: {
    borderColor: c.line, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 13, paddingVertical: 10,
  },
  pickBtnOn: { borderColor: c.accent, backgroundColor: c.hiBg },
  pickText: { color: c.ink2, fontSize: 15, fontWeight: '600' },
  pickTextOn: { color: c.accent },
  msg: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  msgGlyph: { fontSize: 13, lineHeight: 19 },
  msgText: { fontSize: 13, flex: 1, lineHeight: 19 },
  button: {
    backgroundColor: c.accent, borderRadius: 8, paddingVertical: 13,
    alignItems: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: c.accentInk, fontSize: 15, fontWeight: '700' },
  empty: { color: c.ink3, fontSize: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.surface, borderColor: c.line, borderWidth: 1,
    borderRadius: 10, padding: 12,
  },
  rowTitle: { color: c.ink, fontSize: 14, fontWeight: '600' },
  rowStatus: { fontSize: 13, marginTop: 2 },
  rowNote: { color: c.ink3, fontSize: 12, marginTop: 2 },
  cancel: {
    borderColor: c.line, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  cancelText: { color: c.ink2, fontSize: 12 },
});
