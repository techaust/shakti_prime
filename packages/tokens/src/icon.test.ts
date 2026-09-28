import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderAppIcon } from './icon';
import { colors, themeInputs } from './tokens';

const icon = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/web/src/app/icon.svg');

describe('the app icon', () => {
  it('is up to date with tokens.ts (run pnpm --filter @shakti/tokens build)', () => {
    expect(readFileSync(icon, 'utf8')).toBe(renderAppIcon());
  });

  it('is an accent tile with the mark in the text-on-accent colour', () => {
    const svg = renderAppIcon();
    expect(svg).toContain(`fill="${themeInputs.light.accent.toUpperCase()}"`);
    expect(svg).toContain(`fill="${colors['accent-fg'].light}"`);
    expect(svg.match(/fill="#[0-9A-F]{6}"/g)).toHaveLength(2);
  });
});
