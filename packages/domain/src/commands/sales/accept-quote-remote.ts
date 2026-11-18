import {
  AcceptQuoteRemoteInput,
  AccountTypeSchema,
  DomainError,
  QuoteAcceptedRemotely,
  QuoteStateSchema,
  type AccountType,
  type QuoteState,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { needsAcceptanceCode } from '../../messaging/acceptance-code';
import {
  acceptedOrder,
  acceptQuoteMoves,
  drawOrderNumber,
  recordAcceptance,
  withdrawOthersMoves,
} from '../../sales/quote-acceptance';
import { ORDER_AUDIT_FIELDS, recordOrderMade } from '../../sales/save-order';
import type { Actor } from '../../state-machines/define-machine';
import type { QuoteRecord } from '../../state-machines/machines/quote';
import { requireEntity } from '../crm/opportunity-shared';
import { quoteRecordOf } from './quote-shared';

interface FactsRow {
  quote_id: string;
  opportunity_id: string;
  account_id: string;
  quote_no: string;
  state: string;
  valid_until: Date | string;
  pdf_file_id: string | null;
  grand_total: string;
  tier_id: string;
  price_list_id: string;
  account_type: string;
  entity_code: string;
  thread_matches: boolean;
  order_id: string | null;
  so_no: string | null;
  other_quotes: { id: string; state: string }[];
  owner_id: string;
  accepted_quote_id: string | null;
  accepted_quote_no: string | null;
  accepted_order_id: string | null;
  accepted_so_no: string | null;
}

interface AcceptedRow {
  result: { lineCount: number; withdrawn: { id: string; state: string }[] };
}

/** An accepted quote and the order it made. */
interface AcceptedQuote {
  quoteId: string;
  quoteNo: string;
  orderId: string;
  soNo: string;
}

/** The quote the platform's acceptance starts from, as `app.remote_quote_facts()` reads it. */
export interface RemoteQuoteFacts {
  quoteId: string;
  opportunityId: string;
  accountId: string;
  quoteNo: string;
  state: QuoteState;
  /** The quote as the quote machine reads it, made as every other quote command makes it. */
  record: QuoteRecord;
  tierId: string;
  priceListId: string;
  /** As stored (`numeric(14,2)`), compared on its digits, never computed. */
  grandTotal: string;
  accountType: AccountType;
  entityCode: string;
  /** Whether the chat is the quote's customer's, in its company, with a number. */
  threadMatches: boolean;
  /** The quote, accepted, with the order it made. */
  accepted: AcceptedQuote | null;
  /** The lead's quote this one was withdrawn for, accepted, with its order. */
  withdrawnFor: AcceptedQuote | null;
  otherQuotes: { id: string; state: QuoteState }[];
  ownerId: string;
}

function acceptedOf(
  quoteId: string | null,
  quoteNo: string | null,
  orderId: string | null,
  soNo: string | null,
): AcceptedQuote | null {
  return quoteId === null || quoteNo === null || orderId === null || soNo === null
    ? null
    : { quoteId, quoteNo, orderId, soNo };
}

/**
 * The quote a WhatsApp acceptance starts from (`app.remote_quote_facts()`, which checks
 * `sales.quote.accept.remote`, queues the lead's acceptances on the lead's lock and locks the
 * quote); null when the quote is not of the company.
 */
export async function readRemoteQuoteFacts(
  ctx: Pick<RequestContext, 'tx'>,
  input: { entityId: number; quoteId: string; threadId: string },
): Promise<RemoteQuoteFacts | null> {
  const rows = (await ctx.tx.execute(sql`
    select quote_id, opportunity_id, account_id, quote_no, state, valid_until, pdf_file_id,
           grand_total, tier_id, price_list_id, account_type, entity_code, thread_matches,
           order_id, so_no, other_quotes, owner_id, accepted_quote_id, accepted_quote_no,
           accepted_order_id, accepted_so_no
      from app.remote_quote_facts(${input.entityId}::smallint, ${input.quoteId}::uuid,
                                  ${input.threadId}::uuid)`)) as unknown as FactsRow[];
  const r = rows[0];
  if (r === undefined) return null;
  return {
    quoteId: r.quote_id,
    opportunityId: r.opportunity_id,
    accountId: r.account_id,
    quoteNo: r.quote_no,
    state: QuoteStateSchema.parse(r.state),
    record: quoteRecordOf({
      state: r.state,
      tierId: r.tier_id,
      priceListId: r.price_list_id,
      pdfFileId: r.pdf_file_id,
      validUntil: new Date(r.valid_until),
    }),
    tierId: r.tier_id,
    priceListId: r.price_list_id,
    grandTotal: r.grand_total,
    accountType: AccountTypeSchema.parse(r.account_type),
    entityCode: r.entity_code,
    threadMatches: r.thread_matches,
    accepted:
      r.state === 'accepted' ? acceptedOf(r.quote_id, r.quote_no, r.order_id, r.so_no) : null,
    withdrawnFor: acceptedOf(
      r.accepted_quote_id,
      r.accepted_quote_no,
      r.accepted_order_id,
      r.accepted_so_no,
    ),
    otherQuotes: r.other_quotes.map((o) => ({ id: o.id, state: QuoteStateSchema.parse(o.state) })),
    ownerId: r.owner_id,
  };
}

/** The platform's acceptance, as the quote machine names who fired it. */
const PLATFORM: Actor = { kind: 'system', job: 'whatsapp-acceptance' };

/**
 * `sales.quote.accept_remote` (docs/03-roadmap-appendix/phase2.md §7.1, PRD SAL-05): the platform
 * accepts a quote the customer accepted on WhatsApp, after the WhatsApp handler checked the
 * Accept button's token, that the sender's number is the chat's, and, from the value of question
 * 5, the one-time code. Run as `system:workers`, which holds the platform-only
 * `sales.quote.accept.remote` and no `sales.*` grant a person may hold (ADR 0020): it reads the
 * quote through `app.remote_quote_facts()`, which queues the lead's acceptances on the lead's lock
 * and locks the quote, and writes through `app.accept_quote_remote()`, which checks every fact
 * again. Between them run what a person's acceptance runs (`sales/quote-acceptance.ts`): the
 * quote machine's `accept` (sent, within its validity: a lapsed quote answers `quote_expired`),
 * `withdraw` for the lead's other quotes, the order machine's `create`, the number from the
 * company's series; the definer then makes the order by `app.order_from_quote()`, the function a
 * person's acceptance runs, so the order is the one `sales.quote.accept` would make. A chat that is
 * not the quote's customer's accepts nothing (`whatsapp_quote_not_customer`), and from the value
 * of question 5 (`WORKSHOP_DEFAULTS.whatsapp.otpFromRupees`) only `whatsapp_otp` accepts
 * (`whatsapp_code_required`), whoever calls it. One acceptance makes one order: a second press, at
 * once or later, finds the quote accepted and answers its order (`accepted` false), changing
 * nothing; so does a press on a quote withdrawn because the customer accepted another quote of the
 * lead, with that quote and its order.
 */
export const acceptQuoteRemote = defineCommand({
  name: 'sales.quote.accept_remote',
  permission: 'sales.quote.accept.remote',
  minScope: 'entity',
  input: AcceptQuoteRemoteInput,
  output: QuoteAcceptedRemotely,
  auditFields: ['state', 'acceptedVia', ...ORDER_AUDIT_FIELDS],
  // A press handled twice changes nothing the second time, so it leaves no second audit row.
  auditWhen: 'changed',
  constraintReasons: {
    quotes_opportunity_accepted_unique: 'quote_lead_already_accepted',
    sales_orders_quote_unique: 'concurrent_change',
    sales_orders_entity_so_no_unique: 'concurrent_change',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await readRemoteQuoteFacts(ctx, input);
    if (facts === null) {
      throw new DomainError('not_found', `quote ${input.quoteId} is not visible`, {
        reason: 'quote_missing',
      });
    }
    if (!facts.threadMatches) {
      throw new DomainError('forbidden', 'the chat is not the quote customer’s', {
        reason: 'whatsapp_quote_not_customer',
      });
    }
    // Already accepted, this quote or the one it was withdrawn for: that order, changing nothing.
    const earlier = facts.accepted ?? (facts.state === 'withdrawn' ? facts.withdrawnFor : null);
    if (earlier !== null) {
      return { ...earlier, accepted: false, ownerId: facts.ownerId };
    }

    acceptQuoteMoves(
      PLATFORM,
      ctx.now,
      facts.record,
      facts.accountType,
      facts.grandTotal,
      input.acceptedVia,
    );
    // From the code's value a press alone accepts nothing: the code sent back on the chat does.
    if (input.acceptedVia === 'whatsapp_reply' && needsAcceptanceCode(facts.grandTotal)) {
      throw new DomainError('validation_failed', 'the quote is accepted only with the code', {
        reason: 'whatsapp_code_required',
      });
    }
    withdrawOthersMoves(PLATFORM, ctx.now, facts.otherQuotes, facts.quoteNo);

    const order = await drawOrderNumber(ctx, input.entityId, facts.entityCode);
    const [accepted] = (await ctx.tx.execute(sql`
      select app.accept_quote_remote(${input.entityId}::smallint, ${input.quoteId}::uuid,
                                     ${input.threadId}::uuid, ${input.acceptedVia},
                                     ${order.id}::uuid, ${order.soNo}, ${order.fy}) as result`)) as unknown as AcceptedRow[];
    if (accepted === undefined) {
      throw new DomainError('internal', 'the acceptance answered nothing');
    }
    const quote = {
      id: facts.quoteId,
      entityId: input.entityId,
      opportunityId: facts.opportunityId,
      accountId: facts.accountId,
      quoteNo: facts.quoteNo,
      state: facts.state,
      tierId: facts.tierId,
      priceListId: facts.priceListId,
      grandTotal: facts.grandTotal,
    };
    recordOrderMade(ctx, acceptedOrder(quote, facts.accountType, order, accepted.result.lineCount));
    recordAcceptance(ctx, {
      quote,
      acceptedVia: input.acceptedVia,
      signedFileId: null,
      withdrawn: accepted.result.withdrawn.map((o) => ({
        id: o.id,
        state: QuoteStateSchema.parse(o.state),
      })),
      order,
    });
    return {
      quoteId: facts.quoteId,
      quoteNo: facts.quoteNo,
      orderId: order.id,
      soNo: order.soNo,
      accepted: true,
      ownerId: facts.ownerId,
    };
  },
});
