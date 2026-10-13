import { isAadhaarNumber } from '../privacy/identity-numbers';
import { findPersonalNumbers, replaceNumbers, type FoundNumber } from '../privacy/number-shapes';

/**
 * An import never keeps an identity number (BLUEPRINT §7.5, SECURITY §5; audit SEC-1). Before the
 * rows of a file are stored, or shown on its preview, every column that holds Aadhaar numbers is
 * left out whole, and an Aadhaar number written inside any other cell keeps only its last four
 * digits. A number is read as the log and audit scrubber reads it (`findPersonalNumbers`): twelve
 * digits as one run, or in groups of 4-8, 8-4 or 4-4-4, in any script's digits and with any
 * separator people use, touching letters or not.
 */
export interface WithoutIdentityNumbers {
  columns: string[];
  rows: string[][];
  /** The columns left out whole, by the names the file gave them, in the file's order. */
  leftOutColumns: string[];
  /** The cells (the header's included) in which an Aadhaar number was masked to its last four. */
  maskedValues: number;
}

/**
 * A header that names an Aadhaar number, read without case, spaces or signs: "Aadhaar", "Aadhar
 * No.", "Adhaar card number", "UID", "UID no", and the word in Hindi and Gujarati.
 */
export function namesAadhaar(header: string): boolean {
  const word = header.toLowerCase().replace(/[^\p{L}]/gu, '');
  return (
    /a?adh+a+r/.test(word) ||
    /^uid(?:ai)?(?:no|number|num)?$/.test(word) ||
    // आधार (Hindi) and આધાર (Gujarati), written as escapes so no source file carries the script.
    word.includes('आधार') ||
    word.includes('આધાર')
  );
}

/** A header that names a phone number, whose twelve digits beginning 91 are a mobile's. */
function namesPhone(header: string): boolean {
  return /phone|mobile|mob|whatsapp|contact|cell/.test(header.toLowerCase().replace(/\W/g, ''));
}

/**
 * The Aadhaar numbers of one cell. Twelve digits in one run beginning 91 and a mobile number's
 * first digit are a mobile number with its country code in a phone column, and anywhere else are
 * an Aadhaar number only when their check digit is one.
 */
function aadhaarNumbers(cell: string, phoneColumn: boolean): FoundNumber[] {
  return findPersonalNumbers(cell).filter(
    (n) => n.kind === 'aadhaar' && (!n.alsoPhone || (!phoneColumn && isAadhaarNumber(n.digits))),
  );
}

/** The number as written, every digit but the last four replaced by X, its separators kept. */
function lastFourOnly(written: string): string {
  const digits = [...written].filter((c) => /\p{Nd}/u.test(c)).length;
  let seen = 0;
  return [...written]
    .map((c) => {
      if (!/\p{Nd}/u.test(c)) return c;
      seen += 1;
      return seen <= digits - 4 ? 'X' : c;
    })
    .join('');
}

/** `cell` with its Aadhaar numbers masked, and whether any was. */
function masked(cell: string, phoneColumn: boolean): { text: string; changed: boolean } {
  const found = aadhaarNumbers(cell, phoneColumn);
  if (found.length === 0) return { text: cell, changed: false };
  return { text: replaceNumbers(cell, found, (_, written) => lastFourOnly(written)), changed: true };
}

/**
 * The file's columns and rows without identity numbers. A column is left out when its header
 * names an Aadhaar number, or when half or more of its filled cells hold one; every other cell,
 * and every header, keeps only the last four digits of an Aadhaar number written in it. Applying
 * it again changes nothing.
 */
export function withoutIdentityNumbers(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): WithoutIdentityNumbers {
  const leftOut = columns.map((name, k) => {
    if (namesAadhaar(name)) return true;
    const phoneColumn = namesPhone(name);
    let filled = 0;
    let holding = 0;
    for (const row of rows) {
      const cell = row[k] ?? '';
      if (cell === '') continue;
      filled += 1;
      if (aadhaarNumbers(cell, phoneColumn).length > 0) holding += 1;
    }
    return filled > 0 && holding * 2 >= filled;
  });
  const kept = columns.flatMap((_, k) => (leftOut[k] === true ? [] : [k]));
  let maskedValues = 0;
  const mask = (cell: string, k: number): string => {
    const result = masked(cell, namesPhone(columns[k] ?? ''));
    if (result.changed) maskedValues += 1;
    return result.text;
  };
  const keptColumns = kept.map((k) => mask(columns[k] ?? '', k));
  const keptRows = rows.map((row) => {
    const cells = kept.map((k) => mask(row[k] ?? '', k));
    // A row keeps no blanks at its end, as the parser gives it.
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  });
  return {
    columns: keptColumns,
    rows: keptRows,
    leftOutColumns: columns.filter((_, k) => leftOut[k] === true),
    maskedValues,
  };
}
