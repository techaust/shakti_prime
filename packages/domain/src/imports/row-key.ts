import { createHash } from 'node:crypto';

/**
 * The idempotency key of one import row, `import:{job}:{row}` (docs/design/backend-weeks-3-5.md
 * §8). Keys are UUIDs, so the name is hashed into a name-based UUID (version 5 layout, SHA-256
 * rather than SHA-1): the same row of the same job always gets the same key.
 */
export function importRowKey(jobId: string, rowNo: number): string {
  const hash = createHash('sha256')
    .update(`import:${jobId}:${String(rowNo)}`)
    .digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The order a rollback works in: committed rows newest first, in chunks, so a stop part-way
 * leaves the earliest rows of the file in place and never a gap in the middle.
 */
export function rollbackChunks(rowNos: readonly number[], size: number): number[][] {
  const newestFirst = [...rowNos].sort((a, b) => b - a);
  const chunks: number[][] = [];
  for (let i = 0; i < newestFirst.length; i += size) chunks.push(newestFirst.slice(i, i + size));
  return chunks;
}
