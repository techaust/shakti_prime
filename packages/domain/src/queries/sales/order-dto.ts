import {
  AccountTypeSchema,
  CreditHoldReasonSchema,
  DomainError,
  hasGrant,
  SalesOrderDto,
  SalesOrderRowDto,
  SalesOrderStateSchema,
  SupplyKindSchema,
  type AccountType,
  type CreditHoldDto,
  type Principal,
  type SalesOrderState,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { z } from 'zod';
import { transition } from '../../state-machines/define-machine';
import {
  salesOrderMachine,
  type SalesOrderEvent,
  type SalesOrderRecord,
} from '../../state-machines/machines/sales-order';
import { toLineDto } from './line-dto';
import type { QuoteReadContext } from './quote-facts';

/** One order's row as the reads select it. */
export const SALES_ORDER_ROW_COLUMNS = {
  id: schema.salesOrders.id,
  entityId: schema.salesOrders.entityId,
  soNo: schema.salesOrders.soNo,
  opportunityId: schema.salesOrders.opportunityId,
  quoteId: schema.salesOrders.quoteId,
  accountId: schema.salesOrders.accountId,
  customerName: schema.accounts.name,
  state: schema.salesOrders.state,
  creditHeldAt: schema.salesOrders.creditHeldAt,
  grandTotal: schema.salesOrders.grandTotal,
  createdAt: schema.salesOrders.createdAt,
};

export function toSalesOrderRow(row: {
  id: string;
  entityId: number;
  soNo: string;
  opportunityId: string | null;
  quoteId: string | null;
  accountId: string;
  customerName: string;
  state: string;
  creditHeldAt: Date | null;
  grandTotal: string;
  createdAt: Date;
}): SalesOrderRowDto {
  return SalesOrderRowDto.parse({
    id: row.id,
    entityId: row.entityId,
    soNo: row.soNo,
    opportunityId: row.opportunityId,
    quoteId: row.quoteId,
    accountId: row.accountId,
    customerName: row.customerName,
    state: SalesOrderStateSchema.parse(row.state),
    creditHeld: row.creditHeldAt !== null,
    grandTotal: row.grandTotal,
    createdAt: row.createdAt.toISOString(),
  });
}

/** The facts a hold keeps (`credit_hold_json`), as `creditCheck()` named them. */
const HoldFacts = z
  .object({
    limit: z.string().nullable().optional(),
    exposure: z.string().nullable().optional(),
    invoiceNo: z.string().nullable().optional(),
    overdueDays: z.number().int().nullable().optional(),
    creditDays: z.number().int().nullable().optional(),
  })
  .loose();

/** A stored hold as the order page shows it, or null when the order is not held. */
export function creditHoldOf(row: {
  creditHeldAt: Date | null;
  creditHoldReason: string | null;
  creditHoldJson: unknown;
}): CreditHoldDto | null {
  if (row.creditHeldAt === null || row.creditHoldReason === null) return null;
  const facts = HoldFacts.parse(row.creditHoldJson ?? {});
  return {
    reason: CreditHoldReasonSchema.parse(row.creditHoldReason),
    heldAt: row.creditHeldAt.toISOString(),
    limit: facts.limit ?? null,
    exposure: facts.exposure ?? null,
    invoiceNo: facts.invoiceNo ?? null,
    overdueDays: facts.overdueDays ?? null,
    creditDays: facts.creditDays ?? null,
  };
}

/**
 * A saved order as the sales order machine reads it for a move other than confirm, whose credit
 * facts the confirmation loads itself: these facts pass the check (no dealer is read).
 */
export function salesOrderRecordOf(
  row: Pick<
    typeof schema.salesOrders.$inferSelect,
    'state' | 'quoteId' | 'grandTotal' | 'creditHeldAt' | 'creditReleaseBy' | 'creditReleaseReason'
  >,
  accountType: AccountType,
): SalesOrderRecord {
  return {
    state: SalesOrderStateSchema.parse(row.state),
    accountType,
    fromAcceptedQuote: row.quoteId !== null,
    credit: {
      accountType: 'household',
      creditLimit: null,
      creditDays: null,
      outstanding: '0.00',
      confirmedUnpaid: '0.00',
      orderValue: row.grandTotal,
      oldestOverdueDays: null,
      oldestOverdueInvoiceNo: null,
    },
    creditHeld: row.creditHeldAt !== null,
    creditRelease:
      row.creditReleaseBy === null || row.creditReleaseReason === null
        ? null
        : { by: row.creditReleaseBy, reason: row.creditReleaseReason },
    // The dispatches, the Tally link and payments arrive in Phases 3 and 5.
    hasActiveDispatch: false,
    voucherLinked: false,
    balanceDue: row.grandTotal,
  };
}

/** A reason stands in, so the check asks only whether a person may make the move now. */
const GIVEN = 'given when asked';

/** Whether the machine lets this principal fire `event` on the order now. */
function allows(principal: Principal, record: SalesOrderRecord, event: SalesOrderEvent, now: Date) {
  try {
    transition(salesOrderMachine, record, event, {
      actor: { kind: 'principal', principal },
      now,
      params: { reason: GIVEN },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * One order with its lines (the order page), as the caller reads it under RLS: `not_found` with
 * `order_missing` when the caller cannot read it or it is of another company. What the caller may
 * do with it is worked out by the sales order machine on the stored state; the commands check
 * again, and a confirmation runs the credit check then.
 */
export async function readSalesOrder(
  ctx: Pick<QuoteReadContext, 'tx' | 'principal' | 'entityIds' | 'now'>,
  entityId: number,
  orderId: string,
): Promise<SalesOrderDto> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const so = schema.salesOrders;
  const a = schema.accounts;
  const t = schema.priceTiers;
  const q = schema.quotes;
  const maker = alias(schema.principals, 'maker');
  const confirmer = alias(schema.principals, 'confirmer');
  const releaser = alias(schema.principals, 'releaser');
  const [row] = await ctx.tx
    .select({
      ...getTableColumns(so),
      customerName: a.name,
      accountType: a.type,
      tierName: t.name,
      quoteNo: q.quoteNo,
      createdByName: maker.displayName,
      confirmedByName: confirmer.displayName,
      releasedByName: releaser.displayName,
    })
    .from(so)
    .innerJoin(a, eq(a.id, so.accountId))
    .leftJoin(t, eq(t.id, so.tierId))
    .leftJoin(q, eq(q.id, so.quoteId))
    .leftJoin(maker, eq(maker.id, so.createdBy))
    .leftJoin(confirmer, eq(confirmer.id, so.confirmedBy))
    .leftJoin(releaser, eq(releaser.id, so.creditReleaseBy))
    .where(and(eq(so.id, orderId), eq(so.entityId, entityId)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `order ${orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  const l = schema.salesOrderLines;
  const lines = await ctx.tx
    .select()
    .from(l)
    .where(eq(l.salesOrderId, orderId))
    .orderBy(asc(l.position));
  const accountType = AccountTypeSchema.parse(row.accountType);
  const state: SalesOrderState = SalesOrderStateSchema.parse(row.state);
  const record = salesOrderRecordOf(row, accountType);
  return SalesOrderDto.parse({
    id: row.id,
    entityId: row.entityId,
    soNo: row.soNo,
    quoteId: row.quoteId,
    quoteNo: row.quoteNo,
    opportunityId: row.opportunityId,
    accountId: row.accountId,
    customerName: row.customerName,
    accountType,
    siteId: row.siteId,
    tierId: row.tierId,
    // The tier's name only for a caller who reads the price tiers, as on the quote page.
    tierName: hasGrant(ctx.principal.permissions, 'pricing.read', 'own') ? row.tierName : null,
    priceListId: row.priceListId,
    placeOfSupplyState: row.placeOfSupplyState,
    supplyKind: SupplyKindSchema.parse(row.supplyKind),
    state,
    lines: lines.map(toLineDto),
    totals: {
      subtotal: row.subtotal,
      cgst: row.cgst,
      sgst: row.sgst,
      igst: row.igst,
      taxTotal: row.taxTotal,
      roundOff: row.roundOff,
      grandTotal: row.grandTotal,
    },
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdByName,
    stateChangedAt: row.stateChangedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedByName: row.confirmedByName,
    creditHold: creditHoldOf(row),
    creditRelease:
      row.creditReleasedAt === null || row.creditReleaseReason === null
        ? null
        : {
            byName: row.releasedByName,
            reason: row.creditReleaseReason,
            releasedAt: row.creditReleasedAt.toISOString(),
          },
    cancelReason: row.cancelReason,
    // Confirm runs the credit check itself; here only the move and the permission are asked.
    canConfirm:
      hasGrant(ctx.principal.permissions, 'sales.order.confirm', 'own') &&
      allows(ctx.principal, record, 'confirm', ctx.now),
    canRelease:
      hasGrant(ctx.principal.permissions, 'sales.credit.release', 'all') &&
      allows(ctx.principal, record, 'credit.release', ctx.now),
    canCancel:
      hasGrant(ctx.principal.permissions, 'sales.order.cancel', 'entity') &&
      allows(ctx.principal, record, 'cancel', ctx.now),
  });
}
