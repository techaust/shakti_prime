import { IMPORT_LIMITS } from '@shakti/contracts';
import ExcelJS from 'exceljs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import {
  cellText,
  detectHeaderRow,
  parseImportFile,
  uniqueColumns,
  type ParseLimits,
} from './parse';

const text = (value: string) => new TextEncoder().encode(value);

async function workbook(rows: unknown[][], sheets = 1): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  for (let s = 1; s < sheets; s++) book.addWorksheet(`Empty ${String(s)}`);
  const sheet = book.addWorksheet('Leads');
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function reason(bytes: Uint8Array, limits: ParseLimits = IMPORT_LIMITS): Promise<unknown> {
  try {
    await parseImportFile(bytes, limits);
  } catch (e) {
    return (e as { code?: string; details?: { reason?: string } }).details?.reason;
  }
  return 'parsed';
}

describe('parseImportFile: CSV', () => {
  it('reads a header and rows, trimming cells and dropping empty lines', async () => {
    const parsed = await parseImportFile(
      text('\uFEFFName, Phone ,Village\r\n Ram Kumar ,98765 43210,Sikar\r\n\r\nSita,9812345678,\n'),
    );
    expect(parsed).toEqual({
      format: 'csv',
      columns: ['Name', 'Phone', 'Village'],
      rows: [
        ['Ram Kumar', '98765 43210', 'Sikar'],
        ['Sita', '9812345678'],
      ],
      headerLine: 1,
    });
  });

  it('skips a title line above the table and quotes with commas', async () => {
    const parsed = await parseImportFile(
      text(
        'Leads from the March fair\n\nName,Phone,Address\n"Kumar, Ram",9876543210,"Main road, Sikar"\n',
      ),
    );
    expect(parsed.columns).toEqual(['Name', 'Phone', 'Address']);
    expect(parsed.rows).toEqual([['Kumar, Ram', '9876543210', 'Main road, Sikar']]);
    expect(parsed.headerLine).toBe(3);
  });

  it('names blank and repeated columns, and widens the header for longer rows', async () => {
    const parsed = await parseImportFile(text('Name,,Phone,phone\nA,x,1,2,extra\n'));
    expect(parsed.columns).toEqual(['Name', 'Column 2', 'Phone', 'phone (2)', 'Column 5']);
  });

  it.each([
    ['an empty file', text(''), 'import_file_empty'],
    ['a header with no rows', text('Name,Phone\n'), 'import_file_empty'],
    ['numbers only, no header', text('9876543210,1\n9812345678,2\n'), 'import_no_header'],
    ['an old Excel file', Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]), 'import_file_type'],
    ['a binary file', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), 'import_file_type'],
    ['unbalanced quotes', text('Name,Phone\n"Ram,9876543210\n'), 'import_file_unreadable'],
    ['a long cell', text(`Name,Phone\n${'x'.repeat(501)},1\n`), 'import_cell_too_long'],
  ])('refuses %s', async (_label, bytes, expected) => {
    expect(await reason(bytes)).toBe(expected);
  });

  it('refuses a file over the size, row or column limits', async () => {
    const small = { ...IMPORT_LIMITS, maxFileBytes: 20, maxRows: 2, maxColumns: 3 };
    expect(await reason(text('Name,Phone\n' + 'Ram,98765\n'.repeat(3)), small)).toBe(
      'import_file_too_large',
    );
    const rows = { ...small, maxFileBytes: 1000 };
    expect(await reason(text('Name,Phone\nA,1\nB,2\nC,3\n'), rows)).toBe('import_too_many_rows');
    expect(await reason(text('A,B,C,D\n1,2,3,4\n'), rows)).toBe('import_too_many_columns');
  });
});

describe('parseImportFile: XLSX', () => {
  it('reads the first sheet with rows, numbers and dates as the person sees them', async () => {
    const bytes = await workbook(
      [
        ['Name', 'Phone', 'Visited'],
        ['Ram', 9876543210, new Date(Date.UTC(2026, 8, 1))],
        [{ richText: [{ text: 'Si' }, { text: 'ta' }] }, '9812345678', null],
      ],
      2,
    );
    const parsed = await parseImportFile(bytes);
    expect(parsed.format).toBe('xlsx');
    expect(parsed.columns).toEqual(['Name', 'Phone', 'Visited']);
    expect(parsed.rows).toEqual([
      ['Ram', '9876543210', '2026-09-01'],
      ['Sita', '9812345678'],
    ]);
  });

  it('refuses a damaged workbook', async () => {
    expect(await reason(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9]))).toBe(
      'import_file_unreadable',
    );
  });

  it('refuses a sheet longer than the limit', async () => {
    const bytes = await workbook([['Name'], ['a'], ['b'], ['c'], ['d']]);
    expect(await reason(bytes, { ...IMPORT_LIMITS, maxRows: 1, headerSearchRows: 2 })).toBe(
      'import_too_many_rows',
    );
  });
});

