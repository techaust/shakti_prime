import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tokenBypasses } from './class-rules';

const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here)
  .filter((name) => /\.(tsx?|css)$/.test(name) && !name.includes('.test.'))
  .map((name) => ({ name, text: readFileSync(join(here, name), 'utf8') }));

/**
 * The bracketed values these components keep, each named with the reason no token fits. A new
 * one needs a token in packages/tokens or an entry here with its reason.
 */
const EXCEPTIONS: readonly { name: string; value: string; why: string }[] = [
  {
    name: 'board.tsx',
    value: 'h-[3px]',
    why: 'the stage colour bar is 3 px (docs/08-design-system.md §6)',
  },
  {
    name: 'command-palette.tsx',
    value: 'top-[12vh]',
    why: 'the palette sits an eighth of the way down, clear of the top bar',
  },
  {
    name: 'command-palette.tsx',
    value: 'w-[calc(100%-2rem)]',
    why: 'the 16 px phone gutter each side (docs/08-design-system.md §5)',
  },
  {
    name: 'command-palette.tsx',
    value: 'max-h-[min(24rem,60dvh)]',
    why: 'the result list scrolls inside the palette, never past a phone screen',
  },
  {
    name: 'data-grid.tsx',
    value: 'max-h-[calc(100dvh-12rem)]',
    why: 'the sticky header scrolls with the rows inside the window, below the shell',
  },
  {
    name: 'dialog.tsx',
    value: 'backdrop-blur-[2px]',
    why: 'the overlay softens the page behind a dialog; docs/08-design-system.md has no blur token',
  },
  {
    name: 'dialog.tsx',
    value: 'w-[calc(100%-2rem)]',
    why: 'the 16 px phone gutter each side (docs/08-design-system.md §5)',
  },
  {
    name: 'dialog.tsx',
    value: 'max-h-[calc(100dvh-2rem)]',
    why: 'a long dialog scrolls inside the phone gutter',
  },
  {
    name: 'dialog.tsx',
    value: 'w-[min(24rem,calc(100%-3rem))]',
    why: 'a side sheet leaves a strip of the page visible on phones',
  },
];

describe('component source rules', () => {
  it("never uses shadcn's accent pair, whose name the Shakti indigo owns", () => {
    // shadcn writes hover fills as bg-accent with text-accent-foreground; here they are
    // bg-highlight and text-highlight-foreground (packages/tokens/src/css.ts).
    for (const { name, text } of sources) {
      expect({ name, found: text.match(/accent-foreground/g) }).toEqual({ name, found: null });
    }
  });

  it('holds no raw colour: every colour is a token (docs/08-design-system.md §2)', () => {
    for (const { name, text } of sources) {
      expect({ name, found: text.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) }).toEqual({
        name,
        found: null,
      });
    }
  });

  it('takes every colour, type size, weight, radius and space from the tokens (docs/08-design-system.md §2–§4)', () => {
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
});
