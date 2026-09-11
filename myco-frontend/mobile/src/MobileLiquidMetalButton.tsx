import React, { useEffect, useRef, useState } from 'react';
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
 * Full-pill liquid metal — the shader/gradient is the button surface, not a
 * 2px rim with a dark capsule covering the rest.
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
  const shaderRef = useRef<View>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

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

  useEffect(() => {
    if (Platform.OS !== 'web' || box.w < 2) return;
    const node = shaderRef.current as unknown as HTMLDivElement | null;
    if (!node) return;
    let mount: { destroy?: () => void; setSpeed?: (n: number) => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { ShaderMount, liquidMetalFragmentShader } = await import('@paper-design/shaders');
        if (cancelled) return;
        mount = new ShaderMount(
          node,
          liquidMetalFragmentShader,
          {
            u_repetition: 4,
            u_softness: 0.5,
            u_shiftRed: 0.3,
            u_shiftBlue: 0.3,
            u_distortion: 0,
            u_contour: 0,
            u_angle: 45,
            u_scale: 8,
            u_shape: 1,
            u_offsetX: 0.1,
            u_offsetY: -0.1,
          },
          undefined,
          0.6,
        );
      } catch {
        /* keep the SVG metal fallback */
      }
    })();
    return () => {
      cancelled = true;
      mount?.destroy?.();
    };
  }, [box.w, box.h]);

  const handlePressIn = () => {
    if (disabled || busy) return;
    Animated.spring(pressAnim, { toValue: 0.97, useNativeDriver: true }).start();
  };
  const handlePressOut = () => {
    Animated.spring(pressAnim, { toValue: 1, friction: 4, tension: 40, useNativeDriver: true }).start();
  };

  const translateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-160, 280],
  });

  return (
    <Animated.View
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox({ w: Math.round(width), h: Math.round(height) });
      }}
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
        <View style={s.metalFill} pointerEvents="none">
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="liquidMetalFill" x1="0%" y1="0%" x2="100%" y2="100%">
                <Stop offset="0%" stopColor="#ffffff" stopOpacity={0.95} />
                <Stop offset="22%" stopColor="#94a3b8" stopOpacity={0.9} />
                <Stop offset="48%" stopColor="#38bdf8" stopOpacity={0.85} />
                <Stop offset="72%" stopColor="#cbd5e1" stopOpacity={0.9} />
                <Stop offset="100%" stopColor="#ffffff" stopOpacity={0.95} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" rx={24} fill="url(#liquidMetalFill)" />
          </Svg>
        </View>

        {Platform.OS === 'web' && (
          <View ref={shaderRef} pointerEvents="none" style={s.webShader} />
        )}

        <View style={s.glass} pointerEvents="none" />

        <Animated.View
          style={[s.shimmerSweep, { transform: [{ translateX }, { skewX: '-25deg' }] }]}
          pointerEvents="none"
        />

        <View style={s.content}>
          {busy ? (
            <ActivityIndicator color="#ffffff" size="small" />
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
    overflow: 'hidden',
    shadowColor: '#94a3b8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
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
  metalFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 100,
  },
  webShader: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 100,
    overflow: 'hidden',
  },
  glass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 100,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  shimmerSweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 70,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
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
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  disabled: { opacity: 0.6 },
});

export default MobileLiquidMetalButton;
