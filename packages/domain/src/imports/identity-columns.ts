import { isAadhaarNumber } from '../privacy/identity-numbers';
import { findPersonalNumbers, replaceNumbers, type FoundNumber } from '../privacy/number-shapes';

/**
 * An import never keeps an identity number (BLUEPRINT §7.5, SECURITY §5; audit SEC-1). Before the
 * rows of a file are stored, or shown on its preview, every column that holds Aadhaar numbers is
 * left out whole, and the run of digits holding an Aadhaar number inside any other cell keeps only
 * its last four digits. A number is read as the log and audit scrubber reads it
 * (`findPersonalNumbers`): twelve digits, the first 2 to 9, in any grouping, in any script's
 * digits, with any separator people use or an invisible character between, touching letters or
 * not.
 */
/** The most letters a cell may hold besides its number and still be that number: "UID no." */
const LABEL_LETTERS = 10;

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
  // Letters and the vowel signs of the Indian scripts, which Unicode counts as marks.
  const word = header.toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
  return (
    /a?adh+a+r/.test(word) ||
    /^uid(?:ai)?(?:no|number|num)?$/.test(word) ||
    // आधार (Hindi) and આધાર (Gujarati), written as escapes so no source file carries the script.
    word.includes('\u0906\u0927\u093e\u0930') ||
    word.includes('\u0a86\u0aa7\u0abe\u0ab0')
  );
}

/**
 * A header or key that names a phone number, whose twelve digits beginning 91 are a mobile's: read
 * without case, spaces or signs, in any script ("Ph", "Ph. No.", "Phone No", "Mobile No",
 * "Contact", "Number", "WhatsApp", and phone and mobile in Hindi and Gujarati).
 */
export function namesPhone(header: string): boolean {
  const word = header.toLowerCase().replace(/[^\p{L}\p{M}]/gu, '');
  return (
    /phone|mobile|whatsapp|contact|^cell|^mob|^ph(?:no|num|number)?$|^(?:no|number|num)$/u.test(
      word,
    ) ||
    // फोन, फ़ोन and मोबाइल (Hindi), ફોન and મોબાઇલ (Gujarati), as escapes.
    /\u092b\u093c?\u094b\u0928|\u092e\u094b\u092c\u093e\u0907\u0932|\u0aab\u0acb\u0aa8|\u0aae\u0acb\u0aac\u0abe\u0a87\u0ab2/u.test(
      word,
    )
  );
}

/**
 * Whether a cell is a phone number, alone or after a short label: a mobile or landline, or 91 and
 * a mobile number, rather than text that has one inside it.
 */
function isPhoneCell(cell: string): boolean {
  const found = findPersonalNumbers(cell);
  if (found.length === 0 || !found.every((n) => n.kind === 'phone' || n.alsoPhone)) return false;
  const rest = replaceNumbers(cell, found, () => ' ');
  return !/\p{N}/u.test(rest) && (rest.match(/\p{L}/gu) ?? []).length <= LABEL_LETTERS;
}

/**
 * Whether a column holds phone numbers: its header names one, or most of its filled cells are one
 * (so a column of 91 and a mobile number is read as phones under any header).
 */
