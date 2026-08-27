/** Shared visual language with the admin web app. Crisp monochrome obsidian and slate. */
export const theme = {
  color: {
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
  },
  space: (n: number) => n * 4,
  radius: { sm: 8, md: 14, lg: 22, pill: 999 },
} as const;
