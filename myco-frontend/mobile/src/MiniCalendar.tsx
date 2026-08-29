/**
 * A small month grid for picking a date INTO a text field, not instead of
 * one. It renders inline, attached under the field it serves - never a modal
 * floating over the middle of the screen - and tapping a day just writes
 * YYYY-MM-DD into the same state the keyboard writes into. Typing stays a
 * first-class path; this exists for the people who find the format fiddly.
 *
 * No dependency on purpose: a date-picker library drags in native modules
 * and its own look; this is ~100 lines in the app's own visual language.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from './ThemeContext';
import { monthTitle } from './format';
import type { ThemeColors } from './theme';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export default function MiniCalendar({
  value, onPick,
}: {
  /** The field's current text - used to open on the month being talked about. */
  value: string;
  onPick: (date: string) => void;
}) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const now = new Date();
  const seed = /^\d{4}-\d{2}/.test(value)
    ? { y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) }
    : { y: now.getFullYear(), m: now.getMonth() + 1 };
  const [year, setYear] = useState(seed.y);
  const [month, setMonth] = useState(seed.m);

  function shift(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y); setMonth(m);
  }

  const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const daysInMonth = new Date(year, month, 0).getDate();
  // getDay() is Sun=0; the grid starts Monday like the org's week.
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View style={s.box}>
      <View style={s.nav}>
        <Pressable onPress={() => shift(-1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month">
          <Text style={s.arrow}>‹</Text>
        </Pressable>
        <Text style={s.title}>{monthTitle(year, month)}</Text>
        <Pressable onPress={() => shift(1)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month">
          <Text style={s.arrow}>›</Text>
        </Pressable>
      </View>

      <View style={s.week}>
        {WEEKDAYS.map((w, i) => (
          <Text key={`${w}-${i}`} style={s.weekday}>{w}</Text>
        ))}
      </View>

      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={s.week}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (d === null) return <View key={i} style={s.cell} />;
            const dateStr = iso(year, month, d);
            const picked = dateStr === value;
            const isToday = dateStr === today;
            return (
              <Pressable
                key={i}
                style={[s.cell, picked && s.cellOn, !picked && isToday && s.cellToday]}
                onPress={() => onPick(dateStr)}
                accessibilityRole="button"
                accessibilityLabel={dateStr}
                accessibilityState={{ selected: picked }}
              >
                <Text style={[s.cellText, picked && s.cellTextOn]}>{d}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  box: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 10, padding: 10, marginTop: 8, gap: 2,
  },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 4,
  },
  arrow: { color: c.accent, fontSize: 22, fontWeight: '600', paddingHorizontal: 10 },
  title: { color: c.ink, fontSize: 14, fontWeight: '700' },
  week: { flexDirection: 'row' },
  weekday: {
    flex: 1, textAlign: 'center', color: c.ink3, fontSize: 11,
    fontWeight: '700', paddingVertical: 4,
  },
  cell: {
    flex: 1, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },
  cellOn: { backgroundColor: c.accent },
  cellToday: { borderWidth: 1, borderColor: c.ink3 },
  cellText: { color: c.ink2, fontSize: 13, fontVariant: ['tabular-nums'] },
  cellTextOn: { color: c.accentInk, fontWeight: '800' },
});