describe('parseImportFile: XLSX limits met row by row', () => {
  it('refuses a value far to the right as soon as it is met', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Leads');
    sheet.addRow(['Name', 'Mobile']);
    sheet.addRow(['Ram', '9876543210']);
    // The last column a workbook can have, one value in it.
    sheet.getCell('XFD3').value = 'x';
    for (let i = 0; i < 200; i++) sheet.addRow([`Farmer ${String(i)}`, '9812345678']);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const made = vi.spyOn(Array, 'from');
    let widest = 0;
    try {
      expect(await reason(bytes)).toBe('import_too_many_columns');
      for (const [items] of made.mock.calls) {
        widest = Math.max(widest, (items as Partial<ArrayLike<unknown>>).length ?? 0);
      }
    } finally {
      made.mockRestore();
    }
    // No list as wide as the far column was made on the way.
    expect(widest).toBeLessThanOrEqual(IMPORT_LIMITS.maxColumns);
  });

  it('passes over formatting beyond the last column that holds nothing', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Leads');
    sheet.addRow(['Name', 'Mobile']);
    sheet.addRow(['Ram', '9876543210']);
    sheet.getCell('BZ2').numFmt = '0.00';
    sheet.getCell('BZ2').value = '   ';
    const parsed = await parseImportFile(new Uint8Array(await book.xlsx.writeBuffer()));
    expect(parsed.columns).toEqual(['Name', 'Mobile']);
    expect(parsed.rows).toEqual([['Ram', '9876543210']]);
  });

  it('refuses a cell over the length limit in the row it is met', async () => {
    const bytes = await workbook([['Name'], ['a'.repeat(IMPORT_LIMITS.maxCellLength + 1)]]);
    expect(await reason(bytes)).toBe('import_cell_too_long');
  });

  it('leaves no temporary file behind for a sheet stored before its shared strings', async () => {
    // A workbook written in one piece stores the sheet before the shared strings.
    const bytes = await workbook(
      [
        ['Name', 'Mobile'],
        ['Ram', '9876543210'],
      ],
      2,
    );
    const names = Buffer.from(bytes).toString('latin1');
    expect(names.indexOf('xl/worksheets/sheet')).toBeLessThan(names.indexOf('xl/sharedStrings'));
    const mine = async () =>
      (await readdir(tmpdir())).filter((f) => f.startsWith(`tmp-${String(process.pid)}-`));
    const before = await mine();
    expect((await parseImportFile(bytes)).rows).toEqual([['Ram', '9876543210']]);
    expect(await mine()).toEqual(before);
  });
});

describe('parser helpers', () => {
  it('finds the header among the leading rows and never takes numbers for one', () => {
    expect(detectHeaderRow([['Report'], ['Name', 'Phone'], ['A', '1']], 20)).toBe(1);
    expect(detectHeaderRow([['Name'], ['A']], 20)).toBe(0);
    expect(detectHeaderRow([['1', '2']], 20)).toBe(-1);
    expect(detectHeaderRow([['Title'], ['Name', 'Phone']], 1)).toBe(-1);
  });

  it('keeps column names unique and short', () => {
    expect(uniqueColumns(['A', 'a', 'A', ''], 5, 80)).toEqual([
      'A',
      'a (2)',
      'A (3)',
      'Column 4',
      'Column 5',
    ]);
    expect(uniqueColumns(['x'.repeat(100)], 1, 20)[0]).toHaveLength(15);
  });

  it('reads formula results, links and booleans', () => {
    expect(cellText({ formula: 'A1', result: 42 })).toBe('42');
    expect(cellText({ text: 'site', hyperlink: 'https://example.com' })).toBe('site');
    expect(cellText(true)).toBe('TRUE');
    expect(cellText({ error: '#N/A' })).toBe('');
  });
});
