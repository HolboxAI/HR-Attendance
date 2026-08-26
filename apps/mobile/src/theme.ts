/** Shared visual language with the admin web app. Amber on cool graphite. */
export const theme = {
  color: {
    ground: '#0E1316',
    surface: '#151C20',
    surface2: '#1C252A',
    line: '#2A353B',
    ink: '#E8EEF1',
    ink2: '#AFBEC6',
    ink3: '#7E8F98',
    accent: '#E8A344',
    accentInk: '#1A1206',
    ok: '#5FBF93',
    warn: '#E0A94E',
    crit: '#E07A63',
  },
  space: (n: number) => n * 4,
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
} as const;
