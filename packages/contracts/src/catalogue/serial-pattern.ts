/**
 * An item's serial pattern (phase3 §6.1, C5): the shape a scanned serial must have whole, to catch
 * a scan of the wrong code (a model number, a barcode). It is written in a small, safe part of
 * JavaScript's regular expressions, checked by `parseSerialPattern()`, then compiled with the `u`
 * flag and anchored here (`^(?:…)$`), so the person writes only the shape (`SP[0-9]{8}`). Pure,
 * for the contracts, the domain and the browser alike.
 *
 * The safe part: literal characters, `.`, `\d`, `\w`, an escaped sign (`\.`, `\+`), and character
 * classes `[...]` of listed characters and ascending ranges, with no class inside and no `\s`;
 * each may be followed by one quantifier, `?`, `+`, `*`, `{n}` or `{m,n}` (up to 64). No groups,
 * no alternation, no back-references, no lookaround, no anchors (the code adds them). With no
 * group a repeat holds one atom, so a match never goes back over nested choices; and the pattern
 * holds at most two repeats whose length varies, one of them unbounded, so even repeats of
 * overlapping atoms try at most some ten thousand ways on the longest serial (100 characters):
 * well under a millisecond (`serial-pattern.test.ts` times the slowest).
 */

/** Why a pattern is refused; `undefined` when it is accepted. */
export type SerialPatternProblem = 'too_long' | 'unsupported' | 'not_compiling' | 'matches_empty';

/** The longest pattern accepted, as `items_serial_pattern_check` holds it. */
const MAX_LENGTH = 200;

/** The longest serial a pattern is tried against: a longer one never matches. */
export const SERIAL_MAX_LENGTH = 100;

/** The largest count a `{n}` or `{m,n}` takes. */
const MAX_COUNT = 64;

/** Repeats whose length varies (`?`, `+`, `*`, `{m,n}` with m < n), and of those unbounded ones. */
const MAX_VARIABLE_REPEATS = 2;
const MAX_UNBOUNDED_REPEATS = 1;

/** Signs that stand for themselves only when escaped; `\-` is one only inside a class (`u`). */
const ESCAPABLE = new Set([...'\\^$.|?*+()[]{}/']);

/** Signs that a pattern may not use bare: groups, alternation, anchors and stray brackets. */
const REFUSED_BARE = new Set([...'()|^$]}']);

/**
 * Reads one escape at `i` (just after a backslash): `\d`, `\w` or an escaped sign. Answers how many
 * characters it took, or undefined for any other (`\s`, `\b`, a back-reference, `\p{…}`).
 */
function escapeAt(source: string, i: number, inClass = false): number | undefined {
  const ch = source[i];
  if (ch === undefined) return undefined;
  return ch === 'd' || ch === 'w' || ESCAPABLE.has(ch) || (inClass && ch === '-') ? 1 : undefined;
}

/**
 * Reads a character class from `start` (its `[`): an optional leading `^`, then characters,
 * ascending ranges and the escapes `\d`, `\w` or an escaped sign, up to the closing `]`. Answers
 * the index after it, or undefined for a class that is empty, unclosed, nested or holds anything
 * else.
 */
function classEnd(source: string, start: number): number | undefined {
  let i = start + 1;
  if (source[i] === '^') i += 1;
  let members = 0;
  // The last single character read, which a following `-` makes the start of a range.
  let previous: string | undefined;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ']') return members > 0 ? i + 1 : undefined;
    if (ch === '[') return undefined;
    if (ch === '\\') {
      const taken = escapeAt(source, i + 1, true);
      if (taken === undefined) return undefined;
      const escaped = source[i + 1] ?? '';
      previous = escaped === 'd' || escaped === 'w' ? undefined : escaped;
      i += 1 + taken;
      members += 1;
      continue;
    }
    const next = source[i + 1];
    if (ch === '-' && previous !== undefined && next !== undefined && next !== ']') {
      // A range: its end must be a plain character after its start.
      const end = next === '\\' ? source[i + 2] : next;
      if (end === undefined || end === 'd' || end === 'w' || end < previous) return undefined;
      i += next === '\\' ? 3 : 2;
      previous = undefined;
      continue;
    }
    previous = ch;
    i += 1;
    members += 1;
  }
  return undefined;
}

