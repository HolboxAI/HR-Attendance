import React from 'react';
import { View, StyleSheet } from 'react-native';

export function BoxcodeLogo({ size = 32, color = '#FAFAFA' }: { size?: number; color?: string }) {
  const scale = size / 24;
  return (
    <View style={[styles.container, { width: size, height: (size * 20) / 24 }]}>
      {/* Outer stepped bracket shape constructed with crisp geometric blocks */}
      <View style={[styles.topTabs, { width: size }]}>
        <View style={[styles.tab, { backgroundColor: color, width: 5 * scale, height: 3 * scale }]} />
        <View style={{ width: 6 * scale }} />
        <View style={[styles.tab, { backgroundColor: color, width: 5 * scale, height: 3 * scale }]} />
      </View>

      <View
        style={[
          styles.middleRing,
          {
            borderColor: color,
            borderWidth: 3.5 * scale,
            height: 14 * scale,
            borderRadius: 2 * scale,
          },
        ]}
      >
        {/* Central solid floating core */}
        <View
          style={[
            styles.core,
            {
              backgroundColor: color,
              width: 6 * scale,
              height: 4 * scale,
              borderRadius: 1 * scale,
            },
          ]}
        />
      </View>

      <View style={[styles.bottomTabs, { width: size }]}>
        <View style={[styles.tab, { backgroundColor: color, width: 5 * scale, height: 3 * scale }]} />
        <View style={{ width: 6 * scale }} />
        <View style={[styles.tab, { backgroundColor: color, width: 5 * scale, height: 3 * scale }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  topTabs: {
    position: 'absolute',
    top: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    zIndex: 2,
  },
  bottomTabs: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    zIndex: 2,
  },
  tab: {
    borderRadius: 0.5,
  },
  middleRing: {
    width: '90%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  core: {},
});

export default BoxcodeLogo;
