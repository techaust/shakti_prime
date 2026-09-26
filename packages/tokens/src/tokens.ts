// Single source of the design tokens in DESIGN.md §2–§4 and §8.
// `tokens.css` and `tailwind.css` are generated from this file by `pnpm --filter @shakti/tokens build`.
// The Android app and chart code import this object directly.

export type Theme = 'light' | 'dark';

/** Colour tokens with a concrete value per theme (DESIGN.md §2.1, §2.2, §2.3). */
export const colors = {
  bg: { light: '#FAFAFA', dark: '#0B0B0C' },
  surface: { light: '#FFFFFF', dark: '#141416' },
  'surface-2': { light: '#F4F4F5', dark: '#1C1C1F' },
  'surface-3': { light: '#E9E9EB', dark: '#242428' },
  text: { light: '#18181B', dark: '#EDEDEF' },
  'text-muted': { light: '#52525B', dark: '#A1A1AA' },
  'text-subtle': { light: '#71717A', dark: '#7E7E86' },
  border: { light: '#E4E4E7', dark: '#26262B' },
  'border-strong': { light: '#D4D4D8', dark: '#35353B' },
  accent: { light: '#D97706', dark: '#F59E0B' },
  'accent-hover': { light: '#B45309', dark: '#FBBF24' },
  'accent-text': { light: '#B45309', dark: '#FCD34D' },
  'accent-fg': { light: '#1A1200', dark: '#1A1200' },
  'accent-soft': { light: '#FEF3C7', dark: '#3A2A08' },
  focus: { light: '#D97706', dark: '#F59E0B' },
  success: { light: '#15803D', dark: '#4ADE80' },
  'success-soft': { light: '#DCFCE7', dark: '#0F2E1A' },
  warning: { light: '#B45309', dark: '#FBBF24' },
  'warning-soft': { light: '#FEF3C7', dark: '#3A2A08' },
  danger: { light: '#B91C1C', dark: '#F87171' },
  'danger-soft': { light: '#FEE2E2', dark: '#3B1111' },
  info: { light: '#1D4ED8', dark: '#60A5FA' },
  'info-soft': { light: '#DBEAFE', dark: '#0F2140' },
  'stage-contacted': { light: '#7C3AED', dark: '#A78BFA' },
  'stage-quoted': { light: '#0E7490', dark: '#22D3EE' },
} as const;

export type ColorToken = keyof typeof colors;

/**
 * Tokens that point at another token (DESIGN.md §2.3). Emitted as `var(--x)` in CSS and
 * resolved to the concrete value in `resolve()` for Android and charts.
 */
export const aliases = {
  'stage-new': 'info',
  'stage-qualified': 'accent',
  'stage-won': 'success',
  'stage-lost': 'text-subtle',
  'sla-ok': 'success',
  'sla-warn': 'warning',
  'sla-breach': 'danger',
  'stock-healthy': 'success',
  'stock-low': 'warning',
  'stock-out': 'danger',
  'stock-reserved': 'info',
  'auto-suggest': 'info',
  'auto-approve': 'warning',
  'auto-automatic': 'success',
  'chart-1': 'accent',
  'chart-2': 'info',
  'chart-3': 'stage-quoted',
  'chart-4': 'stage-contacted',
  'chart-5': 'success',
  'chart-6': 'text-subtle',
  'entity-1': 'accent',
  'entity-2': 'info',
  'entity-3': 'stage-quoted',
  'entity-4': 'stage-contacted',
} as const satisfies Record<string, ColorToken>;

export type AliasToken = keyof typeof aliases;

/** Shadows are the one non-colour token that differs by theme (DESIGN.md §4). */
export const shadows = {
  'shadow-1': {
    light: '0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.08)',
    dark: '0 1px 2px rgb(0 0 0 / 0.4)',
  },
  'shadow-2': {
    light: '0 8px 24px rgb(0 0 0 / 0.12)',
    dark: '0 8px 24px rgb(0 0 0 / 0.5)',
  },
} as const;

/** Theme-independent tokens (DESIGN.md §3, §4, §5). Numeric values are pixels. */
export const scale = {
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
  radius: { sm: 4, md: 6, lg: 8, xl: 12 },
  font: {
    display: { size: 30, line: 36, weight: 600 },
    h1: { size: 24, line: 32, weight: 600 },
    h2: { size: 20, line: 28, weight: 600 },
    h3: { size: 16, line: 24, weight: 600 },
    body: { size: 14, line: 20, weight: 400 },
    'body-dense': { size: 13, line: 18, weight: 400 },
    'body-phone': { size: 15, line: 22, weight: 400 },
    caption: { size: 12, line: 16, weight: 400 },
  },
  fontFamily: 'Inter, "Noto Sans Devanagari", system-ui, sans-serif',
  motion: { fast: 120, panel: 180, dialog: 240 },
  breakpoint: { sm: 640, md: 768, lg: 1024, xl: 1280 },
  row: { comfortable: 40, compact: 32 },
  control: { desktop: 36, phone: 44 },
  focusRing: { width: 2, offset: 2 },
} as const;

/** Every colour token, aliases resolved, for one theme. */
export function resolve(theme: Theme): Record<ColorToken | AliasToken, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(colors)) out[name] = value[theme];
  for (const [name, target] of Object.entries(aliases)) out[name] = colors[target][theme];
  return out;
}
