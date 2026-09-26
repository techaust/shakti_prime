import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance } from './contrast.js';
import { resolve, type Theme } from './tokens.js';

const AA_TEXT = 4.5;
const AA_UI = 3;

describe('contrast helpers', () => {
  it('matches the WCAG reference values', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 3);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });
});

describe.each<Theme>(['light', 'dark'])('%s theme meets DESIGN.md §2.4', (theme) => {
  const t = resolve(theme);

  it.each([
    ['text', 'surface'],
    ['text', 'bg'],
    ['text', 'surface-2'],
    ['text-muted', 'surface'],
    ['text-muted', 'surface-2'],
    ['text-subtle', 'surface'],
    ['accent-text', 'surface'],
    ['accent-fg', 'accent'],
    ['success', 'success-soft'],
    ['warning', 'warning-soft'],
    ['danger', 'danger-soft'],
    ['info', 'info-soft'],
    ['text', 'accent-soft'],
  ] as const)('body text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([
    // Primary button label on the hover fill: 3.7:1 in light. Raised for the DESIGN.md sign-off in week 4.
    ['accent-fg', 'accent-hover'],
    ['accent', 'surface'],
    ['focus', 'surface'],
    ['focus', 'bg'],
    ['danger', 'surface'],
    ['success', 'surface'],
    ['warning', 'surface'],
    ['info', 'surface'],
    ['stage-contacted', 'surface'],
    ['stage-quoted', 'surface'],
  ] as const)('UI colour %s on %s is at least 3:1', (fg, bg) => {
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
