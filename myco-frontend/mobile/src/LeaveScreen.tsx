import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View, ActionSheetIOS, Platform, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { applyForLeave, cancelLeave, getLeaveBalance, getMyLeave, getHolidays } from './api';
import MiniCalendar from './MiniCalendar';
import { useTheme } from './ThemeContext';
import type { ThemeColors } from './theme';
import type { LeaveBalance, LeaveRequestItem, Holiday } from './types';

/** Dates are YYYY-MM-DD - typed, or picked from the calendar beside the field. */
const DATE_HINT = 'YYYY-MM-DD';
const looksLikeDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

const LEAVE_CATEGORIES = [
  'Personal',
  'Family emergency',
  'Medical/health-related',
  'Family/household responsibility',
  'Other legitimate personal reason',
];

function formatDateLong(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export default function LeaveScreen() {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);
  const STATUS: Record<LeaveRequestItem['status'], { label: string; glyph: string; tone: string }> = {
    pending: { label: 'Pending', glyph: '◌', tone: c.warn },
    approved: { label: 'Approved', glyph: '●', tone: c.ok },
    partially_approved: { label: 'Partial', glyph: '◐', tone: c.warn },
    rejected: { label: 'Rejected', glyph: '○', tone: c.crit },
    cancelled: { label: 'Cancelled', glyph: '–', tone: c.ink3 },
  };

  const [balances, setBalances] = useState<LeaveBalance[] | null>(null);
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [code, setCode] = useState('CL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('Personal');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<{ uri: string; type: string; name: string; webFile?: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Which field the calendar is filling; only one grid open at a time.
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);

  const selectedBalance = balances?.find((b) => b.code === code);
  const requiresProof = selectedBalance?.requiresProof;

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [showAllHolidays, setShowAllHolidays] = useState(false);
  const [calendarModalVisible, setCalendarModalVisible] = useState(false);

  const upcomingHolidays = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    return holidays.filter(h => h.day >= todayStr).sort((a, b) => a.day.localeCompare(b.day));
  }, [holidays]);

  const holidayDates = useMemo(() => new Set(holidays.map(h => h.day)), [holidays]);

  const load = useCallback(async () => {
    try {
      const [b, r, h] = await Promise.all([getLeaveBalance(), getMyLeave(), getHolidays()]);
      setBalances(b);
      setRequests(r);
      setHolidays(h);
      if (b.length && !b.some((x) => x.code === code)) setCode(b[0].code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your leave');
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  async function pickImage() {
    const options = ['Take Photo', 'Choose from Library', 'Cancel'];
    const pick = async (index: number) => {
      let result;
      if (index === 0) {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) { Alert.alert('Camera permission required'); return; }
        result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      } else if (index === 1) {
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      }
      if (result && !result.canceled) {
        const asset = result.assets?.[0];
        if (!asset) return;
        if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
          setError('File too large. Maximum 5MB.');
          return;
        }
        const uri = asset.uri;
        const ext = uri.split('.').pop() || 'jpg';
        setFile({ uri, type: asset.file?.type || `image/${ext}`, name: asset.file?.name || `doc.${ext}`, webFile: asset.file });
      }
    };

    if (Platform.OS === 'web') {
      pick(1);
    } else if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 2 },
        (btnIndex) => { if (btnIndex !== 2) pick(btnIndex); }
      );
    } else {
      Alert.alert('Upload Document', 'Choose an option', [
        { text: 'Take Photo', onPress: () => pick(0) },
        { text: 'Choose from Library', onPress: () => pick(1) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

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
    if (requiresProof && !file) {
      setError('A medical document is required for this leave type.');
      return;
    }
    if (!category) {
      setError('Please select a leave reason category.');
      return;
    }
    setBusy(true);
    const problem = await applyForLeave({ 
      code, from, to, halfDay: false, category, reason, 
      fileUri: file?.uri, fileType: file?.type, fileName: file?.name, webFile: file?.webFile 
    });
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setFrom(''); setTo(''); setReason(''); setCategory('Personal'); setFile(null);
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

        <Text style={[s.label, { marginTop: 4, marginBottom: 4 }]}>Reason Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {LEAVE_CATEGORIES.map((cat) => {
              const on = category === cat;
              return (
                <Pressable
                  key={cat}
                  style={[s.chip, on && s.chipOn]}
                  onPress={() => setCategory(cat)}
                  accessibilityRole="button"
                >
                  <Text style={[s.chipText, on && s.chipTextOn]}>{cat}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={s.reasonRow}>
          <TextInput
            style={[s.input, { flex: 1 }]} value={reason} onChangeText={setReason}
            placeholder={requiresProof ? "Reason (Document Required)" : "Reason"} 
            placeholderTextColor={requiresProof ? c.crit : c.ink3} editable={!busy}
          />
          <Pressable
            style={[s.pickBtn, file && s.pickBtnOn]}
            onPress={pickImage}
            accessibilityRole="button"
          >
            <Text style={[s.pickText, file && s.pickTextOn]}>📎</Text>
          </Pressable>
        </View>
        {file && <Text style={{ fontSize: 11, color: c.ink3, marginLeft: 4 }}>Attachment selected</Text>}

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
          const st = STATUS[r.status] || { label: String(r.status), glyph: '?', tone: c.ink3 };
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
                {r.category ? <Text style={[s.rowNote, { fontWeight: '600', color: c.ink }]}>Category: {r.category}</Text> : null}
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

      <View style={s.holidayHeader}>
        <Text style={s.label}>Upcoming Holidays</Text>
        <Pressable onPress={() => setCalendarModalVisible(true)} accessibilityRole="button" style={s.calendarBtn}>
          <Text style={s.calendarBtnText}>▦</Text>
        </Pressable>
      </View>

      {upcomingHolidays.length === 0 ? (
        <Text style={s.empty}>No upcoming holidays.</Text>
      ) : (
        <View style={s.holidayList}>
          {(showAllHolidays ? upcomingHolidays : upcomingHolidays.slice(0, 10)).map(h => {
            const d = new Date(h.day + 'T00:00:00');
            const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayNum = d.getDate();
            const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
            const yearStr = d.getFullYear();
            return (
              <View key={h.id} style={s.holidayItem}>
                <View style={s.holidayDateBadge}>
                  <Text style={s.holidayDay}>{dayNum}</Text>
                  <Text style={s.holidayMonth}>{monthStr}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.holidayName}>{h.name}</Text>
                  <Text style={s.holidayMeta}>
                    {weekday}, {monthStr} {dayNum}, {yearStr}
                    {h.is_optional ? '  ·  Optional' : ''}
                  </Text>
                </View>
              </View>
            );
          })}
          {!showAllHolidays && upcomingHolidays.length > 10 && (
            <Pressable onPress={() => setShowAllHolidays(true)} style={s.readMore} accessibilityRole="button">
              <Text style={s.readMoreText}>Read more ›</Text>
            </Pressable>
          )}
          {showAllHolidays && upcomingHolidays.length > 10 && (
            <Pressable onPress={() => setShowAllHolidays(false)} style={s.readMore} accessibilityRole="button">
              <Text style={s.readMoreText}>Show less ‹</Text>
            </Pressable>
          )}
        </View>
      )}

      <Modal visible={calendarModalVisible} transparent animationType="fade" onRequestClose={() => setCalendarModalVisible(false)}>
        <View style={s.modalOverlay}>
          <ScrollView style={s.modalScroll} contentContainerStyle={{ padding: 0 }}>
            <View style={s.modalContent}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.modalTitle}>Holiday Calendar</Text>
                <Pressable onPress={() => setCalendarModalVisible(false)} hitSlop={12} accessibilityRole="button">
                  <Text style={s.modalClose}>✕</Text>
                </Pressable>
              </View>
              <MiniCalendar
                value={new Date().toISOString().slice(0, 10)}
                readOnly
                highlights={holidayDates}
              />
              <View style={s.legendRow}>
                <View style={[s.legendDot, { backgroundColor: c.accent }]} />
                <Text style={s.legendText}>Highlighted dates are holidays</Text>
              </View>
              {holidays.length > 0 && (
                <View style={{ marginTop: 8, gap: 6 }}>
                  <Text style={s.modalSubhead}>All Holidays</Text>
                  {holidays.sort((a, b) => a.day.localeCompare(b.day)).map(h => {
                    const d = new Date(h.day + 'T00:00:00');
                    return (
                      <View key={h.id} style={s.modalHolidayRow}>
                        <Text style={s.modalHolidayName}>{h.name}</Text>
                        <Text style={s.modalHolidayDate}>
                          {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          {h.is_optional ? '  ·  Optional' : ''}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    textTransform: 'uppercase', fontWeight: '700',
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
  reasonRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
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

  /* ---- Holidays section ---- */
  holidayHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 28, marginBottom: 8,
  },
  calendarBtn: {
    borderColor: c.accent, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  calendarBtnText: { color: c.accent, fontSize: 16, fontWeight: '700' },
  holidayList: {
    backgroundColor: c.surface, borderColor: c.line, borderWidth: 1,
    borderRadius: 12, overflow: 'hidden',
  },
  holidayItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: c.line,
  },
  holidayDateBadge: {
    width: 46, height: 46, borderRadius: 10,
    backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center',
  },
  holidayDay: { color: c.ink, fontSize: 18, fontWeight: '800', lineHeight: 22 },
  holidayMonth: { color: c.accent, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  holidayName: { color: c.ink, fontSize: 14, fontWeight: '700' },
  holidayMeta: { color: c.ink3, fontSize: 12, marginTop: 2 },
  readMore: {
    paddingVertical: 14, alignItems: 'center',
    borderTopWidth: 1, borderTopColor: c.line,
  },
  readMoreText: { color: c.accent, fontSize: 13, fontWeight: '700' },

  /* ---- Holiday calendar modal ---- */
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  modalScroll: {
    flex: 1, width: '100%',
    marginTop: 60, marginBottom: 40,
  },
  modalContent: {
    backgroundColor: c.surface, borderRadius: 16, padding: 20,
    width: '100%', maxWidth: 340, gap: 12,
    borderWidth: 1, borderColor: c.line,
    alignSelf: 'center',
  },
  modalTitle: { color: c.ink, fontSize: 18, fontWeight: '800' },
  modalClose: { color: c.ink3, fontSize: 18, fontWeight: '700' },
  modalSubhead: { color: c.ink3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  modalHolidayRow: {
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line,
  },
  modalHolidayName: { color: c.ink, fontSize: 13, fontWeight: '700' },
  modalHolidayDate: { color: c.ink3, fontSize: 11, marginTop: 2 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: c.ink3, fontSize: 12 },
});

