import { inflateRawSync } from 'node:zlib';

/** The limits a workbook's packed parts are held to before the spreadsheet reader opens it. */
export interface ZipLimits {
  /** The most every part together may hold once unpacked. */
  maxUnzippedBytes: number;
  /** The most one large part may grow when unpacked. */
  maxZipRatio: number;
}

/** Parts smaller than this once unpacked are never judged by their ratio. */
const RATIO_FLOOR = 1024 * 1024;

/**
 * Why a workbook is refused before it is opened: it unpacks to more than the limits allow, or
 * its directory is damaged or uses a form the reader should not be trusted with.
 */
export type ZipVerdict =
  | { ok: true; entries: number; unzippedBytes: number }
  | { ok: false; reason: 'import_workbook_too_large' | 'import_file_unreadable'; why: string };

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ZIP64_LOCATOR = 0x07064b50;
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

/**
 * Checks an XLSX file's ZIP directory, and the size each part really unpacks to, before ExcelJS
 * (through JSZip) unpacks all of it into memory: the 10 MB upload limit counts packed bytes only,
 * and a crafted file of that size can unpack into gigabytes.
 *
 * The directory is read the way JSZip reads it (the last end-of-directory record, the directory
 * entries it points at, each part's data after its local header, of the directory's packed size),
 * so the bytes judged here are the bytes the reader later unpacks. Anything JSZip would read
 * differently or leniently is refused: ZIP64 records, several disks, a directory that does not
 * end exactly where the end record starts (JSZip would shift every offset by the difference),
 * a local header or part data reaching into the directory, encryption, packing methods other than
 * stored and deflate, and a part whose unpacked size differs from its directory entry. Bytes in
 * front of the first part, between parts or between the last part and the directory are not
 * refused: nothing is read from them, since each part is read at the offset its directory entry
 * gives, where JSZip reads it too. The declared sizes must stay within the limits, and each part
 * is then unpacked with a ceiling of its declared size, so a part that lies about its size is
 * refused after producing no more than it declared.
 */
export function checkZipArchive(bytes: Uint8Array, limits: ZipLimits): ZipVerdict {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => data.readUInt16LE(at);
  const u32 = (at: number) => data.readUInt32LE(at);

  // JSZip takes the last end-of-directory signature anywhere in the file; so does this.
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
  // The directory ends where the end record starts, so JSZip finds no extra bytes to shift by.
  if (directoryOffset + directorySize !== end) return unreadable('directory out of place');
  if (entries === 0) return unreadable('no parts');

  const parts: { method: number; packed: number; unpacked: number; start: number }[] = [];
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
    if ((flags & 0x0001) !== 0) return unreadable('encrypted');
    if (method !== STORED && method !== DEFLATED) return unreadable('unknown packing method');
    at += 46 + nameLength + extraLength + commentLength;
    if (at > end) return unreadable('damaged directory entry');

    // The part's data follows its local header, whose name and extra lengths JSZip reads there.
    if (localOffset + 30 > directoryOffset || u32(localOffset) !== LOCAL_HEADER) {
      return unreadable('damaged local header');
    }
    const start = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    if (start + packed > directoryOffset) return unreadable('part outside the file');
    if (method === STORED && packed !== unpacked) return unreadable('stored part size');

    declared += unpacked;
    if (declared > limits.maxUnzippedBytes) return tooLarge('unpacks beyond the limit');
    if (unpacked >= RATIO_FLOOR && unpacked > packed * limits.maxZipRatio) {
      return tooLarge('implausible packing ratio');
    }
    parts.push({ method, packed, unpacked, start });
  }
  // JSZip reads directory entries until the signature stops; the count must cover all of them.
  if (at !== end) return unreadable('directory size');

  for (const part of parts) {
    if (part.method === STORED) continue;
    let size: number;
    try {
      // The ceiling is the declared size: a part that unpacks to more stops here, bounded.
      size = inflateRawSync(data.subarray(part.start, part.start + part.packed), {
        maxOutputLength: Math.max(part.unpacked, 1),
      }).length;
    } catch {
      return unreadable('part does not unpack within its declared size');
    }
    if (size !== part.unpacked) return unreadable('part size differs from the directory');
  }
  return { ok: true, entries, unzippedBytes: declared };
}
