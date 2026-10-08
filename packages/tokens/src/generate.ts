// Theme generation from three inputs, the way Linear generates its themes (docs/08-design-system.md §2.1):
// a base colour, an accent and a contrast level, computed in the CIE LCH colour space so that
// equal lightness steps look equal whatever the hue. Every neutral and accent shade is derived;
// the contrast test then checks every text and UI pair the design relies on.
import { contrastRatio } from './contrast';

export interface ThemeInputs {
  base: string;
  accent: string;
  /** 0 to 100: the spread of the ladder. 30 is the default; a high-contrast variant uses more. */
  contrast: number;
}

interface Lch {
  l: number;
  c: number;
  h: number;
}

// sRGB (D65) ↔ CIE Lab (D65 white) ↔ LCH.
const WHITE = { x: 0.95047, y: 1, z: 1.08883 };

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
const fInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function hexToLch(hex: string): Lch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WHITE.x;
  const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * b) / WHITE.y;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WHITE.z;
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  const h = ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l, c: Math.hypot(a, bb), h };
}

/** Linear sRGB for an LCH colour; components outside 0..1 mean it is out of gamut. */
function lchToLinear({ l, c, h }: Lch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const fy = (l + 16) / 116;
  const x = fInv(fy + a / 500) * WHITE.x;
  const y = fInv(fy) * WHITE.y;
  const z = fInv(fy - b / 200) * WHITE.z;
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** The sRGB hex of an LCH colour, reducing chroma until it fits the gamut. */
export function lchToHex(colour: Lch): string {
  let lo = 0;
  let hi = colour.c;
  let rgb = lchToLinear(colour);
  if (!inGamut(rgb)) {
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchToLinear({ ...colour, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = lchToLinear({ ...colour, c: lo });
  }
  return `#${rgb
    .map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** From this contrast input on, a theme is a high-contrast variant with the stricter minimums. */
export const HIGH_CONTRAST_FROM = 60;

/**
 * The contrast minimums a theme is generated to meet (docs/08-design-system.md §2.5): body text and UI colours
 * (outlines, icons, placeholders). The high-contrast variant for field phones in daylight asks
 * 7:1 for text (WCAG AAA) and 4.5:1 for everything that carries meaning on its own.
 */
export function contrastMinimums(contrast: number): { text: number; ui: number } {
  return contrast >= HIGH_CONTRAST_FROM ? { text: 7, ui: 4.5 } : { text: 4.5, ui: 3 };
}

/**
 * The colour of the given hue and chroma nearest to `background` in lightness that reaches
 * `ratio` against it, moving darker or lighter.
 */
export function reach(
  background: string,
  ratio: number,
  hue: number,
  chroma: number,
  direction: 'darker' | 'lighter',
): string {
  const start = hexToLch(background).l;
  let lo = direction === 'darker' ? 0 : start;
  let hi = direction === 'darker' ? start : 100;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    const passes = contrastRatio(lchToHex({ l: mid, c: chroma, h: hue }), background) >= ratio;
    if (direction === 'darker') {
      if (passes) lo = mid;
      else hi = mid;
    } else if (passes) hi = mid;
    else lo = mid;
  }
  return lchToHex({ l: direction === 'darker' ? lo : hi, c: chroma, h: hue });
}

export const GENERATED_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'surface-3',
  'text',
  'text-muted',
  'text-subtle',
  'border',
  'border-strong',
  'accent',
  'accent-hover',
  'accent-text',
  'accent-fg',
  'accent-soft',
  'focus',
] as const;

export type GeneratedToken = (typeof GENERATED_TOKENS)[number];

/** One theme's neutral ladder and accent shades (docs/08-design-system.md §2.1, §2.2). */
export function generateTheme(inputs: ThemeInputs): Record<GeneratedToken, string> {
  const base = hexToLch(inputs.base);
  const accent = hexToLch(inputs.accent);
  const dark = base.l < 50;
  const toward = dark ? 'lighter' : 'darker';
  const sign = dark ? 1 : -1;
  // The contrast input scales the lightness steps and the text targets around the default 30.
  const spread = 0.5 + inputs.contrast / 60;
  const tint = dark ? 2.5 : 1.2;
  const neutral = (l: number, c = tint) => lchToHex({ l, c, h: accent.h });

  const bg = inputs.base.toUpperCase();
  const surfaceL = dark ? base.l + 2.5 * spread : base.l;
  const surface = dark ? neutral(surfaceL) : bg;
  const surface2 = neutral(surfaceL + sign * 3.2 * spread);
  const surface3 = neutral(surfaceL + sign * 6.4 * spread);
  const border = neutral(surfaceL + sign * (dark ? 10 : 9.5) * spread);

  const min = contrastMinimums(inputs.contrast);
  const textTarget = Math.max(4.5 + inputs.contrast * 0.04, min.text + 0.1);
  const text = neutral(dark ? 97.5 : 11, dark ? 1.2 : 3);
  const textMuted = reach(surface2, textTarget, accent.h, tint, toward);
  // Placeholders, helpers and metadata are still text, so they reach the text minimum too
  // (WCAG 1.4.3); they stay a step lighter than muted text.
  const textSubtle = reach(surface2, min.text + 0.1, accent.h, tint, toward);
  // Inputs are identified by their outline alone, so it must reach 3:1 (WCAG 1.4.11).
  const borderStrong = reach(surface, Math.max(3.2, min.ui + 0.2), accent.h, tint, toward);

  // The accent fill carries a white label. When white on the accent input misses the text
  // minimum (only the high-contrast variants), a light theme deepens the fill until it passes;
  // a dark one lightens it and labels it in the page's own near-black, because a fill deep
  // enough for white would no longer stand out from the dark surface.
  const white = '#FFFFFF';
  const input = inputs.accent.toUpperCase();
  const labelFits = contrastRatio(white, input) >= min.text;
  const accentHex = labelFits
    ? input
    : dark
      ? reach(bg, min.text + 0.1, accent.h, accent.c, 'lighter')
      : reach(white, min.text + 0.1, accent.h, accent.c, 'darker');
  const accentFg = labelFits || !dark ? white : bg;
  const fill = hexToLch(accentHex);
  // Hover is one step away from the label in both themes, so the label on it stays above the
  // minimum: darker under white, lighter under a dark label.
  const accentHover = lchToHex({
    l: accentFg === white ? fill.l - 6 : fill.l + 6,
    c: fill.c,
    h: fill.h,
  });
  const accentSoft = lchToHex({ l: dark ? 20 : 95, c: dark ? 18 : 10, h: accent.h });
  // Accent text sits on the surfaces and on the soft accent tint (badges, selected rows), so it
  // reaches the text minimum against whichever of them is hardest.
  const textGrounds = [surface, surface2, accentSoft];
  const hardest = textGrounds.reduce((a, b) =>
    contrastRatio(accentHex, a) <= contrastRatio(accentHex, b) ? a : b,
  );
  const accentText =
    contrastRatio(accentHex, hardest) >= min.text
      ? accentHex
      : reach(hardest, min.text + 0.1, accent.h, accent.c, toward);

  return {
    bg,
    surface,
    'surface-2': surface2,
    'surface-3': surface3,
    text,
    'text-muted': textMuted,
    'text-subtle': textSubtle,
    border,
    'border-strong': borderStrong,
    accent: accentHex,
    'accent-hover': accentHover,
    'accent-text': accentText,
    'accent-fg': accentFg,
    'accent-soft': accentSoft,
    focus: accentHex,
  };
}
