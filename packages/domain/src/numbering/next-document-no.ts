import { DomainError, DocumentNoSchema, type DocType, type DocumentNo } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { documentPrefix, financialYear, formatDocumentNo } from './financial-year';

/**
 * Draws the next gapless number of a series inside the caller's transaction (ADR 0006). The
 * SQL function owns the write and re-checks the entity scope; a rollback of the transaction
 * returns the number to the series, which is what keeps it gapless.
 */
export async function nextDocumentNo(
  ctx: { tx: RequestTx; now: Date },
  entityId: number,
  entityCode: string,
  docType: DocType,
): Promise<DocumentNo> {
  const fy = financialYear(ctx.now);
  const prefix = documentPrefix(entityCode, docType);
  let rows: { no: number | null }[];
  try {
    rows = (await ctx.tx.execute(
      sql`select app.next_document_no(${entityId}::smallint, ${docType}, ${fy}, ${prefix}) as no`,
    )) as unknown as { no: number | null }[];
  } catch (e) {
    if (
      e instanceof Error &&
      e.cause instanceof Error &&
      'code' in e.cause &&
      e.cause.code === '42501'
    ) {
      throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
    }
    throw e;
  }
  const no = rows[0]?.no;
  if (no === undefined || no === null) {
    throw new DomainError('internal', 'document sequence returned no number');
  }
  return DocumentNoSchema.parse({ docType, fy, no, formatted: formatDocumentNo(prefix, fy, no) });
}
