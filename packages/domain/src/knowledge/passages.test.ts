import { describe, expect, it } from 'vitest';
import { maskForModel } from '../privacy/model-text';
import { chunkText, KNOWLEDGE_CHUNKING } from './chunk';
import { knowledgePassages, maskWholeText } from './passages';

// A vault file's passages are masked before they are cut, then again after (SECURITY §5, §6). Every
// number here is made up.

const NUMBER = '2345 6789 0123';
const DIGITS = ['2345', '6789', '0123'];

function leaks(passages: readonly string[]): boolean {
  // Any four digits of the number left in a passage is a leak, however the cut fell.
  return passages.some((p) => DIGITS.some((group) => p.includes(group)));
}

describe('knowledgePassages', () => {
  it('masks a number that would straddle the cut of a long line', () => {
    // One line with no sentence break, the cut falling at every position near the number: the
    // eight digits left on one side of a cut would not be masked on their own.
    let cutBeforeMasking = false;
    for (let filler = 1_260; filler <= 1_320; filler += 1) {
      const lead = 'ab '.repeat(Math.floor(filler / 3)).trimEnd();
      const text = `${lead} ${NUMBER} tail words after the number`;
      // Control: masking each passage after the cut, as the index job once did, leaks at some cut.
      if (leaks(chunkText(text).map(maskForModel))) cutBeforeMasking = true;
      const passages = knowledgePassages(text);
      expect(leaks(passages), `filler ${String(filler)}`).toBe(false);
      expect(passages.join(' ')).toContain('[number]');
    }
    expect(cutBeforeMasking).toBe(true);
  });

  it('masks a number split across two lines, and one joined by table separators', () => {
    expect(maskWholeText('Aadhaar 2345 6789\n0123 on file')).not.toContain('6789');
    expect(maskWholeText('Name | Aadhaar | 2345 6789 0123 | Jaipur')).not.toContain('2345');
  });

  it('masks a number that falls where a very long text is cut into blocks', () => {
    const filler = 'word '.repeat(2_000).trim();
    for (const gap of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const lines = Array.from({ length: 4 }, () => filler);
      const text = `${lines.join('\n')}\n${'x'.repeat(gap)}2345 6789\n0123\n${lines.join('\n')}`;
      expect(maskWholeText(text)).not.toContain('6789');
    }
  });

  it('cuts a line longer than a block where no number is', () => {
    const line = `${'7'.repeat(3)} ${'word '.repeat(5_000)}`;
    const masked = maskWholeText(`${line} 2345 6789 0123 ${line}`);
    expect(masked).not.toContain('6789');
    expect(masked.length).toBeGreaterThan(20_000);
  });

  it('keeps ordinary text and respects the passage size', () => {
    const passages = knowledgePassages('Warranty covers the motor for five years.\n\nPanels: ten years.');
    expect(passages).toEqual(['Warranty covers the motor for five years.\n\nPanels: ten years.']);
    const long = knowledgePassages('Sentence about pumps. '.repeat(400));
    expect(long.every((p) => p.length <= KNOWLEDGE_CHUNKING.maxChars)).toBe(true);
  });
});
