import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { momentValues } from '../components/date-time';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function components(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return components(path);
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : [];
  });
}

describe('a sentence around a moment is one message (docs/08-design-system.md §9, WEB-10)', () => {
  it('never places a translated fragment in front of a DateTime', () => {
    const fragment = /\{t\('[^']+'(?:,\s*\{[^}]*\})?\)\}\s*(?:\{' '\})?\s*<DateTime\b/;
    const found = components(src)
      .filter((file) => fragment.test(readFileSync(file, 'utf8')))
      .map((file) => relative(src, file).replaceAll('\\', '/'));
    expect(found).toEqual([]);
  });

  it('puts the moment inside the sentence, marked up as a time', () => {
    const t = createTranslator({ locale: 'en', messages: en, namespace: 'converting.order' });
    const at = new Date('2026-10-12T04:30:00Z');
    const html = renderToStaticMarkup(<p>{t.rich('heldSince', momentValues(at))}</p>);
    expect(html).toBe(
      `<p>Held since <time dateTime="2026-10-12T04:30:00.000Z">${momentValues(at).when}</time></p>`,
    );
  });
});
