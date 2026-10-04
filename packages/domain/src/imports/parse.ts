import { DomainError, IMPORT_LIMITS, type ImportFormat } from '@shakti/contracts';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
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
  maxPartBytes: number;
  maxSharedStringsBytes: number;
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

/**
 * The parts the reader needs, in the order it needs them: each before the sheets that use it. The
 * workbook's relationships are left out: they only name the sheets, which the import does not use,
 * and a reader given empty or damaged ones would spool every sheet to a temporary file.
 */
function partRank(name: string): number {
  if (name === 'xl/workbook.xml') return 0;
  if (name === 'xl/sharedStrings.xml') return 1;
  if (name === 'xl/styles.xml') return 2;
  return /^xl\/worksheets\/sheet\d+\.xml$/.test(name) ? 3 : -1;
}

/**
 * Gives the reader a list it can never lose: ExcelJS reads a sheet as it arrives only while its
 * shared strings and relationships are set, and otherwise spools the sheet to a temporary file
 * that it deletes only when read to the end. Whatever a part sets them to, they stay lists.
 */
function keepList(reader: object, key: 'sharedStrings' | 'workbookRels'): void {
  let value: unknown = [];
  Object.defineProperty(reader, key, {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (next: unknown) => {
      value = Array.isArray(next) ? next : [];
    },
  });
}

/**
 * One row's cells as strings, column by column, without blanks at its end. The row is read
 * cell by cell as ExcelJS holds it (only the cells it has), so a value far to the right is
 * refused as soon as it is met, before any list as wide as its column is made; a cell beyond
 * the column limit that holds nothing (formatting only) is passed over.
 */
function rowCells(row: ExcelJS.Row, limits: ParseLimits): string[] {
  const cells: (string | undefined)[] = [];
  row.eachCell((cell, column) => {
    const text = cellText(cell.value).trim();
    if (text === '') return;
    if (column > limits.maxColumns) throw refuse('import_too_many_columns', 'too many columns');
    if (text.length > limits.maxCellLength) throw refuse('import_cell_too_long', 'cell too long');
    cells[column - 1] = text;
  });
  return Array.from(cells, (c) => c ?? '');
}

/**
 * The rows of a workbook's first sheet that has any, read with ExcelJS's streaming reader: the
 * sheet's XML is parsed as it is unpacked and each row becomes a list of strings at once, so the
 * workbook is never held as a model of cells (which takes many times the file's unpacked size)
 * and memory stays flat whatever the sheet's length. Shared strings and number formats are kept,
 * so text and dates read as the person sees them.
 *
 * The reader is given only the parts it reads, each a record the guard checked, in the order it
 * needs them: the workbook, the shared strings and the styles before the sheets (in their order
 * in the file), then the directory. A reader given a sheet before its shared strings and
 * relationships spools the sheet to a temporary file, which it deletes only when it reads to the
 * end; with both held as lists from the start (`keepList`), it never does.
 */
async function readXlsx(bytes: Uint8Array, limits: ParseLimits): Promise<string[][]> {
  // The packed size was checked; what the parts unpack to is checked before anything unpacks.
  const verdict = checkZipArchive(bytes, limits);
  if (!verdict.ok) throw refuse(verdict.reason, verdict.why);
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const wanted = verdict.records
    .filter((record) => partRank(record.name) >= 0)
    .sort((x, y) => partRank(x.name) - partRank(y.name));
  const source = Readable.from([
    ...wanted.map((record) => data.subarray(record.from, record.to)),
    data.subarray(verdict.directoryOffset),
  ]);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    entries: 'ignore',
  });
  // The reader takes the sheets' names and the date system from `xl/workbook.xml`, which a
  // workbook may lack; empty ones stand in until the real ones are read. The shared strings and
  // relationships are lists from the start, so a sheet is always read as it arrives.
  Object.assign(reader as unknown as Record<string, unknown>, {
    model: { sheets: [] },
    properties: { model: {} },
  });
  keepList(reader, 'sharedStrings');
  keepList(reader, 'workbookRels');
  const most = limits.maxRows + limits.headerSearchRows;
  const rows: string[][] = [];
  // Set once the sheet is read: leaving the reader early may end its stream with an error.
  let read = false;
  try {
    for await (const sheet of reader) {
      for await (const row of sheet) {
        const cells = rowCells(row, limits);
        if (rows.length === 0 && cells.length === 0) continue;
        rows.push(cells);
        if (rows.length > most) throw refuse('import_too_many_rows', 'sheet is too long');
      }
      // The first sheet with rows is the one imported; the rest of the file is not read.
      if (rows.length > 0) {
        read = true;
        break;
      }
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (!read) throw refuse('import_file_unreadable', 'not a readable workbook');
  } finally {
    source.destroy();
  }
  return rows;
}

/** The upload types of an import file, by the format its bytes must have. */
const FORMAT_OF_TYPE: Readonly<Record<string, ImportFormat>> = {
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

/**
 * The check an uploaded import file passes before it is `ready` (the worker of
 * `files.file.uploaded`): its bytes are the format its type declares, and a workbook's ZIP
 * directory is one the reader may open (`checkZipArchive`). The rows are read and checked when the
 * job starts. Answers whether the file passes.
 */
export function importFileReadable(
  bytes: Uint8Array,
  contentType: string,
  limits: ParseLimits = IMPORT_LIMITS,
): boolean {
  const declared = FORMAT_OF_TYPE[contentType];
  if (declared === undefined || bytes.length === 0 || bytes.length > limits.maxFileBytes) {
    return false;
  }
  try {
    if (detectImportFormat(bytes) !== declared) return false;
  } catch {
    return false;
  }
  return declared === 'csv' || checkZipArchive(bytes, limits).ok;
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
