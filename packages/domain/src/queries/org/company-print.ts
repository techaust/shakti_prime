import { DomainError, type FilePurpose } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq } from 'drizzle-orm';
import { getStoredFile, type StoredFile } from '../files/file-queries';
import { readSealedBankDetails } from './bank-details';
import { ENTITY_COLUMNS, type EntityRow } from './entity-dto';

/** What the print loader reads of one company, as the render worker (`files.process`). */
export interface CompanyForPrint {
  entity: EntityRow;
  /** The newest ready logo and letterhead: a company's current ones (`files`). */
  logo: StoredFile | undefined;
  letterhead: StoredFile | undefined;
  /** The sealed bank account (`app.entity_bank_envelope()`), opened by the caller; null if none. */
  sealedBank: unknown;
}

async function currentFile(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
  purpose: FilePurpose,
): Promise<StoredFile | undefined> {
  const f = schema.files;
  const [row] = await ctx.tx
    .select({ id: f.id })
    .from(f)
    .where(and(eq(f.entityId, entityId), eq(f.purpose, purpose), eq(f.status, 'ready')))
    .orderBy(desc(f.createdAt))
    .limit(1);
  return row === undefined ? undefined : getStoredFile(ctx, row.id);
}

/**
 * The selling company of a printed document (docs/03-roadmap-appendix/phase1.md §6.4): its details, its current
 * logo and letterhead (each on `files_entity_purpose_created_idx`) and its sealed bank account, all
 * of the one company named, never another. A company outside the request is `not_found`.
 */
export async function loadCompanyForPrint(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
): Promise<CompanyForPrint> {
  const e = schema.entities;
  const [entity] = await ctx.tx.select(ENTITY_COLUMNS).from(e).where(eq(e.id, entityId)).limit(1);
  if (entity === undefined) {
    throw new DomainError('not_found', 'entity not visible in this scope', { entityId });
  }
  // One transaction, one statement at a time.
  const logo = await currentFile(ctx, entityId, 'entity_logo');
  const letterhead = await currentFile(ctx, entityId, 'letterhead');
  const sealedBank = await readSealedBankDetails(ctx, entityId);
  return { entity, logo, letterhead, sealedBank };
}
