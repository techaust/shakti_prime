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
    // the system query, the explicit override and the scoped block, standard and high contrast
    expect(css.match(/color-scheme: dark;/g)).toHaveLength(6);
  });

  it('declares the high-contrast variant of both themes under data-contrast="high"', () => {
    const css = renderTokensCss();
    expect(css).toContain(':root[data-contrast="high"] {');
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root[data-contrast="high"]:not([data-theme="light"]) {',
    );
    expect(css).toContain(':root[data-contrast="high"][data-theme="dark"] {');
    expect(css).toContain('.theme-light-high {');
    expect(css).toContain('.theme-dark-high {');
    // Each variant comes after the standard block it refines, so the cascade order agrees with
    // the higher specificity.
    expect(css.indexOf(':root[data-contrast="high"] {')).toBeGreaterThan(
      css.indexOf(':root[data-theme="dark"] {'),
    );
  });

  it('keeps the standard themes unchanged by the high-contrast variant', () => {
    const css = renderTokensCss();
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
    const high = css.slice(
      css.indexOf(':root[data-contrast="high"] {'),
      css.indexOf('}', css.indexOf(':root[data-contrast="high"] {')),
    );
    expect(root).toContain('--accent: #5E6AD2;');
    expect(high).not.toContain('--accent: #5E6AD2;');
  });

  it('offers scoped light and dark blocks for side-by-side previews', () => {
    const css = renderTokensCss();
    expect(css).toContain('.theme-light {');
    expect(css).toContain('.theme-dark {');
  });

  it('declares the aliases again in each scoped block, so they resolve to that theme', () => {
    const css = renderTokensCss();
    for (const scope of [
      '.theme-light {',
      '.theme-dark {',
      '.theme-light-high {',
      '.theme-dark-high {',
    ]) {
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

  it('keeps the indigo accent and gives shadcn its neutral hover under another name', () => {
    const css = renderTailwindCss();
    expect(css).toContain('--color-accent: var(--accent);');
    expect(css).toContain('--highlight: var(--surface-3);');
    expect(css).toContain('--color-highlight: var(--highlight);');
    expect(css).toContain('--color-highlight-foreground: var(--highlight-foreground);');
    // shadcn's accent pair is never declared, so its hover classes cannot reach the indigo.
    expect(css).not.toMatch(/--accent-foreground/);
    expect(css).not.toMatch(/^\s*--accent:/m);
  });

  it('offers the three weights of DESIGN.md §3 as the only weight utilities', () => {
    const tokens = renderTokensCss();
    expect(tokens).toContain('--weight-normal: 400;');
    expect(tokens).toContain('--weight-medium: 510;');
    expect(tokens).toContain('--weight-semibold: 590;');
    const tw = renderTailwindCss();
    // Tailwind's own scale (500 for medium, 700 for bold) is cleared before the design's.
    const reset = tw.indexOf('--font-weight-*: initial;');
    expect(reset).toBeGreaterThan(-1);
    expect(tw.indexOf('--font-weight-medium: var(--weight-medium);')).toBeGreaterThan(reset);
    expect(tw).toContain('--font-weight-normal: var(--weight-normal);');
    expect(tw).toContain('--font-weight-semibold: var(--weight-semibold);');
    expect(tw.match(/--font-weight-[a-z]+:/g)).toHaveLength(3);
    // The type roles carry the same values.
    expect(tokens).toContain('--font-h1-weight: 590;');
    expect(tokens).toContain('--font-numeric-weight: 510;');
  });

  it('sizes the app shell and content widths from DESIGN.md §5', () => {
    const tokens = renderTokensCss();
    expect(tokens).toContain('--sidebar-width: 15rem;');
    expect(tokens).toContain('--sidebar-collapsed: 3.5rem;');
    expect(tokens).toContain('--topbar-height: 3rem;');
    expect(tokens).toContain('--content-form: 45rem;');
    expect(tokens).toContain('--content-detail: 75rem;');
    const tw = renderTailwindCss();
    expect(tw).toContain('--spacing-sidebar: var(--sidebar-width);');
    expect(tw).toContain('--container-form: var(--content-form);');
  });
});
