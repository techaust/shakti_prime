/**
 * An item's serial pattern (phase3 §6.1, C5): the source of a JavaScript regular expression that a
 * scanned serial must match whole, to catch a scan of the wrong code (a model number, a barcode).
 * It is compiled with the `u` flag and anchored here (`^(?:…)$`), so the person writes only the
 * shape (`SP[0-9]{8}`). Pure, for the contracts, the domain and the browser alike.
 */

/** Why a pattern is refused; `undefined` when it is accepted. */
export type SerialPatternProblem = 'too_long' | 'not_compiling' | 'matches_empty' | 'nested_repeat';

/** The longest pattern accepted, as `items_serial_pattern_check` holds it. */
const MAX_LENGTH = 200;

/** The longest serial a pattern is tried against: a longer one never matches. */
export const SERIAL_MAX_LENGTH = 100;

/**
 * A repeat around a group that itself repeats (`(a+)+`, `(\d*)*`, `(x{2,})+`): such a pattern can
 * take exponential time on a serial that almost matches, so it is refused. Read on the source with
 * escaped characters and character classes blanked out, which hold no group.
 */
function hasNestedRepeat(source: string): boolean {
  const plain = source.replace(/\\./g, '_').replace(/\[(?:\\.|[^\]\\])*\]/g, '_');
  // Whether each open group holds a repeat, innermost last.
  const open: boolean[] = [];
  // Whether the group closed by the character before held a repeat; undefined after any other.
  let closed: boolean | undefined;
  for (let i = 0; i < plain.length; i += 1) {
    const ch = plain[i];
    if (ch === '(') {
      open.push(false);
      closed = undefined;
      continue;
    }
    if (ch === ')') {
      closed = open.pop() ?? false;
      if (closed && open.length > 0) open[open.length - 1] = true;
      continue;
    }
    // `*`, `+` and a range `{n,}` or `{n,m}` repeat; an exact count `{n}` does not.
    const brace = ch === '{' ? /^\{\d*(,\d*)?\}/.exec(plain.slice(i)) : null;
    if (ch === '*' || ch === '+' || brace?.[1] !== undefined) {
      if (closed === true) return true;
      if (open.length > 0) open[open.length - 1] = true;
    }
    if (brace !== null && brace !== undefined) i += brace[0].length - 1;
    closed = undefined;
  }
  return false;
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
 * Whether a pattern may be kept: at most 200 characters, compiling with the `u` flag, never
 * matching an empty serial, and with no repeat around a repeating group.
 */
export function serialPatternProblem(source: string): SerialPatternProblem | undefined {
  if (source.length > MAX_LENGTH) return 'too_long';
  const pattern = compileSerialPattern(source);
  if (pattern === undefined) return 'not_compiling';
  if (hasNestedRepeat(source)) return 'nested_repeat';
  if (pattern.test('')) return 'matches_empty';
  return undefined;
}

/**
 * Whether `serial` fits the pattern: always, for an item with none; never, for a pattern that no
 * longer compiles or a serial longer than `SERIAL_MAX_LENGTH`.
 */
export function serialFitsPattern(pattern: string | null, serial: string): boolean {
  if (pattern === null) return true;
  if (serial.length > SERIAL_MAX_LENGTH) return false;
  return compileSerialPattern(pattern)?.test(serial) ?? false;
}
