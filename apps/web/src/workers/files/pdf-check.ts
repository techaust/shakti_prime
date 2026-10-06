import { inflateSync } from 'node:zlib';

/**
 * The PDF check before a file is usable (docs/07-security.md §8). It fails closed: whatever it cannot
 * read, it refuses.
 *
 * A PDF must start with its header and end with its end-of-file marker, and must name no script
 * (`/JavaScript`, `/JS`), no launch action (`/Launch`), no embedded file (`/EmbeddedFile`,
 * `/EmbeddedFiles`), no form script (`/XFA`), no rich media (`/RichMedia`) and no additional
 * action (`/AA`); an `/OpenAction` is refused through the action it carries, which is one of
 * those names. Names are read with their `#xx` escapes decoded, in the file and inside every
 * stream, each stream read by its own dictionary:
 * - a stream with no filter is read as it is;
 * - a stream with the one filter `/FlateDecode` and no `/DecodeParms` (so no predictor) is
 *   unpacked, within one budget for the whole file, and read;
 * - an image (`/Subtype /Image`, and not an object or cross-reference stream) is skipped whatever
 *   its filter: a viewer only ever draws its bytes as pixels, never reads them as PDF objects;
 * - every other stream, a filter chain, any other filter (ASCIIHexDecode among them), decode
 *   parameters, a stream that does not unpack or runs over the budget, or a dictionary the check
 *   cannot find, refuses the file as unreadable.
 */
export type PdfCheck =
  { ok: true } | { ok: false; reason: 'file_unreadable' | 'file_pdf_active_content' };

const ACTIVE = new Set([
  'JavaScript',
  'JS',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'XFA',
  'RichMedia',
  'AA',
]);

/** The most the compressed streams of one file may unpack to, together. */
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

const NAME = /\/([^\s/[\]<>(){}%]+)/g;
const UNREADABLE: PdfCheck = { ok: false, reason: 'file_unreadable' };
const ACTIVE_CONTENT: PdfCheck = { ok: false, reason: 'file_pdf_active_content' };

function decodeName(raw: string): string {
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function names(text: string): string[] {
  return [...text.matchAll(NAME)].flatMap((m) => (m[1] === undefined ? [] : [decodeName(m[1])]));
}

function namesActive(text: string): boolean {
  return names(text).some((name) => ACTIVE.has(name));
}

/**
 * The dictionary that ends just before `end` (the `stream` keyword), found by matching its `<<`
 * and `>>` from the back, so a nested dictionary (`/DecodeParms << … >>`) stays inside it.
 */
function dictionaryBefore(text: string, end: number): string | undefined {
  let i = end;
  while (i > 0 && /\s/.test(text.charAt(i - 1))) i -= 1;
  if (text.slice(i - 2, i) !== '>>') return undefined;
  let depth = 0;
  for (let j = i; j >= 2;) {
    const pair = text.slice(j - 2, j);
    if (pair === '>>') {
      depth += 1;
      j -= 2;
    } else if (pair === '<<') {
      depth -= 1;
      j -= 2;
      if (depth === 0) return text.slice(j, i);
    } else {
      j -= 1;
    }
  }
  return undefined;
}

/** The value of `/Filter` as its names, `[]` without one, undefined when it cannot be read. */
function filtersOf(dictionary: string): string[] | undefined {
  const at = /\/Filter(?![A-Za-z0-9])/.exec(dictionary);
  if (at === null) return [];
  const rest = dictionary.slice(at.index + at[0].length).trimStart();
  if (rest.startsWith('[')) {
    const close = rest.indexOf(']');
    if (close < 0) return undefined;
    return names(rest.slice(1, close));
  }
  const single = /^\/([^\s/[\]<>(){}%]+)/.exec(rest);
  return single?.[1] === undefined ? undefined : [decodeName(single[1])];
}

type StreamCheck = 'read' | 'skip' | 'refuse';

/** How one stream is read, by its own dictionary. */
function streamRule(dictionary: string): { rule: StreamCheck; flate: boolean } {
  const keys = new Set(names(dictionary));
  const image = keys.has('Image') && /\/Subtype\s*\/Image/.test(dictionary);
  const structural = keys.has('ObjStm') || keys.has('XRef');
  if (image && !structural) return { rule: 'skip', flate: false };
  const filters = filtersOf(dictionary);
  if (filters === undefined) return { rule: 'refuse', flate: false };
  if (filters.length === 0) return { rule: 'read', flate: false };
  const bare = filters.length === 1 && filters[0] === 'FlateDecode';
  const parameters = keys.has('DecodeParms') || keys.has('DP') || keys.has('Predictor');
  return bare && !parameters ? { rule: 'read', flate: true } : { rule: 'refuse', flate: false };
}

export function checkPdf(input: Uint8Array): PdfCheck {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return UNREADABLE;
  const text = bytes.toString('latin1');
  if (!text.slice(-1024).includes('%%EOF')) return UNREADABLE;
  if (namesActive(text)) return ACTIVE_CONTENT;

  let budget = MAX_INFLATED_BYTES;
  for (const match of text.matchAll(/(?<![A-Za-z])stream(\r\n|\n|\r)/g)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) return UNREADABLE;
    const dictionary = dictionaryBefore(text, match.index);
    if (dictionary === undefined) return UNREADABLE;
    const { rule, flate } = streamRule(dictionary);
    if (rule === 'skip') continue;
    if (rule === 'refuse') return UNREADABLE;
    if (!flate) continue; // Read already: an unfiltered stream is part of `text`.
    let data = bytes.subarray(start, end);
    // The end-of-line before `endstream` is not part of the data.
    if (data.at(-1) === 0x0a) data = data.subarray(0, -1);
    if (data.at(-1) === 0x0d) data = data.subarray(0, -1);
    let inflated: Buffer;
    try {
      inflated = inflateSync(data, { maxOutputLength: Math.max(1, budget) });
    } catch {
      // Damaged, cut short or over the budget: nothing in it can be vouched for.
      return UNREADABLE;
    }
    budget -= inflated.length;
    if (budget <= 0) return UNREADABLE;
    if (namesActive(inflated.toString('latin1'))) return ACTIVE_CONTENT;
  }
  return { ok: true };
}
