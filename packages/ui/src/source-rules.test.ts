import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here)
  .filter((name) => /\.(tsx?|css)$/.test(name) && !name.includes('.test.'))
  .map((name) => ({ name, text: readFileSync(join(here, name), 'utf8') }));

describe('component source rules', () => {
  it("never uses shadcn's accent pair, whose name the Shakti indigo owns", () => {
    // shadcn writes hover fills as bg-accent with text-accent-foreground; here they are
    // bg-highlight and text-highlight-foreground (packages/tokens/src/css.ts).
    for (const { name, text } of sources) {
      expect({ name, found: text.match(/accent-foreground/g) }).toEqual({ name, found: null });
    }
  });

  it('holds no raw colour: every colour is a token (DESIGN.md §2)', () => {
    for (const { name, text } of sources) {
      expect({ name, found: text.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) }).toEqual({
        name,
        found: null,
      });
    }
  });
});
