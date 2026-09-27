import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderTailwindCss, renderTokensCss } from './css';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), 'utf8');

describe('generated CSS', () => {
  it('tokens.css is up to date with tokens.ts (run pnpm --filter @shakti/tokens build)', () => {
    expect(read('tokens.css')).toBe(renderTokensCss());
  });

  it('tailwind.css is up to date with tokens.ts', () => {
    expect(read('tailwind.css')).toBe(renderTailwindCss());
  });

  it('declares dark values under both the system query and the explicit override', () => {
    const css = renderTokensCss();
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {',
    );
    expect(css).toContain(':root[data-theme="dark"] {');
    expect(css).toContain('color-scheme: light;');
    // the system query, the explicit override and the scoped .theme-dark block
    expect(css.match(/color-scheme: dark;/g)).toHaveLength(3);
  });

  it('offers scoped light and dark blocks for side-by-side previews', () => {
    const css = renderTokensCss();
    expect(css).toContain('.theme-light {');
    expect(css).toContain('.theme-dark {');
  });

  it('declares the aliases again in each scoped block, so they resolve to that theme', () => {
    const css = renderTokensCss();
    for (const scope of ['.theme-light {', '.theme-dark {']) {
      const block = css.slice(css.indexOf(scope), css.indexOf('}', css.indexOf(scope)));
      expect(block).toContain('--chart-2: var(--info);');
      expect(block).toContain('--stage-new: var(--text-subtle);');
    }
  });

  it('sizes type and controls in rem, so a user text-size setting scales them', () => {
    const css = renderTokensCss();
    expect(css).toContain('--font-body-size: 0.875rem;');
    expect(css).toContain('--control-phone: 2.75rem;');
    expect(css).not.toMatch(/--font-[a-z0-9-]+-size: \d+px/);
  });

  it('contains no raw hex outside the theme blocks of tailwind.css', () => {
    expect(renderTailwindCss()).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
