import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, View, ActionSheetIOS, Platform, Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { getNotifications, markNotificationRead, replyToNotification, uploadLeaveDocument } from './api';
import { useTheme } from './ThemeContext';
import { theme, type ThemeColors } from './theme';
import type { NotificationItem } from './types';

function timeAgo(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * In-product notification records - decisions on your leave and corrections,
 * and messages from your manager or HR. These rows exist regardless of push:
 * the backend writes them unconditionally, and the banner is the courtesy on
 * top. Messages (and only messages) can be answered from here - the reply
 * goes back to whoever wrote, named by the message itself, so an employee
 * never gains the ability to message an arbitrary person.
 */
export default function InboxScreen({ onUnreadChange }: { onUnreadChange: (n: number) => void }) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [repliedTo, setRepliedTo] = useState<string | null>(null);
  
  const [uploadOpen, setUploadOpen] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<{ uri: string; type: string; name: string; webFile?: any } | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedTo, setUploadedTo] = useState<string | null>(null);

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

  function setRead(id: string) {
    setItems((cur) => {
      const next = cur?.map((x) => (x.id === id ? { ...x, read: true } : x)) ?? null;
      if (next) onUnreadChange(next.filter((x) => !x.read).length);
      return next;
    });
  }

  async function markRead(n: NotificationItem) {
    if (n.read) return;
    setRead(n.id);
    await markNotificationRead(n.id);
  }

  async function sendReply(n: NotificationItem) {
    const text = replyText.trim();
    if (!text || replyBusy) return;
    setReplyBusy(true);
    setReplyError(null);
    const refusal = await replyToNotification(n.id, text);
    setReplyBusy(false);
    if (refusal) {
      setReplyError(refusal);
      return;
    }
    // Replying marks the original read server-side; mirror that here.
    setRead(n.id);
    setReplyOpen(null);
    setReplyText('');
    setRepliedTo(n.id);
  }

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
          setUploadError('File too large. Maximum 5MB.');
          return;
        }
        const uri = asset.uri;
        const ext = uri.split('.').pop() || 'jpg';
        setUploadFile({ uri, type: asset.file?.type || `image/${ext}`, name: asset.file?.name || `doc.${ext}`, webFile: asset.file });
        setUploadError(null);
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

  async function sendUpload(n: NotificationItem) {
    if (!uploadFile || uploadBusy) return;
    const reqId = n.data?.leave_request_id as string | undefined;
    if (!reqId) {
      setUploadError('Invalid request ID');
      return;
    }
    
    setUploadBusy(true);
    setUploadError(null);
    
    const refusal = await uploadLeaveDocument(reqId, { 
      fileUri: uploadFile.uri, 
      fileType: uploadFile.type, 
      fileName: uploadFile.name,
      webFile: uploadFile.webFile
    });
    
    setUploadBusy(false);
    if (refusal) {
      setUploadError(refusal);
      return;
    }
    
    setRead(n.id);
    setUploadOpen(null);
    setUploadFile(null);
    setUploadedTo(n.id);
  }

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
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
          {items.map((n) => {
            const isMessage = n.category === 'message';
            const open = replyOpen === n.id;
            return (
              <View
                key={n.id}
                style={[s.item, n.read && !open && s.itemRead]}
                accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`}
              >
                <View style={s.itemRow}>
                  {!n.read && <View style={s.dot} />}
                  <Text style={s.itemTitle} numberOfLines={1}>{n.title}</Text>
                  <Text style={s.itemTime}>{timeAgo(n.createdAt)}</Text>
                </View>
                <Text style={s.itemBody}>{n.body}</Text>

                {repliedTo === n.id && (
                  <Text style={s.sentNote} accessibilityLiveRegion="polite">
                    ● Reply sent
                  </Text>
                )}

                {uploadedTo === n.id && (
                  <Text style={s.sentNote} accessibilityLiveRegion="polite">
                    ● Document uploaded
                  </Text>
                )}

                {(!n.read || isMessage || n.category === 'leave.partially_approved') && (
                  <View style={s.actions}>
                    {!n.read && (
                      <Pressable
                        style={s.actionBtn} onPress={() => markRead(n)}
                        accessibilityRole="button"
                      >
                        <Text style={s.actionText}>Mark as read</Text>
                      </Pressable>
                    )}
                    {isMessage && (
                      <Pressable
                        style={s.actionBtn}
                        onPress={() => {
                          setReplyOpen(open ? null : n.id);
                          setUploadOpen(null);
                          setReplyText('');
                          setReplyError(null);
                          setRepliedTo(null);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={s.actionText}>{open ? 'Close' : 'Reply'}</Text>
                      </Pressable>
                    )}
                    {n.category === 'leave.partially_approved' && uploadedTo !== n.id && (
                      <Pressable
                        style={s.actionBtn}
                        onPress={() => {
                          const isOpen = uploadOpen === n.id;
                          setUploadOpen(isOpen ? null : n.id);
                          setReplyOpen(null);
                          setUploadFile(null);
                          setUploadError(null);
                        }}
                        accessibilityRole="button"
                      >
                        <Text style={s.actionText}>{uploadOpen === n.id ? 'Close' : 'Upload Document'}</Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {uploadOpen === n.id && (
                  <View style={s.replyBox}>
                    <Text style={{ fontSize: 13, color: c.ink2, marginBottom: 8 }}>
                      Please upload the medical document required for your leave request.
                    </Text>
                    
                    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                      <Pressable
                        style={[s.actionBtn, uploadFile && { borderColor: c.accent }]}
                        onPress={pickImage}
                        accessibilityRole="button"
                      >
                        <Text style={[s.actionText, uploadFile && { color: c.accent }]}>
                          {uploadFile ? 'Change Attachment' : '📎 Attach Document'}
                        </Text>
                      </Pressable>
                      {uploadFile && <Text style={{ fontSize: 12, color: c.ink3 }}>Ready</Text>}
                    </View>

                    {uploadError && (
                      <Text style={s.replyError} accessibilityLiveRegion="polite">
                        ○ {uploadError}
                      </Text>
                    )}
                    
                    <Pressable
                      style={[s.sendBtn, (uploadBusy || !uploadFile) && s.sendBtnOff]}
                      onPress={() => sendUpload(n)}
                      disabled={uploadBusy || !uploadFile}
                      accessibilityRole="button"
                    >
                      {uploadBusy
                        ? <ActivityIndicator color={c.accentInk} />
                        : <Text style={s.sendText}>Upload</Text>}
                    </Pressable>
                  </View>
                )}

                {open && (
                  <View style={s.replyBox}>
                    <TextInput
                      style={s.replyInput}
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Write your reply…"
                      placeholderTextColor={c.ink3}
                      multiline
                      editable={!replyBusy}
                      accessibilityLabel="Reply message"
                    />
                    {replyError && (
                      <Text style={s.replyError} accessibilityLiveRegion="polite">
                        ○ {replyError}
                      </Text>
                    )}
                    <Pressable
                      style={[s.sendBtn, (replyBusy || !replyText.trim()) && s.sendBtnOff]}
                      onPress={() => sendReply(n)}
                      disabled={replyBusy || !replyText.trim()}
                      accessibilityRole="button"
                    >
                      {replyBusy
                        ? <ActivityIndicator color={c.accentInk} />
                        : <Text style={s.sendText}>Send reply</Text>}
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.ground },
  content: { padding: 20, paddingTop: 24, gap: 14, paddingBottom: 40 },
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

  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  actionBtn: {
    borderColor: c.line, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  actionText: { color: c.accent, fontSize: 13, fontWeight: '600' },

  replyBox: { marginTop: 10, gap: 8 },
  replyInput: {
    backgroundColor: c.surface2, borderColor: c.line, borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    color: c.ink, fontSize: 14, minHeight: 60, textAlignVertical: 'top',
  },
  replyError: { color: c.crit, fontSize: 13, lineHeight: 18 },
  sendBtn: {
    backgroundColor: c.accent, borderRadius: 8, paddingVertical: 11,
    alignItems: 'center',
  },
  sendBtnOff: { opacity: 0.5 },
  sendText: { color: c.accentInk, fontWeight: '700', fontSize: 14 },
  sentNote: { color: c.ok, fontSize: 13, marginTop: 4 },

  empty: { color: c.ink3, fontSize: 14, lineHeight: 20, marginTop: 8 },
  errorBox: { gap: 8, marginTop: 8 },
  errorText: { color: c.ink2, fontSize: 14, lineHeight: 20 },
  retry: { color: c.accent, fontWeight: '600', fontSize: 14 },
});
