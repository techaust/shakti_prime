// Single source of the design tokens in DESIGN.md §2–§4 and §8.
// `tokens.css` and `tailwind.css` are generated from this file by `pnpm --filter @shakti/tokens build`.
// The Android app and chart code import this object directly.
import { generateTheme, GENERATED_TOKENS, type GeneratedToken, type ThemeInputs } from './generate';

export { contrastRatio } from './contrast';

export type Theme = 'light' | 'dark';

/** The three inputs each theme is generated from (DESIGN.md §2.1). Linear's default indigo. */
export const themeInputs: Record<Theme, ThemeInputs> = {
  light: { base: '#FFFFFF', accent: '#5E6AD2', contrast: 30 },
  dark: { base: '#08090A', accent: '#5E6AD2', contrast: 30 },
};

/** Fixed hues, not generated, checked by the same contrast test (DESIGN.md §2.3, §2.4). */
const fixed = {
  success: { light: '#15803D', dark: '#4ADE80' },
  'success-soft': { light: '#DCFCE7', dark: '#0F2E1A' },
  warning: { light: '#B45309', dark: '#FBBF24' },
  'warning-soft': { light: '#FEF3C7', dark: '#3A2A08' },
  danger: { light: '#B91C1C', dark: '#F87171' },
  'danger-soft': { light: '#FEE2E2', dark: '#3B1111' },
  info: { light: '#0369A1', dark: '#38BDF8' },
  'info-soft': { light: '#E0F2FE', dark: '#0C2A3D' },
  rose: { light: '#BE185D', dark: '#F472B6' },
} as const;

type FixedToken = keyof typeof fixed;
export type ColorToken = GeneratedToken | FixedToken;

function buildColors(): Record<ColorToken, Record<Theme, string>> {
  const light = generateTheme(themeInputs.light);
  const dark = generateTheme(themeInputs.dark);
  const out = {} as Record<ColorToken, Record<Theme, string>>;
  for (const name of GENERATED_TOKENS) out[name] = { light: light[name], dark: dark[name] };
  for (const [name, value] of Object.entries(fixed) as [FixedToken, (typeof fixed)[FixedToken]][])
    out[name] = { light: value.light, dark: value.dark };
  return out;
}

/** Colour tokens with a concrete value per theme (DESIGN.md §2.2, §2.3). */
export const colors: Readonly<Record<ColorToken, Readonly<Record<Theme, string>>>> = buildColors();

/**
 * Tokens that point at another token (DESIGN.md §2.4). Emitted as `var(--x)` in CSS and
 * resolved to the concrete value in `resolve()` for Android and charts.
 */
export const aliases = {
  'stage-new': 'text-subtle',
  'stage-contacted': 'warning',
  'stage-qualified': 'accent',
  'stage-quoted': 'info',
  'stage-won': 'success',
  'stage-lost': 'danger',
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
  'chart-3': 'success',
  'chart-4': 'warning',
  'chart-5': 'rose',
  'chart-6': 'text-subtle',
  'entity-1': 'accent',
  'entity-2': 'info',
  'entity-3': 'success',
  'entity-4': 'rose',
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

/**
 * Theme-independent tokens (DESIGN.md §3, §4, §5). Numeric values are pixels at the browser's
 * default text size; the CSS emits them in rem so a user's own text-size setting scales them.
 */
export const scale = {
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
  radius: { sm: 4, md: 6, lg: 8, xl: 12 },
  font: {
    display: { size: 30, line: 36, weight: 590 },
    h1: { size: 24, line: 32, weight: 590 },
    h2: { size: 20, line: 28, weight: 590 },
    h3: { size: 16, line: 24, weight: 590 },
    body: { size: 14, line: 20, weight: 400 },
    'body-dense': { size: 13, line: 18, weight: 400 },
    'body-phone': { size: 15, line: 22, weight: 400 },
    caption: { size: 12, line: 16, weight: 400 },
    numeric: { size: 14, line: 20, weight: 510 },
  },
  /** For native apps and charts; the web app loads Inter through next/font (`--font-inter`). */
  fontFamily: 'Inter, system-ui, sans-serif',
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
