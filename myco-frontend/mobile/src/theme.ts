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
  surface: 'rgba(18, 18, 22, 0.75)',
  surface2: 'rgba(28, 28, 34, 0.65)',
  line: 'rgba(255, 255, 255, 0.10)',
  ink: '#FAFAFA',
  ink2: '#D4D4D8',
  ink3: '#A1A1AA',
  accent: '#FFFFFF',
  accentInk: '#09090B',
  ok: '#10B981',
  warn: '#F59E0B',
  crit: '#F43F5E',
  okBg: 'rgba(16, 185, 129, 0.12)',
  warnBg: 'rgba(245, 158, 11, 0.12)',
  badBg: 'rgba(244, 63, 94, 0.12)',
  hiBg: 'rgba(245, 158, 11, 0.16)',
};

export const lightColors: ThemeColors = {
  ground: '#F8FAFC',
  surface: 'rgba(255, 255, 255, 0.90)',
  surface2: 'rgba(241, 245, 249, 0.85)',
  line: 'rgba(15, 23, 42, 0.08)',
  ink: '#0F172A',
  ink2: '#334155',
  ink3: '#64748B',
  accent: '#0F172A',
  accentInk: '#FFFFFF',
  ok: '#16A34A',
  warn: '#D97706',
  crit: '#DC2626',
  okBg: '#E2F9EC',
  warnBg: '#FEF3C7',
  badBg: '#FEE2E2',
  hiBg: '#FEF3C7',
};

export const theme = {
  color: darkColors,
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
} as const;
