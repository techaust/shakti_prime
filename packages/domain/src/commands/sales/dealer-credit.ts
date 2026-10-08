import {
  DealerOutstandingDto,
  DealerTermsDto,
  DomainError,
  newId,
  RecordDealerOutstandingInput,
  SetDealerTermsInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { istCalendarDate } from '../../numbering/financial-year';

/**
 * The dealer in the company, as the caller reads it: a live customer of type dealer related to
 * the company of the request. `account_missing` otherwise, or `dealer_terms_not_dealer` for a
 * customer who is not a dealer.
 */
async function requireDealer(
  ctx: CommandContext,
  entityId: number,
  accountId: string,
): Promise<void> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const a = schema.accounts;
  const ae = schema.accountEntities;
  const [row] = await ctx.tx
    .select({ type: a.type })
    .from(ae)
    .innerJoin(a, eq(a.id, ae.accountId))
    .where(and(eq(ae.accountId, accountId), eq(ae.entityId, entityId), isNull(a.archivedAt)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `account ${accountId} is not visible`, {
      reason: 'account_missing',
    });
  }
  if (row.type !== 'dealer') {
    throw new DomainError('validation_failed', 'credit terms are for dealers', {
      reason: 'credit_not_dealer',
    });
  }
}

/**
 * `sales.dealer_terms.set` (docs/03-roadmap-appendix/phase1.md §8.3, workshop SALE-4): Accounts enter a
 * dealer's credit limit and credit days in one company. Each entry is kept (append-only) and the
 * newest counts; a limit left empty means none is set, which holds the dealer's orders (SAL-07).
 * The figures are the client's: nothing is filled in for them. People only.
 */
export const setDealerTerms = defineCommand({
  name: 'sales.dealer_terms.set',
  permission: 'sales.credit.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SetDealerTermsInput,
  output: DealerTermsDto,
  auditFields: ['creditLimit', 'creditDays'],
  async handler(ctx, input) {
    await requireDealer(ctx, input.entityId, input.accountId);
    const id = newId();
    await ctx.tx.insert(schema.dealerTerms).values({
      id,
      entityId: input.entityId,
      accountId: input.accountId,
      creditLimit: input.creditLimit,
      creditDays: input.creditDays,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'dealer_terms',
      aggregateId: id,
      entityId: input.entityId,
      after: {
        accountId: input.accountId,
        creditLimit: input.creditLimit,
        creditDays: input.creditDays,
      },
    });
    return {
      id,
      accountId: input.accountId,
      entityId: input.entityId,
      creditLimit: input.creditLimit,
      creditDays: input.creditDays,
      enteredAt: ctx.now.toISOString(),
      enteredByName: null,
    };
  },
});

/**
 * `sales.dealer_outstanding.record` (docs/03-roadmap-appendix/phase1.md §8.3, workshop SALE-6): Accounts enter
 * what a dealer owes in one company as of a date, with the oldest unpaid invoice and its date,
 * until the Tally sync brings it (Phase 5). Append-only; the entry with the newest date counts. A
 * date after today is refused. People only.
 */
export const recordDealerOutstanding = defineCommand({
  name: 'sales.dealer_outstanding.record',
  permission: 'sales.credit.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RecordDealerOutstandingInput,
  output: DealerOutstandingDto,
  auditFields: ['outstanding', 'oldestUnpaidInvoiceDate', 'oldestUnpaidInvoiceNo', 'asOf'],
  async handler(ctx: CommandContext, input) {
    await requireDealer(ctx, input.entityId, input.accountId);
    if (input.asOf > istCalendarDate(ctx.now)) {
      throw new DomainError('validation_failed', 'the outstanding is dated after today', {
        reason: 'outstanding_date_future',
      });
    }
    const id = newId();
    await ctx.tx.insert(schema.dealerOutstanding).values({
      id,
      entityId: input.entityId,
      accountId: input.accountId,
      outstanding: input.outstanding,
      oldestUnpaidInvoiceDate: input.oldestUnpaidInvoiceDate,
      oldestUnpaidInvoiceNo: input.oldestUnpaidInvoiceNo,
      asOf: input.asOf,
      enteredBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'dealer_outstanding',
      aggregateId: id,
      entityId: input.entityId,
      after: {
        accountId: input.accountId,
        outstanding: input.outstanding,
        oldestUnpaidInvoiceDate: input.oldestUnpaidInvoiceDate,
        oldestUnpaidInvoiceNo: input.oldestUnpaidInvoiceNo,
        asOf: input.asOf,
      },
    });
    return {
      id,
      accountId: input.accountId,
      entityId: input.entityId,
      outstanding: input.outstanding,
      oldestUnpaidInvoiceDate: input.oldestUnpaidInvoiceDate,
      oldestUnpaidInvoiceNo: input.oldestUnpaidInvoiceNo,
      asOf: input.asOf,
      enteredAt: ctx.now.toISOString(),
      enteredByName: null,
    };
  },
});
