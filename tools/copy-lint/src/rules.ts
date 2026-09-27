// Copy rules from DESIGN.md §11. Pure functions; the CLI in index.ts applies them to files.

/** Words that never appear on screen (DESIGN.md §11.2). Matched whole-word, case-insensitive. */
export const BANNED_PHRASES = [
  'error code',
  'exception',
  'stack trace',
  'null',
  'undefined',
  'NaN',
  'payload',
  'request',
  'response',
  'API',
  'webhook',
  'token',
  'session expired',
  'sync failed',
  'cache',
  'timeout',
  'server',
  'database',
  'RLS',
  'entity_id',
  'DTO',
  'JSON',
  'UUID',
  'invalid',
  'unauthorized',
  'forbidden',
  '403',
  '404',
  '500',
  'Supabase',
  'Vercel',
  'Meta',
  'Exotel',
  'LiveKit',
  'Claude',
  'Lorem ipsum',
  'TODO',
  'TBD',
  'placeholder',
  'sample',
  'dummy',
  'foo',
  'bar',
  'test',
  'coming soon',
  'example',
  'insert text here',
] as const;

const BANNED_REGEX = BANNED_PHRASES.map((phrase) => ({
  phrase,
  regex: new RegExp(
    `(?<![\\p{L}\\p{N}_])${phrase.replaceAll(' ', '\\s+')}(?![\\p{L}\\p{N}_])`,
    'iu',
  ),
}));

const DEVANAGARI = /\p{Script=Devanagari}/u;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Visible characters, so a letter with combining marks counts once (DESIGN.md §11.4). */
export function graphemeCount(value: string): number {
  return Array.from(segmenter.segment(value)).length;
}

const ICU_HEAD = /^\{\s*\w+\s*,\s*(?:plural|select|selectordinal)\s*,/;

/** The end of the brace group that opens at `start`, or -1 when it never closes. */
function closingBrace(value: string, start: number): number {
  let depth = 0;
  for (let i = start; i < value.length; i += 1) {
    if (value[i] === '{') depth += 1;
    else if (value[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every wording a message can show: each branch of a plural or select (`{count, plural, one {…}
 * other {…}}`) in turn, so a length limit measures what a person reads, not the pattern.
 */
export function messageVariants(value: string, limit = 64): string[] {
  for (let start = value.indexOf('{'); start !== -1; start = value.indexOf('{', start + 1)) {
    const head = ICU_HEAD.exec(value.slice(start));
    if (!head) continue;
    const end = closingBrace(value, start);
    if (end === -1) return [value];
    const branches: string[] = [];
    let i = start + head[0].length;
    while (i < end) {
      const open = value.indexOf('{', i);
      if (open === -1 || open > end) break;
      const close = closingBrace(value, open);
      if (close === -1 || close > end) break;
      branches.push(value.slice(open + 1, close));
      i = close + 1;
    }
    if (branches.length === 0) return [value];
    const out: string[] = [];
    for (const branch of branches) {
      for (const v of messageVariants(
        value.slice(0, start) + branch + value.slice(end + 1),
        limit,
      )) {
        if (out.length < limit) out.push(v);
      }
    }
    return out;
  }
  return [value];
}

export interface LengthLimit {
  keyPattern: string;
  max: number;
}

export interface Issue {
  key: string;
  locale: string;
  reason: string;
}

/** Flattens nested catalogue JSON into dotted keys. */
export function flatten(value: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === 'string') {
    out.set(prefix, value);
    return out;
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = prefix ? `${prefix}.${k}` : k;
      for (const [fk, fv] of flatten(v, key)) out.set(fk, fv);
    }
    return out;
  }
  out.set(prefix, String(value));
  return out;
}

export function checkString(
  key: string,
  value: string,
  locale: string,
  limits: readonly LengthLimit[] = [],
): Issue[] {
  const issues: Issue[] = [];
  if (value.trim() === '') issues.push({ key, locale, reason: 'empty string' });
  for (const { phrase, regex } of BANNED_REGEX) {
    if (regex.test(value)) issues.push({ key, locale, reason: `banned word "${phrase}"` });
  }
  if (value.includes('!')) issues.push({ key, locale, reason: 'exclamation mark' });
  // Screens, messages and documents are English; Hinglish is written in Roman letters (ADR 0014).
  if (DEVANAGARI.test(value)) issues.push({ key, locale, reason: 'Devanagari text' });
  for (const limit of limits) {
    const longest = Math.max(...messageVariants(value).map(graphemeCount));
    if (new RegExp(limit.keyPattern).test(key) && longest > limit.max) {
      issues.push({ key, locale, reason: `longer than ${limit.max} characters` });
    }
  }
  return issues;
}

/** Every key must exist in every catalogue of a set, such as the `hinglish` and `en` caller scripts. */
export function checkParity(catalogues: ReadonlyMap<string, ReadonlyMap<string, string>>): Issue[] {
  const issues: Issue[] = [];
  const allKeys = new Set<string>();
  for (const keys of catalogues.values()) for (const k of keys.keys()) allKeys.add(k);
  for (const [locale, keys] of catalogues) {
    for (const k of allKeys) {
      if (!keys.has(k)) issues.push({ key: k, locale, reason: 'missing in this language' });
    }
  }
  return issues;
}

export function checkCatalogues(
  catalogues: ReadonlyMap<string, ReadonlyMap<string, string>>,
  limits: readonly LengthLimit[] = [],
): Issue[] {
  const issues = checkParity(catalogues);
  for (const [locale, keys] of catalogues) {
    for (const [key, value] of keys) issues.push(...checkString(key, value, locale, limits));
  }
  return issues;
}
