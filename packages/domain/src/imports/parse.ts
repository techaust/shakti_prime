import { DomainError, IMPORT_LIMITS, type ImportFormat } from '@shakti/contracts';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { checkZipArchive } from './zip-guard';

/** An import file read into a header and data rows, every cell a trimmed string. */
export interface ParsedImportFile {
  format: ImportFormat;
  /** Unique column names from the header row. */
  columns: string[];
  /** Data rows after the header, empty rows dropped; never wider than `columns`. */
  rows: string[][];
  /** The header's line in the file, counted from 1, for the preview. */
  headerLine: number;
}

export interface ParseLimits {
  maxFileBytes: number;
  maxUnzippedBytes: number;
  maxZipRatio: number;
  maxRows: number;
  maxColumns: number;
  maxCellLength: number;
  maxHeaderLength: number;
  headerSearchRows: number;
}

/** The reasons a file is refused; each has a sentence in the message catalogue. */
export type ImportFileReason =
  | 'import_file_too_large'
  | 'import_workbook_too_large'
  | 'import_file_empty'
  | 'import_file_type'
  | 'import_file_unreadable'
  | 'import_no_header'
  | 'import_too_many_rows'
  | 'import_too_many_columns'
  | 'import_cell_too_long';

function refuse(reason: ImportFileReason, message: string): DomainError {
  return new DomainError('validation_failed', message, { reason });
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** CSV or XLSX by content, never by the name alone; old `.xls` and other binaries are refused. */
export function detectImportFormat(bytes: Uint8Array): ImportFormat {
  if (startsWith(bytes, ZIP)) return 'xlsx';
  if (startsWith(bytes, OLE)) throw refuse('import_file_type', 'old binary spreadsheet');
  // A text file has no NUL byte in its opening kilobytes.
  if (bytes.subarray(0, 4096).includes(0)) throw refuse('import_file_type', 'binary file');
  return 'csv';
}

function readCsv(bytes: Uint8Array, limits: ParseLimits): string[][] {
  const text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  const result = Papa.parse<string[]>(text, {
    // Blank lines are kept so the header's line number is the file's; they are dropped later.
    skipEmptyLines: false,
    // One row beyond the limit is enough to know the file is too long.
    preview: limits.maxRows + limits.headerSearchRows + 1,
  });
  if (result.meta.truncated) throw refuse('import_too_many_rows', 'file is too long');
  if (result.errors.some((e) => e.type === 'Quotes')) {
    throw refuse('import_file_unreadable', 'unbalanced quotes');
  }
  return result.data;
}

/** A cell's value as the person sees it, whatever the spreadsheet stored. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part: { text?: unknown }) => cellText(part.text)).join('');
    }
    if ('result' in value) return cellText(value.result);
    if ('text' in value) return cellText(value.text);
  }
  return '';
}

async function readXlsx(bytes: Uint8Array, limits: ParseLimits): Promise<string[][]> {
  // The packed size was checked; what the parts unpack to is checked before anything unpacks.
  const verdict = checkZipArchive(bytes, limits);
  if (!verdict.ok) throw refuse(verdict.reason, verdict.why);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch {
    throw refuse('import_file_unreadable', 'not a readable workbook');
  }
  const sheet = workbook.worksheets.find((s) => s.actualRowCount > 0);
  if (sheet === undefined) return [];
  if (sheet.actualRowCount > limits.maxRows + limits.headerSearchRows) {
    throw refuse('import_too_many_rows', 'sheet is too long');
  }
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // `values` counts from 1; the first entry is always empty.
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(Array.from(values, (v) => cellText(v)));
  });
  return rows;
}

function trimRow(row: readonly string[]): string[] {
  const cells = row.map((c) => c.trim());
  while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/**
 * The header is the first of the leading rows that names its columns: at least two filled cells
 * (one when the file has a single column), each with a letter in it. Title lines above the
 * table are skipped; a row of numbers is data, never a header.
 */
export function detectHeaderRow(rows: readonly (readonly string[])[], searchRows: number): number {
  const width = Math.max(0, ...rows.slice(0, searchRows * 2).map((r) => r.length));
  const needed = Math.min(2, width);
  for (let i = 0; i < Math.min(rows.length, searchRows); i++) {
    const filled = (rows[i] ?? []).filter((c) => c !== '');
    if (needed > 0 && filled.length >= needed && filled.every((c) => /\p{L}/u.test(c))) return i;
  }
  return -1;
}

/** Blank names become `Column 3`, repeats become `Phone (2)`. */
export function uniqueColumns(
  header: readonly string[],
  width: number,
  maxLength: number,
): string[] {
  const used = new Set<string>();
  const columns: string[] = [];
  for (let i = 0; i < width; i++) {
    // Room is left for a " (12)" suffix within the length limit.
    const given = (header[i] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength - 5);
    const base = given === '' ? `Column ${String(i + 1)}` : given;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${String(n)})`;
    used.add(name.toLowerCase());
    columns.push(name);
  }
  return columns;
}

/**
 * Reads an uploaded CSV or XLSX file (docs/design/backend-weeks-3-5.md §8): size and type
 * checks, what a workbook unpacks to (`checkZipArchive`), the first sheet of a workbook, header
 * detection, and the row, column and cell limits. A file outside the limits is refused whole with a reason the screen can explain.
 */
export async function parseImportFile(
  bytes: Uint8Array,
  limits: ParseLimits = IMPORT_LIMITS,
): Promise<ParsedImportFile> {
  if (bytes.length === 0) throw refuse('import_file_empty', 'empty file');
  if (bytes.length > limits.maxFileBytes) throw refuse('import_file_too_large', 'file too large');
  const format = detectImportFormat(bytes);
  const read = format === 'xlsx' ? await readXlsx(bytes, limits) : readCsv(bytes, limits);

  // Line numbers are kept for the header; empty lines are dropped before looking for it.
  const lines = read.map((row, i) => ({ line: i + 1, cells: trimRow(row) }));
  const filled = lines.filter((l) => l.cells.length > 0);
  if (filled.length === 0) throw refuse('import_file_empty', 'no rows');

  const at = detectHeaderRow(
    filled.map((l) => l.cells),
    limits.headerSearchRows,
  );
  const header = filled[at];
  if (at < 0 || header === undefined) throw refuse('import_no_header', 'no header row');

  const data = filled.slice(at + 1).map((l) => l.cells);
  if (data.length === 0) throw refuse('import_file_empty', 'header without rows');
  if (data.length > limits.maxRows) throw refuse('import_too_many_rows', 'too many rows');

  const width = data.reduce((w, r) => Math.max(w, r.length), header.cells.length);
  if (width > limits.maxColumns) throw refuse('import_too_many_columns', 'too many columns');
  if (data.some((r) => r.some((c) => c.length > limits.maxCellLength))) {
    throw refuse('import_cell_too_long', 'a cell is too long');
  }

  return {
    format,
    columns: uniqueColumns(header.cells, width, limits.maxHeaderLength),
    rows: data,
    headerLine: header.line,
  };
}
