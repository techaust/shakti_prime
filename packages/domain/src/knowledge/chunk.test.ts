import { describe, expect, it } from 'vitest';
import { chunkText, KNOWLEDGE_CHUNKING, normaliseText } from './chunk';

// Synthetic text only: the vault's real documents are the client's.

/** A small seeded generator, so the generated cases are the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const WORDS = ['pump', 'panel', 'borewell', 'kilowatt', 'subsidy', 'warranty', 'inverter', 'farm'];

/** A document of paragraphs, lines and sentences made of the words above. */
function document(seed: number, paragraphs: number): string {
  const next = random(seed);
  const pick = () => WORDS[Math.floor(next() * WORDS.length)] ?? 'pump';
  const sentence = () =>
    `${Array.from({ length: 3 + Math.floor(next() * 12) }, pick).join(' ')}${next() < 0.8 ? '.' : '?'}`;
  return Array.from({ length: paragraphs }, () =>
    Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
      Array.from({ length: 1 + Math.floor(next() * 6) }, sentence).join(' '),
    ).join('\n'),
  ).join('\n\n\n');
}

/** Every word of the text, in order, with the separators dropped. */
const words = (text: string): string[] => text.split(/\s+/).filter((w) => w !== '');

/** The passages without the overlap each one repeats from the one before. */
function bodies(chunks: readonly string[], overlap: number): string[] {
  return chunks.map((chunk, i) => {
    if (i === 0) return chunk;
    const before = chunks[i - 1] ?? '';
    // The longest end of the passage before (within the overlap) that this one starts with.
    for (let n = Math.min(overlap, before.length); n > 0; n -= 1) {
      const end = before.slice(before.length - n);
      if (chunk.startsWith(`${end} `)) return chunk.slice(n + 1);
    }
    return chunk;
  });
}

describe('normaliseText', () => {
  it('makes line breaks, spaces and blank lines regular', () => {
    expect(normaliseText('  One\t two \r\nthree\r\n\r\n\r\n\r\nfour  \n')).toBe(
      'One two\nthree\n\nfour',
    );
    expect(normaliseText(' \n\t\n ')).toBe('');
  });
});

describe('chunkText', () => {
  it('answers no passages for no text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('\n \n')).toEqual([]);
  });

  it('keeps a short text whole', () => {
    expect(chunkText('The pump runs on 5 HP.\n\nIt needs a borewell.')).toEqual([
      'The pump runs on 5 HP.\n\nIt needs a borewell.',
    ]);
  });

  it('cuts at paragraphs first, and repeats the end of a passage at the start of the next', () => {
    const a = `First paragraph ${'about pumps '.repeat(5).trim()}.`;
    const b = `Second paragraph ${'about panels '.repeat(4).trim()}.`;
    const chunks = chunkText(`${a}\n\n${b}`, { maxChars: 100, overlapChars: 20 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(a);
    // The last 20 characters of the first passage, from its first whole word.
    expect(chunks[1]).toBe(`pumps about pumps. ${b}`);
  });

  it('cuts a long paragraph by sentence, then by word, then by character', () => {
    const sentences = 'One two three. Four five six. Seven eight nine.';
    expect(chunkText(sentences, { maxChars: 20, overlapChars: 0 })).toEqual([
      'One two three.',
      'Four five six.',
      'Seven eight nine.',
    ]);
    expect(chunkText('alpha beta gamma delta', { maxChars: 11, overlapChars: 0 })).toEqual([
      'alpha beta',
      'gamma delta',
    ]);
    expect(chunkText('a'.repeat(25), { maxChars: 10, overlapChars: 0 })).toEqual([
      'a'.repeat(10),
      'a'.repeat(10),
      'a'.repeat(5),
    ]);
  });

  it('never cuts inside a character written with two code units', () => {
    const chunks = chunkText('\u{1F31E}'.repeat(7), { maxChars: 4, overlapChars: 0 });
    expect(chunks).toEqual(['\u{1F31E}\u{1F31E}', '\u{1F31E}\u{1F31E}', '\u{1F31E}\u{1F31E}', '\u{1F31E}']);
  });

  it('refuses an overlap as long as a passage', () => {
    expect(() => chunkText('text', { maxChars: 10, overlapChars: 10 })).toThrow();
  });

  it('keeps every passage within the limit and every word in order, over many documents', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const text = document(seed, 1 + (seed % 20));
      const options = seed % 2 === 0 ? KNOWLEDGE_CHUNKING : { maxChars: 120, overlapChars: 30 };
      const chunks = chunkText(text, options);
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(options.maxChars);
        expect(chunk.trim()).toBe(chunk);
        expect(chunk).not.toBe('');
      }
      // With the overlaps taken off, the passages hold the text's words exactly, in order.
      expect(words(bodies(chunks, options.overlapChars).join(' '))).toEqual(words(text));
    }
  });
});
