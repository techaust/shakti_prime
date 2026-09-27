// Turns OCR output (lines of words with character boxes) into the rectangles to cover on the
// image and the masked text. Pure, so it is tested without the OCR engine.
import {
  AADHAAR_VISIBLE_FROM,
  maskLine,
  normalizeOcrDigits,
  summarizeSpans,
  type IdentityNumberSpan,
  type MaskedText,
} from '@shakti/domain';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrSymbol {
  text: string;
  bbox: Box;
}

export interface OcrWord {
  text: string;
  bbox: Box;
  symbols: OcrSymbol[];
}

export interface OcrLine {
  words: OcrWord[];
}

export interface MaskPlan {
  rects: Box[];
  masked: MaskedText;
  /** The hidden digits of each number found. In memory only; never log or store them. */
  hiddenDigits: string[];
}

/**
 * `text` with every number-like word whose digits belong to a hidden part replaced by X. Used
 * when one reading of a photo found a number that another reading, whose text is kept, did
 * not recognise.
 */
export function scrubHiddenDigits(text: string, hiddenDigits: string[]): string {
  if (hiddenDigits.length === 0) return text;
  const normalized = normalizeOcrDigits(text);
  return text.replace(/[^\s]+/g, (word, offset: number) => {
    const digits = normalized.slice(offset, offset + word.length).replace(/\D/g, '');
    if (digits.length < 3 || !hiddenDigits.some((h) => h.includes(digits))) return word;
    return Array.from(normalized.slice(offset, offset + word.length), (c, i) =>
      /\d/.test(c) ? 'X' : (word[i] ?? c),
    ).join('');
  });
}

// Extra cover around each character, as a share of the word's height, so anti-aliased edges,
// a slight tilt and the OCR's tight boxes leave no readable stroke.
const PAD_X = 0.25;
const PAD_Y = 0.3;

/** The part of `word` that holds characters `from` to `to` (inclusive, offsets in the word). */
function charBox(word: OcrWord, from: number, to: number): Box {
  const graphemes = Array.from(word.text);
  if (word.symbols.length === graphemes.length && word.symbols.length > 0) {
    const picked = word.symbols.slice(from, to + 1);
    return {
      x0: Math.min(...picked.map((s) => s.bbox.x0)),
      y0: Math.min(...picked.map((s) => s.bbox.y0)),
      x1: Math.max(...picked.map((s) => s.bbox.x1)),
      y1: Math.max(...picked.map((s) => s.bbox.y1)),
    };
  }
  // No character boxes to match: share the word's width out evenly.
  const width = (word.bbox.x1 - word.bbox.x0) / Math.max(1, graphemes.length);
  return {
    x0: word.bbox.x0 + width * from,
    y0: word.bbox.y0,
    x1: word.bbox.x0 + width * (to + 1),
    y1: word.bbox.y1,
  };
}

function pad(box: Box, word: Box): Box {
  const height = word.y1 - word.y0;
  return {
    x0: box.x0 - height * PAD_X,
    y0: Math.min(box.y0, word.y0) - height * PAD_Y,
    x1: box.x1 + height * PAD_X,
    y1: Math.max(box.y1, word.y1) + height * PAD_Y,
  };
}

/** The rectangles to cover and the masked text, line by line in reading order. */
export function planMasks(lines: OcrLine[]): MaskPlan {
  const rects: Box[] = [];
  const found: IdentityNumberSpan[] = [];
  const texts: string[] = [];
  let previous = '';
  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim() !== '');
    const starts: number[] = [];
    let text = '';
    for (const word of words) {
      if (text !== '') text += ' ';
      starts.push(text.length);
      text += word.text;
    }
    const { spans, hidden } = maskLine(text, previous);
    found.push(...spans);
    previous = text;

    // Group the hidden characters by the word they sit in.
    const byWord = new Map<number, number[]>();
    for (const offset of hidden) {
      const index = starts.findLastIndex((start) => start <= offset);
      if (index < 0) continue;
      const list = byWord.get(index) ?? [];
      list.push(offset - (starts[index] ?? 0));
      byWord.set(index, list);
    }
    for (const [index, offsets] of byWord) {
      const word = words[index];
      if (!word) continue;
      rects.push(pad(charBox(word, Math.min(...offsets), Math.max(...offsets)), word.bbox));
    }

    const chars = text.split('');
    for (const offset of hidden) chars[offset] = 'X';
    texts.push(chars.join(''));
  }
  const hiddenDigits = found.map((span) =>
    span.kind === 'bank_account'
      ? span.digits.slice(0, -4)
      : span.digits.slice(0, AADHAAR_VISIBLE_FROM),
  );
  return { rects, masked: { text: texts.join('\n'), ...summarizeSpans(found) }, hiddenDigits };
}
