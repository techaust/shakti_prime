import { IMPORT_LIMITS } from '@shakti/contracts';
import ExcelJS from 'exceljs';
import type * as Zlib from 'node:zlib';
import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseImportFile } from './parse';
import { checkZipArchive, type ZipLimits } from './zip-guard';

/** Each unpacking the guard does: the ceiling it set, and what came out or that it stopped. */
const unpacked = vi.hoisted(() => ({
  calls: [] as { ceiling: number | undefined; made: number | 'stopped' }[],
}));

vi.mock('node:zlib', async (importOriginal) => {
  const zlib = await importOriginal<typeof Zlib>();
  return {
    ...zlib,
    inflateRawSync: (buffer: Zlib.InputType, options?: Zlib.ZlibOptions) => {
      try {
        const out = zlib.inflateRawSync(buffer, options);
        unpacked.calls.push({ ceiling: options?.maxOutputLength, made: out.length });
        return out;
      } catch (error) {
        unpacked.calls.push({ ceiling: options?.maxOutputLength, made: 'stopped' });
        throw error;
      }
    },
  };
});

/** One part of a ZIP made in memory; the declared sizes default to the true ones. */
interface Part {
  name: string;
  content: Buffer;
  method?: number;
  flags?: number;
  declaredUnpacked?: number;
  declaredPacked?: number;
  localExtra?: Buffer;
}

interface Shape {
  /** Bytes put in front of the first part, which the offsets leave out (as a prepended stub). */
  prefix?: Buffer;
  /** Overrides of the end-of-directory fields. */
  entries?: number;
  directoryOffset?: number;
  directorySize?: number;
  /** Cut this many bytes off the end. */
  truncate?: number;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

/** Packing a large part takes a while, so each content is packed once for the whole file. */
const packedOnce = new WeakMap<Buffer, Buffer>();
function deflated(content: Buffer): Buffer {
  const known = packedOnce.get(content);
  if (known !== undefined) return known;
  const packed = deflateRawSync(content);
  packedOnce.set(content, packed);
  return packed;
}

/**
 * 120 MB of one repeated byte, which packs into about 120 KB: the shape of a zip bomb. It is made
 * and packed once before the tests run, not when the file loads, and let go after them.
 */
let BOMB = Buffer.alloc(0);
beforeAll(() => {
  BOMB = Buffer.alloc(120 * 2 ** 20);
  deflated(BOMB);
}, 60_000);
afterAll(() => {
  BOMB = Buffer.alloc(0);
});

/** A ZIP laid out as the format describes it: local headers and data, directory, end record. */
function zip(parts: Part[], shape: Shape = {}): Uint8Array {
  const prefix = shape.prefix ?? Buffer.alloc(0);
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const part of parts) {
    const method = part.method ?? 8;
    const data = method === 8 ? deflated(part.content) : part.content;
    const packed = part.declaredPacked ?? data.length;
    const unpacked = part.declaredUnpacked ?? part.content.length;
    const name = Buffer.from(part.name);
    const extra = part.localExtra ?? Buffer.alloc(0);
    const common = [
      u16(part.flags ?? 0),
      u16(method),
      u16(0),
      u16(0),
      u32(0),
      u32(packed),
      u32(unpacked),
      u16(name.length),
    ];
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      ...common,
      u16(extra.length),
      name,
      extra,
      data,
    ]);
    directory.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        ...common,
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(shape.entries ?? parts.length),
    u16(shape.entries ?? parts.length),
    u32(shape.directorySize ?? dir.length),
    u32(shape.directoryOffset ?? offset),
    u16(0),
  ]);
  const whole = Buffer.concat([prefix, ...locals, dir, end]);
  return new Uint8Array(whole.subarray(0, whole.length - (shape.truncate ?? 0)));
}

const text = (value: string) => Buffer.from(value);
const limits: ZipLimits = IMPORT_LIMITS;

function verdictOf(bytes: Uint8Array, given: ZipLimits = limits): string {
  const verdict = checkZipArchive(bytes, given);
  return verdict.ok ? 'ok' : verdict.reason;
}

async function reason(bytes: Uint8Array): Promise<unknown> {
  try {
    await parseImportFile(bytes);
  } catch (e) {
    return (e as { details?: { reason?: string } }).details?.reason;
  }
  return 'parsed';
}

