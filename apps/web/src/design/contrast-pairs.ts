import {
  contrastRatio,
  resolve,
  type AliasToken,
  type ColorToken,
  type Theme,
} from '@shakti/tokens';

type Token = ColorToken | AliasToken;

export interface ContrastPair {
  fg: Token;
  bg: Token;
  /** 4.5 for body text, 3 for large text, lines and icons (DESIGN.md §2.5). */
  min: 4.5 | 3;
}

/**
 * The pairs DESIGN.md §2.5 relies on, the same ones the token package's contrast test checks:
 * text on every surface, accent text, labels on accent fills, status text on its soft tint, and
 * the colours that carry meaning on their own (outlines, focus, status dots).
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text', bg: 'surface', min: 4.5 },
  { fg: 'text', bg: 'bg', min: 4.5 },
  { fg: 'text', bg: 'surface-2', min: 4.5 },
  { fg: 'text-muted', bg: 'surface', min: 4.5 },
  { fg: 'text-muted', bg: 'surface-2', min: 4.5 },
  { fg: 'accent-text', bg: 'surface', min: 4.5 },
  { fg: 'accent-text', bg: 'surface-2', min: 4.5 },
  { fg: 'accent-fg', bg: 'accent', min: 4.5 },
  { fg: 'accent-fg', bg: 'accent-hover', min: 4.5 },
  { fg: 'text', bg: 'accent-soft', min: 4.5 },
  { fg: 'success', bg: 'success-soft', min: 4.5 },
  { fg: 'warning', bg: 'warning-soft', min: 4.5 },
  { fg: 'danger', bg: 'danger-soft', min: 4.5 },
  { fg: 'info', bg: 'info-soft', min: 4.5 },
  { fg: 'text-subtle', bg: 'surface', min: 3 },
  { fg: 'text-subtle', bg: 'surface-2', min: 3 },
  { fg: 'border-strong', bg: 'surface', min: 3 },
  { fg: 'border-strong', bg: 'bg', min: 3 },
  { fg: 'accent', bg: 'surface', min: 3 },
  { fg: 'focus', bg: 'surface', min: 3 },
  { fg: 'focus', bg: 'bg', min: 3 },
  { fg: 'danger', bg: 'surface', min: 3 },
  { fg: 'success', bg: 'surface', min: 3 },
  { fg: 'warning', bg: 'surface', min: 3 },
  { fg: 'info', bg: 'surface', min: 3 },
  { fg: 'stage-contacted', bg: 'surface', min: 3 },
  { fg: 'stage-quoted', bg: 'surface', min: 3 },
];

export interface ContrastRow extends ContrastPair {
  id: string;
  fgHex: string;
  bgHex: string;
  ratio: number;
  passes: boolean;
}

/** Every pair with its measured ratio in one theme, from the generated values. */
export function contrastRows(theme: Theme): ContrastRow[] {
  const values = resolve(theme);
  return CONTRAST_PAIRS.map((pair) => {
    const fgHex = values[pair.fg];
    const bgHex = values[pair.bg];
    const ratio = contrastRatio(fgHex, bgHex);
    return {
      ...pair,
      id: `${pair.fg}/${pair.bg}`,
      fgHex,
      bgHex,
      ratio,
      passes: ratio >= pair.min,
    };
  });
}

/** A ratio as the page shows it: two decimals and ":1". */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
