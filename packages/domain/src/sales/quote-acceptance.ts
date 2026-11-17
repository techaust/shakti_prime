import { newId, type AccountType } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { nextDocumentNo } from '../numbering/next-document-no';
import { transition, type Actor } from '../state-machines/define-machine';
import {
  quoteMachine,
  type QuoteAcceptedVia,
  type QuoteMachineState,
  type QuoteRecord,
} from '../state-machines/machines/quote';
import { salesOrderMachine } from '../state-machines/machines/sales-order';
import type { OrderMade } from './save-order';

// What every acceptance of a quote shares (docs/03-roadmap-appendix/phase1.md §8.3 and phase2.md
// §7.1): a person's by the signed copy (`sales.quote.accept`) and the platform's from WhatsApp
// (`sales.quote.accept_remote`) run the same machine moves, draw the order's number from the same
// series, make the order with the same function (`app.order_from_quote()`) and record it the
// same way. Only who may write differs: a person under the policies, the platform through its
// definer.

/** The quote as an acceptance reads it. */
export interface QuoteToAccept {
  id: string;
  entityId: number;
  opportunityId: string;
  accountId: string;
  quoteNo: string;
  state: QuoteMachineState;
  tierId: string;
  priceListId: string | null;
  grandTotal: string;
}

/**
 * The quote machine's `accept` (sent, not past its validity, how it was accepted) and the sales
 * order machine's `create` from an accepted quote, for the customer's type now (DOM-1). Throws
 * the machine's refusal; answers the quote's new state.
 */
export function acceptQuoteMoves(
  actor: Actor,
  now: Date,
  record: QuoteRecord,
  accountType: AccountType,
  grandTotal: string,
  acceptedVia: QuoteAcceptedVia,
): QuoteMachineState {
  const accepted = transition(quoteMachine, record, 'accept', {
    actor,
    now,
    params: { acceptedVia },
  });
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
        orderValue: grandTotal,
        oldestUnpaidInvoiceDate: null,
        oldestUnpaidInvoiceNo: null,
      },
      creditHeld: false,
      creditRelease: null,
      hasActiveDispatch: false,
      voucherLinked: false,
      balanceDue: grandTotal,
    },
    'create',
    { actor, now, params: {} },
  );
  return accepted.to;
}

/** A quote as the machine's `withdraw` reads it: only its state and the reason count. */
function withdrawRecord(state: QuoteMachineState): QuoteRecord {
  return {
    state,
    segment: 'farmer_pumps',
    tierId: null,
    priceListId: null,
    sizingComplete: true,
    pumpCurveInBounds: true,
    dcrRuleMet: true,
    pdfFileId: null,
    validUntil: null,
  };
}

/**
 * The machine's `withdraw` for each of the lead's other draft and sent quotes, naming the
 * accepted quote as the reason (DOM-4). Throws the machine's refusal.
 */
export function withdrawOthersMoves(
  actor: Actor,
  now: Date,
  others: readonly { state: QuoteMachineState }[],
  acceptedQuoteNo: string,
): void {
  for (const other of others) {
    transition(quoteMachine, withdrawRecord(other.state), 'withdraw', {
      actor,
      now,
      params: { reason: acceptedQuoteNo },
    });
  }
}

/** The order an acceptance makes: its id and its number drawn from the company's series. */
export interface OrderNumber {
  id: string;
  soNo: string;
  fy: string;
}

/**
 * Draws the next number of the company's sales order series for the order of an accepted quote
 * (SALE-1, gapless: a rollback returns it), and the order's id.
 */
export async function drawOrderNumber(
  ctx: CommandContext,
  entityId: number,
  entityCode: string,
): Promise<OrderNumber> {
  const number = await nextDocumentNo(ctx, entityId, entityCode, 'sales_order');
  return { id: newId(), soNo: number.formatted, fy: number.fy };
}

/**
 * Makes the draft order of a quote the caller has just accepted, under the number drawn
 * (`app.order_from_quote()`, run as the caller under the order policies). Answers its line count.
 */
export async function orderFromQuote(
  ctx: CommandContext,
  quoteId: string,
  order: OrderNumber,
): Promise<number> {
  const rows = (await ctx.tx.execute(
    sql`select app.order_from_quote(${quoteId}::uuid, ${order.id}::uuid, ${order.soNo}, ${order.fy}) as lines`,
  )) as unknown as { lines: number }[];
  return rows[0]?.lines ?? 0;
}

/**
 * The order an acceptance made, as `recordOrderMade()` audits it and sends `sales.order.created`
 * (each command calls it itself, before `recordAcceptance()`).
 */
export function acceptedOrder(
  quote: QuoteToAccept,
  accountType: AccountType,
  order: OrderNumber,
  lineCount: number,
): OrderMade {
  return {
    id: order.id,
    soNo: order.soNo,
    entityId: quote.entityId,
    quoteId: quote.id,
    opportunityId: quote.opportunityId,
    accountId: quote.accountId,
    accountType,
    tierId: quote.tierId,
    priceListId: quote.priceListId,
    lineCount,
    grandTotal: quote.grandTotal,
  };
}

/**
 * Records an acceptance after its order: the quote's audit row with how it was accepted, each
 * withdrawn quote's audit row and `sales.quote.withdrawn`, then `sales.quote.accepted`, naming who
 * recorded it (a person, or the platform for WhatsApp) so the notice skips an owner who did.
 */
export function recordAcceptance(
  ctx: CommandContext,
  accepted: {
    quote: QuoteToAccept;
    acceptedVia: QuoteAcceptedVia;
    signedFileId: string | null;
    withdrawn: readonly { id: string; state: QuoteMachineState }[];
    order: OrderNumber;
  },
): void {
  const { quote, acceptedVia, order } = accepted;
  ctx.audit({
    aggregateType: 'quote',
    aggregateId: quote.id,
    entityId: quote.entityId,
    before: { state: quote.state },
    after: {
      state: 'accepted',
      acceptedVia,
      ...(accepted.signedFileId === null ? {} : { signedFileId: accepted.signedFileId }),
    },
  });
  for (const other of accepted.withdrawn) {
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: other.id,
      entityId: quote.entityId,
      before: { state: other.state },
      after: { state: 'withdrawn', withdrawnForId: quote.id },
    });
    ctx.emit({
      type: 'sales.quote.withdrawn',
      entityId: quote.entityId,
      aggregateType: 'quote',
      aggregateId: other.id,
      payload: { opportunityId: quote.opportunityId },
    });
  }
  ctx.emit({
    type: 'sales.quote.accepted',
    entityId: quote.entityId,
    aggregateType: 'quote',
    aggregateId: quote.id,
    payload: {
      opportunityId: quote.opportunityId,
      orderId: order.id,
      acceptedVia,
      acceptedBy: ctx.principal.id,
    },
  });
}
