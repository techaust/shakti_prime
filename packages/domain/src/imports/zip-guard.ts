import { inflateRawSync } from 'node:zlib';

/** The limits a workbook's packed parts are held to before the spreadsheet reader opens it. */
export interface ZipLimits {
  /** The most every part together may hold once unpacked. */
  maxUnzippedBytes: number;
  /** The most one large part may grow when unpacked. */
  maxZipRatio: number;
  /**
   * The most each of the workbook's own parts the reader takes whole (the workbook, its styles,
   * its relationships and the content types) may hold once unpacked.
   */
  maxPartBytes: number;
  /** The most the shared strings, which the reader keeps in memory, may hold once unpacked. */
  maxSharedStringsBytes: number;
}

/** The parts held to `maxPartBytes`: small in any workbook, read whole by the reader. */
const SMALL_PARTS = new Set([
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/_rels/workbook.xml.rels',
  'xl/workbook.xml',
  'xl/styles.xml',
]);

/** The most a part of this name may hold once unpacked, beyond the total; none for a sheet. */
function partCap(name: string, limits: ZipLimits): number | undefined {
  if (name === 'xl/sharedStrings.xml') return limits.maxSharedStringsBytes;
  return SMALL_PARTS.has(name) ? limits.maxPartBytes : undefined;
}

/** Parts smaller than this once unpacked are never judged by their ratio. */
const RATIO_FLOOR = 1024 * 1024;

/**
 * Why a workbook is refused before it is opened: it unpacks to more than the limits allow, or
 * its directory is damaged or uses a form the reader should not be trusted with.
 */
export type ZipVerdict =
  | {
      ok: true;
      entries: number;
      unzippedBytes: number;
      /** Each part's whole record (local header, data, descriptor), in file order. */
      records: ZipRecord[];
      /** Where the directory starts; the directory and the end record run to the file's end. */
      directoryOffset: number;
    }
  | { ok: false; reason: 'import_workbook_too_large' | 'import_file_unreadable'; why: string };

/** One part of a checked archive: its name and the bytes of its record, `from` to `to`. */
export interface ZipRecord {
  name: string;
  from: number;
  to: number;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ZIP64_LOCATOR = 0x07064b50;
const DESCRIPTOR_SIGNATURE = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
const ENCRYPTED = 0x0001;
const DATA_DESCRIPTOR = 0x0008;
const STORED = 0;
const DEFLATED = 8;
const MAX_16 = 0xffff;
const MAX_32 = 0xffffffff;

const unreadable = (why: string): ZipVerdict => ({
  ok: false,
  reason: 'import_file_unreadable',
  why,
});
const tooLarge = (why: string): ZipVerdict => ({
  ok: false,
  reason: 'import_workbook_too_large',
  why,
});

interface DirectoryPart {
  name: Buffer;
  method: number;
  packed: number;
  unpacked: number;
  localOffset: number;
}

/**
 * Checks an XLSX file's ZIP structure, and the size each part really unpacks to, before ExcelJS
 * unpacks it: the 10 MB upload limit counts packed bytes only, and a crafted file of that size can
 * unpack into gigabytes.
 *
 * ExcelJS's streaming reader (through `unzipper.Parse`) reads the file from its first byte, one
 * local header after another, and unpacks each part as far as its local header says (or, for a
 * part written with a data descriptor, up to the descriptor's signature); it never consults the
 * directory. So the file is walked the same way, and every part the reader would unpack must match
 * an entry of the directory one-to-one and in order: the first local header at the first byte,
 * each next one where the previous part and its descriptor end, the last part ending where the
 * directory starts, and each local header naming the same part, packing method and sizes as its
 * directory entry. A part with a data descriptor has no sizes in its local header, the
 * descriptor's signature is first found exactly where the directory's packed size ends, and the
 * descriptor carries the directory's sizes.
 *
 * Anything else is refused: bytes in front of, between or after the parts, a part present only as
 * a local header, a local size differing from the directory's, ZIP64 records, several disks, a
 * directory that does not end exactly where the end record starts, encryption, and packing
 * methods other than stored and deflate. The declared sizes must stay within the limits (the total,
 * and each of the parts the reader keeps whole: the shared strings and the workbook's own small
 * parts), and each part is then unpacked with a ceiling of its declared size, so a part that
 * lies about its size is refused after producing no more than it declared. The bytes unpacked here are the bytes the
 * reader later unpacks.
 */
export function checkZipArchive(bytes: Uint8Array, limits: ZipLimits): ZipVerdict {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => data.readUInt16LE(at);
  const u32 = (at: number) => data.readUInt32LE(at);

  // The last end-of-directory signature anywhere in the file.
  let end = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (u32(i) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) return unreadable('no end of directory');
  const disk = u16(end + 4);
  const directoryDisk = u16(end + 6);
  const entriesHere = u16(end + 8);
  const entries = u16(end + 10);
  const directorySize = u32(end + 12);
  const directoryOffset = u32(end + 16);
  if (
    [disk, directoryDisk, entriesHere, entries].includes(MAX_16) ||
    [directorySize, directoryOffset].includes(MAX_32) ||
    (end >= 20 && u32(end - 20) === ZIP64_LOCATOR)
  ) {
    return unreadable('zip64');
  }
  if (disk !== 0 || directoryDisk !== 0 || entriesHere !== entries) {
    return unreadable('several disks');
  }
  // The directory ends where the end record starts, with nothing in between.
  if (directoryOffset + directorySize !== end) return unreadable('directory out of place');
  if (entries === 0) return unreadable('no parts');

  const parts: DirectoryPart[] = [];
  let declared = 0;
  let at = directoryOffset;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > end || u32(at) !== DIRECTORY_ENTRY) return unreadable('damaged directory entry');
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const packed = u32(at + 20);
    const unpacked = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const localOffset = u32(at + 42);
    if (packed === MAX_32 || unpacked === MAX_32 || localOffset === MAX_32) {
      return unreadable('zip64 entry');
    }
    if ((flags & ENCRYPTED) !== 0) return unreadable('encrypted');
    if (method !== STORED && method !== DEFLATED) return unreadable('unknown packing method');
    if (method === STORED && packed !== unpacked) return unreadable('stored part size');
    const name = data.subarray(at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (at > end) return unreadable('damaged directory entry');

    declared += unpacked;
    if (declared > limits.maxUnzippedBytes) return tooLarge('unpacks beyond the limit');
    const cap = partCap(name.toString('utf8'), limits);
    if (cap !== undefined && unpacked > cap) return tooLarge('a part beyond its own limit');
    if (unpacked >= RATIO_FLOOR && unpacked > packed * limits.maxZipRatio) {
      return tooLarge('implausible packing ratio');
    }
    parts.push({ name, method, packed, unpacked, localOffset });
  }
  // The count must cover every directory entry written.
  if (at !== end) return unreadable('directory size');

