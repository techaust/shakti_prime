// The scan field's rules, kept apart from its looks so they are tested on their own
// (docs/03-roadmap-appendix/phase3.md §7.2, question 8 (a)). A screen gives the field a `resolve`
// function that says what a code is for that screen: U2's receipt takes a new serial that fits the
// item's pattern; D2's picking and H3's counts, and Q1's label payloads (`parseLabelPayload()`), give
// their own. The field itself refuses a repeat and a code once the count is reached.

/** What a screen's `resolve` says of one code. */
export type ScanResolution =
  /** Taken: a new code the screen accepts (a new serial on a receipt). */
  | { verdict: 'accepted'; value?: string; label?: string }
  /** Taken: a code the system already knows (a serial in stock, a bin, a package). */
  | { verdict: 'known'; value?: string; label?: string }
  /** Refused: the system knows no such code. */
  | { verdict: 'unknown' }
  /** Refused: not the shape this screen's codes have (another barcode on the box). */
  | { verdict: 'wrong_pattern' };

export type ScanResolve = (code: string) => ScanResolution | Promise<ScanResolution>;

/** What the field shows after one scan: taken, or why not. */
export type ScanOutcome =
  | { kind: 'taken'; code: string; known: boolean; label?: string | undefined }
  | { kind: 'repeat'; code: string }
  | { kind: 'unknown'; code: string }
  | { kind: 'wrong_pattern'; code: string }
  | { kind: 'full'; code: string }
  | { kind: 'empty' };

/** A code as a scanner or a person typed it: trimmed, inner whitespace kept. */
export function cleanCode(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, '').trim();
}

/** Whether `code` is already in `codes`, in any case. */
export function isRepeat(codes: readonly string[], code: string): boolean {
  const key = code.toLowerCase();
  return codes.some((c) => c.toLowerCase() === key);
}

/**
 * One scan: the cleaned code checked for a repeat and against the count before `resolve` is asked,
 * then taken or refused as `resolve` says. Answers the codes after the scan and what to show.
 */
export async function scanOnce(
  codes: readonly string[],
  raw: string,
  resolve: ScanResolve,
  expected?: number,
): Promise<{ codes: string[]; outcome: ScanOutcome }> {
  const code = cleanCode(raw);
  if (code === '') return { codes: [...codes], outcome: { kind: 'empty' } };
  if (isRepeat(codes, code)) return { codes: [...codes], outcome: { kind: 'repeat', code } };
  if (expected !== undefined && codes.length >= expected) {
    return { codes: [...codes], outcome: { kind: 'full', code } };
  }
  const resolution = await resolve(code);
  switch (resolution.verdict) {
    case 'accepted':
    case 'known': {
      const value = resolution.value ?? code;
      if (isRepeat(codes, value)) return { codes: [...codes], outcome: { kind: 'repeat', code } };
      return {
        codes: [...codes, value],
        outcome: {
          kind: 'taken',
          code: value,
          known: resolution.verdict === 'known',
          label: resolution.label,
        },
      };
    }
    case 'unknown':
      return { codes: [...codes], outcome: { kind: 'unknown', code } };
    case 'wrong_pattern':
      return { codes: [...codes], outcome: { kind: 'wrong_pattern', code } };
  }
}

/**
 * The resolver of a receipt's serials: a code that fits the item's pattern (anchored, as
 * `serialFitsPattern()` reads one; any code when the item has none) is a new serial.
 */
export function newSerialResolver(pattern: string | null): ScanResolve {
  let compiled: RegExp | null = null;
  if (pattern !== null) {
    try {
      compiled = new RegExp(`^(?:${pattern})$`, 'u');
    } catch {
      compiled = null;
    }
  }
  return (code) =>
    compiled === null || compiled.test(code)
      ? { verdict: 'accepted' }
      : { verdict: 'wrong_pattern' };
}
