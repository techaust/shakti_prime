import type { FileDto, FilePurpose } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { AWAITING_CHECKS } from '../../commands/files/recheck-files';
import { scanResultOf, toFileDto, type FileRow } from '../../commands/files/shared';

/**
 * A stored file as server code needs it: where its bytes are. Never sent to a browser; the screens
 * get `FileDto`, and a download goes through a signed address made from `key`.
 */
export interface StoredFile {
  id: string;
  entityId: number;
  purpose: FilePurpose;
  bucket: string;
  key: string;
  name: string;
  contentType: string;
  size: number;
  sha256: string;
  status: FileRow['status'];
  /** The upload's own bytes, once the checks replaced or refused them (`ScanResult`). */
  originalKey: string | undefined;
}

function toStoredFile(row: FileRow): StoredFile {
  return {
    id: row.id,
    entityId: row.entityId,
    purpose: row.purpose as FilePurpose,
    bucket: row.bucket,
    key: row.key,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
    status: row.status,
    originalKey: scanResultOf(row).originalKey,
  };
}

/** One file the caller may read, for its bytes; undefined when row security hides it. */
export async function getStoredFile(
  ctx: Pick<RequestContext, 'tx'>,
  fileId: string,
): Promise<StoredFile | undefined> {
  const f = schema.files;
  const [row] = await ctx.tx.select().from(f).where(eq(f.id, fileId)).limit(1);
  return row === undefined ? undefined : toStoredFile(row);
}

/** One file the caller may read, as the screens see it (the uploader polls its checks). */
export async function getFile(
  ctx: Pick<RequestContext, 'tx'>,
  fileId: string,
): Promise<FileDto | undefined> {
  const f = schema.files;
  const [row] = await ctx.tx.select().from(f).where(eq(f.id, fileId)).limit(1);
  return row === undefined ? undefined : toFileDto(row);
}

/**
 * The newest usable file of each purpose in each company the caller sees: a company's current logo
 * and letterhead (`files_entity_purpose_created_idx`). A newer upload still in its checks, or one
 * the checks refused, leaves the current one in place.
 */
export async function listCompanyFiles(
  ctx: Pick<RequestContext, 'tx'>,
  purposes: readonly FilePurpose[],
): Promise<FileDto[]> {
  if (purposes.length === 0) return [];
  const f = schema.files;
  const rows = await ctx.tx
    .selectDistinctOn([f.entityId, f.purpose])
    .from(f)
    .where(and(inArray(f.purpose, [...purposes]), eq(f.status, 'ready')))
    .orderBy(f.entityId, f.purpose, desc(f.createdAt));
  return rows.map(toFileDto);
}

/**
 * How many files the caller sees that are still waiting for their checks and have not moved for
 * `olderThanMinutes` (Integration health, before `files.file.recheck`).
 */
export async function countFilesAwaitingChecks(
  ctx: Pick<RequestContext, 'tx'>,
  olderThanMinutes = 10,
  now: Date = new Date(),
): Promise<number> {
  const f = schema.files;
  const before = new Date(now.getTime() - olderThanMinutes * 60_000);
  const [row] = await ctx.tx
    .select({ n: count() })
    .from(f)
    .where(and(inArray(f.status, [...AWAITING_CHECKS]), lt(f.updatedAt, before)));
  return row?.n ?? 0;
}
