import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colors } from '@shakti/tokens';
import { describe, expect, it } from 'vitest';
import {
  LOGO_VIEWBOX,
  MARK_LOWER,
  MARK_UPPER,
  WORD_DOTS,
  WORD_PRIME,
  WORD_SHAKTI,
} from './logo-paths';

const brand = join(dirname(fileURLToPath(import.meta.url)), '../../../public/brand');

/** The fill and outline of each path of a published logo file, in order. */
function paths(file: string): { fill: string; d: string }[] {
  const svg = readFileSync(join(brand, file), 'utf8');
  return [...svg.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({
    fill: m[1] ?? '',
    d: m[2] ?? '',
  }));
}

describe('the logo (docs/08-design-system.md §2.2)', () => {
  it('draws the same outlines as the published logo files', () => {
    const outlines = [MARK_UPPER, MARK_LOWER, WORD_SHAKTI, WORD_PRIME, WORD_DOTS];
    for (const file of ['shakti-prime-logo.svg', 'shakti-prime-logo-dark.svg']) {
      expect(paths(file).map((p) => p.d)).toEqual(outlines);
      expect(readFileSync(join(brand, file), 'utf8')).toContain(`viewBox="${LOGO_VIEWBOX}"`);
    }
  });

  it('colours each file as the component colours the page: two indigos in each theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const file = theme === 'light' ? 'shakti-prime-logo.svg' : 'shakti-prime-logo-dark.svg';
      expect(paths(file).map((p) => p.fill)).toEqual([
        colors.brand[theme],
        colors['brand-deep'][theme],
        colors.text[theme],
        colors.brand[theme],
        colors.brand[theme],
      ]);
    }
  });
});