function phoneColumnAt(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  k: number,
): boolean {
  if (namesPhone(columns[k] ?? '')) return true;
  let filled = 0;
  let phones = 0;
  for (const row of rows) {
    const cell = row[k] ?? '';
    if (cell === '') continue;
    filled += 1;
    if (isPhoneCell(cell)) phones += 1;
  }
  return filled > 0 && phones * 2 > filled;
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

/**
 * Whether a cell is an Aadhaar number, alone or after a short label, rather than text that has
 * one inside it (an address, a note).
 */
function isAadhaarCell(cell: string, phoneColumn: boolean): boolean {
  const found = aadhaarNumbers(cell, phoneColumn);
  if (found.length !== 1) return found.length > 1;
  const rest = replaceNumbers(cell, found, () => ' ');
  return !/\p{N}/u.test(rest) && (rest.match(/\p{L}/gu) ?? []).length <= LABEL_LETTERS;
}

/** The number as written, every digit but the last four replaced by X, its separators kept. */
function lastFourOnly(written: string): string {
  const digits = (written.match(/\p{Nd}/gu) ?? []).length;
  let seen = 0;
  return written.replace(/\p{Nd}/gu, (digit) => {
    seen += 1;
    return seen <= digits - 4 ? 'X' : digit;
  });
}

/** `cell` with its Aadhaar numbers masked, and whether any was. */
function masked(cell: string, phoneColumn: boolean): { text: string; changed: boolean } {
  const found = aadhaarNumbers(cell, phoneColumn);
  if (found.length === 0) return { text: cell, changed: false };
  return {
    text: replaceNumbers(cell, found, (_, written) => lastFourOnly(written)),
    changed: true,
  };
}

/** `text` with every Aadhaar number in it masked to its last four digits (a file's name, a header). */
export function maskIdentityText(text: string): string {
  return masked(text, false).text;
}

/**
 * The file's columns and rows without identity numbers. A column is left out when its header
 * names an Aadhaar number or holds one (a file with no header row, whose first person's row was
 * read as the header), or when most of its filled cells are one (alone, or after a short label
 * such as "UID"); the names of the columns left out keep only the last four digits of any number
 * in them. Every other cell keeps only the last four digits of the run of digits that holds an
 * Aadhaar number. A column of phone numbers (`phoneColumnAt`) reads twelve digits beginning 91 as
 * a mobile number. Applying it again changes nothing.
 */
export function withoutIdentityNumbers(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): WithoutIdentityNumbers {
  const phones = columns.map((_, k) => phoneColumnAt(columns, rows, k));
  const leftOut = columns.map((name, k) => {
    if (namesAadhaar(name) || aadhaarNumbers(name, false).length > 0) return true;
    let filled = 0;
    let holding = 0;
    for (const row of rows) {
      const cell = row[k] ?? '';
      if (cell === '') continue;
      filled += 1;
      if (isAadhaarCell(cell, phones[k] === true)) holding += 1;
    }
    return filled > 0 && holding * 2 > filled;
  });
  const kept = columns.flatMap((_, k) => (leftOut[k] === true ? [] : [k]));
  const cells = maskCells(
    kept.map((k) => phones[k] === true),
    rows.map((row) => kept.map((k) => row[k] ?? '')),
  );
  return {
    columns: kept.map((k) => columns[k] ?? ''),
    rows: cells.rows,
    leftOutColumns: columns.filter((_, k) => leftOut[k] === true).map(maskIdentityText),
    maskedValues: cells.maskedValues,
  };
}

/**
 * The columns whose header names or holds an Aadhaar number left out, without reading a cell: the
 * check `imports.job.create` makes of rows `parseImportFile()` already filtered, at no cost inside
 * its transaction. The names of the columns left out keep only the last four digits of a number.
 */
export function withoutIdentityHeaders(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): { columns: string[]; rows: string[][]; leftOutColumns: string[] } {
  const leftOut = columns.map(
    (name) => namesAadhaar(name) || aadhaarNumbers(name, false).length > 0,
  );
  if (!leftOut.includes(true)) {
    return { columns: [...columns], rows: rows.map((row) => [...row]), leftOutColumns: [] };
  }
  const kept = columns.flatMap((_, k) => (leftOut[k] === true ? [] : [k]));
  return {
    columns: kept.map((k) => columns[k] ?? ''),
    rows: rows.map((row) => {
      const cells = kept.map((k) => row[k] ?? '');
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      return cells;
    }),
    leftOutColumns: columns.filter((_, k) => leftOut[k] === true).map(maskIdentityText),
  };
}

/** Every cell masked, column by column, and rows without blanks at their end. */
function maskCells(
  phoneColumns: readonly boolean[],
  rows: readonly (readonly string[])[],
): { rows: string[][]; maskedValues: number } {
  let maskedValues = 0;
  const out = rows.map((row) => {
    const cells = row.map((cell, k) => {
      const result = masked(cell, phoneColumns[k] === true);
      if (result.changed) maskedValues += 1;
      return result.text;
    });
    // A row keeps no blanks at its end, as the parser gives it.
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells;
  });
  return { rows: out, maskedValues };
}

/**
 * The cells of rows whose columns are already decided (a later part of a large job in the one-off
 * pass), each Aadhaar number masked to its last four digits; no column is left out.
 */
export function maskIdentityCells(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): { rows: string[][]; maskedValues: number } {
  return maskCells(
    columns.map((_, k) => phoneColumnAt(columns, rows, k)),
    rows,
  );
}

/**
 * A stored value (a row's checked input, `normalised_json`) with every Aadhaar number in its
 * strings masked to its last four digits, at any depth; a string under a key that names a phone
 * reads twelve digits beginning 91 as the phone. Answers how many strings changed.
 */
export function maskIdentityValue(value: unknown, key = ''): { value: unknown; masked: number } {
  if (typeof value === 'string') {
    const result = masked(value, namesPhone(key));
    return { value: result.text, masked: result.changed ? 1 : 0 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const out = value.map((item) => {
      const result = maskIdentityValue(item, key);
      count += result.masked;
      return result.value;
    });
    return { value: out, masked: count };
  }
  if (value !== null && typeof value === 'object') {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const result = maskIdentityValue(v, k);
      count += result.masked;
      out[k] = result.value;
    }
    return { value: out, masked: count };
  }
  return { value, masked: 0 };
}
