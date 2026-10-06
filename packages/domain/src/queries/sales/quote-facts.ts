import {
  CompositeRuleRowSchema,
  type CreateQuoteInput,
  DomainError,
  ItemUnitSchema,
  SegmentSchema,
  TaxRateRowSchema,
  type CompositeRuleRow,
  type PlaceOfSupply,
  type Principal,
  type Segment,
  type SizingDto,
  type SizingKind,
  type StaleSizingDto,
  type SubsidyScheme,
  type TaxRateRow,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, gt, inArray, isNotNull, isNull, lte, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { istCalendarDate } from '../../numbering/financial-year';
import { priceQuote, type PricedQuote, type PricedSource } from '../../sales/quote-pricing';
import { quoteSizingFacts, type QuoteSizingFacts } from '../../sizing/quote-facts';
import type { ModuleLine } from '../../sizing/rules';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine, quoteValidUntil } from '../../state-machines/machines/quote';
import { placeOfSupply } from '../../tax';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { latestSizing } from '../crm/latest-sizing';

/** A quote's input as `CreateQuoteInput` parses it: defaults applied. */
export type QuoteInput = z.output<typeof CreateQuoteInput>;

/** What the quote reads run with: a transaction under the caller's request, and the time. */
export interface QuoteReadContext {
  tx: RequestTx;
  principal: Principal;
  entityIds: readonly number[];
  now: Date;
}

/** The lead a quote is made for, with its customer, site and company, as the caller reads them. */
export interface QuoteLead {
  id: string;
  entityId: number;
  accountId: string;
  siteId: string | null;
  segment: Segment;
  pipelineName: string;
  customerName: string;
  accountType: string;
  accountTierId: string | null;
  accountGstin: string | null;
  siteStateCode: string | null;
  entityCode: string;
  entityStateCode: string;
}

/**
 * The lead, its customer, its site and its company. A lead the caller cannot read, of another
 * company or archived is `lead_missing`: RLS decides what the caller sees, and a customer the
 * caller cannot read through the lead is not quoted.
 */
