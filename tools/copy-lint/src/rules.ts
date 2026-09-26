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

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Visible characters, so a Devanagari syllable with matras counts once (DESIGN.md §11.4). */
export function graphemeCount(value: string): number {
  return Array.from(segmenter.segment(value)).length;
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
  for (const limit of limits) {
    if (new RegExp(limit.keyPattern).test(key) && graphemeCount(value) > limit.max) {
      issues.push({ key, locale, reason: `longer than ${limit.max} characters` });
    }
  }
  return issues;
}

/** Every key must exist in every locale (DESIGN.md §11.1 rule 7). */
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
