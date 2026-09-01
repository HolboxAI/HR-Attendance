import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from './ThemeContext';
import type { ThemeColors } from './theme';

export type TabItem = {
  key: string;
  label: string;
  badge?: number;
};

/**
 * The "tubelight" tab bar - a native translation of the web component of the
 * same name. The original is Next.js + framer-motion + DOM blur filters,
 * none of which exist in React Native, so the effect is rebuilt with the
 * built-in Animated API: a pill highlight SPRINGS to the active tab instead
 * of teleporting, and a lamp bar glows above it (stacked translucent views
 * stand in for CSS blur - RN has no filter primitive and expo-blur is not
 * a dependency this app wants for one ornament).
 *
 * Still no navigation library: this renders whatever items it is given and
 * reports presses. App.tsx keeps owning which screen shows.
 */
export function TubelightTabBar({
  items, activeKey, onPress, bottomInset,
}: {
  items: TabItem[];
  activeKey: string;
  onPress: (key: string) => void;
  bottomInset: number;
}) {
  const { c } = useTheme();
  const s = useMemo(() => makeStyles(c), [c]);

  const [barWidth, setBarWidth] = useState(0);
  const tabWidth = barWidth / items.length;
  const activeIndex = Math.max(0, items.findIndex((i) => i.key === activeKey));

  const slide = useRef(new Animated.Value(0)).current;
  const measured = useRef(false);

  useEffect(() => {
    if (!tabWidth) return;
    if (!measured.current) {
      // First layout: park the lamp on the active tab without a journey
      // from x=0 - the slide is for tab CHANGES, not for mounting.
      slide.setValue(activeIndex * tabWidth);
      measured.current = true;
      return;
    }
    Animated.spring(slide, {
      toValue: activeIndex * tabWidth,
      stiffness: 300,
      damping: 30,
      mass: 1,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, tabWidth, slide]);

  return (
    <View style={[s.wrap, { paddingBottom: Math.max(bottomInset, 10) }]}>
      <View
        style={s.pill}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      >
        {/* The travelling lamp: highlight pill + glow bar, one element that
            slides as a unit. Rendered first so every label sits above it. */}
        {tabWidth > 0 && (
          <Animated.View
            style={[s.lamp, { width: tabWidth, transform: [{ translateX: slide }], pointerEvents: 'none' }]}
          >
            <View style={s.lampFill} />
            <View style={s.lampBarWrap}>
              {/* Widest and faintest first - three stacked translucent pools
                  read as a blur-less glow. */}
              <View style={[s.glow, s.glowLg]} />
              <View style={[s.glow, s.glowMd]} />
              <View style={[s.glow, s.glowSm]} />
              <View style={s.lampBar} />
            </View>
          </Animated.View>
        )}

        {items.map((item) => {
          const active = item.key === activeKey;
          const badge = item.badge ?? 0;
          return (
            <Pressable
              key={item.key}
              style={s.tab}
              onPress={() => onPress(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={badge > 0 ? `${item.label}, ${badge} unread` : item.label}
            >
              <View>
                <Text style={[s.tabText, active && s.tabTextOn]} numberOfLines={1}>
                  {item.label}
                </Text>
                {badge > 0 && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{badge > 9 ? '9+' : badge}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap: {
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  pill: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.surface,
    overflow: 'visible',
    // Lift the pill off the page - the floating look is the point.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabText: { color: c.ink3, fontSize: 12.5, fontWeight: '600' },
  tabTextOn: { color: c.ink, fontWeight: '700' },

  lamp: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  lampFill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 5,
    right: 5,
    borderRadius: 999,
    backgroundColor: c.surface2,
  },
  lampBarWrap: {
    position: 'absolute',
    top: -1,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  lampBar: {
    width: 30,
    height: 3,
    borderRadius: 999,
    backgroundColor: c.accent,
  },
  glow: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: c.accent,
  },
  glowLg: { width: 48, height: 14, top: -6, opacity: 0.10 },
  glowMd: { width: 34, height: 11, top: -4, opacity: 0.14 },
  glowSm: { width: 20, height: 8, top: -3, opacity: 0.18 },

  badge: {
    position: 'absolute',
    top: -6,
    right: -16,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: c.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: c.accentInk, fontSize: 10, fontWeight: '800' },
});