export async function loadQuoteLead(
  ctx: QuoteReadContext,
  entityId: number,
  opportunityId: string,
): Promise<QuoteLead> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const o = schema.opportunities;
  const p = schema.pipelines;
  const a = schema.accounts;
  const cs = schema.customerSites;
  const e = schema.entities;
  const [row] = await ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      accountId: o.accountId,
      siteId: o.siteId,
      segment: p.segment,
      pipelineName: p.name,
      customerName: a.name,
      accountType: a.type,
      accountTierId: a.tierId,
      accountGstin: a.gstin,
      siteStateCode: cs.stateCode,
      entityCode: e.code,
      entityStateCode: e.stateCode,
    })
    .from(o)
    .innerJoin(p, eq(p.id, o.pipelineId))
    .innerJoin(a, eq(a.id, o.accountId))
    .innerJoin(e, eq(e.id, o.entityId))
    .leftJoin(cs, eq(cs.id, o.siteId))
    .where(and(eq(o.id, opportunityId), eq(o.entityId, entityId), isNull(o.archivedAt)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `opportunity ${opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }
  return { ...row, segment: SegmentSchema.parse(row.segment) };
}

/**
 * The customer's price tier (PRICE-1): their own, else the workshop map by customer type, which
 * is empty until the workshop answers; an inactive or archived tier counts as none.
 */
export async function quoteTier(
  ctx: QuoteReadContext,
  lead: Pick<QuoteLead, 'accountTierId' | 'accountType'>,
): Promise<{ id: string; name: string } | null> {
  const t = schema.priceTiers;
  const code = (WORKSHOP_DEFAULTS.pricing.tierByAccountType as Record<string, string | undefined>)[
    lead.accountType
  ];
  const by: SQL | undefined =
    lead.accountTierId !== null
      ? eq(t.id, lead.accountTierId)
      : code === undefined
        ? undefined
        : eq(t.code, code);
  if (by === undefined) return null;
  const [tier] = await ctx.tx
    .select({ id: t.id, name: t.name })
    .from(t)
    .where(and(by, eq(t.isActive, true), isNull(t.archivedAt)))
    .limit(1);
  return tier ?? null;
}

/**
 * The approved list of the tier that prices `day` for the company, else the group's (SAL-01): a
 * company's own list wins over the shared one, and a quote is priced from one list only.
 */
export async function livePriceList(
  ctx: QuoteReadContext,
  tierId: string,
  entityId: number,
  day: string,
): Promise<string | null> {
  const pl = schema.priceLists;
  const live = (company: SQL) =>
    ctx.tx
      .select({ id: pl.id })
      .from(pl)
      .where(
        and(
          eq(pl.tierId, tierId),
          company,
          isNull(pl.archivedAt),
          isNotNull(pl.approvedAt),
          lte(pl.effectiveFrom, day),
          or(isNull(pl.effectiveTo), gt(pl.effectiveTo, day)),
        ),
      )
      .limit(1);
  const [own] = await live(eq(pl.entityId, entityId));
  if (own) return own.id;
  const [shared] = await live(isNull(pl.entityId));
  return shared?.id ?? null;
}

/** An item as the quote's sizing facts read it: its category, DCR mark and specifications. */
interface ItemFacts {
  category: string;
  isDcr: boolean;
  specs: unknown;
}

/** The lines' items and kits with their list prices, and the items the sizing facts read. */
export interface QuoteSources {
  byKey: Map<string, PricedSource>;
  /** Every catalogue item a line brings, a kit's components counted by the kit's quantity. */
  items: { itemId: string; facts: ItemFacts; quantity: number }[];
}

const keyOf = (line: { itemId?: string | undefined; kitId?: string | undefined }) =>
  line.itemId === undefined ? `kit:${line.kitId ?? ''}` : `item:${line.itemId}`;

/**
 * The lines' items and kits, each active and priced on the list: an item or kit off sale is
 * `quote_item_missing`, one with no price on the list `quote_price_missing` (SAL-03: a quote never
 * prices a line any other way). A kit is priced at its own fixed price (PRICE-3).
 */
export async function loadQuoteSources(
  ctx: QuoteReadContext,
  priceListId: string,
  lines: QuoteInput['lines'],
): Promise<QuoteSources> {
  const itemIds = [...new Set(lines.flatMap((l) => (l.itemId === undefined ? [] : [l.itemId])))];
  const kitIds = [...new Set(lines.flatMap((l) => (l.kitId === undefined ? [] : [l.kitId])))];
  const i = schema.items;
  const k = schema.kits;
  const kc = schema.kitComponents;
  const pli = schema.priceListItems;

  const itemRows =
    itemIds.length === 0
      ? []
      : await ctx.tx
          .select({
            id: i.id,
            sku: i.sku,
            name: i.name,
            unit: i.unit,
            hsn: i.hsn,
            category: i.category,
            isDcr: i.isDcr,
            specs: i.specsJson,
            price: pli.price,
          })
          .from(i)
          .leftJoin(pli, and(eq(pli.itemId, i.id), eq(pli.priceListId, priceListId)))
          .where(and(inArray(i.id, itemIds), eq(i.isActive, true), isNull(i.archivedAt)));
  const kitRows =
    kitIds.length === 0
      ? []
      : await ctx.tx
          .select({ id: k.id, sku: k.sku, name: k.name, price: pli.price })
          .from(k)
          .leftJoin(pli, and(eq(pli.kitId, k.id), eq(pli.priceListId, priceListId)))
          .where(and(inArray(k.id, kitIds), eq(k.isActive, true), isNull(k.archivedAt)));
  const components =
    kitIds.length === 0
      ? []
      : await ctx.tx
          .select({
            kitId: kc.kitId,
            itemId: kc.itemId,
            qty: kc.qty,
            category: i.category,
            isDcr: i.isDcr,
            specs: i.specsJson,
          })
          .from(kc)
          .innerJoin(i, eq(i.id, kc.itemId))
          .where(inArray(kc.kitId, kitIds));

  const byKey = new Map<string, PricedSource>();
  const itemFacts = new Map<string, ItemFacts>();
  for (const row of itemRows) {
    itemFacts.set(row.id, { category: row.category, isDcr: row.isDcr, specs: row.specs });
    if (row.price === null) continue;
    byKey.set(`item:${row.id}`, {
      kind: 'item',
      id: row.id,
      sku: row.sku,
      name: row.name,
      unit: ItemUnitSchema.parse(row.unit),
      hsn: row.hsn,
      price: row.price,
    });
  }
  for (const row of kitRows) {
    if (row.price === null) continue;
    byKey.set(`kit:${row.id}`, {
      kind: 'kit',
      id: row.id,
      sku: row.sku,
      name: row.name,
      unit: 'set',
      hsn: null,
      price: row.price,
    });
  }
  const onSale = new Set([
    ...itemRows.map((r) => `item:${r.id}`),
    ...kitRows.map((r) => `kit:${r.id}`),
  ]);
  for (const line of lines) {
    const key = keyOf(line);
    if (!onSale.has(key)) {
      throw new DomainError('not_found', `${key} is not on sale`, { reason: 'quote_item_missing' });
    }
    if (!byKey.has(key)) {
      throw new DomainError('validation_failed', `${key} has no price on the list`, {
        reason: 'quote_price_missing',
        sku: (
          itemRows.find((r) => `item:${r.id}` === key) ?? kitRows.find((r) => `kit:${r.id}` === key)
        )?.sku,
      });
    }
  }

  const items: QuoteSources['items'] = [];
  for (const line of lines) {
    const qty = Number(line.qty);
    if (line.itemId !== undefined) {
      const facts = itemFacts.get(line.itemId);
      if (facts) items.push({ itemId: line.itemId, facts, quantity: qty });
    } else {
      for (const c of components.filter((x) => x.kitId === line.kitId)) {
        items.push({
          itemId: c.itemId,
          facts: { category: c.category, isDcr: c.isDcr, specs: c.specs },
          quantity: qty * Number(c.qty),
        });
      }
    }
  }
  return { byKey, items };
}

/** The rate rows the lines may resolve to and the segment's composite rules (ADR 0007). */
export async function loadQuoteTaxRows(
  ctx: QuoteReadContext,
  sources: Iterable<PricedSource>,
  segment: Segment,
): Promise<{ rates: TaxRateRow[]; rules: CompositeRuleRow[] }> {
  const list = [...sources];
  const itemIds = list.filter((s) => s.kind === 'item').map((s) => s.id);
  const hsns = [...new Set(list.flatMap((s) => (s.hsn === null ? [] : [s.hsn])))];
  const tr = schema.taxRates;
  const cr = schema.compositeSupplyRules;
  const rateRows =
    itemIds.length === 0
      ? []
      : await ctx.tx
          .select({
            id: tr.id,
            hsn: tr.hsn,
            itemId: tr.itemId,
            ratePct: tr.ratePct,
            effectiveFrom: tr.effectiveFrom,
            effectiveTo: tr.effectiveTo,
          })
          .from(tr)
          .where(
            or(
              inArray(tr.itemId, itemIds),
              hsns.length === 0 ? undefined : and(isNull(tr.itemId), inArray(tr.hsn, hsns)),
            ),
          );
  const ruleRows = await ctx.tx
    .select({
      id: cr.id,
      segment: cr.segment,
      goodsSharePct: cr.goodsSharePct,
      servicesSharePct: cr.servicesSharePct,
      goodsRatePct: cr.goodsRatePct,
      servicesRatePct: cr.servicesRatePct,
      effectiveFrom: cr.effectiveFrom,
      effectiveTo: cr.effectiveTo,
    })
    .from(cr)
    .where(eq(cr.segment, segment));
  return {
    rates: rateRows.map((r) => TaxRateRowSchema.parse(r)),
    rules: ruleRows.map((r) => CompositeRuleRowSchema.parse(r)),
  };
}

/** The kind of sizing a segment's quote relies on (`quoteSizingFacts`); others read either. */
const SIZED_KIND: Partial<Record<Segment, SizingKind>> = {
  farmer_pumps: 'pump',
  residential_rooftop: 'rooftop',
};

/** A number from an item's specifications, or null when it is not a finite number above zero. */
function specNumber(specs: unknown, key: string): number | null {
  if (typeof specs !== 'object' || specs === null || Array.isArray(specs)) return null;
  const value = (specs as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The sizing facts of the lines (docs/design/phase1.md §6.7): the one pump they carry (none when
 * they carry two different pumps, which no sizing checked), every module with its DCR mark and
 * count, and the modules' size in kWp from each module's `wp`.
 */
export function quoteSizingContextOf(
  sources: QuoteSources,
  segment: Segment,
  scheme: SubsidyScheme,
): {
  segment: Segment;
  quotedPumpItemId: string | null;
  moduleLines: ModuleLine[];
  scheme: SubsidyScheme;
  systemKwp: number;
} {
  const pumps = [
    ...new Set(sources.items.filter((x) => x.facts.category === 'pump').map((x) => x.itemId)),
  ];
  const modules = sources.items.filter((x) => x.facts.category === 'solar_module');
  const systemKwp = modules.reduce(
    (total, m) => total + (m.quantity * (specNumber(m.facts.specs, 'wp') ?? 0)) / 1000,
    0,
  );
  return {
    segment,
    quotedPumpItemId: pumps.length === 1 ? (pumps[0] ?? null) : null,
    moduleLines: modules.map((m) => ({ isDcr: m.facts.isDcr, quantity: m.quantity })),
    scheme,
    systemKwp,
  };
}

/** Everything a quote is made from, worked out and checked, before it is numbered and saved. */
export interface BuiltQuote {
  lead: QuoteLead;
  tier: { id: string; name: string };
  priceListId: string;
  scheme: SubsidyScheme;
  sizing: SizingDto | StaleSizingDto | null;
  facts: QuoteSizingFacts;
  supply: PlaceOfSupply;
  validUntil: Date;
  priced: PricedQuote;
}

/**
 * Works out a quote as `sales.quote.create` makes it (docs/design/phase1.md §7.3), without saving
 * anything: the customer's tier, the live list for the tier and company, the lead's newest sizing
 * and the quote machine's `create` guards (the tier and list first, then the sizing, the pump
 * curve and the DCR rule, SAL-04), then the prices from the list and the tax from the engine with
 * the place of supply from the site (ADR 0007), and the 15-day validity. The preview runs it read
 * only; the commands save what it answers.
 */
export async function buildQuote(ctx: QuoteReadContext, input: QuoteInput): Promise<BuiltQuote> {
  const lead = await loadQuoteLead(ctx, input.entityId, input.opportunityId);
  const tier = await quoteTier(ctx, lead);
  const day = istCalendarDate(ctx.now);
  const priceListId = tier === null ? null : await livePriceList(ctx, tier.id, lead.entityId, day);
  const kind = SIZED_KIND[lead.segment];
  const sizing = await latestSizing(ctx, {
    entityId: lead.entityId,
    opportunityId: lead.id,
    ...(kind === undefined ? {} : { kind }),
  });

  // The tier and the list are checked before anything is priced from them.
  const actor = { kind: 'principal' as const, principal: ctx.principal };
  if (tier === null || priceListId === null) {
    transition(
      quoteMachine,
      {
        state: null,
        segment: lead.segment,
        tierId: tier?.id ?? null,
        priceListId,
        sizingComplete: true,
        pumpCurveInBounds: true,
        dcrRuleMet: true,
        pdfFileId: null,
        validUntil: null,
      },
      'create',
      { actor, now: ctx.now, params: {} },
    );
    throw new DomainError('internal', 'the quote guard passed without a tier or a list');
  }

  const sources = await loadQuoteSources(ctx, priceListId, input.lines);
  const facts = quoteSizingFacts(sizing, quoteSizingContextOf(sources, lead.segment, input.scheme));
  transition(
    quoteMachine,
    {
      state: null,
      segment: lead.segment,
      tierId: tier.id,
      priceListId,
      ...facts,
      pdfFileId: null,
      validUntil: null,
    },
    'create',
    { actor, now: ctx.now, params: {} },
  );

  const supply = placeOfSupply({
    siteStateCode: lead.siteStateCode,
    accountGstin: lead.accountGstin,
    entityStateCode: lead.entityStateCode,
  });
  const { rates, rules } = await loadQuoteTaxRows(ctx, sources.byKey.values(), lead.segment);
  const priced = priceQuote({
    segment: lead.segment,
    on: ctx.now,
    supply,
    rates,
    compositeRules: rules,
    lines: input.lines.map((line) => {
      const source = sources.byKey.get(keyOf(line));
      if (source === undefined) throw new DomainError('internal', 'a priced line went missing');
      return { source, qty: line.qty, worksContract: line.worksContract };
    }),
  });
  return {
    lead,
    tier,
    priceListId,
    scheme: input.scheme,
    sizing,
    facts,
    supply,
    validUntil: quoteValidUntil(ctx.now),
    priced,
  };
}
