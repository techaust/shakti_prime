import {
  AcceptQuoteRemoteInput,
  AccountTypeSchema,
  DomainError,
  QuoteAcceptedRemotely,
  QuoteStateSchema,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import {
  acceptQuoteMoves,
  drawOrderNumber,
  recordAcceptance,
  withdrawOthersMoves,
} from '../../sales/quote-acceptance';
import { ORDER_AUDIT_FIELDS } from '../../sales/save-order';
import type { Actor } from '../../state-machines/define-machine';
import { requireEntity } from '../crm/opportunity-shared';

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
  price_list_id: string | null;
  account_type: string;
  entity_code: string;
  thread_matches: boolean;
  order_id: string | null;
  so_no: string | null;
  other_quotes: { id: string; state: string }[];
  owner_id: string;
}

interface AcceptedRow {
  result: { lineCount: number; withdrawn: { id: string; state: string }[] };
}

/** The platform's acceptance, as the quote machine names who fired it. */
const PLATFORM: Actor = { kind: 'system', job: 'whatsapp-acceptance' };

/**
 * `sales.quote.accept_remote` (docs/03-roadmap-appendix/phase2.md §7.1, PRD SAL-05): the platform
 * accepts a quote the customer accepted on WhatsApp, after the WhatsApp handler checked the
 * Accept button's token, that the sender's number is the chat's, and, from the value of question
 * 5, the one-time code. Run as `system:workers`, which holds the platform-only
 * `sales.quote.accept_remote` and no `sales.*` grant a person may hold (ADR 0020): it reads the
 * quote through `app.remote_quote_facts()`, which queues the lead's acceptances on the lead's lock
 * and locks the quote, and writes through `app.accept_quote_remote()`, which checks every fact
 * again. Between them run what a person's acceptance runs (`sales/quote-acceptance.ts`): the
 * quote machine's `accept` (sent, within its validity: a lapsed quote answers `quote_expired`),
 * `withdraw` for the lead's other quotes, the order machine's `create`, the number from the
 * company's series; the definer then makes the order by `app.order_from_quote()`, the function a
 * person's acceptance runs, so the order is the one `sales.quote.accept` would make. A chat that is
 * not the quote's customer's accepts nothing (`whatsapp_quote_not_customer`). One acceptance makes
 * one order: a second press, at once or later, finds the quote accepted and answers its order
 * (`accepted` false), changing nothing.
 */
export const acceptQuoteRemote = defineCommand({
  name: 'sales.quote.accept_remote',
  permission: 'sales.quote.accept_remote',
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
    const rows = (await ctx.tx.execute(sql`
      select quote_id, opportunity_id, account_id, quote_no, state, valid_until, pdf_file_id,
             grand_total, tier_id, price_list_id, account_type, entity_code, thread_matches,
             order_id, so_no, other_quotes, owner_id
        from app.remote_quote_facts(${input.entityId}::smallint, ${input.quoteId}::uuid,
                                    ${input.threadId}::uuid)`)) as unknown as FactsRow[];
    const facts = rows[0];
    if (facts === undefined) {
      throw new DomainError('not_found', `quote ${input.quoteId} is not visible`, {
        reason: 'quote_missing',
      });
    }
    if (!facts.thread_matches) {
      throw new DomainError('forbidden', 'the chat is not the quote customer’s', {
        reason: 'whatsapp_quote_not_customer',
      });
    }
    if (facts.state === 'accepted' && facts.order_id !== null && facts.so_no !== null) {
      return {
        quoteId: facts.quote_id,
        orderId: facts.order_id,
        soNo: facts.so_no,
        accepted: false,
        ownerId: facts.owner_id,
      };
    }

    const state = QuoteStateSchema.parse(facts.state);
    const accountType = AccountTypeSchema.parse(facts.account_type);
    acceptQuoteMoves(
      PLATFORM,
      ctx.now,
      {
        state,
        segment: 'farmer_pumps',
        tierId: facts.tier_id,
        priceListId: facts.price_list_id,
        sizingComplete: true,
        pumpCurveInBounds: true,
        dcrRuleMet: true,
        pdfFileId: facts.pdf_file_id,
        validUntil: new Date(facts.valid_until),
      },
      accountType,
      facts.grand_total,
      input.acceptedVia,
    );
    const others = facts.other_quotes.map((o) => ({
      id: o.id,
      state: QuoteStateSchema.parse(o.state),
    }));
    withdrawOthersMoves(PLATFORM, ctx.now, others, facts.quote_no);

    const order = await drawOrderNumber(ctx, input.entityId, facts.entity_code);
    const [accepted] = (await ctx.tx.execute(sql`
      select app.accept_quote_remote(${input.entityId}::smallint, ${input.quoteId}::uuid,
                                     ${input.threadId}::uuid, ${input.acceptedVia},
                                     ${order.id}::uuid, ${order.soNo}, ${order.fy}) as result`)) as unknown as AcceptedRow[];
    if (accepted === undefined) {
      throw new DomainError('internal', 'the acceptance answered nothing');
    }
    recordAcceptance(ctx, {
      quote: {
        id: facts.quote_id,
        entityId: input.entityId,
        opportunityId: facts.opportunity_id,
        accountId: facts.account_id,
        quoteNo: facts.quote_no,
        state,
        tierId: facts.tier_id,
        priceListId: facts.price_list_id,
        grandTotal: facts.grand_total,
      },
      acceptedVia: input.acceptedVia,
      signedFileId: null,
      accountType,
      withdrawn: accepted.result.withdrawn.map((o) => ({
        id: o.id,
        state: QuoteStateSchema.parse(o.state),
      })),
      order,
      lineCount: accepted.result.lineCount,
    });
    return {
      quoteId: facts.quote_id,
      orderId: order.id,
      soNo: order.soNo,
      accepted: true,
      ownerId: facts.owner_id,
    };
  },
});
