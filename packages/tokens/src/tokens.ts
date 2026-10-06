// Single source of the design tokens in docs/08-design-system.md §2–§4 and §8.
// `tokens.css` and `tailwind.css` are generated from this file by `pnpm --filter @shakti/tokens build`.
// The Android app and chart code import this object directly.
import { contrastRatio } from './contrast';
import {
  contrastMinimums,
  generateTheme,
  GENERATED_TOKENS,
  hexToLch,
  reach,
  type GeneratedToken,
  type ThemeInputs,
} from './generate';

export { contrastRatio } from './contrast';
export { contrastMinimums } from './generate';

export type Theme = 'light' | 'dark';

/** Standard, or the high-contrast variant for field phones in daylight (docs/08-design-system.md §2.1). */
export type Contrast = 'standard' | 'high';

/** The three inputs each theme is generated from (docs/08-design-system.md §2.1). Linear's default indigo. */
export const themeInputs: Record<Theme, ThemeInputs> = {
  light: { base: '#FFFFFF', accent: '#5E6AD2', contrast: 30 },
  dark: { base: '#08090A', accent: '#5E6AD2', contrast: 30 },
};

/** The high-contrast variant: the same base and accent with a wider ladder. */
export const highContrastInputs: Record<Theme, ThemeInputs> = {
  light: { ...themeInputs.light, contrast: 70 },
  dark: { ...themeInputs.dark, contrast: 70 },
};

/** Fixed hues, not generated, checked by the same contrast test (docs/08-design-system.md §2.3, §2.4). */
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

/** Each status colour's soft tint, which its text sits on (docs/08-design-system.md §2.5). */
const SOFT: Partial<Record<FixedToken, FixedToken>> = {
  success: 'success-soft',
  warning: 'warning-soft',
  danger: 'danger-soft',
  info: 'info-soft',
};

/**
 * A fixed hue at a theme's minimums: the same hue and chroma, moved away from what it sits on
 * until it meets them. Status text must reach the text minimum on its soft tint (and so on the
 * surface, which lies further away); the other hues, the UI minimum on the surface; the tints
 * stay as they are. A hue that already passes is kept, so the standard themes keep docs/08-design-system.md
 * §2.3 exactly and only the high-contrast variant moves.
 */
function strengthen(
  name: FixedToken,
  theme: Theme,
  surface: string,
  min: { text: number; ui: number },
): string {
  const value = fixed[name][theme];
  if (name.endsWith('-soft')) return value;
  const soft = SOFT[name];
  const [against, ratio] = soft === undefined ? [surface, min.ui] : [fixed[soft][theme], min.text];
  if (contrastRatio(value, against) >= ratio) return value;
  const lch = hexToLch(value);
  return reach(against, ratio + 0.1, lch.h, lch.c, theme === 'dark' ? 'lighter' : 'darker');
}

function buildColors(
  inputs: Record<Theme, ThemeInputs>,
): Record<ColorToken, Record<Theme, string>> {
  const light = generateTheme(inputs.light);
  const dark = generateTheme(inputs.dark);
  const out = {} as Record<ColorToken, Record<Theme, string>>;
  for (const name of GENERATED_TOKENS) out[name] = { light: light[name], dark: dark[name] };
  for (const name of Object.keys(fixed) as FixedToken[]) {
    out[name] = {
      light: strengthen(name, 'light', light.surface, contrastMinimums(inputs.light.contrast)),
      dark: strengthen(name, 'dark', dark.surface, contrastMinimums(inputs.dark.contrast)),
    };
  }
  return out;
}

/** Colour tokens with a concrete value per theme (docs/08-design-system.md §2.2, §2.3). */
export const colors: Readonly<Record<ColorToken, Readonly<Record<Theme, string>>>> =
  buildColors(themeInputs);

/**
 * The high-contrast variant of every colour token, for field phones in daylight (docs/08-design-system.md
 * §2.1): generated from `highContrastInputs`, with the fixed hues moved to the variant's
 * minimums (`contrastMinimums`: 7:1 for text, 4.5:1 for outlines and icons).
 */
export const highContrastColors: Readonly<Record<ColorToken, Readonly<Record<Theme, string>>>> =
  buildColors(highContrastInputs);

/** The colour tokens of one contrast level. */
export function colorsFor(
  contrast: Contrast,
): Readonly<Record<ColorToken, Readonly<Record<Theme, string>>>> {
  return contrast === 'high' ? highContrastColors : colors;
}

/**
 * Tokens that point at another token (docs/08-design-system.md §2.4). Emitted as `var(--x)` in CSS and
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

/** Shadows are the one non-colour token that differs by theme (docs/08-design-system.md §4). */
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
 * The three weights of the variable Inter cut (docs/08-design-system.md §3): regular text, the 510 Linear uses
 * for labels and numbers, and the 590 of headings. The type roles below take theirs from here,
 * and `font-normal`, `font-medium` and `font-semibold` are the only weight utilities.
 */
const fontWeight = { normal: 400, medium: 510, semibold: 590 } as const;

/**
 * Theme-independent tokens (docs/08-design-system.md §3, §4, §5). Numeric values are pixels at the browser's
 * default text size; the CSS emits them in rem so a user's own text-size setting scales them.
 */
export const scale = {
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 },
  radius: { sm: 4, md: 6, lg: 8, xl: 12 },
  fontWeight,
  font: {
    display: { size: 30, line: 36, weight: fontWeight.semibold },
    h1: { size: 24, line: 32, weight: fontWeight.semibold },
    h2: { size: 20, line: 28, weight: fontWeight.semibold },
    h3: { size: 16, line: 24, weight: fontWeight.semibold },
    body: { size: 14, line: 20, weight: fontWeight.normal },
    'body-dense': { size: 13, line: 18, weight: fontWeight.normal },
    'body-phone': { size: 15, line: 22, weight: fontWeight.normal },
    caption: { size: 12, line: 16, weight: fontWeight.normal },
    numeric: { size: 14, line: 20, weight: fontWeight.medium },
  },
  /** For native apps and charts; the web app loads Inter through next/font (`--font-inter`). */
  fontFamily: 'Inter, system-ui, sans-serif',
  motion: { fast: 120, panel: 180, dialog: 240 },
  breakpoint: { sm: 640, md: 768, lg: 1024, xl: 1280 },
  row: { comfortable: 40, compact: 32 },
  control: { desktop: 36, phone: 44 },
  focusRing: { width: 2, offset: 2 },
  /** The app shell (docs/08-design-system.md §5): sidebar open and collapsed to icons, and the top bar. */
  shell: { sidebar: 240, sidebarCollapsed: 56, topbar: 48 },
  /** Content widths (docs/08-design-system.md §5): forms and detail pages; grids and boards use the full width. */
  content: { form: 720, detail: 1200 },
} as const;

/** Every colour token, aliases resolved, for one theme at one contrast level. */
export function resolve(
  theme: Theme,
  contrast: Contrast = 'standard',
): Record<ColorToken | AliasToken, string> {
  const palette = colorsFor(contrast);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(palette)) out[name] = value[theme];
  for (const [name, target] of Object.entries(aliases)) out[name] = palette[target][theme];
  return out;
}
