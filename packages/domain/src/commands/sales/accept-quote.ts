import { AcceptQuoteInput, DomainError, QuoteDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq } from 'drizzle-orm';
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
 * read (the `files` policies) and that has passed its checks.
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
 * `sales.quote.accept` (docs/03-roadmap-appendix/phase1.md §8.3, PRD SAL-05, SAL-06): a sent quote that has not
 * expired is accepted by the customer's signed copy, which staff upload as a `signed_quote` file of
 * the quote's company. In one transaction the quote records `accepted_via` `signed_upload` and the
 * file and moves to accepted (the quote machine's `accept`: a quote past its validity is refused
 * with `quote_expired`, whose sentence asks for a re-quote), and its order is made as a draft with
 * the quote's lines, prices and tax snapshot copied as they stand (the sales order machine's
 * `create`), numbered from the company's series. People only: the WhatsApp acceptance of Phase 2
 * will be the platform's. The order is made with `sales.order.create` over the lead, which the
 * insert policy checks again.
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
    sales_orders_quote_unique: 'concurrent_change',
    sales_orders_entity_so_no_unique: 'concurrent_change',
  },
  async handler(ctx, input) {
    const quote = await lockQuote(ctx, input.entityId, input.quoteId);
    const actor = { kind: 'principal' as const, principal: ctx.principal };
    const accepted = transition(quoteMachine, quoteRecordOf(quote), 'accept', {
      actor,
      now: ctx.now,
      params: { acceptedVia: 'signed_upload' },
    });
    const fileId = await signedCopy(ctx, quote.entityId, input.signedFileId);

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
    if (!account || !entity) throw new DomainError('internal', 'the quote has no readable customer');

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

    transition(
      salesOrderMachine,
      {
        state: null,
        accountType: account.type === 'dealer' ? 'dealer' : 'household',
        fromAcceptedQuote: true,
        credit: {
          accountType: 'household',
          creditLimit: null,
          creditDays: null,
          outstanding: '0.00',
          confirmedUnpaid: '0.00',
          orderValue: quote.grandTotal,
          oldestOverdueDays: null,
          oldestOverdueInvoiceNo: null,
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
      payload: { opportunityId: quote.opportunityId, orderId: order.id, acceptedVia: 'signed_upload' },
    });
    return readQuote(ctx, quote.entityId, quote.id);
  },
});
