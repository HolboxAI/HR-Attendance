import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  GestureResponderEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

export interface MobileLiquidMetalButtonProps {
  label?: string;
  onPress?: (event: GestureResponderEvent) => void;
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  variant?: 'silver' | 'liquid' | 'dark';
}

/**
 * MobileLiquidMetalButton
 * Native liquid metal button for iOS/Android/Web matching the Liquid Metal shader design:
 * - Fluid metallic gradient sweeping reflections
 * - 3D inner capsule with specular highlights
 * - Interactive spring press response & ripple feedback
 */
export function MobileLiquidMetalButton({
  label = 'Sign in  →',
  onPress,
  busy = false,
  disabled = false,
  style,
  children,
  variant = 'liquid',
}: MobileLiquidMetalButtonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const pressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 2800,
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const handlePressIn = () => {
    if (disabled || busy) return;
    Animated.spring(pressAnim, {
      toValue: 0.97,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(pressAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-160, 260],
  });

  const isSilver = variant === 'silver';
  const isDark = variant === 'dark';

  return (
    <Animated.View
      style={[
        s.container,
        { transform: [{ scale: pressAnim }] },
        disabled && s.disabled,
        style,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || busy}
        accessibilityRole="button"
        style={s.pressable}
      >
        {/* Layer 1: Liquid metal metallic base gradient rim */}
        <View style={s.shaderBorder} pointerEvents="none">
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="liquidMetalRim" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
                <Stop offset="25%" stopColor="#94a3b8" stopOpacity={0.8} />
                <Stop offset="50%" stopColor="#38bdf8" stopOpacity={0.9} />
                <Stop offset="75%" stopColor="#cbd5e1" stopOpacity={0.85} />
                <Stop offset="100%" stopColor="#ffffff" stopOpacity={0.95} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" rx={28} fill="url(#liquidMetalRim)" />
          </Svg>
        </View>

        {/* Layer 2: Inner capsule surface */}
        <View
          style={[
            s.innerCapsule,
            isSilver ? s.capsuleSilver : isDark ? s.capsuleDark : s.capsuleLiquid,
          ]}
        >
          {/* Shimmering specular liquid sweep reflection */}
          <Animated.View
            style={[
              s.shimmerSweep,
              {
                transform: [{ translateX }, { skewX: '-25deg' }],
              },
            ]}
            pointerEvents="none"
          />

          {/* Top highlight glare */}
          <View style={s.topGlare} pointerEvents="none" />

          {/* Content layer */}
          <View style={s.content}>
            {busy ? (
              <ActivityIndicator color={isSilver ? '#000000' : '#ffffff'} size="small" />
            ) : children ? (
              children
            ) : (
              <Text
                style={[
                  s.labelText,
                  isSilver ? s.labelSilver : isDark ? s.labelDark : s.labelLiquid,
                ]}
              >
                {label}
              </Text>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    width: '100%',
    height: 48,
    borderRadius: 100,
    marginTop: 18,
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  pressable: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: 100,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shaderBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 100,
    overflow: 'hidden',
  },
  innerCapsule: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 98,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  capsuleLiquid: {
    backgroundColor: '#0a0a0c',
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  capsuleSilver: {
    backgroundColor: '#f8fafc',
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  capsuleDark: {
    backgroundColor: '#18181b',
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  topGlare: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: 1,
  },
  shimmerSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 10,
  },
  labelText: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelLiquid: {
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  labelSilver: {
    color: '#000000',
  },
  labelDark: {
    color: '#ffffff',
  },
  disabled: {
    opacity: 0.6,
  },
});

export default MobileLiquidMetalButton;
