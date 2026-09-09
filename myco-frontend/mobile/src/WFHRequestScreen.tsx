import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';

import { getWfhRequests, submitWfhRequest } from './api';
import { plainDate, STATUS_META } from './format';
import MiniCalendar from './MiniCalendar';
import { useTheme } from './ThemeContext';
import { theme, type ThemeColors } from './theme';
import type { WFHRequestItem, MonthDay } from './types';

const DATE_HINT = 'YYYY-MM-DD';

export default function WFHRequestScreen({ prefill }: { prefill: MonthDay | null }) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [items, setItems] = useState<WFHRequestItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(prefill !== null);
  const [shiftDate, setShiftDate] = useState(prefill?.date ?? '');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await getWfhRequests());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load WFH requests');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (prefill) {
      setFormOpen(true);
      setShiftDate(prefill.date);
      setDone(false);
    }
  }, [prefill]);

  async function submit() {
    setFormError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      setFormError(`The day must look like ${DATE_HINT}.`);
      return;
    }
    if (!reason.trim()) {
      setFormError('Please provide a reason for working from home.');
      return;
    }
    setBusy(true);
    
    const refusal = await submitWfhRequest(shiftDate, reason);
    if (refusal) {
      setFormError(refusal);
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    void load();
  }

  function renderForm() {
    if (done) {
      return (
        <View style={s.form}>
          <Text style={s.doneTitle}>Request submitted</Text>
          <Text style={s.doneBody}>
            Your manager will review it. You must still punch in via the mobile app - 
            the geofence check will be bypassed if approved.
          </Text>
          <Pressable
            style={s.buttonSecondary}
            onPress={() => {
              setDone(false);
              setFormOpen(false);
              setShiftDate('');
              setReason('');
            }}
          >
            <Text style={s.buttonSecondaryText}>Done</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={s.form}>
        <View style={s.formHeader}>
          <Text style={s.formTitle}>Request Work From Home</Text>
          <Pressable onPress={() => setFormOpen(false)} hitSlop={10}>
            <Text style={s.closeText}>Cancel</Text>
          </Pressable>
        </View>
        <Text style={s.formLead}>
          Submit a request to bypass the office geofence for a specific day.
        </Text>

        <View style={s.fieldGroup}>
          <Text style={s.label}>Shift date</Text>
          <Pressable onPress={() => setCalendarOpen(true)}>
            <View pointerEvents="none">
              <TextInput
                style={s.input}
                value={shiftDate}
                placeholder={DATE_HINT}
                placeholderTextColor={c.ink3}
                editable={false}
              />
            </View>
          </Pressable>
        </View>
        
        {calendarOpen && (
          <View style={s.calendarWrap}>
            <MiniCalendar
              value={shiftDate}
              onPick={(d) => {
                setShiftDate(d);
                setCalendarOpen(false);
              }}
            />
          </View>
        )}

        <View style={s.fieldGroup}>
          <Text style={s.label}>Reason</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            value={reason}
            onChangeText={setReason}
            placeholder="Why do you need to work from home?"
            placeholderTextColor={c.ink3}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        {formError && (
          <View style={s.formErrorBlock}>
            <Text style={s.formErrorText}>{formError}</Text>
          </View>
        )}

        <Pressable
          style={[s.button, busy && s.buttonBusy]}
          onPress={submit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={c.ground} />
          ) : (
            <Text style={s.buttonText}>Submit Request</Text>
          )}
        </Pressable>
      </View>
    );
  }

  function renderList() {
    if (items === null) {
      if (error) {
        return (
          <View style={s.center}>
            <Text style={s.error}>{error}</Text>
            <Pressable style={s.buttonSecondary} onPress={load}>
              <Text style={s.buttonSecondaryText}>Try Again</Text>
            </Pressable>
          </View>
        );
      }
      return (
        <View style={s.center}>
          <ActivityIndicator color={c.ink} size="large" />
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={s.center}>
          <Text style={s.emptyTitle}>No WFH requests yet</Text>
          <Text style={s.emptyBody}>
            Temporary work from home requests will appear here.
          </Text>
        </View>
      );
    }

    return (
      <View style={s.list}>
        {items.map((r) => {
          const meta = STATUS_META[r.status] || STATUS_META.pending;
          return (
            <View key={r.id} style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardDate}>{plainDate(r.shift_date)}</Text>
                <View style={[s.badge, { backgroundColor: c.surface2, borderColor: c.line }]}>
                  <Text style={[s.badgeText, { color: c.ink2 }]}>
                    {meta.glyph} {meta.label}
                  </Text>
                </View>
              </View>
              <Text style={s.cardMeta}>
                Requested on {plainDate(r.created_at.split('T')[0])}
              </Text>
              <Text style={s.cardReason}>"{r.reason}"</Text>
            </View>
          );
        })}
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await load();
          setRefreshing(false);
        }} />
      }
    >
      <View style={s.header}>
        <Text style={s.title}>Work From Home</Text>
        {!formOpen && (
          <Pressable style={s.buttonMini} onPress={() => {
            setFormOpen(true);
            setDone(false);
            setShiftDate('');
            setReason('');
          }}>
            <Text style={s.buttonMiniText}>New Request</Text>
          </Pressable>
        )}
      </View>

      {formOpen ? renderForm() : renderList()}
    </ScrollView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.ground },
    content: { padding: 24, paddingBottom: 120 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 24,
    },
    title: { fontSize: 32, fontWeight: '900', color: c.ink },
    
    buttonMini: {
      backgroundColor: c.ink, paddingHorizontal: 16, paddingVertical: 8,
      borderRadius: 12,
    },
    buttonMiniText: {
      fontSize: 12, fontWeight: '700',
      textTransform: 'uppercase', color: c.ground,
    },

    center: { paddingVertical: 48, alignItems: 'center', gap: 16 },
    error: { fontSize: 13, color: c.ink2, textAlign: 'center' },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: c.ink },
    emptyBody: {
      fontSize: 13, color: c.ink3,
      textAlign: 'center', maxWidth: 280, marginTop: 4,
    },

    list: { gap: 12 },
    card: {
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
      borderRadius: 16, padding: 16, gap: 4,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardDate: { fontSize: 16, fontWeight: '700', color: c.ink },
    cardMeta: { fontSize: 12, color: c.ink3, marginBottom: 4 },
    cardReason: { fontSize: 14, color: c.ink2, fontStyle: 'italic' },
    
    badge: {
      paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
      borderWidth: 1,
    },
    badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

    form: {
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.line,
      borderRadius: 20, padding: 20, gap: 20,
    },
    formHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    formTitle: { fontSize: 18, fontWeight: '700', color: c.ink },
    closeText: { fontSize: 12, color: c.ink3 },
    formLead: { fontSize: 14, color: c.ink2, marginTop: -12, marginBottom: 8 },

    fieldGroup: { gap: 8 },
    label: { fontSize: 12, fontWeight: '600', color: c.ink2, textTransform: 'uppercase' },
    input: {
      backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line,
      borderRadius: 12, padding: 16, fontSize: 16, color: c.ink,
    },
    inputMulti: { height: 100 },
    
    calendarWrap: {
      marginTop: -12, marginBottom: 8, backgroundColor: c.surface2,
      borderWidth: 1, borderColor: c.line, borderRadius: 16, padding: 12,
    },

    button: {
      backgroundColor: c.ink, padding: 16, borderRadius: 12,
      alignItems: 'center', justifyContent: 'center', marginTop: 8,
    },
    buttonBusy: { opacity: 0.7 },
    buttonText: {
      fontSize: 14, fontWeight: '700',
      color: c.ground, textTransform: 'uppercase', letterSpacing: 1,
    },

    buttonSecondary: {
      backgroundColor: c.surface2, borderWidth: 1, borderColor: c.line,
      padding: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    },
    buttonSecondaryText: {
      fontSize: 14, fontWeight: '700',
      color: c.ink, textTransform: 'uppercase', letterSpacing: 1,
    },

    formErrorBlock: { backgroundColor: `${c.warnBg}15`, padding: 12, borderRadius: 8 },
    formErrorText: { fontSize: 12, color: c.warn },

    doneTitle: { fontSize: 20, fontWeight: '800', color: c.ink, textAlign: 'center' },
    doneBody: { fontSize: 15, color: c.ink2, textAlign: 'center', lineHeight: 22, marginBottom: 12 },
  });
}