  const locals = localParts(data, parts, directoryOffset);
  if (typeof locals === 'string') return unreadable(locals);

  for (const [i, part] of parts.entries()) {
    const start = locals[i]?.start ?? 0;
    if (part.method === STORED) continue;
    let size: number;
    try {
      // The ceiling is the declared size: a part that unpacks to more stops here, bounded.
      size = inflateRawSync(data.subarray(start, start + part.packed), {
        maxOutputLength: Math.max(part.unpacked, 1),
      }).length;
    } catch {
      return unreadable('part does not unpack within its declared size');
    }
    if (size !== part.unpacked) return unreadable('part size differs from the directory');
  }
  return {
    ok: true,
    entries,
    unzippedBytes: declared,
    records: parts.map((part, i) => ({
      name: part.name.toString('utf8'),
      from: part.localOffset,
      to: locals[i]?.to ?? part.localOffset,
    })),
    directoryOffset,
  };
}

/**
 * The parts as the streaming reader meets them, from the first byte, each where the last one
 * ended, matched one-to-one with the directory's entries: where each part's data starts and its
 * record ends, or why the file is refused.
 */
function localParts(
  data: Buffer,
  parts: readonly DirectoryPart[],
  directoryOffset: number,
): { start: number; to: number }[] | string {
  const u16 = (at: number) => data.readUInt16LE(at);
  const u32 = (at: number) => data.readUInt32LE(at);
  const starts: { start: number; to: number }[] = [];
  let next = 0;
  for (const part of parts) {
    if (part.localOffset !== next) return 'parts out of order with the directory';
    if (next + 30 > directoryOffset || u32(next) !== LOCAL_HEADER) return 'damaged local header';
    const flags = u16(next + 6);
    const method = u16(next + 8);
    const packed = u32(next + 18);
    const unpacked = u32(next + 22);
    const nameLength = u16(next + 26);
    const start = next + 30 + nameLength + u16(next + 28);
    if (start > directoryOffset) return 'damaged local header';
    if ((flags & ENCRYPTED) !== 0) return 'encrypted';
    if (method !== part.method) return 'local packing method differs';
    if (!data.subarray(next + 30, next + 30 + nameLength).equals(part.name)) {
      return 'local name differs';
    }
    let after = start + part.packed;
    if ((flags & DATA_DESCRIPTOR) === 0) {
      if (packed !== part.packed || unpacked !== part.unpacked) {
        return 'local size differs from the directory';
      }
    } else {
      // The reader reads up to the first descriptor signature after the part's data starts.
      if (packed !== 0) return 'data descriptor with local sizes';
      if (data.indexOf(DESCRIPTOR_SIGNATURE, start) !== after || after + 16 > directoryOffset) {
        return 'data descriptor out of place';
      }
      if (u32(after + 8) !== part.packed || u32(after + 12) !== part.unpacked) {
        return 'data descriptor size differs from the directory';
      }
      after += 16;
    }
    if (after > directoryOffset) return 'part outside the file';
    starts.push({ start, to: after });
    next = after;
  }
  if (next !== directoryOffset) return 'bytes between the parts and the directory';
  return starts;
}
