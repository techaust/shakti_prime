/**
 * How a vault file's text is cut into passages for search (docs/03-roadmap-appendix/phase1.md §8.4, ADR 0011).
 * A passage holds at most `maxChars` characters, about 375 tokens of English, which suits the
 * embedding model and gives the reader a passage worth reading; each passage after the first
 * starts with up to `overlapChars` characters from the end of the one before, so a sentence that
 * falls across the cut is still found whole in one of them.
 */
export const KNOWLEDGE_CHUNKING = { maxChars: 1500, overlapChars: 200 } as const;

export interface ChunkingOptions {
  maxChars: number;
  overlapChars: number;
}

/**
 * The text with its line breaks made `\n`, the spaces and tabs inside each line made one space,
 * every line trimmed, and runs of blank lines made one, so paragraphs are separated by exactly one
 * blank line.
 */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t\f\v \u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The text's pieces at the next finer cut, each kept whole with its separator dropped. */
function splitBy(text: string, level: number, limit: number): string[] {
  switch (level) {
    case 0:
      return text.split('\n\n');
    case 1:
      return text.split('\n');
    case 2:
      // After the end of a sentence, in English or with the Devanagari full stop.
      return text.split(/(?<=[.!?\u0964])\s+/);
    case 3:
      return text.split(' ');
    default: {
      // A run of characters with no space: cut where it must, never inside a surrogate pair.
      const out: string[] = [];
      let piece = '';
      for (const char of text) {
        if (piece !== '' && piece.length + char.length > limit) {
          out.push(piece);
          piece = '';
        }
        piece += char;
      }
      if (piece !== '') out.push(piece);
      return out;
    }
  }
}

const SEPARATORS = ['\n\n', '\n', ' ', ' ', ''];

/**
 * Packs the pieces of `text` into bodies of at most `limit` characters, the pieces joined as they
 * were (a blank line between paragraphs, a line break between lines, a space between sentences
 * and words); a piece longer than the limit is cut at the next finer level.
 */
function pack(text: string, limit: number, level: number, out: string[]): void {
  const separator = SEPARATORS[level] ?? '';
  let body = '';
  const flush = () => {
    if (body !== '') out.push(body);
    body = '';
  };
  for (const piece of splitBy(text, level, limit)) {
    if (piece === '') continue;
    // The last level's pieces are as short as the characters allow, so they are never cut again.
    if (piece.length > limit && level < SEPARATORS.length - 1) {
      flush();
      pack(piece, limit, level + 1, out);
      continue;
    }
    const joined = body === '' ? piece : `${body}${separator}${piece}`;
    if (joined.length <= limit) {
      body = joined;
    } else {
      flush();
      body = piece;
    }
  }
  flush();
}

/** The end of a passage to repeat at the start of the next: whole words, at most `max` characters. */
function tail(body: string, max: number): string {
  if (max <= 0 || body.length <= max) return max <= 0 ? '' : body;
  const end = body.slice(body.length - max);
  const space = end.search(/\s/);
  return space < 0 ? '' : end.slice(space + 1).trimStart();
}

/**
 * Cuts a vault file's text into passages for search: paragraph by paragraph where they fit, then
 * line by line, sentence by sentence and word by word, never more than `maxChars` characters, the
 * passages after the first starting with the end of the one before. No text, no passages.
 */
export function chunkText(text: string, options: ChunkingOptions = KNOWLEDGE_CHUNKING): string[] {
  const { maxChars, overlapChars } = options;
  if (maxChars < 1 || overlapChars < 0 || overlapChars >= maxChars) {
    throw new Error('a passage must be longer than its overlap');
  }
  const clean = normaliseText(text);
  if (clean === '') return [];
  // Room for the overlap and the space that joins it, so a passage never passes maxChars.
  const bodyLimit = overlapChars === 0 ? maxChars : maxChars - overlapChars - 1;
  const bodies: string[] = [];
  pack(clean, bodyLimit, 0, bodies);
  return bodies.map((body, i) => {
    const before = i === 0 ? '' : tail(bodies[i - 1] ?? '', overlapChars);
    return before === '' ? body : `${before} ${body}`;
  });
}