/**
 * Reads a quantifier at `i`, if there is one: answers how many characters it took and whether
 * the length it repeats varies or is unbounded; `null` when none starts here; undefined for one
 * outside the safe part (`{n,}`, a count over 64, `{m,n}` with m > n, or a lazy or doubled
 * quantifier).
 */
function quantifierAt(
  source: string,
  i: number,
): { taken: number; variable: boolean; unbounded: boolean } | null | undefined {
  const ch = source[i];
  let found: { taken: number; variable: boolean; unbounded: boolean } | null = null;
  if (ch === '?') found = { taken: 1, variable: true, unbounded: false };
  else if (ch === '+' || ch === '*') found = { taken: 1, variable: true, unbounded: true };
  else if (ch === '{') {
    const count = /^\{(\d{1,2})(?:,(\d{1,2}))?\}/.exec(source.slice(i));
    if (count === null) return undefined;
    const least = Number(count[1]);
    const most = count[2] === undefined ? least : Number(count[2]);
    if (most > MAX_COUNT || least > most) return undefined;
    found = { taken: count[0].length, variable: least < most, unbounded: false };
  }
  if (found === null) return null;
  // A quantifier after a quantifier (`a+?`, `a{2}+`) is lazy or doubled: outside the safe part.
  const after = source[i + found.taken];
  if (after === '?' || after === '+' || after === '*' || after === '{') return undefined;
  return found;
}

/**
 * Whether a pattern keeps to the safe part described at the top of this file: atoms one after
 * another, each with at most one quantifier, and no more than the allowed variable repeats.
 */
export function parseSerialPattern(source: string): boolean {
  let variable = 0;
  let unbounded = 0;
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    let atomEnd: number | undefined;
    if (ch === '\\') {
      const taken = escapeAt(source, i + 1);
      atomEnd = taken === undefined ? undefined : i + 1 + taken;
    } else if (ch === '[') {
      atomEnd = classEnd(source, i);
    } else if (ch === '?' || ch === '+' || ch === '*' || ch === '{' || REFUSED_BARE.has(ch)) {
      // A quantifier with no atom before it, or a group, alternation, anchor or stray bracket.
      atomEnd = undefined;
    } else {
      atomEnd = i + 1;
    }
    if (atomEnd === undefined) return false;
    const quantifier = quantifierAt(source, atomEnd);
    if (quantifier === undefined) return false;
    i = atomEnd + (quantifier?.taken ?? 0);
    if (quantifier?.variable === true) variable += 1;
    if (quantifier?.unbounded === true) unbounded += 1;
    if (variable > MAX_VARIABLE_REPEATS || unbounded > MAX_UNBOUNDED_REPEATS) return false;
  }
  return true;
}

/** The pattern compiled and anchored, or `undefined` when it does not compile. */
export function compileSerialPattern(source: string): RegExp | undefined {
  try {
    return new RegExp(`^(?:${source})$`, 'u');
  } catch {
    return undefined;
  }
}

/**
 * Whether a pattern may be kept: at most 200 characters, within the safe part
 * (`parseSerialPattern`), compiling with the `u` flag, and never matching an empty serial.
 */
export function serialPatternProblem(source: string): SerialPatternProblem | undefined {
  if (source.length > MAX_LENGTH) return 'too_long';
  if (!parseSerialPattern(source)) return 'unsupported';
  const pattern = compileSerialPattern(source);
  if (pattern === undefined) return 'not_compiling';
  if (pattern.test('')) return 'matches_empty';
  return undefined;
}

/**
 * Whether `serial` fits the pattern: always, for an item with none; never, for a pattern outside
 * the safe part (one stored before the rule, or written past the commands) or a serial longer than
 * `SERIAL_MAX_LENGTH`.
 */
export function serialFitsPattern(pattern: string | null, serial: string): boolean {
  if (pattern === null) return true;
  if (serial.length > SERIAL_MAX_LENGTH || !parseSerialPattern(pattern)) return false;
  return compileSerialPattern(pattern)?.test(serial) ?? false;
}
