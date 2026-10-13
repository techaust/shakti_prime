import { AcceptQuoteInput, AccountTypeSchema, DomainError, QuoteDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { toLineDto } from '../../queries/sales/line-dto';
import { readQuote } from '../../queries/sales/quote-dto';
import { ORDER_AUDIT_FIELDS, saveSalesOrder } from '../../sales/save-order';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { salesOrderMachine } from '../../state-machines/machines/sales-order';
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
 * withdrew, for the command's events.
 */
async function withdrawOtherQuotes(
  ctx: CommandContext,
  accepted: { id: string; entityId: number; opportunityId: string; quoteNo: string },
): Promise<{ id: string; entityId: number; opportunityId: string }[]> {
  const q = schema.quotes;
  const others = await ctx.tx
    .select()
    .from(q)
    .where(
      and(
        eq(q.opportunityId, accepted.opportunityId),
        ne(q.id, accepted.id),
        inArray(q.state, ['draft', 'sent']),
      ),
    )
    .orderBy(asc(q.id))
    .for('update');
  for (const other of others) {
    const withdrawn = transition(quoteMachine, quoteRecordOf(other), 'withdraw', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { reason: accepted.quoteNo },
    });
    const done = await ctx.tx
      .update(q)
      .set({
        state: withdrawn.to,
        stateChangedAt: ctx.now,
        withdrawnForId: accepted.id,
        updatedBy: ctx.principal.id,
      })
      .where(eq(q.id, other.id))
      .returning({ id: q.id });
    if (done.length !== 1) {
      throw new DomainError('forbidden', `quote ${other.id} is outside the caller's scope`);
    }
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: other.id,
      entityId: other.entityId,
      before: { state: other.state },
      after: { state: withdrawn.to, withdrawnForId: accepted.id },
    });
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
 * only: the WhatsApp acceptance of Phase 2 will be the platform's. The order is made with
 * `sales.order.create` over the lead, which the insert policy checks again.
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
    const actor = { kind: 'principal' as const, principal: ctx.principal };
    const accepted = transition(quoteMachine, quoteRecordOf(quote), 'accept', {
      actor,
      now: ctx.now,
      params: { acceptedVia: 'signed_upload' },
    });
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

    await ctx.tx
      .update(schema.quotes)
      .set({
        state: accepted.to,
        stateChangedAt: ctx.now,
        acceptedVia: 'signed_upload',
        signedFileId: fileId,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.quotes.id, quote.id));
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: quote.id,
      entityId: quote.entityId,
      before: { state: quote.state },
      after: { state: accepted.to, acceptedVia: 'signed_upload', signedFileId: fileId },
    });
    for (const other of await withdrawOtherQuotes(ctx, quote)) {
      ctx.emit({
        type: 'sales.quote.withdrawn',
        entityId: other.entityId,
        aggregateType: 'quote',
        aggregateId: other.id,
        payload: { opportunityId: other.opportunityId },
      });
    }

    transition(
      salesOrderMachine,
      {
        state: null,
        accountType,
        fromAcceptedQuote: true,
        credit: {
          accountType: 'household',
          creditLimit: null,
          creditDays: null,
          outstanding: '0.00',
          confirmedUnpaid: '0.00',
          orderValue: quote.grandTotal,
          oldestUnpaidInvoiceDate: null,
          oldestUnpaidInvoiceNo: null,
        },
        creditHeld: false,
        creditRelease: null,
        hasActiveDispatch: false,
        voucherLinked: false,
        balanceDue: quote.grandTotal,
      },
      'create',
      { actor, now: ctx.now, params: {} },
    );
    const l = schema.quoteLines;
    const lines = await ctx.tx
      .select()
      .from(l)
      .where(eq(l.quoteId, quote.id))
      .orderBy(asc(l.position));
    const order = await saveSalesOrder(ctx, {
      entityId: quote.entityId,
      entityCode: entity.code,
      accountId: quote.accountId,
      accountType,
      quoteId: quote.id,
      opportunityId: quote.opportunityId,
      siteId: quote.siteId,
      tierId: quote.tierId,
      priceListId: quote.priceListId,
      supply: {
        stateCode: quote.placeOfSupplyState,
        kind: quote.supplyKind === 'inter' ? 'inter' : 'intra',
      },
      lines: lines.map(toLineDto),
      totals: {
        subtotal: quote.subtotal,
        cgst: quote.cgst,
        sgst: quote.sgst,
        igst: quote.igst,
        taxTotal: quote.taxTotal,
        roundOff: quote.roundOff,
        grandTotal: quote.grandTotal,
      },
    });
    ctx.emit({
      type: 'sales.quote.accepted',
      entityId: quote.entityId,
      aggregateType: 'quote',
      aggregateId: quote.id,
      payload: {
        opportunityId: quote.opportunityId,
        orderId: order.id,
        acceptedVia: 'signed_upload',
      },
    });
    return readQuote(ctx, quote.entityId, quote.id);
  },
});
