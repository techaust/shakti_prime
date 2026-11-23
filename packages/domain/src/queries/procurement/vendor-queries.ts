import {
  CompareQuotesDto,
  CompareQuotesInput,
  DomainError,
  GetVendorInput,
  ListVendorsInput,
  VendorListPageDto,
  VendorSheetDto,
  VendorSheetWithQuotesDto,
  type CompareCellDto,
  type CompareRowDto,
  type ItemCategory,
  type ItemUnit,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, ilike, isNull, lte, or, sql } from 'drizzle-orm';
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

/**
 * Procurement › Compare: for one company, the items of a category down and the vendors with a
 * quote across. Each cell holds the vendor's lowest live quote for the item (the group's or the
 * company's), else the quote that ended last, shown expired. The lowest live rate of each row is
 * marked; an expired quote is never marked lowest. Withdrawn quotes and quotes not yet started are
 * left out.
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
  const q = schema.vendorQuotes;
  const i = schema.items;
  const v = schema.vendors;
  const rows = await ctx.tx
    .select({
      quoteId: q.id,
      vendorId: q.vendorId,
      vendorName: v.name,
      itemId: q.itemId,
      sku: i.sku,
      itemName: i.name,
      category: i.category,
      unit: i.unit,
      entityId: q.entityId,
      rate: q.rate,
      moq: q.moq,
      leadTimeDays: q.leadTimeDays,
      validUntil: q.validUntil,
      fileId: q.fileId,
    })
    .from(q)
    .innerJoin(i, eq(i.id, q.itemId))
    .innerJoin(v, eq(v.id, q.vendorId))
    .where(
      and(
        or(isNull(q.entityId), eq(q.entityId, input.entityId)),
        isNull(q.withdrawnAt),
        lte(q.validFrom, today),
        isNull(i.archivedAt),
        input.category === undefined ? undefined : eq(i.category, input.category),
      ),
    )
    .orderBy(asc(i.name), asc(i.id), asc(v.name), asc(v.id));

  const vendors = new Map<string, string>();
  const items = new Map<
    string,
    Omit<CompareRowDto, 'cells'> & { cells: Map<string, CompareCellDto> }
  >();
  for (const r of rows) {
    vendors.set(r.vendorId, r.vendorName);
    let item = items.get(r.itemId);
    if (item === undefined) {
      item = {
        itemId: r.itemId,
        sku: r.sku,
        itemName: r.itemName,
        category: r.category as ItemCategory,
        unit: r.unit as ItemUnit,
        cells: new Map(),
      };
      items.set(r.itemId, item);
    }
    const cell: CompareCellDto = {
      vendorId: r.vendorId,
      quoteId: r.quoteId,
      entityId: r.entityId,
      rate: r.rate,
      moq: r.moq,
      leadTimeDays: r.leadTimeDays,
      validUntil: r.validUntil,
      status: r.validUntil < today ? 'expired' : 'live',
      isLowest: false,
      fileId: r.fileId,
    };
    const held = item.cells.get(r.vendorId);
    if (held === undefined || better(cell, held)) item.cells.set(r.vendorId, cell);
  }

  const outRows: CompareRowDto[] = [...items.values()].map((item) => {
    const cells = [...item.cells.values()];
    const live = cells.filter((c) => c.status === 'live');
    if (live.length > 0) {
      const lowest = live.reduce(
        (min, c) => (rateUnits(c.rate) < min ? rateUnits(c.rate) : min),
        rateUnits(live[0]?.rate ?? '0.0000'),
      );
      for (const c of live) c.isLowest = rateUnits(c.rate) === lowest;
    }
    return { ...item, cells: cells.sort((a, b) => a.vendorId.localeCompare(b.vendorId)) };
  });

  return CompareQuotesDto.parse({
    entityId: input.entityId,
    category: input.category ?? null,
    asOf: today,
    vendors: [...vendors.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    rows: outRows,
  });
}

/**
 * Which of a vendor's quotes for one item the cell shows: a live one over an expired one; among
 * live ones the lowest rate, then the one that lasts longer; among expired ones the one that
 * ended last.
 */
function better(candidate: CompareCellDto, held: CompareCellDto): boolean {
  if (candidate.status !== held.status) return candidate.status === 'live';
  if (candidate.status === 'live') {
    const a = rateUnits(candidate.rate);
    const b = rateUnits(held.rate);
    if (a !== b) return a < b;
  }
  return candidate.validUntil > held.validUntil;
}
