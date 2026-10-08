import {
  CreateSalesOrderInput,
  DomainError,
  ItemUnitSchema,
  SalesOrderBuilderDto,
  SalesOrderBuilderInput,
  SalesOrderPreviewDto,
  type PlaceOfSupply,
  type QuoteChoiceDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { checkPermission } from '../../command/run-command';
import { istCalendarDate } from '../../numbering/financial-year';
import { priceQuote, type PricedQuote } from '../../sales/quote-pricing';
import { transition } from '../../state-machines/define-machine';
import { salesOrderMachine } from '../../state-machines/machines/sales-order';
import { placeOfSupply } from '../../tax';
import { parseQueryInput } from '../parse-input';
import {
  livePriceList,
  loadQuoteSources,
  loadQuoteTaxRows,
  quoteTier,
  type QuoteReadContext,
} from './quote-facts';

/** A dealer's order as `CreateSalesOrderInput` parses it. */
export type DealerOrderInput = z.output<typeof CreateSalesOrderInput>;

/** The dealer an order is made for, with its company, as the caller reads them. */
export interface OrderDealer {
  accountId: string;
  entityId: number;
  name: string;
  type: string;
  tierId: string | null;
  gstin: string | null;
  entityCode: string;
  entityStateCode: string;
}

/**
 * The customer and its relationship with the company, as the caller reads them: `account_missing`
 * when the caller cannot read the customer in that company or it is archived.
 */
export async function loadOrderDealer(
  ctx: QuoteReadContext,
  entityId: number,
  accountId: string,
): Promise<OrderDealer> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const a = schema.accounts;
  const ae = schema.accountEntities;
  const e = schema.entities;
  const [row] = await ctx.tx
    .select({
      accountId: a.id,
      entityId: ae.entityId,
      name: a.name,
      type: a.type,
      tierId: a.tierId,
      gstin: a.gstin,
      entityCode: e.code,
      entityStateCode: e.stateCode,
    })
    .from(ae)
    .innerJoin(a, eq(a.id, ae.accountId))
    .innerJoin(e, eq(e.id, ae.entityId))
    .where(and(eq(ae.accountId, accountId), eq(ae.entityId, entityId), isNull(a.archivedAt)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `account ${accountId} is not visible`, {
      reason: 'account_missing',
    });
  }
  return row;
}

/** The quote reasons the shared pricing helpers give, in an order's own words. */
const ORDER_REASONS: Readonly<Record<string, string>> = {
  quote_item_missing: 'order_item_missing',
  quote_price_missing: 'order_price_missing',
  quote_amount_too_large: 'order_amount_too_large',
  quote_kit_tax_missing: 'order_kit_tax_missing',
};

async function inOrderWords<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DomainError) {
      const reason = error.details?.reason;
      const mapped = typeof reason === 'string' ? ORDER_REASONS[reason] : undefined;
      if (mapped !== undefined) {
        throw new DomainError(error.code, error.message, { ...error.details, reason: mapped });
      }
    }
    throw error;
  }
}

/** Everything a dealer's order is made from, worked out and checked, before it is saved. */
export interface BuiltDealerOrder {
  dealer: OrderDealer;
  tier: { id: string; name: string };
  priceListId: string;
  supply: PlaceOfSupply;
  priced: PricedQuote;
}

/**
 * Works out a dealer's order as `sales.order.create` makes it (docs/03-roadmap-appendix/phase1.md §8.3, PRD
 * SAL-06), without saving anything: the customer must be a dealer of the company (the sales order
 * machine's `create` guard, `order_needs_accepted_quote` otherwise), priced from the live list of
 * the dealer's tier for the company, else the group (SAL-01, SAL-03: no price is taken from the
 * input), and taxed by the engine with each line's rate row and the place of supply from the
 * dealer's GSTIN, else the company (ADR 0007). Goods only: a dealer's line is never a works
 * contract, so a kit, which has no rate of its own, is refused (`order_kit_tax_missing`).
 */
