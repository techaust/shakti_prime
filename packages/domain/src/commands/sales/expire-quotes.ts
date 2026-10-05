import { ExpireQuotesInput, newId, QuoteExpiryBatchDto, QuoteStateSchema } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { requireEntity } from '../crm/opportunity-shared';

/** How many lapsed quotes one batch reads and marks. */
export const QUOTE_EXPIRY_BATCH = 500;

interface LapsedRow {
  quote_id: string;
  opportunity_id: string;
  quote_state: string;
  valid_until: Date | string;
}

/** Whether the quote machine's `expire` lets the daily job mark this quote now. */
function due(row: LapsedRow, now: Date): boolean {
  try {
    transition(
      quoteMachine,
      {
        state: QuoteStateSchema.parse(row.quote_state),
        segment: 'farmer_pumps',
        tierId: null,
        priceListId: null,
        sizingComplete: true,
        pumpCurveInBounds: true,
        dcrRuleMet: true,
        pdfFileId: null,
        validUntil: new Date(row.valid_until),
      },
      'expire',
      { actor: { kind: 'system', job: 'quote-expiry' }, now, params: {} },
    );
    return true;
  } catch {
    // A quote the machine will not expire yet waits for the next run.
    return false;
  }
}

/**
 * `sales.quote.expire` (docs/design/phase1.md §7.3): the next `QUOTE_EXPIRY_BATCH` draft and sent
 * quotes of a company whose validity has passed, in id order after `afterId`, marked expired. The
 * daily QStash job (`apps/web/src/workers/quote-expiry.ts`) runs it batch by batch as
 * `system:workers`, which holds the platform-only `sales.quote.expire` and no `sales.*` or `crm.*`
 * permission a person may hold (ADR 0020): it reads and writes quotes only through two definers
 * (`app.lapsed_quotes()`, `app.expire_quotes()`), and the quote machine's `expire` guard, fired
 * as the job, runs on each quote between them. A read already shows a lapsed quote as expired.
 * One audit row records each batch that expired a quote, and each quote sends
 * `sales.quote.expired`.
 */
export const expireQuotes = defineCommand({
  name: 'sales.quote.expire',
  permission: 'sales.quote.expire',
  minScope: 'entity',
  input: ExpireQuotesInput,
  output: QuoteExpiryBatchDto,
  auditFields: ['rows'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const lapsed = (await ctx.tx.execute(
      sql`select quote_id, opportunity_id, quote_state, valid_until
            from app.lapsed_quotes(${input.entityId}::smallint, ${input.afterId}::uuid, ${QUOTE_EXPIRY_BATCH})`,
    )) as unknown as LapsedRow[];
    const ids = lapsed.filter((row) => due(row, ctx.now)).map((row) => row.quote_id);
    const expired =
      ids.length === 0
        ? []
        : ((await ctx.tx.execute(
            sql`select quote_id, opportunity_id
                  from app.expire_quotes(${input.entityId}::smallint, ${`{${ids.join(',')}}`}::uuid[])`,
          )) as unknown as { quote_id: string; opportunity_id: string }[]);
    for (const row of expired) {
      ctx.emit({
        type: 'sales.quote.expired',
        entityId: input.entityId,
        aggregateType: 'quote',
        aggregateId: row.quote_id,
        payload: { opportunityId: row.opportunity_id },
      });
    }
    if (expired.length > 0) {
      ctx.audit({
        aggregateType: 'quote_expiry_batch',
        aggregateId: newId(),
        entityId: input.entityId,
        before: null,
        after: { rows: expired.length },
      });
    }
    return QuoteExpiryBatchDto.parse({
      entityId: input.entityId,
      expired: expired.length,
      nextAfterId: lapsed.length === QUOTE_EXPIRY_BATCH ? (lapsed.at(-1)?.quote_id ?? null) : null,
    });
  },
});
