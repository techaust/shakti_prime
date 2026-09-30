import {
  contrastMinimums,
  contrastRatio,
  highContrastInputs,
  resolve,
  themeInputs,
  type AliasToken,
  type ColorToken,
  type Contrast,
  type Theme,
} from '@shakti/tokens';

type Token = ColorToken | AliasToken;

export interface ContrastPair {
  fg: Token;
  bg: Token;
  /**
   * Body text, or a UI colour (large text, lines, icons). Standard themes ask 4.5:1 and 3:1
   * (DESIGN.md §2.5); the high-contrast variant 7:1 and 4.5:1 (`contrastMinimums`).
   */
  kind: 'text' | 'ui';
}

/**
 * The pairs DESIGN.md §2.5 relies on, the same ones the token package's contrast test checks:
 * text on every surface, accent text, labels on accent fills, status text on its soft tint, and
 * the colours that carry meaning on their own (outlines, focus, status dots).
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text', bg: 'surface', kind: 'text' },
  { fg: 'text', bg: 'bg', kind: 'text' },
  { fg: 'text', bg: 'surface-2', kind: 'text' },
  { fg: 'text-muted', bg: 'surface', kind: 'text' },
  { fg: 'text-muted', bg: 'surface-2', kind: 'text' },
  { fg: 'accent-text', bg: 'surface', kind: 'text' },
  { fg: 'accent-text', bg: 'surface-2', kind: 'text' },
  { fg: 'accent-text', bg: 'accent-soft', kind: 'text' },
  { fg: 'accent-fg', bg: 'accent', kind: 'text' },
  { fg: 'accent-fg', bg: 'accent-hover', kind: 'text' },
  { fg: 'text', bg: 'accent-soft', kind: 'text' },
  { fg: 'success', bg: 'success-soft', kind: 'text' },
  { fg: 'warning', bg: 'warning-soft', kind: 'text' },
  { fg: 'danger', bg: 'danger-soft', kind: 'text' },
  { fg: 'info', bg: 'info-soft', kind: 'text' },
  { fg: 'text-subtle', bg: 'surface', kind: 'text' },
  { fg: 'text-subtle', bg: 'surface-2', kind: 'text' },
  { fg: 'border-strong', bg: 'surface', kind: 'ui' },
  { fg: 'border-strong', bg: 'bg', kind: 'ui' },
  { fg: 'accent', bg: 'surface', kind: 'ui' },
  { fg: 'focus', bg: 'surface', kind: 'ui' },
  { fg: 'focus', bg: 'bg', kind: 'ui' },
  { fg: 'danger', bg: 'surface', kind: 'ui' },
  { fg: 'success', bg: 'surface', kind: 'ui' },
  { fg: 'warning', bg: 'surface', kind: 'ui' },
  { fg: 'info', bg: 'surface', kind: 'ui' },
  { fg: 'stage-contacted', bg: 'surface', kind: 'ui' },
  { fg: 'stage-quoted', bg: 'surface', kind: 'ui' },
];

export interface ContrastRow extends ContrastPair {
  id: string;
  /** The ratio this pair needs at this contrast level. */
  min: number;
  fgHex: string;
  bgHex: string;
  ratio: number;
  passes: boolean;
}

/**
 * Every pair with its measured ratio in one theme at one contrast level, from the generated
 * values, against the minimum that level asks for.
 */
export function contrastRows(theme: Theme, contrast: Contrast = 'standard'): ContrastRow[] {
  const values = resolve(theme, contrast);
  const inputs = contrast === 'high' ? highContrastInputs : themeInputs;
  const minimums = contrastMinimums(inputs[theme].contrast);
  return CONTRAST_PAIRS.map((pair) => {
    const fgHex = values[pair.fg];
    const bgHex = values[pair.bg];
    const ratio = contrastRatio(fgHex, bgHex);
    const min = minimums[pair.kind];
    return {
      ...pair,
      id: `${pair.fg}/${pair.bg}`,
      min,
      fgHex,
      bgHex,
      ratio,
      passes: ratio >= min,
    };
  });
}

/** A ratio as the page shows it: two decimals and ":1". */
export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}
