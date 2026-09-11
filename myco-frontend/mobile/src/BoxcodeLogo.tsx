import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

export interface BoxcodeLogoProps {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
}

/**
 * Official Holbox mark for native mobile app.
 */
export function BoxcodeLogo({ size = 32, style }: BoxcodeLogoProps) {
  return (
    <Image
      source={require('../assets/holbox-logo.png')}
      style={[{ width: size, height: size, resizeMode: 'contain' }, style]}
      accessibilityLabel="Holbox Logo"
    />
  );
}

export const HolboxCube = BoxcodeLogo;
export default BoxcodeLogo;

