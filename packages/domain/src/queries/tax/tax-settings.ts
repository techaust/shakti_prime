import { TaxSettingsDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { asc, desc, eq, sql } from 'drizzle-orm';

/**
 * Whether the request acts for every active company (`app.request_covers_group()`), as a change
 * to a shared price list, a GST rate or a composite split needs (AUDIT H2, 0048).
 */
export async function requestCoversAllCompanies(ctx: Pick<RequestContext, 'tx'>): Promise<boolean> {
  const rows = (await ctx.tx.execute(sql`select app.request_covers_group() as ok`)) as unknown as {
    ok: boolean;
  }[];
  return rows[0]?.ok === true;
}

/** The most rows the screen lists of either table; the group's rates run to a few hundred. */
const MOST = 2000;

/**
 * Settings › Tax (SAL-02, ADR 0007): every GST rate by HSN code or item, and every
 * composite-supply rule by segment, each with its period, newest first within its code. The
 * tables carry no company: every reader with a request context reads the same rows.
 */
export async function readTaxSettings(ctx: Pick<RequestContext, 'tx'>): Promise<TaxSettingsDto> {
  const tr = schema.taxRates;
  const i = schema.items;
  const rates = await ctx.tx
    .select({
      id: tr.id,
      hsn: tr.hsn,
      itemId: tr.itemId,
      ratePct: tr.ratePct,
      effectiveFrom: tr.effectiveFrom,
      effectiveTo: tr.effectiveTo,
      sourceRef: tr.sourceRef,
      itemSku: i.sku,
      itemName: i.name,
    })
    .from(tr)
    .leftJoin(i, eq(i.id, tr.itemId))
    .orderBy(asc(tr.hsn), asc(i.sku), desc(tr.effectiveFrom), asc(tr.id))
    .limit(MOST);
  const cr = schema.compositeSupplyRules;
  const compositeRules = await ctx.tx
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
    .orderBy(asc(cr.segment), desc(cr.effectiveFrom), asc(cr.id))
    .limit(MOST);
  const coversAllCompanies = await requestCoversAllCompanies(ctx);
  return TaxSettingsDto.parse({ rates, compositeRules, coversAllCompanies });
}
