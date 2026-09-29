import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance } from './contrast';
import {
  contrastMinimums,
  highContrastInputs,
  resolve,
  themeInputs,
  type Contrast,
  type Theme,
} from './tokens';

describe('contrast helpers', () => {
  it('matches the WCAG reference values', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 3);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

const LEVELS: [Theme, Contrast][] = [
  ['light', 'standard'],
  ['dark', 'standard'],
  ['light', 'high'],
  ['dark', 'high'],
];

describe('the high-contrast variant (DESIGN.md §2.1)', () => {
  it('asks 7:1 for text and 4.5:1 for outlines and icons, and the standard themes AA', () => {
    expect(contrastMinimums(30)).toEqual({ text: 4.5, ui: 3 });
    expect(contrastMinimums(highContrastInputs.light.contrast)).toEqual({ text: 7, ui: 4.5 });
    expect(contrastMinimums(highContrastInputs.dark.contrast)).toEqual({ text: 7, ui: 4.5 });
  });

  it.each<Theme>(['light', 'dark'])(
    'keeps the %s base and moves every text colour further from it',
    (theme) => {
      const standard = resolve(theme);
      const high = resolve(theme, 'high');
      expect(high.bg).toBe(standard.bg);
      for (const token of ['text-muted', 'text-subtle', 'border-strong', 'accent-text'] as const) {
        expect(contrastRatio(high[token], high.bg)).toBeGreaterThan(
          contrastRatio(standard[token], standard.bg),
        );
      }
    },
  );
});

describe.each(LEVELS)('%s theme at %s contrast meets DESIGN.md §2.5', (theme, contrast) => {
  const t = resolve(theme, contrast);
  const min = contrastMinimums(
    (contrast === 'high' ? highContrastInputs : themeInputs)[theme].contrast,
  );
  const AA_TEXT = min.text;
  const AA_UI = min.ui;

  it.each([
    ['text', 'surface'],
    ['text', 'bg'],
    ['text', 'surface-2'],
    ['text-muted', 'surface'],
    ['text-muted', 'surface-2'],
    ['accent-text', 'surface'],
    ['accent-text', 'surface-2'],
    // Accent badges and ticked rows (the status badge's accent tone).
    ['accent-text', 'accent-soft'],
    ['accent-fg', 'accent'],
    ['accent-fg', 'accent-hover'],
    ['success', 'success-soft'],
    ['warning', 'warning-soft'],
    ['danger', 'danger-soft'],
    ['info', 'info-soft'],
    ['text', 'accent-soft'],
  ] as const)(`body text %s on %s is at least ${String(min.text)}:1`, (fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([
    // Placeholders and metadata (DESIGN.md §2.2).
    ['text-subtle', 'surface'],
    ['text-subtle', 'surface-2'],
    // A field is identified by its outline alone (WCAG 1.4.11, AUDIT M49).
    ['border-strong', 'surface'],
    ['border-strong', 'bg'],
    ['accent', 'surface'],
    ['focus', 'surface'],
    ['focus', 'bg'],
    ['danger', 'surface'],
    ['success', 'surface'],
    ['warning', 'surface'],
    ['info', 'surface'],
    ['stage-contacted', 'surface'],
    ['stage-quoted', 'surface'],
  ] as const)(`UI colour %s on %s is at least ${String(min.ui)}:1`, (fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(AA_UI);
  });

  it('chart colours are pairwise distinguishable', () => {
    const chart = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'] as const;
    for (let i = 0; i < chart.length; i += 1) {
      for (let j = i + 1; j < chart.length; j += 1) {
        const a = chart[i];
        const b = chart[j];
        if (a === undefined || b === undefined) continue;
        expect(t[a]).not.toBe(t[b]);
      }
    }
  });
});
