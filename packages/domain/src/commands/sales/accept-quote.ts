import {
  AcceptQuoteInput,
  AccountTypeSchema,
  DomainError,
  QuoteDto,
  QuoteStateSchema,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { readQuote } from '../../queries/sales/quote-dto';
import {
  acceptQuoteMoves,
  drawOrderNumber,
  orderFromQuote,
  recordAcceptance,
  withdrawOthersMoves,
} from '../../sales/quote-acceptance';
import { ORDER_AUDIT_FIELDS } from '../../sales/save-order';
import type { QuoteMachineState } from '../../state-machines/machines/quote';
import { lockQuote, quoteRecordOf } from './quote-shared';

/**
 * The customer's signed copy: a `signed_quote` file of the quote's company that the caller may
 * read (the `files` policies) and that has passed its checks. A signed copy accepts one quote
 * only (`quotes_signed_file_unique`, which refuses a copy another quote already names).
 */
async function signedCopy(ctx: CommandContext, entityId: number, fileId: string): Promise<string> {
  const f = schema.files;
  const [file] = await ctx.tx
    .select({ id: f.id, status: f.status })
    .from(f)
    .where(and(eq(f.id, fileId), eq(f.entityId, entityId), eq(f.purpose, 'signed_quote')))
    .limit(1);
  if (!file) {
    throw new DomainError('not_found', `signed copy ${fileId} is not visible`, {
      reason: 'signed_copy_missing',
    });
  }
  if (file.status === 'rejected') {
    throw new DomainError('validation_failed', 'the signed copy was refused by its checks', {
      reason: 'signed_copy_refused',
    });
  }
  if (file.status !== 'ready') {
    throw new DomainError('conflict', 'the signed copy is still being checked', {
      reason: 'signed_copy_checking',
    });
  }
  return file.id;
}

/**
 * One sale a lead (DOM-4): the acceptances of the quotes of one lead queue here, before any quote
 * is locked, so the second sees the first's quote accepted and its own withdrawn, and two quotes
 * accepted at once never wait on each other's rows crosswise. A quote the caller cannot read takes
 * no lock; `lockQuote` then answers `quote_missing`.
 */
async function holdLeadSale(ctx: CommandContext, entityId: number, quoteId: string): Promise<void> {
  const q = schema.quotes;
  const [found] = await ctx.tx
    .select({ opportunityId: q.opportunityId })
    .from(q)
    .where(and(eq(q.id, quoteId), eq(q.entityId, entityId)))
    .limit(1);
  if (!found) return;
  await ctx.tx.execute(
    sql`select pg_advisory_xact_lock(
          pg_catalog.hashtextextended('lead-sale:' || ${found.opportunityId}::text, 0))`,
  );
}

/**
 * The lead's other draft and sent quotes stop standing once one is accepted (DOM-4): each is
 * withdrawn through the quote machine, naming the accepted quote (`withdrawn_for_id`), so none of
 * them can be sent or accepted into a second order and a second commission. Answers the quotes it
 * withdrew with the state each had, for the acceptance's record.
 */
async function withdrawOtherQuotes(
  ctx: CommandContext,
  accepted: { id: string; opportunityId: string; quoteNo: string },
): Promise<{ id: string; state: QuoteMachineState }[]> {
  const q = schema.quotes;
  const others = (
    await ctx.tx
      .select({ id: q.id, state: q.state })
      .from(q)
      .where(
        and(
          eq(q.opportunityId, accepted.opportunityId),
          ne(q.id, accepted.id),
          inArray(q.state, ['draft', 'sent']),
        ),
      )
      .orderBy(asc(q.id))
      .for('update')
  ).map((other) => ({ id: other.id, state: QuoteStateSchema.parse(other.state) }));
  withdrawOthersMoves(
    { kind: 'principal', principal: ctx.principal },
    ctx.now,
    others,
    accepted.quoteNo,
  );
  for (const other of others) {
    const done = await ctx.tx
      .update(q)
      .set({
        state: 'withdrawn',
        stateChangedAt: ctx.now,
        withdrawnForId: accepted.id,
        updatedBy: ctx.principal.id,
      })
      .where(eq(q.id, other.id))
      .returning({ id: q.id });
    if (done.length !== 1) {
      throw new DomainError('forbidden', `quote ${other.id} is outside the caller's scope`);
    }
  }
  return others;
}

/**
 * `sales.quote.accept` (docs/03-roadmap-appendix/phase1.md §8.3, PRD SAL-05, SAL-06): a sent quote that has not
 * expired is accepted by the customer's signed copy, which staff upload as a `signed_quote` file of
 * the quote's company. In one transaction the quote records `accepted_via` `signed_upload` and the
 * file and moves to accepted (the quote machine's `accept`: a quote past its validity is refused
 * with `quote_expired`, whose sentence asks for a re-quote), and its order is made as a draft with
 * the quote's lines, prices and tax snapshot copied as they stand (the sales order machine's
 * `create`), numbered from the company's series, keeping the customer's type (DOM-1). A lead has
 * one accepted quote, so one order and one commission (DOM-4): a quote of a lead whose other quote
 * is accepted is refused (`quote_lead_already_accepted`, which `quotes_opportunity_accepted_unique`
 * backs), and the lead's other draft and sent quotes are withdrawn in the same transaction. People
 * only: the WhatsApp acceptance is the platform's (`sales.quote.accept_remote`), which shares the
 * machine moves, the numbering, the order's making and its record (`sales/quote-acceptance.ts`).
 * The order is made by `app.order_from_quote()` as the caller, under `sales.order.create` over the
 * lead, which the insert policy checks.
 */
export const acceptQuote = defineCommand({
  name: 'sales.quote.accept',
  permission: 'sales.quote.send',
  minScope: 'own',
  alsoRequires: [{ permission: 'sales.order.create', minScope: 'own' }],
  peopleOnly: true,
  input: AcceptQuoteInput,
  output: QuoteDto,
  auditFields: ['state', 'acceptedVia', ...ORDER_AUDIT_FIELDS],
  constraintReasons: {
    quotes_signed_file_unique: 'signed_copy_used',
    quotes_opportunity_accepted_unique: 'quote_lead_already_accepted',
    sales_orders_quote_unique: 'concurrent_change',
    sales_orders_entity_so_no_unique: 'concurrent_change',
  },
  async handler(ctx, input) {
    await holdLeadSale(ctx, input.entityId, input.quoteId);
    const quote = await lockQuote(ctx, input.entityId, input.quoteId);
    const [account] = await ctx.tx
      .select({ type: schema.accounts.type })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, quote.accountId))
      .limit(1);
    const [entity] = await ctx.tx
      .select({ code: schema.entities.code })
      .from(schema.entities)
      .where(eq(schema.entities.id, quote.entityId))
      .limit(1);
    if (!account || !entity)
      throw new DomainError('internal', 'the quote has no readable customer');
    const accountType = AccountTypeSchema.parse(account.type);
    // The machines first, so a lapsed quote answers `quote_expired` before the signed copy's checks.
    const to = acceptQuoteMoves(
      { kind: 'principal', principal: ctx.principal },
      ctx.now,
      quoteRecordOf(quote),
      accountType,
      quote.grandTotal,
      'signed_upload',
    );
    const fileId = await signedCopy(ctx, quote.entityId, input.signedFileId);
    const [acceptedBefore] = await ctx.tx
      .select({ id: schema.quotes.id })
      .from(schema.quotes)
      .where(
        and(
          eq(schema.quotes.opportunityId, quote.opportunityId),
          eq(schema.quotes.state, 'accepted'),
          ne(schema.quotes.id, quote.id),
        ),
      )
      .limit(1);
    if (acceptedBefore) {
      throw new DomainError('conflict', 'another quote of this lead is accepted', {
        reason: 'quote_lead_already_accepted',
      });
    }

    await ctx.tx
      .update(schema.quotes)
      .set({
        state: to,
        stateChangedAt: ctx.now,
        acceptedVia: 'signed_upload',
        signedFileId: fileId,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.quotes.id, quote.id));
    const withdrawn = await withdrawOtherQuotes(ctx, quote);
    const order = await drawOrderNumber(ctx, quote.entityId, entity.code);
    const lineCount = await orderFromQuote(ctx, quote.id, order);
    recordAcceptance(ctx, {
      quote: { ...quote, state: QuoteStateSchema.parse(quote.state) },
      acceptedVia: 'signed_upload',
      signedFileId: fileId,
      accountType,
      withdrawn,
      order,
      lineCount,
    });
    return readQuote(ctx, quote.entityId, quote.id);
  },
});
