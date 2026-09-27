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
  // A series keeps the prefix it started the year with, even if the entity's code changes later
  // (AUDIT L5), so every number in one year reads the same way.
  const [series] = (await ctx.tx.execute(
    sql`select prefix from document_sequences
         where entity_id = ${entityId} and doc_type = ${docType} and fy = ${fy}`,
  )) as unknown as { prefix: string }[];
  const stored = series?.prefix ?? prefix;
  return DocumentNoSchema.parse({ docType, fy, no, formatted: formatDocumentNo(stored, fy, no) });
}
