import {
  DomainError,
  hasGrant,
  type ItemVendorDto,
  type Principal,
  type VendorAddress,
  type VendorContactDto,
  type VendorDto,
  type VendorQuoteDto,
  type VendorQuoteStatus,
  type VendorSheetDto,
  VendorKindSchema,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { istCalendarDate } from '../../numbering/financial-year';

/**
 * Readers of the vendor master and of supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3).
 * The master's readers never touch `vendor_quotes`; the quote readers are called only after
 * `assertRateReader()`, and row security narrows them again to the quotes the caller may read.
 */

type VendorRow = typeof schema.vendors.$inferSelect;
type ContactRow = typeof schema.vendorContacts.$inferSelect;
type QuoteRow = typeof schema.vendorQuotes.$inferSelect;

/** Whether the caller reads the vendor master: `inventory.stock.read` or `procurement.po.write`. */
export function readsVendors(principal: Principal): boolean {
  return (
    hasGrant(principal.permissions, 'inventory.stock.read', 'own') ||
    hasGrant(principal.permissions, 'procurement.po.write', 'entity')
  );
}

/** Refuses a caller who may not read the vendor master, before any query runs. */
export function assertVendorReader(principal: Principal): void {
  if (!readsVendors(principal)) {
    throw new DomainError(
      'forbidden',
      `${principal.roleKey} reads no vendor: inventory.stock.read or procurement.po.write needed`,
      { permission: 'inventory.stock.read', scope: 'own' },
    );
  }
}

/** Whether the caller reads supplier rates. */
export function readsRates(principal: Principal): boolean {
  return hasGrant(principal.permissions, 'procurement.rate.read', 'entity');
}

/** Refuses a caller without `procurement.rate.read`, before any rate is read. */
export function assertRateReader(principal: Principal): void {
  if (!readsRates(principal)) {
    throw new DomainError('forbidden', `${principal.roleKey} lacks procurement.rate.read:entity`, {
      permission: 'procurement.rate.read',
      scope: 'entity',
    });
  }
}

/** The stored address as the DTO takes it: only the known lines, each a string. */
function toAddress(value: unknown): VendorAddress {
  const out: VendorAddress = {};
  if (value === null || typeof value !== 'object') return out;
  const raw = value as Record<string, unknown>;
  for (const key of ['line1', 'line2', 'city', 'pin'] as const) {
    const line = raw[key];
    if (typeof line === 'string' && line !== '') out[key] = line;
  }
  return out;
}

export function toVendorDto(row: VendorRow): VendorDto {
  return {
    id: row.id,
    name: row.name,
    gstin: row.gstin,
    stateCode: row.stateCode,
    pan: row.pan,
    address: toAddress(row.addressJson),
    paymentTermsDays: row.paymentTermsDays,
    leadTimeDays: row.leadTimeDays,
    kind: VendorKindSchema.parse(row.kind),
    isActive: row.isActive,
    notes: row.notes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toContactDto(row: ContactRow): VendorContactDto {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    phone: row.phoneE164,
    email: row.email,
    position: row.position,
  };
}

/** The vendor as the caller reads it, or `vendor_missing`. */
export async function readVendor(tx: RequestTx, vendorId: string): Promise<VendorRow> {
  const [row] = await tx
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.id, vendorId))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `vendor ${vendorId} is not readable`, {
      reason: 'vendor_missing',
    });
  }
  return row;
}

export async function readContacts(tx: RequestTx, vendorId: string): Promise<VendorContactDto[]> {
  const rows = await tx
    .select()
    .from(schema.vendorContacts)
    .where(eq(schema.vendorContacts.vendorId, vendorId))
    .orderBy(asc(schema.vendorContacts.position));
  return rows.map(toContactDto);
}

