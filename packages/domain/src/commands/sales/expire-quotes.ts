import { ExpireQuotesInput, newId, QuoteExpiryBatchDto, QuoteStateSchema } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
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

/** The catalogue reason a quote refused by a check is recorded with (`errors.*`). */
function refusalReason(constraint: string): string {
  return constraint.endsWith('_gst_split_check') ? 'gst_split_mismatch' : 'validation_failed';
}

/** The constraint a check refused the statement for, through Drizzle's wrapping, if any. */
export function refusedCheck(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e !== undefined && e !== null && depth < 5; depth += 1) {
    if (typeof e === 'object' && 'code' in e && e.code === '23514') {
      return 'constraint_name' in e && typeof e.constraint_name === 'string'
        ? e.constraint_name
        : 'unknown_check';
    }
    e = typeof e === 'object' && 'cause' in e ? e.cause : undefined;
  }
  return undefined;
}

interface ExpiredRow {
  quote_id: string;
  opportunity_id: string;
}

function expireBatch(tx: RequestTx, entityId: number, ids: readonly string[]) {
  return tx.execute(
    sql`select quote_id, opportunity_id
          from app.expire_quotes(${entityId}::smallint, ${`{${ids.join(',')}}`}::uuid[])`,
  ) as unknown as Promise<ExpiredRow[]>;
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
 * `sales.quote.expire` (docs/03-roadmap-appendix/phase1.md §7.3): the next `QUOTE_EXPIRY_BATCH` draft and sent
 * quotes of a company whose validity has passed, in id order after `afterId`, marked expired. The
 * daily QStash job (`apps/web/src/workers/quote-expiry.ts`) runs it batch by batch as
 * `system:workers`, which holds the platform-only `sales.quote.expire` and no `sales.*` or `crm.*`
 * permission a person may hold (ADR 0020): it reads and writes quotes only through two definers
 * (`app.lapsed_quotes()`, `app.expire_quotes()`), and the quote machine's `expire` guard, fired
 * as the job, runs on each quote between them. A read already shows a lapsed quote as expired.
 * One audit row records each batch that expired a quote, and each quote sends
 * `sales.quote.expired`. A quote a check refuses (an older row that breaks the GST split added
 * `NOT VALID`) never stops the batch (review L3): the batch is tried again one quote at a time,
 * and each refused quote is skipped, counted and recorded on its own audit row with the reason.
 */
export const expireQuotes = defineCommand({
  name: 'sales.quote.expire',
  permission: 'sales.quote.expire',
  minScope: 'entity',
  input: ExpireQuotesInput,
  output: QuoteExpiryBatchDto,
  auditFields: ['rows', 'skipped', 'expiryRefused'],
  // Run on a timer: a call that changed nothing leaves no audit row (DATA-6).
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const lapsed = (await ctx.tx.execute(
      sql`select quote_id, opportunity_id, quote_state, valid_until
            from app.lapsed_quotes(${input.entityId}::smallint, ${input.afterId}::uuid, ${QUOTE_EXPIRY_BATCH})`,
    )) as unknown as LapsedRow[];
    const ids = lapsed.filter((row) => due(row, ctx.now)).map((row) => row.quote_id);
    let expired: ExpiredRow[] = [];
    const refused: { quoteId: string; reason: string }[] = [];
    if (ids.length > 0) {
      try {
        expired = await ctx.savepoint((tx) => expireBatch(tx, input.entityId, ids));
      } catch (error) {
        if (refusedCheck(error) === undefined) throw error;
        for (const id of ids) {
          try {
            expired.push(...(await ctx.savepoint((tx) => expireBatch(tx, input.entityId, [id]))));
          } catch (one) {
            const constraint = refusedCheck(one);
            if (constraint === undefined) throw one;
            refused.push({ quoteId: id, reason: refusalReason(constraint) });
          }
        }
      }
    }
    for (const r of refused) {
      ctx.audit({
        aggregateType: 'quote',
        aggregateId: r.quoteId,
        entityId: input.entityId,
        before: null,
        after: { expiryRefused: r.reason },
      });
    }
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
        after: { rows: expired.length, skipped: refused.length },
      });
    }
    return QuoteExpiryBatchDto.parse({
      entityId: input.entityId,
      expired: expired.length,
      skipped: refused.length,
      nextAfterId: lapsed.length === QUOTE_EXPIRY_BATCH ? (lapsed.at(-1)?.quote_id ?? null) : null,
    });
  },
});
