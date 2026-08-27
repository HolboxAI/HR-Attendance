import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { getMonth } from './api';
import { hhmm, hoursLabel, monthTitle, plainDate, STATUS_META } from './format';
import { theme } from './theme';
import type { MonthData, MonthDay } from './types';

const c = theme.color;

/**
 * Your month, day by day - the screen the API has served since /mobile/month
 * existed with nothing on the phone to show it. Future days are simply not
 * listed: nobody is absent for a day that has not happened. A flagged day
 * carries a "fix this" affordance that hands off to the correction flow.
 */
export default function MonthScreen({
  onRequestCorrection,
}: {
  onRequestCorrection: (day: MonthDay) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const load = useCallback(async (y: number, m: number) => {
    setError(null);
    try {
      setData(await getMonth(y, m));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the month');
    }
  }, []);

  useEffect(() => { void load(year, month); }, [year, month, load]);

  function shift(delta: number) {
    setData(null);
    setOpenDay(null);
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y); setMonth(m);
  }

  const isCurrent = year === now.getFullYear() && month === now.getMonth() + 1;
  const today = new Date().toISOString().slice(0, 10);
  const days = (data?.days ?? []).filter((d) => d.date <= today).reverse();

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={c.accent}
          onRefresh={async () => {
            setRefreshing(true);
            await load(year, month);
            setRefreshing(false);
          }}
        />
      }
    >
      <View style={s.nav}>
        <Pressable onPress={() => shift(-1)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous month">
          <Text style={s.navArrow}>‹</Text>
        </Pressable>
        <Text style={s.title}>{monthTitle(year, month)}</Text>
        <Pressable
          onPress={() => shift(1)} hitSlop={12} disabled={isCurrent}
          accessibilityRole="button" accessibilityLabel="Next month"
        >
          <Text style={[s.navArrow, isCurrent && s.navArrowOff]}>›</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={() => load(year, month)} accessibilityRole="button">
            <Text style={s.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : !data ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={s.totals}>
            <Total label="Present" value={String(data.totals.present ?? 0)} />
            <Total label="Half" value={String(data.totals.half_day ?? 0)} />
            <Total label="Absent" value={String(data.totals.absent ?? 0)} />
            <Total label="Hours" value={hoursLabel(data.totals.worked_minutes ?? 0)} />
          </View>

          {days.length === 0 ? (
            <Text style={s.empty}>Nothing yet - this month has only just started.</Text>
          ) : (
            <View style={s.list}>
              {days.map((d) => {
                const meta = STATUS_META[d.status] ?? STATUS_META.not_marked;
                const off = d.status === 'weekly_off' || d.status === 'holiday';
                const open = openDay === d.date;
                return (
                  <Pressable
                    key={d.date}
                    onPress={() => setOpenDay(open ? null : d.date)}
                    accessibilityRole="button"
                    accessibilityLabel={`${plainDate(d.date)}, ${meta.label}${d.has_exception ? ', needs attention' : ''}`}
                    style={[s.day, off && s.dayOff]}
                  >
                    <View style={s.dayRow}>
                      <Text style={s.dayDate}>{plainDate(d.date)}</Text>
                      <Text style={s.dayStatus}>
                        <Text style={s.glyph}>{meta.glyph} </Text>{meta.label}
                      </Text>
                      {d.worked_minutes > 0 && (
                        <Text style={s.dayHours}>{hoursLabel(d.worked_minutes)}</Text>
                      )}
                      {d.has_exception && <Text style={s.flag}>⚠</Text>}
                    </View>

                    {open && (
                      <View style={s.detail}>
                        <Detail label="In" value={hhmm(d.first_in)} />
                        <Detail label="Out" value={hhmm(d.last_out)} />
                        {d.late_minutes > 0 && (
                          <Detail label="Late by" value={`${d.late_minutes}m`} />
                        )}
                        {d.overtime_minutes > 0 && (
                          <Detail label="Overtime" value={`${d.overtime_minutes}m`} />
                        )}
                        {d.exception_note && (
                          <Text style={s.note}>⚠ {d.exception_note}</Text>
                        )}
                        {d.has_exception && (
                          <Pressable
                            style={s.fixBtn}
                            onPress={() => onRequestCorrection(d)}
                            accessibilityRole="button"
                          >
                            <Text style={s.fixText}>Request a correction</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.total}>
      <Text style={s.totalLabel}>{label}</Text>
      <Text style={s.totalValue}>{value}</Text>
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 20, paddingTop: 24, gap: 16 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navArrow: { color: c.accent, fontSize: 30, fontWeight: '600', paddingHorizontal: 10 },
  navArrowOff: { color: c.line },
  title: { color: c.ink, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },

  totals: { flexDirection: 'row', gap: 8 },
  total: {
    flex: 1, backgroundColor: c.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: c.line, padding: 10, alignItems: 'center', gap: 2,
  },
  totalLabel: { color: c.ink3, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  totalValue: { color: c.ink, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },

  list: { gap: 6 },
  day: {
    backgroundColor: c.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: c.line, paddingHorizontal: 14, paddingVertical: 12,
  },
  dayOff: { opacity: 0.55 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayDate: { color: c.ink, fontSize: 14, fontWeight: '600', width: 92 },
  dayStatus: { color: c.ink2, fontSize: 14, flex: 1 },
  glyph: { color: c.ink3 },
  dayHours: { color: c.ink3, fontSize: 13, fontVariant: ['tabular-nums'] },
  flag: { color: c.warn, fontSize: 14 },

  detail: {
    marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.line, gap: 4,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: c.ink3, fontSize: 13 },
  detailValue: { color: c.ink, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  note: { color: c.warn, fontSize: 13, lineHeight: 18, marginTop: 4 },
  fixBtn: {
    backgroundColor: c.accent, borderRadius: theme.radius.sm,
    paddingVertical: 10, alignItems: 'center', marginTop: 8,
  },
  fixText: { color: c.accentInk, fontWeight: '700', fontSize: 14 },

  empty: { color: c.ink3, fontSize: 14, textAlign: 'center', marginTop: 24 },
  errorBox: { alignItems: 'center', gap: 10, marginTop: 40, paddingHorizontal: 20 },
  errorText: { color: c.ink2, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  retry: { color: c.accent, fontWeight: '600', fontSize: 15 },
});