/** The items a vendor supplies, by name; or one link when `itemId` is given. */
export async function readItemLinks(
  tx: RequestTx,
  vendorId: string,
  itemId?: string,
): Promise<ItemVendorDto[]> {
  const iv = schema.itemVendors;
  const i = schema.items;
  const rows = await tx
    .select({ link: iv, item: { sku: i.sku, name: i.name, category: i.category, unit: i.unit } })
    .from(iv)
    .innerJoin(i, eq(i.id, iv.itemId))
    .where(
      itemId === undefined
        ? eq(iv.vendorId, vendorId)
        : and(eq(iv.vendorId, vendorId), eq(iv.itemId, itemId)),
    )
    .orderBy(asc(i.name), asc(iv.id));
  return rows.map((r) => ({
    id: r.link.id,
    vendorId: r.link.vendorId,
    itemId: r.link.itemId,
    sku: r.item.sku,
    itemName: r.item.name,
    category: r.item.category as ItemVendorDto['category'],
    unit: r.item.unit as ItemVendorDto['unit'],
    vendorItemCode: r.link.vendorItemCode,
    isPreferred: r.link.isPreferred,
  }));
}

/**
 * The vendor sheet without a rate: the vendor, its people and the items it supplies. Built without
 * reading `vendor_quotes`, so no rate can reach it whoever calls it.
 */
export async function readVendorSheet(tx: RequestTx, vendorId: string): Promise<VendorSheetDto> {
  const vendor = await readVendor(tx, vendorId);
  return {
    vendor: toVendorDto(vendor),
    contacts: await readContacts(tx, vendorId),
    items: await readItemLinks(tx, vendorId),
  };
}

/** Where a quote stands on `today` (an IST calendar date). */
export function quoteStatus(
  row: Pick<QuoteRow, 'validFrom' | 'validUntil' | 'withdrawnAt'>,
  today: string,
): VendorQuoteStatus {
  if (row.withdrawnAt !== null) return 'withdrawn';
  if (today < row.validFrom) return 'upcoming';
  if (today > row.validUntil) return 'expired';
  return 'live';
}

/** Today in IST, the day quotes are judged on. */
export function quoteDay(now: Date): string {
  return istCalendarDate(now);
}

/**
 * Supplier quotes for a holder of `procurement.rate.read` (checked here, and by row security on
 * every row): a vendor's, or one quote by id. Newest validity first.
 */
export async function readQuotes(
  tx: RequestTx,
  principal: Principal,
  now: Date,
  where: { vendorId: string } | { quoteId: string },
): Promise<VendorQuoteDto[]> {
  assertRateReader(principal);
  const q = schema.vendorQuotes;
  const v = schema.vendors;
  const i = schema.items;
  const rows = await tx
    .select({
      quote: q,
      vendorName: v.name,
      item: { sku: i.sku, name: i.name, unit: i.unit },
    })
    .from(q)
    .innerJoin(v, eq(v.id, q.vendorId))
    .innerJoin(i, eq(i.id, q.itemId))
    .where('vendorId' in where ? eq(q.vendorId, where.vendorId) : eq(q.id, where.quoteId))
    .orderBy(desc(q.validUntil), asc(i.name), asc(q.id));
  const today = quoteDay(now);
  return rows.map((r) => ({
    id: r.quote.id,
    vendorId: r.quote.vendorId,
    vendorName: r.vendorName,
    itemId: r.quote.itemId,
    sku: r.item.sku,
    itemName: r.item.name,
    unit: r.item.unit as VendorQuoteDto['unit'],
    entityId: r.quote.entityId,
    rate: r.quote.rate,
    moq: r.quote.moq,
    leadTimeDays: r.quote.leadTimeDays,
    validFrom: r.quote.validFrom,
    validUntil: r.quote.validUntil,
    fileId: r.quote.fileId,
    status: quoteStatus(r.quote, today),
    recordedAt: r.quote.createdAt.toISOString(),
    withdrawnAt: r.quote.withdrawnAt?.toISOString() ?? null,
  }));
}
