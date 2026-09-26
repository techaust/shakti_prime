import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderTailwindCss, renderTokensCss } from './css.js';

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
    expect(css.match(/color-scheme: dark;/g)).toHaveLength(2);
  });

  it('contains no raw hex outside the theme blocks of tailwind.css', () => {
    expect(renderTailwindCss()).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
