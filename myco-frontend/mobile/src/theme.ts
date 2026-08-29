/**
 * Shared visual language with the admin web app - now in two palettes.
 *
 * Screens must not import a palette directly: they read colours from
 * useTheme() (ThemeContext.tsx) so the appearance option in Profile actually
 * changes them. The static `theme` export stays for the two things that do
 * not re-theme - spacing/radius tokens, and the login screen, which is a
 * brand surface and deliberately always dark.
 */
export type ThemeColors = {
  ground: string;
  surface: string;
  surface2: string;
  line: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  accentInk: string;
  ok: string;
  warn: string;
  crit: string;
  /** Tinted card grounds for result banners and highlighted chips. */
  okBg: string;
  warnBg: string;
  badBg: string;
  hiBg: string;
};

export const darkColors: ThemeColors = {
  ground: '#09090B',
  surface: '#121216',
  surface2: '#1C1C22',
  line: 'rgba(255, 255, 255, 0.08)',
  ink: '#FAFAFA',
  ink2: '#D4D4D8',
  ink3: '#A1A1AA',
  accent: '#FFFFFF',
  accentInk: '#09090B',
  ok: '#E4E4E7',
  warn: '#A1A1AA',
  crit: '#71717A',
  okBg: '#12291F',
  warnBg: '#2A2213',
  badBg: '#2A1512',
  hiBg: '#33270F',
};

export const lightColors: ThemeColors = {
  ground: '#F4F4F5',
  surface: '#FFFFFF',
  surface2: '#ECECEE',
  line: 'rgba(0, 0, 0, 0.10)',
  ink: '#111113',
  ink2: '#3F3F46',
  ink3: '#71717A',
  accent: '#111113',
  accentInk: '#FFFFFF',
  ok: '#15803D',
  warn: '#A16207',
  crit: '#B91C1C',
  okBg: '#E3F4E9',
  warnBg: '#FAF1DC',
  badBg: '#FBE7E7',
  hiBg: '#FDF3D8',
};

export const theme = {
  color: darkColors,
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
} as const;
