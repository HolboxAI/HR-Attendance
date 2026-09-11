import React, { useState, useRef } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View, Image
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';

import { submitEnrolmentPhoto } from './api';
import { BoxcodeLogo } from './BoxcodeLogo';
import { useTheme } from './ThemeContext';

interface OnboardingGuideModalProps {
  visible: boolean;
  employeeName: string | null;
  employeeCode: string | null;
  onCompleted: () => void;
}

export function OnboardingGuideModal({
  visible,
  employeeName,
  employeeCode,
  onCompleted,
}: OnboardingGuideModalProps) {
  const { c } = useTheme();

  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [cameraActive, setCameraActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [camPerm, requestCam] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  if (!visible) return null;

  async function openCamera() {
    setError(null);
    if (!camPerm?.granted) {
      const r = await requestCam();
      if (!r.granted) {
        setError('Camera permission is required to take your reference photo.');
        return;
      }
    }
    setCameraActive(true);
  }

  async function snapPhoto() {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const shot = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: true,
      });
      if (!shot?.uri) throw new Error('Could not capture a photo');
      const res = await submitEnrolmentPhoto(shot.uri);
      setCameraActive(false);
      if (res.enrolled) {
        setStage(3);
      } else {
        setError('Photo was submitted but not enrolled yet. Please try a clearer photo.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photo');
    } finally {
      setBusy(false);
    }
  }

  async function pickImage() {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setBusy(true);
        const res = await submitEnrolmentPhoto(result.assets[0].uri);
        if (res.enrolled) {
          setStage(3);
        } else {
          setError('Photo could not be enrolled. Please try another image.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photo');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* Blurred / heavily dimmed background blocking all underneath interaction */}
      <View style={s.overlay}>
        <View style={s.card}>
          {/* Top Quest Header */}
          <View style={s.questHeader}>
            <View style={s.questBadge}>
              <View style={s.pingDot} />
              <Text style={s.questBadgeText}>NEW EMPLOYEE QUEST • MISSION 1</Text>
            </View>
            <Text style={s.stepCounter}>Step {stage} of 2</Text>
          </View>

          {/* STAGE 1: Briefing */}
          {stage === 1 && (
            <View style={s.contentBlock}>
              <View style={s.logoWrap}>
                <BoxcodeLogo size={48} />
              </View>

              <Text style={s.title}>
                Welcome to Holbox, {employeeName || 'Team Member'}!
              </Text>
              <Text style={s.subtitle}>
                To enable instant biometric check-in for your shifts, you need to register your reference face photo.
              </Text>

              {/* Perk highlight */}
              <View style={s.perkCard}>
                <Text style={s.perkIcon}>⚡</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.perkTitle}>Instant Auto-Activation</Text>
                  <Text style={s.perkBody}>
                    Your initial face photo is verified and activated immediately—no admin approval waiting required!
                  </Text>
                </View>
              </View>

              <View style={s.tipsCard}>
                <Text style={s.tipsTitle}>💡 Tips for a valid reference photo:</Text>
                <Text style={s.tipsBody}>• Look straight into the camera in a well-lit space.</Text>
                <Text style={s.tipsBody}>• Keep a neutral expression without sunglasses or hats.</Text>
              </View>

              <Pressable
                style={s.actionBtnPrimary}
                onPress={() => setStage(2)}
                accessibilityRole="button"
              >
                <Text style={s.actionBtnPrimaryText}>Start Mission: Register Face  →</Text>
              </Pressable>
            </View>
          )}

          {/* STAGE 2: Camera Viewfinder or Choice */}
          {stage === 2 && (
            <View style={s.contentBlock}>
              <Text style={s.title}>Take Reference Photo</Text>
              <Text style={s.subtitle}>
                Take a selfie now or choose a clear portrait photo from your files.
              </Text>

              {cameraActive ? (
                <View style={s.cameraBox}>
                  <CameraView
                    ref={cameraRef}
                    facing="front"
                    style={StyleSheet.absoluteFill}
                  />
                  {/* Face oval guide */}
                  <View style={s.ovalGuide} pointerEvents="none" />

                  <View style={s.cameraControls}>
                    <Pressable
                      style={s.cameraCancelBtn}
                      onPress={() => setCameraActive(false)}
                      disabled={busy}
                    >
                      <Text style={s.cameraCancelText}>Cancel</Text>
                    </Pressable>

                    <Pressable
                      style={s.snapBtn}
                      onPress={snapPhoto}
                      disabled={busy}
                    >
                      {busy ? (
                        <ActivityIndicator color="#000000" />
                      ) : (
                        <Text style={s.snapBtnText}>Snap & Submit</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={s.optionsWrap}>
                  <Pressable
                    style={s.optionBtn}
                    onPress={openCamera}
                    disabled={busy}
                  >
                    <Text style={s.optionIcon}>📸</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.optionTitle}>Take Live Photo (Camera)</Text>
                      <Text style={s.optionSub}>Open camera to take reference selfie</Text>
                    </View>
                  </Pressable>

                  <Pressable
                    style={s.optionBtn}
                    onPress={pickImage}
                    disabled={busy}
                  >
                    <Text style={s.optionIcon}>📁</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.optionTitle}>Upload Photo (Files / Gallery)</Text>
                      <Text style={s.optionSub}>Choose a clear JPEG or PNG portrait</Text>
                    </View>
                  </Pressable>
                </View>
              )}

              {error && (
                <View style={s.errorBox}>
                  <Text style={s.errorText}>○ {error}</Text>
                </View>
              )}

              {busy && !cameraActive && (
                <View style={s.busyRow}>
                  <ActivityIndicator color="#10B981" />
                  <Text style={s.busyText}>Verifying biometric quality…</Text>
                </View>
              )}
            </View>
          )}

          {/* STAGE 3: Mission Accomplished */}
          {stage === 3 && (
            <View style={s.contentBlock}>
              <View style={s.trophyWrap}>
                <Text style={s.trophyIcon}>🏆</Text>
              </View>

              <Text style={[s.title, { textAlign: 'center' }]}>Mission Accomplished!</Text>
              <Text style={[s.subtitle, { textAlign: 'center' }]}>
                Your facial biometrics have been verified and activated. You can now punch in for your shifts!
              </Text>

              <View style={s.successCard}>
                <Text style={s.successCardTitle}>✓ Biometric Profile Live</Text>
                <Text style={s.successCardBody}>
                  Enrolled under employee code {employeeCode || 'active'}. You do not need to wait for HR approval!
                </Text>
              </View>

              <Pressable
                style={[s.actionBtnPrimary, { marginTop: 20 }]}
                onPress={onCompleted}
                accessibilityRole="button"
              >
                <Text style={s.actionBtnPrimaryText}>Enter Attendance Dashboard  →</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {} as any),
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderRadius: 26,
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 24,
  },
  questHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
    borderBottomWidth: 1,
    paddingBottom: 12,
    marginBottom: 16,
  },
  questBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34D399',
  },
  questBadgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  stepCounter: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  contentBlock: {
    width: '100%',
  },
  logoWrap: {
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 16,
  },
  perkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  perkIcon: {
    fontSize: 22,
  },
  perkTitle: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  perkBody: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  tipsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 18,
    gap: 4,
  },
  tipsTitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11.5,
    fontWeight: '700',
  },
  tipsBody: {
    color: 'rgba(255, 255, 255, 0.55)',
    fontSize: 11,
  },
  actionBtnPrimary: {
    backgroundColor: '#3B82F6',
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  optionsWrap: {
    gap: 12,
    marginVertical: 10,
  },
  optionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  optionIcon: {
    fontSize: 24,
  },
  optionTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  optionSub: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 11,
    marginTop: 2,
  },
  cameraBox: {
    width: '100%',
    height: 280,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 12,
    backgroundColor: '#000',
  },
  ovalGuide: {
    position: 'absolute',
    top: '15%',
    left: '20%',
    width: '60%',
    height: '65%',
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'rgba(52, 211, 153, 0.7)',
    borderStyle: 'dashed',
  },
  cameraControls: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    right: 14,
    flexDirection: 'row',
    gap: 10,
  },
  cameraCancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cameraCancelText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  snapBtn: {
    flex: 2,
    backgroundColor: '#10B981',
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  snapBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  errorBox: {
    marginTop: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 12,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  busyText: {
    color: '#34D399',
    fontSize: 12,
  },
  trophyWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginVertical: 12,
  },
  trophyIcon: {
    fontSize: 32,
  },
  successCard: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginVertical: 10,
    gap: 4,
  },
  successCardTitle: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '800',
  },
  successCardBody: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 11.5,
    lineHeight: 16,
  },
});

export default OnboardingGuideModal;

