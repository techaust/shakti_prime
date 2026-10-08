import {
  DealerCreditHistoryDto,
  DealerCreditHistoryInput,
  DealerCreditPageDto,
  DomainError,
  ListDealerCreditInput,
  type DealerCreditRowDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { fromPaise, toPaise } from '../../money/paise';
import { afterCursor, keysetOrder, nextCursor, orderTerms, sortText, type SortKeys } from '../keyset-sort';
import { parseQueryInput } from '../parse-input';

type CreditContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** `/dealer-credit` reads the dealers by name, then id. */
const DEALER_SORT_KEYS: SortKeys<'name'> = {
  name: { expr: schema.accounts.name, type: 'text', nullable: false },
};
const dealerOrder = () =>
  keysetOrder(DEALER_SORT_KEYS, schema.accounts.id, undefined, {
    column: 'name',
    direction: 'asc',
  });

/** How many entries of each kind the history shows. */
const HISTORY_LIMIT = 50;

function requireCompany(ctx: CreditContext, entityId: number): void {
  checkPermission(ctx.principal, 'sales.credit.write', 'entity');
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

interface DealerCreditRow {
  accountId: string;
  name: string;
  sortValue: string | null;
  creditLimit: string | null;
  creditDays: number | null;
  termsAt: Date | string | null;
  outstanding: string | null;
  oldestOverdueDays: number | null;
  oldestOverdueInvoiceNo: string | null;
  asOf: string | null;
  confirmedUnpaid: string;
}

/**
 * The query `listDealerCredit` runs, unexecuted, so the plan can be read
 * (`tests/spike/orders-explain.ts`): the live dealers related to the company, by name on
 * `accounts_dealer_name_idx`, each with its credit position (`app.dealer_credit_position()`, the
 * one place the exposure is worked out, as the confirmation reads it). Checks the permission and
 * the company first.
 */
export function dealerCreditQuery(
  ctx: CreditContext,
  input: { entityId: number; cursor?: string | undefined; limit: number },
) {
  requireCompany(ctx, input.entityId);
  const order = dealerOrder();
  const a = schema.accounts;
  const ae = schema.accountEntities;
  const after = afterCursor(order, input.cursor);
  return sql`
    select ${a.id} as "accountId", ${a.name} as "name", ${sortText(order)} as "sortValue",
           p.credit_limit::numeric(14, 2)::text as "creditLimit", p.credit_days as "creditDays",
           p.terms_at as "termsAt",
           case when p.as_of is null then null else p.outstanding::numeric(14, 2)::text end
             as "outstanding",
           p.oldest_overdue_days as "oldestOverdueDays",
           p.oldest_overdue_invoice_no as "oldestOverdueInvoiceNo",
           p.as_of::text as "asOf",
           p.confirmed_unpaid::numeric(14, 2)::text as "confirmedUnpaid"
      from ${a}
      join ${ae} on ${ae.accountId} = ${a.id} and ${ae.entityId} = ${input.entityId}
      cross join lateral app.dealer_credit_position(${input.entityId}::smallint, ${a.id}, null) p
     where ${a.type} = 'dealer' and ${a.archivedAt} is null
       ${after === undefined ? sql`` : sql`and ${after}`}
     order by ${sql.join(orderTerms(order), sql`, `)}
     limit ${input.limit + 1}`;
}

/**
 * `/dealer-credit` (docs/03-roadmap-appendix/phase1.md §8.3, `sales.credit.write`): each dealer of the company
 * with its newest limit and days, its newest outstanding and the date it stands at, the confirmed
 * orders not yet in that figure, and the exposure the credit check reads (outstanding plus those
 * orders). Keyset paging by name.
 */
export async function listDealerCredit(
  ctx: CreditContext,
  rawInput: unknown,
): Promise<DealerCreditPageDto> {
  const input = parseQueryInput(ListDealerCreditInput, rawInput, 'sales.dealer_credit.list');
  const order = dealerOrder();
  const rows = (await ctx.tx.execute(dealerCreditQuery(ctx, input))) as unknown as DealerCreditRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return DealerCreditPageDto.parse({
    items: page.map(
      (row): DealerCreditRowDto => ({
        accountId: row.accountId,
        name: row.name,
        creditLimit: row.creditLimit,
        creditDays: row.creditDays,
        termsAt: row.termsAt === null ? null : new Date(row.termsAt).toISOString(),
        outstanding: row.outstanding,
        oldestOverdueDays: row.oldestOverdueDays,
        oldestOverdueInvoiceNo: row.oldestOverdueInvoiceNo,
        asOf: row.asOf,
        confirmedUnpaid: row.confirmedUnpaid,
        exposure: fromPaise(toPaise(row.outstanding ?? '0.00') + toPaise(row.confirmedUnpaid)),
      }),
    ),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.accountId },
    ),
  });
}

/** One dealer's terms and outstanding entries in the company, newest first, with who made them. */
export async function dealerCreditHistory(
  ctx: CreditContext,
  rawInput: unknown,
): Promise<DealerCreditHistoryDto> {
  const input = parseQueryInput(DealerCreditHistoryInput, rawInput, 'sales.dealer_credit.history');
  requireCompany(ctx, input.entityId);
  const t = schema.dealerTerms;
  const d = schema.dealerOutstanding;
  const p = schema.principals;
  const terms = await ctx.tx
    .select({
      id: t.id,
      accountId: t.accountId,
      entityId: t.entityId,
      creditLimit: t.creditLimit,
      creditDays: t.creditDays,
      enteredAt: t.createdAt,
      enteredByName: p.displayName,
    })
    .from(t)
    .leftJoin(p, eq(p.id, t.createdBy))
    .where(and(eq(t.accountId, input.accountId), eq(t.entityId, input.entityId)))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(HISTORY_LIMIT);
  const outstanding = await ctx.tx
    .select({
      id: d.id,
      accountId: d.accountId,
      entityId: d.entityId,
      outstanding: d.outstanding,
      oldestOverdueDays: d.oldestOverdueDays,
      oldestOverdueInvoiceNo: d.oldestOverdueInvoiceNo,
      asOf: d.asOf,
      enteredAt: d.createdAt,
      enteredByName: p.displayName,
    })
    .from(d)
    .leftJoin(p, eq(p.id, d.enteredBy))
    .where(and(eq(d.accountId, input.accountId), eq(d.entityId, input.entityId)))
    .orderBy(desc(d.asOf), desc(d.createdAt))
    .limit(HISTORY_LIMIT);
  return DealerCreditHistoryDto.parse({
    accountId: input.accountId,
    entityId: input.entityId,
    terms: terms.map((row) => ({ ...row, enteredAt: row.enteredAt.toISOString() })),
    outstanding: outstanding.map((row) => ({ ...row, enteredAt: row.enteredAt.toISOString() })),
  });
}
