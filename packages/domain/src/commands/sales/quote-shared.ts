import { DomainError, QuoteStateSchema } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import type { QuoteRecord } from '../../state-machines/machines/quote';

/** The quote row a state change starts from, locked for this transaction, as the caller reads it. */
export async function lockQuote(
  ctx: CommandContext,
  entityId: number,
  quoteId: string,
): Promise<typeof schema.quotes.$inferSelect> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const q = schema.quotes;
  const [row] = await ctx.tx
    .select()
    .from(q)
    .where(and(eq(q.id, quoteId), eq(q.entityId, entityId)))
    .for('update')
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `quote ${quoteId} is not visible`, {
      reason: 'quote_missing',
    });
  }
  return row;
}

/**
 * A saved quote as the quote machine reads it for a state change. The creation facts (tier, list,
 * sizing) were checked when it was made and are frozen with it, so they read as met.
 */
export function quoteRecordOf(row: typeof schema.quotes.$inferSelect): QuoteRecord {
  return {
    state: QuoteStateSchema.parse(row.state),
    segment: 'farmer_pumps',
    tierId: row.tierId,
    priceListId: row.priceListId,
    sizingComplete: true,
    pumpCurveInBounds: true,
    dcrRuleMet: true,
    pdfFileId: row.pdfFileId,
    validUntil: row.validUntil,
  };
}
