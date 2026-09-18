import { Platform, StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

/** Chrome on the letter edges; fill stays solid white. */
export function LiquidMetalHeading({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      style={[
        s.title,
        Platform.OS === 'web'
          ? ({
              // RN-web: metal stroke around every glyph, white fill on top.
              WebkitTextStroke: '1.25px #c9d2de',
              paintOrder: 'stroke fill',
              color: '#ffffff',
            } as TextStyle)
          : s.nativeStroke,
        style,
      ]}
    >
      {text}
    </Text>
  );
}

const s = StyleSheet.create({
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
    color: '#ffffff',
  },
  nativeStroke: {
    textShadowColor: 'rgba(201, 210, 222, 0.85)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1.4,
  },
});

export default LiquidMetalHeading;
