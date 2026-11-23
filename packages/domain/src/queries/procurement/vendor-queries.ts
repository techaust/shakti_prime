import {
  CompareQuotesDto,
  COMPARE_EXPIRED_DAYS,
  CompareQuotesInput,
  DomainError,
  GetVendorInput,
  ListVendorsInput,
  VendorListPageDto,
  VendorSheetDto,
  VendorSheetWithQuotesDto,
  type CompareRowDto,
  type ItemCategory,
  type ItemUnit,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { containsPattern } from '../search-text';
import {
  assertRateReader,
  assertVendorReader,
  quoteDay,
  readQuotes,
  readsRates,
  readVendorSheet,
} from './vendor-read';

/**
 * Procurement's reads (docs/03-roadmap-appendix/phase3.md §6.3). The vendor list and the sheet
 * without quotes never read `vendor_quotes`; the quotes and the comparison are read only after the
 * caller's `procurement.rate.read` is checked, and row security narrows every quote row again to
 * the group's and the request's companies'.
 */

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const VendorCursor = z.object({ name: z.string(), id: z.string() }).strict();

/**
 * Procurement › Vendors: by name, a page at a time, with how many items each supplies. Active
 * vendors only unless asked; the `(is_active, name, id)` index serves the default page.
 */
export async function listVendors(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<VendorListPageDto> {
  assertVendorReader(ctx.principal);
  const input = parseQueryInput(ListVendorsInput, rawInput, 'procurement.vendors.list');
  const v = schema.vendors;
  const after = input.cursor === undefined ? undefined : decodeCursor(VendorCursor, input.cursor);
  const pattern = input.q === undefined ? undefined : containsPattern(input.q);
  const rows = await ctx.tx
    .select({
      id: v.id,
      name: v.name,
      gstin: v.gstin,
      stateCode: v.stateCode,
      city: sql<string | null>`${v.addressJson} ->> 'city'`,
      paymentTermsDays: v.paymentTermsDays,
      leadTimeDays: v.leadTimeDays,
      isActive: v.isActive,
      // qualified by hand: drizzle writes a bare column name inside a raw fragment
      itemCount: sql<number>`(select count(*)::int from item_vendors iv where iv.vendor_id = vendors.id)`,
    })
    .from(v)
    .where(
      and(
        input.includeArchived ? undefined : eq(v.isActive, true),
        pattern === undefined ? undefined : or(ilike(v.name, pattern), ilike(v.gstin, pattern)),
        after === undefined
          ? undefined
          : sql`(${v.name}, ${v.id}) > (${after.name}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(asc(v.name), asc(v.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return VendorListPageDto.parse({
    items: page,
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ name: last.name, id: last.id })
        : null,
  });
}

/**
 * The vendor sheet: the vendor, its people and the items it supplies, and, for a holder of
 * `procurement.rate.read`, the quotes they may read. A reader without the grant gets the shape
 * without quotes, built without reading them.
 */
export async function getVendor(
  ctx: QueryContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<VendorSheetDto | VendorSheetWithQuotesDto> {
  assertVendorReader(ctx.principal);
  const input = parseQueryInput(GetVendorInput, rawInput, 'procurement.vendors.get');
  const sheet = await readVendorSheet(ctx.tx, input.vendorId);
  if (!readsRates(ctx.principal)) return VendorSheetDto.parse(sheet);
  const quotes = await readQuotes(ctx.tx, ctx.principal, now, { vendorId: input.vendorId });
  return VendorSheetWithQuotesDto.parse({ ...sheet, quotes });
}

/** A rate of four decimals as a whole number of ten-thousandths, compared without floats. */
const rateUnits = (rate: string): bigint => BigInt(rate.replace('.', ''));

const CompareCursor = z.object({ name: z.string(), id: z.string() }).strict();

interface CellRow extends Record<string, unknown> {
  itemId: string;
  sku: string;
  itemName: string;
  category: string;
  unit: string;
  vendorId: string;
  vendorName: string;
  quoteId: string;
  entityId: number | null;
  rate: string;
  moq: string | null;
  leadTimeDays: number | null;
  validUntil: string;
  live: boolean;
  fileId: string | null;
}

/**
 * Procurement › Compare: for one company, the items of a category down and the vendors with a
 * quote across, a page of `COMPARE_PAGE_ITEMS` items at a time by name. The database chooses each
 * cell (review M6): of an active vendor's quotes for the item (the group's or the company's, not
 * withdrawn, already started), the lowest live one, else the one that ended last within
 * `COMPARE_EXPIRED_DAYS`, shown expired. Archived vendors are left out (review L1). The lowest live
 * rate of each row is marked; an expired quote is never marked lowest. An item shows only when it
 * has a cell.
 */
export async function compareQuotes(
  ctx: QueryContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<CompareQuotesDto> {
  assertRateReader(ctx.principal);
  const input = parseQueryInput(CompareQuotesInput, rawInput, 'procurement.quotes.compare');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const today = quoteDay(now);
  const after = input.cursor === undefined ? undefined : decodeCursor(CompareCursor, input.cursor);
  // The quotes a cell may show: the group's or the company's, of an active vendor, not withdrawn,
  // started, and live or ended within the window. Row security narrows them again.
  const shown = sql`(q.entity_id is null or q.entity_id = ${input.entityId})
      and q.withdrawn_at is null
      and q.valid_from <= ${today}::date
      and q.valid_until >= ${today}::date - ${COMPARE_EXPIRED_DAYS}::int
      and exists (select 1 from vendors v where v.id = q.vendor_id and v.is_active)`;
  const rows = (await ctx.tx.execute(sql`
    with page as (
      select i.id, i.sku, i.name, i.category, i.unit
        from items i
       where i.archived_at is null
         ${input.category === undefined ? sql`` : sql`and i.category = ${input.category}`}
         ${after === undefined ? sql`` : sql`and (i.name, i.id) > (${after.name}, ${after.id}::uuid)`}
         and exists (select 1 from vendor_quotes q where q.item_id = i.id and ${shown})
       order by i.name, i.id
       limit ${input.limit + 1}
    ),
    cells as (
      select distinct on (q.item_id, q.vendor_id)
             q.item_id, q.vendor_id, q.id, q.entity_id, q.rate, q.moq, q.lead_time_days,
             q.valid_until, q.file_id, (q.valid_until >= ${today}::date) as live
        from vendor_quotes q
       where q.item_id in (select id from page) and ${shown}
       order by q.item_id, q.vendor_id, (q.valid_until >= ${today}::date) desc,
                case when q.valid_until >= ${today}::date then q.rate end asc,
                q.valid_until desc, q.id
    )
    select p.id as "itemId", p.sku, p.name as "itemName", p.category, p.unit,
           c.vendor_id as "vendorId", v.name as "vendorName", c.id as "quoteId",
           c.entity_id as "entityId", c.rate::text as rate, c.moq::text as moq,
           c.lead_time_days as "leadTimeDays", c.valid_until::text as "validUntil", c.live,
           c.file_id as "fileId"
      from page p
      join cells c on c.item_id = p.id
      join vendors v on v.id = c.vendor_id
     order by p.name, p.id, v.name, v.id`)) as unknown as CellRow[];

  // The page's items in order; one more than the page says another page follows.
  const order: string[] = [];
  for (const r of rows) if (order.at(-1) !== r.itemId) order.push(r.itemId);
  const pageItems = new Set(order.slice(0, input.limit));
  const lastItem = order.length > input.limit ? order[input.limit - 1] : undefined;

  const vendors = new Map<string, string>();
  const items = new Map<string, CompareRowDto>();
  let lastName = '';
  for (const r of rows) {
    if (!pageItems.has(r.itemId)) continue;
    vendors.set(r.vendorId, r.vendorName);
    let item = items.get(r.itemId);
    if (item === undefined) {
      item = {
        itemId: r.itemId,
        sku: r.sku,
        itemName: r.itemName,
        category: r.category as ItemCategory,
        unit: r.unit as ItemUnit,
        cells: [],
      };
      items.set(r.itemId, item);
    }
    if (r.itemId === lastItem) lastName = r.itemName;
    item.cells.push({
      vendorId: r.vendorId,
      quoteId: r.quoteId,
      entityId: r.entityId,
      rate: r.rate,
      moq: r.moq,
      leadTimeDays: r.leadTimeDays,
      validUntil: r.validUntil,
      status: r.live ? 'live' : 'expired',
      isLowest: false,
      fileId: r.fileId,
    });
  }
  for (const item of items.values()) {
    const live = item.cells.filter((c) => c.status === 'live');
    const first = live[0];
    if (first === undefined) continue;
    const lowest = live.reduce(
      (min, c) => (rateUnits(c.rate) < min ? rateUnits(c.rate) : min),
      rateUnits(first.rate),
    );
    for (const c of live) c.isLowest = rateUnits(c.rate) === lowest;
  }

  return CompareQuotesDto.parse({
    entityId: input.entityId,
    category: input.category ?? null,
    asOf: today,
    vendors: [...vendors.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    rows: [...items.values()],
    nextCursor: lastItem === undefined ? null : encodeCursor({ name: lastName, id: lastItem }),
  });
}
