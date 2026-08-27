import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { getNotifications, markNotificationRead } from './api';
import { theme } from './theme';
import type { NotificationItem } from './types';

const c = theme.color;

function timeAgo(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * In-product notification records - decisions on your leave and corrections.
 * These rows exist regardless of push: the backend writes them
 * unconditionally, and nothing here pretends the phone was rung, because
 * with PUSH_PROVIDER=null it deliberately was not.
 */
export default function InboxScreen({ onUnreadChange }: { onUnreadChange: (n: number) => void }) {
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await getNotifications();
      setItems(rows);
      onUnreadChange(rows.filter((n) => !n.read).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load notifications');
    }
  }, [onUnreadChange]);

  useEffect(() => { void load(); }, [load]);

  async function markRead(n: NotificationItem) {
    if (n.read) return;
    setItems((cur) => {
      const next = cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null;
      if (next) onUnreadChange(next.filter((x) => !x.read).length);
      return next;
    });
    await markNotificationRead(n.id);
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
      <Text style={s.title}>Inbox</Text>

      {error ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
          <Pressable onPress={load} accessibilityRole="button">
            <Text style={s.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : items === null ? (
        <ActivityIndicator color={c.accent} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <Text style={s.empty}>
          Nothing yet. Decisions on your leave and correction requests land here
          the moment they happen.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {items.map((n) => (
            <Pressable
              key={n.id}
              onPress={() => markRead(n)}
              style={[s.item, n.read && s.itemRead]}
              accessibilityRole="button"
              accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}
            >
              <View style={s.itemRow}>
                {!n.read && <View style={s.dot} />}
                <Text style={s.itemTitle} numberOfLines={1}>{n.title}</Text>
                <Text style={s.itemTime}>{timeAgo(n.createdAt)}</Text>
              </View>
              <Text style={s.itemBody}>{n.body}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 20, paddingTop: 24, gap: 14 },
  title: { color: c.ink, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },

  item: {
    backgroundColor: c.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: c.line, padding: 14, gap: 4,
  },
  itemRead: { opacity: 0.55 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: c.accent },
  itemTitle: { color: c.ink, fontSize: 15, fontWeight: '600', flex: 1 },
  itemTime: { color: c.ink3, fontSize: 12 },
  itemBody: { color: c.ink2, fontSize: 14, lineHeight: 19 },

  empty: { color: c.ink3, fontSize: 14, lineHeight: 20, marginTop: 8 },
  errorBox: { gap: 8, marginTop: 8 },
  errorText: { color: c.ink2, fontSize: 14, lineHeight: 20 },
  retry: { color: c.accent, fontWeight: '600', fontSize: 14 },
});
