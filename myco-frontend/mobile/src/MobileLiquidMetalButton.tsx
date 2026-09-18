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
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

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
 * Metal on the RIM only: a 2px chrome ring around a dark capsule, matching
 * the web LiquidMetalButton. The gradient rect is the full pill; the inner
 * face covers everything except that edge.
 */
export function MobileLiquidMetalButton({
  label = 'Sign in  →',
  onPress,
  busy = false,
  disabled = false,
  style,
  children,
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
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const handlePressIn = () => {
    if (disabled || busy) return;
    Animated.spring(pressAnim, { toValue: 0.97, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(pressAnim, { toValue: 1, friction: 4, tension: 40, useNativeDriver: true }).start();
  };

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 220],
  });

  return (
    <Animated.View
      style={[s.container, { transform: [{ scale: pressAnim }] }, disabled && s.disabled, style]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || busy}
        accessibilityRole="button"
        style={s.pressable}
      >
        <View style={s.rim} pointerEvents="none">
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="metalRimFull" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
                <Stop offset="25%" stopColor="#94a3b8" stopOpacity={0.9} />
                <Stop offset="50%" stopColor="#38bdf8" stopOpacity={0.75} />
                <Stop offset="75%" stopColor="#cbd5e1" stopOpacity={0.9} />
                <Stop offset="100%" stopColor="#ffffff" stopOpacity={0.95} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" rx={24} fill="url(#metalRimFull)" />
          </Svg>
          <Animated.View
            style={[s.rimShimmer, { transform: [{ translateX }, { skewX: '-20deg' }] }]}
          />
        </View>

        <View style={s.innerFace} pointerEvents="none" />

        <View style={s.content}>
          {busy ? (
            <ActivityIndicator color="#a1a1aa" size="small" />
          ) : children ? (
            children
          ) : (
            <Text style={s.labelText}>{label}</Text>
          )}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  pressable: {
    flex: 1,
    borderRadius: 100,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rim: {
    ...StyleSheet.absoluteFill,
    borderRadius: 100,
    overflow: 'hidden',
  },
  rimShimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 48,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  innerFace: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 100,
    backgroundColor: '#0a0a0a',
  },
  content: {
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  labelText: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0.2,
    color: '#a1a1aa',
  },
  disabled: { opacity: 0.6 },
});

export default MobileLiquidMetalButton;
