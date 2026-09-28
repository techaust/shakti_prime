import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenBypasses } from '@shakti/ui/class-rules';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(tsx?|css)$/.test(name) && !name.includes('.test.') ? [path] : [];
  });
}

const sources = filesUnder(here).map((path) => ({
  name: relative(here, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

/**
 * The bracketed values the web app keeps, each named with the reason no token fits. A new one
 * needs a token in packages/tokens or an entry here with its reason.
 */
const EXCEPTIONS: readonly { name: string; value: string; why: string }[] = [
  {
    name: 'components/auth/turnstile-widget.tsx',
    value: 'min-h-[65px]',
    why: "the bot check's own frame is 65 px tall; holding the space keeps the form still",
  },
  {
    name: 'components/shell/company-switcher.tsx',
    value: 'max-w-[min(16rem,45vw)]',
    why: 'a long company name is cut short before it crowds the top bar on a phone',
  },
];

describe('web source rules', () => {
  it('takes every colour, type size, weight, radius and space from the tokens (DESIGN.md §2–§4)', () => {
    for (const { name, text } of sources) {
      const found = tokenBypasses(text).filter(
        (value) => !EXCEPTIONS.some((e) => e.name === name && e.value === value),
      );
      expect({ name, found }).toEqual({ name, found: [] });
    }
  });

  it('lists only exceptions that are still in use', () => {
    for (const exception of EXCEPTIONS) {
      const source = sources.find((s) => s.name === exception.name);
      expect({
        exception,
        used: tokenBypasses(source?.text ?? '').includes(exception.value),
      }).toEqual({ exception, used: true });
    }
  });

  it('scans the whole app, pages and components alike', () => {
    const names = sources.map((s) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(['app/error.tsx', 'components/form.tsx', 'app/globals.css']),
    );
  });
});
