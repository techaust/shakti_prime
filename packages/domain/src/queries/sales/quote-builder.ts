import {
  CreateQuoteInput,
  DomainError,
  isStaleSizing,
  ItemUnitSchema,
  QuoteBuilderDto,
  QuoteBuilderInput,
  QuotePreviewDto,
  type QuoteChoiceDto,
  type SizingKind,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { istCalendarDate } from '../../numbering/financial-year';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { latestSizing } from '../crm/latest-sizing';
import { parseQueryInput } from '../parse-input';
import { buildQuote, livePriceList, loadQuoteLead, quoteTier } from './quote-facts';

type BuilderContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The most choices the builder lists: a price list's items and kits, not a catalogue page. */
const MAX_CHOICES = 500;

const SIZED_KIND: Partial<Record<string, SizingKind>> = {
  farmer_pumps: 'pump',
  residential_rooftop: 'rooftop',
};

/**
 * The quote builder of one lead (docs/design/phase1.md §7.3): the customer, the tier and the live
 * list a quote would be priced from today (null when there is none, so the builder can say why
 * before anyone types a line), the lead's newest sizing in words, and the items and kits priced on
 * that list with their prices. The prices are shown as the list holds them; every amount of the
 * quote is worked out on the server (`previewQuote`, `sales.quote.create`).
 */
export async function loadQuoteBuilder(
  ctx: BuilderContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<QuoteBuilderDto> {
  const input = parseQueryInput(QuoteBuilderInput, rawInput, 'sales.quote.builder');
  checkPermission(ctx.principal, 'sales.quote.create', 'own');
  const read = { ...ctx, now };
  const lead = await loadQuoteLead(read, input.entityId, input.opportunityId);
  const tier = await quoteTier(read, lead);
  const today = istCalendarDate(now);
  const priceListId =
    tier === null ? null : await livePriceList(read, tier.id, lead.entityId, today);
  const kind = SIZED_KIND[lead.segment];
  const sizing = await latestSizing(ctx, {
    entityId: lead.entityId,
    opportunityId: lead.id,
    ...(kind === undefined ? {} : { kind }),
  });

  const choices: QuoteChoiceDto[] = [];
  if (priceListId !== null) {
    const pli = schema.priceListItems;
    const i = schema.items;
    const k = schema.kits;
    const items = await ctx.tx
      .select({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, price: pli.price })
      .from(pli)
      .innerJoin(i, eq(i.id, pli.itemId))
      .where(and(eq(pli.priceListId, priceListId), eq(i.isActive, true), isNull(i.archivedAt)))
      .orderBy(asc(i.name), asc(i.id))
      .limit(MAX_CHOICES);
    const kits = await ctx.tx
      .select({ id: k.id, sku: k.sku, name: k.name, price: pli.price })
      .from(pli)
      .innerJoin(k, eq(k.id, pli.kitId))
      .where(and(eq(pli.priceListId, priceListId), eq(k.isActive, true), isNull(k.archivedAt)))
      .orderBy(asc(k.name), asc(k.id))
      .limit(MAX_CHOICES);
    for (const kit of kits) choices.push({ kind: 'kit', ...kit, unit: 'set' });
    for (const item of items) {
      choices.push({ kind: 'item', ...item, unit: ItemUnitSchema.parse(item.unit) });
    }
  }

  let summary: QuoteBuilderDto['sizing'] = null;
  if (sizing !== null) {
    if (isStaleSizing(sizing)) {
      summary = { kind: sizing.kind, inBounds: false, hp: null, kwp: null, stale: true };
    } else if (sizing.kind === 'pump') {
      summary = {
        kind: 'pump',
        inBounds: sizing.inBounds,
        hp: sizing.result.power.standardHp,
        kwp: sizing.result.solar?.arrayKwp ?? null,
        stale: false,
      };
    } else {
      summary = {
        kind: 'rooftop',
        inBounds: sizing.inBounds,
        hp: null,
        kwp: sizing.result.rooftop.recommendedKwp,
        stale: false,
      };
    }
  }

  return QuoteBuilderDto.parse({
    entityId: lead.entityId,
    opportunityId: lead.id,
    accountId: lead.accountId,
    customerName: lead.customerName,
    segment: lead.segment,
    pipelineName: lead.pipelineName,
    tierName: tier?.name ?? null,
    priceListId,
    sizing: summary,
    worksContractOffered: WORKSHOP_DEFAULTS.tax.compositeSegments.includes(lead.segment),
    choices: choices.slice(0, MAX_CHOICES),
    today,
  });
}

/**
 * A quote worked out exactly as `sales.quote.create` would make it now, without saving it: the
 * same guards, prices and tax, for the builder to show before the person makes it.
 */
export async function previewQuote(
  ctx: BuilderContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<QuotePreviewDto> {
  const input = parseQueryInput(CreateQuoteInput, rawInput, 'sales.quote.preview');
  checkPermission(ctx.principal, 'sales.quote.create', 'own');
  const built = await buildQuote({ ...ctx, now }, input);
  if (built.priced.lines.length === 0) throw new DomainError('internal', 'a quote with no lines');
  return QuotePreviewDto.parse({
    tierId: built.tier.id,
    tierName: built.tier.name,
    priceListId: built.priceListId,
    scheme: built.scheme,
    placeOfSupplyState: built.supply.stateCode,
    supplyKind: built.supply.kind,
    validUntil: built.validUntil.toISOString(),
    lines: built.priced.lines,
    totals: built.priced.totals,
  });
}
