import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, contrastRows, formatRatio } from './contrast-pairs';

describe('contrastRows', () => {
  it.each(['light', 'dark'] as const)(
    'measures every DESIGN.md §2.5 pair in %s, all passing',
    (theme) => {
      const rows = contrastRows(theme);
      expect(rows).toHaveLength(CONTRAST_PAIRS.length);
      expect(rows.filter((r) => !r.passes).map((r) => r.id)).toEqual([]);
      for (const row of rows) expect(row.fgHex).toMatch(/^#[0-9A-F]{6}$/i);
    },
  );

  it('has one row per pair and marks white on the accent fill at its measured ratio', () => {
    const rows = contrastRows('light');
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    const label = rows.find((r) => r.id === 'accent-fg/accent');
    expect(label?.ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe('formatRatio', () => {
  it('shows two decimals', () => {
    expect(formatRatio(4.5)).toBe('4.50:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });
});