export async function buildDealerOrder(
  ctx: QuoteReadContext,
  input: DealerOrderInput,
): Promise<BuiltDealerOrder> {
  const dealer = await loadOrderDealer(ctx, input.entityId, input.accountId);
  transition(
    salesOrderMachine,
    {
      state: null,
      accountType: dealer.type === 'dealer' ? 'dealer' : 'business',
      fromAcceptedQuote: false,
      credit: {
        accountType: 'household',
        creditLimit: null,
        creditDays: null,
        outstanding: '0.00',
        confirmedUnpaid: '0.00',
        orderValue: '0.00',
        oldestOverdueDays: null,
        oldestOverdueInvoiceNo: null,
      },
      creditHeld: false,
      creditRelease: null,
      hasActiveDispatch: false,
      voucherLinked: false,
      balanceDue: '0.00',
    },
    'create',
    { actor: { kind: 'principal', principal: ctx.principal }, now: ctx.now, params: {} },
  );
  const tier = await quoteTier(ctx, { accountTierId: dealer.tierId, accountType: dealer.type });
  if (tier === null) {
    throw new DomainError('validation_failed', 'the dealer has no price tier', {
      reason: 'order_tier_missing',
    });
  }
  const priceListId = await livePriceList(ctx, tier.id, dealer.entityId, istCalendarDate(ctx.now));
  if (priceListId === null) {
    throw new DomainError('validation_failed', 'no live price list for the tier', {
      reason: 'order_price_list_missing',
    });
  }
  const lines = input.lines.map((line) => ({ ...line, worksContract: false }));
  const sources = await inOrderWords(() => loadQuoteSources(ctx, priceListId, lines));
  const supply = placeOfSupply({
    siteStateCode: null,
    accountGstin: dealer.gstin,
    entityStateCode: dealer.entityStateCode,
  });
  const { rates, rules } = await loadQuoteTaxRows(
    ctx,
    sources.byKey.values(),
    'dealer_wholesale',
  );
  const priced = await inOrderWords(() =>
    priceQuote({
      segment: 'dealer_wholesale',
      on: ctx.now,
      supply,
      rates,
      compositeRules: rules,
      lines: lines.map((line) => {
        const key = line.itemId === undefined ? `kit:${line.kitId ?? ''}` : `item:${line.itemId}`;
        const source = sources.byKey.get(key);
        if (source === undefined) throw new DomainError('internal', 'a priced line went missing');
        return { source, qty: line.qty, worksContract: false };
      }),
    }),
  );
  return { dealer, tier, priceListId, supply, priced };
}

type BuilderContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The most choices the form lists: a price list's items and kits, not a catalogue page. */
const MAX_CHOICES = 500;

/**
 * The dealer's order form (docs/03-roadmap-appendix/phase1.md §8.3): the dealer, the tier and the live list an
 * order would be priced from today (null when there is none, so the form says why before anyone
 * types a line), and the items priced on that list. Kits are left out: a dealer's goods order is
 * taxed line by line, and a kit has no rate of its own (PRICE-4).
 */
export async function loadSalesOrderBuilder(
  ctx: BuilderContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<SalesOrderBuilderDto> {
  const input = parseQueryInput(SalesOrderBuilderInput, rawInput, 'sales.order.builder');
  checkPermission(ctx.principal, 'sales.order.create', 'own');
  const read = { ...ctx, now };
  const dealer = await loadOrderDealer(read, input.entityId, input.accountId);
  if (dealer.type !== 'dealer') {
    throw new DomainError('conflict', 'the customer is not a dealer', {
      reason: 'order_needs_accepted_quote',
    });
  }
  const tier = await quoteTier(read, { accountTierId: dealer.tierId, accountType: dealer.type });
  const today = istCalendarDate(now);
  const priceListId =
    tier === null ? null : await livePriceList(read, tier.id, dealer.entityId, today);
  const choices: QuoteChoiceDto[] = [];
  if (priceListId !== null) {
    const pli = schema.priceListItems;
    const i = schema.items;
    const items = await ctx.tx
      .select({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, price: pli.price })
      .from(pli)
      .innerJoin(i, eq(i.id, pli.itemId))
      .where(and(eq(pli.priceListId, priceListId), eq(i.isActive, true), isNull(i.archivedAt)))
      .orderBy(asc(i.name), asc(i.id))
      .limit(MAX_CHOICES);
    for (const item of items) {
      choices.push({ kind: 'item', ...item, unit: ItemUnitSchema.parse(item.unit) });
    }
  }
  return SalesOrderBuilderDto.parse({
    entityId: dealer.entityId,
    accountId: dealer.accountId,
    customerName: dealer.name,
    tierName: tier?.name ?? null,
    priceListId,
    choices,
    today,
  });
}

/** A dealer's order worked out exactly as `sales.order.create` would make it now, unsaved. */
export async function previewSalesOrder(
  ctx: BuilderContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<SalesOrderPreviewDto> {
  const input = parseQueryInput(CreateSalesOrderInput, rawInput, 'sales.order.preview');
  checkPermission(ctx.principal, 'sales.order.create', 'own');
  const built = await buildDealerOrder({ ...ctx, now }, input);
  return SalesOrderPreviewDto.parse({
    tierId: built.tier.id,
    tierName: built.tier.name,
    priceListId: built.priceListId,
    placeOfSupplyState: built.supply.stateCode,
    supplyKind: built.supply.kind,
    lines: built.priced.lines,
    totals: built.priced.totals,
  });
}