describe('checkZipArchive', () => {
  it('passes a workbook as Excel files are written, counting what it unpacks to', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Leads');
    sheet.addRow(['Name', 'Mobile', 'Village']);
    for (let i = 0; i < 2000; i++) sheet.addRow([`Farmer ${String(i)}`, 9800000000 + i, 'Sikar']);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const verdict = checkZipArchive(bytes, limits);
    expect(verdict).toMatchObject({ ok: true });
    expect(verdict.ok && verdict.unzippedBytes).toBeGreaterThan(bytes.length);
  });

  it('passes parts stored and packed, with a local header longer than the directory says', () => {
    const bytes = zip([
      { name: '[Content_Types].xml', content: text('<Types/>'), method: 0 },
      { name: 'xl/worksheets/sheet1.xml', content: text('<row/>'.repeat(500)) },
      { name: 'xl/styles.xml', content: text('<styles/>'), localExtra: Buffer.alloc(8, 1) },
    ]);
    expect(checkZipArchive(bytes, limits)).toEqual({
      ok: true,
      entries: 3,
      unzippedBytes: 8 + 3000 + 9,
    });
  });

  it('refuses a file that declares more than the limit once unpacked, before unpacking it', () => {
    const bytes = zip([
      { name: 'a.xml', content: text('<a/>'.repeat(200)) },
      { name: 'b.xml', content: text('<b/>'.repeat(200)) },
    ]);
    expect(verdictOf(bytes, { ...limits, maxUnzippedBytes: 1000 })).toBe(
      'import_workbook_too_large',
    );
    expect(verdictOf(bytes, { ...limits, maxUnzippedBytes: 1600 })).toBe('ok');
  });

  it('refuses a small file that declares more than the limit', () => {
    // 120 MB of one repeated byte packs into about 120 KB, honestly declared.
    const bytes = zip([{ name: 'xl/worksheets/sheet1.xml', content: BOMB }]);
    expect(bytes.length).toBeLessThan(IMPORT_LIMITS.maxFileBytes);
    expect(verdictOf(bytes)).toBe('import_workbook_too_large');
  });

  it('refuses a part that packs implausibly well, even within the total', () => {
    const bytes = zip([
      { name: 'xl/worksheets/sheet1.xml', content: Buffer.alloc(2 * 2 ** 20, 0x20) },
    ]);
    expect(verdictOf(bytes)).toBe('import_workbook_too_large');
    // A small part may pack as well as it likes.
    expect(verdictOf(zip([{ name: 'a.xml', content: Buffer.alloc(64 * 1024, 0x20) }]))).toBe('ok');
  });

  it('refuses a part that unpacks to more than its directory entry says, and stops there', () => {
    const bytes = zip([
      {
        name: 'xl/worksheets/sheet1.xml',
        content: BOMB,
        declaredUnpacked: 1000,
      },
    ]);
    unpacked.calls.length = 0;
    const verdict = checkZipArchive(bytes, limits);
    expect(verdict).toMatchObject({ ok: false, reason: 'import_file_unreadable' });
    // Unpacking stopped at the declared 1,000 bytes rather than making 120 MB.
    expect(unpacked.calls).toEqual([{ ceiling: 1000, made: 'stopped' }]);
    expect(
      verdictOf(zip([{ name: 'a.xml', content: text('<a/>'.repeat(10)), declaredUnpacked: 400 }])),
    ).toBe('import_file_unreadable');
  });

  it.each<[string, Uint8Array]>([
    ['no end record', zip([{ name: 'a.xml', content: text('<a/>') }], { truncate: 22 })],
    ['a truncated end record', zip([{ name: 'a.xml', content: text('<a/>') }], { truncate: 4 })],
    ['a signature and nothing else', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 9, 9, 9, 9])],
    [
      'a directory beyond the end record',
      zip([{ name: 'a.xml', content: text('<a/>') }], { directoryOffset: 5000 }),
    ],
    [
      'a directory size that disagrees',
      zip([{ name: 'a.xml', content: text('<a/>') }], { directorySize: 10 }),
    ],
    [
      'fewer entries counted than written',
      zip(
        [
          { name: 'a.xml', content: text('<a/>') },
          { name: 'b.xml', content: text('<b/>') },
        ],
        { entries: 1 },
      ),
    ],
    [
      'more entries counted than written',
      zip([{ name: 'a.xml', content: text('<a/>') }], { entries: 2 }),
    ],
    ['no entries', zip([])],
    [
      'bytes in front of the parts that the offsets leave out',
      zip([{ name: 'a.xml', content: text('<a/>') }], { prefix: Buffer.alloc(16) }),
    ],
    ['a ZIP64 entry count', zip([{ name: 'a.xml', content: text('<a/>') }], { entries: 0xffff })],
    [
      'a ZIP64 part size',
      zip([{ name: 'a.xml', content: text('<a/>'), declaredUnpacked: 0xffffffff }]),
    ],
    ['an encrypted part', zip([{ name: 'a.xml', content: text('<a/>'), flags: 1 }])],
    ['an unknown packing method', zip([{ name: 'a.xml', content: text('<a/>'), method: 12 }])],
    [
      'a stored part whose sizes disagree',
      zip([{ name: 'a.xml', content: text('<a/>'), method: 0, declaredUnpacked: 9 }]),
    ],
    [
      'a part longer than the file',
      zip([{ name: 'a.xml', content: text('<a/>'), declaredPacked: 100_000 }]),
    ],
  ])('refuses %s as unreadable', (_label, bytes) => {
    expect(verdictOf(bytes)).toBe('import_file_unreadable');
  });

  it('refuses a damaged local header', () => {
    const bytes = zip([{ name: 'a.xml', content: text('<a/>') }]);
    bytes[0] = 0;
    expect(verdictOf(bytes)).toBe('import_file_unreadable');
  });
});

describe('parseImportFile with a crafted workbook', () => {
  it('refuses a workbook that unpacks beyond the limit, with its own reason', async () => {
    const bytes = zip([{ name: 'xl/worksheets/sheet1.xml', content: BOMB }]);
    expect(await reason(bytes)).toBe('import_workbook_too_large');
  });

  it('refuses a workbook whose part lies about its size', async () => {
    const bytes = zip([
      {
        name: 'xl/worksheets/sheet1.xml',
        content: BOMB,
        declaredUnpacked: 10,
      },
    ]);
    expect(await reason(bytes)).toBe('import_file_unreadable');
  });
});
