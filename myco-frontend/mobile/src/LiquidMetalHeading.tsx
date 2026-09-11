import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

/**
 * Auth heading with the liquid-metal treatment. On Expo web this is the same
 * WebGL shader as the dashboard login title; on native it is a metallic
 * gradient-look type so iOS/Android still match without a DOM canvas.
 */
export function LiquidMetalHeading({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  const hostRef = useRef<View>(null);
  const shaderRef = useRef<View>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (Platform.OS !== 'web' || box.w < 2) return;
    const node = shaderRef.current as unknown as HTMLDivElement | null;
    if (!node) return;
    let mount: { destroy?: () => void } | null = null;
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
          0.45,
        );
      } catch {
        /* native / shader missing — heading still renders */
      }
    })();
    return () => {
      cancelled = true;
      mount?.destroy?.();
    };
  }, [box.w, box.h]);

  return (
    <View
      ref={hostRef}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setBox({ w: Math.round(width), h: Math.round(height) });
      }}
      style={s.host}
    >
      {Platform.OS === 'web' && (
        <View ref={shaderRef} pointerEvents="none" style={s.shader} />
      )}
      <Text
        style={[
          s.title,
          Platform.OS === 'web' ? s.titleWeb : s.titleNative,
          style,
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  host: { position: 'relative', alignSelf: 'stretch' },
  shader: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 4,
    overflow: 'hidden',
    opacity: 0.85,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  titleWeb: {
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  titleNative: {
    color: '#e8eef6',
    textShadowColor: 'rgba(148,163,184,0.65)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
});

export default LiquidMetalHeading;
