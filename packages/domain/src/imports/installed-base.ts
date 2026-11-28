import {
  InstalledBaseImportRowInput,
  normaliseIndianPhone,
  type ImportRowErrorDto,
  type InstalledBaseImportField,
  type InstalledBaseImportMapping,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { istCalendarDate } from '../numbering/financial-year';
import { parseSheetDate, warrantyUntilFrom } from '../warranty/dates';
import type { BatchRow } from './commit-leads';

/**
 * R3's installed base (docs/03-roadmap-appendix/phase3.md §7.5): serials the company sold before
 * go-live, entered as `with_customer` with their customer, site, delivery date and warranty, and
 * no stock movement, so a warranty claim can be raised on them. The preview finds each row's item,
 * customer and site; the commit adds the batch through `app.installed_base_add()`, and the
 * rollback takes back, through `app.installed_base_remove()`, each serial nothing has used since.
 */

/** What the preview found for one row. */
export type InstalledBaseRowFinding =
  | { state: 'valid'; input: InstalledBaseImportRowInput }
  | { state: 'invalid'; errors: ImportRowErrorDto[] };

interface FileRow {
  rowNo: number;
  raw: Readonly<Record<string, string>>;
}

/**
 * Checks every row of an installed base file for the job's company: the item by its stock code
 * (tracked by serial), the serial (new for the item, once in the file), the customer by mobile
 * number among the company's customers, the site by its village (the customer's only site when
 * the cell is blank), the delivery date (not ahead of today in India) and the warranty's end
 * (given, or the item's warranty months from delivery).
 */
export async function previewInstalledBase(
  tx: RequestTx,
  rows: readonly FileRow[],
  mapping: InstalledBaseImportMapping,
  entityId: number,
  now: Date,
): Promise<InstalledBaseRowFinding[]> {
  const cellOf =
    (raw: Readonly<Record<string, string>>) =>
    (field: InstalledBaseImportField): string => {
      const column = mapping.columns[field];
      return column === undefined ? '' : (raw[column] ?? '').trim();
    };
  const today = istCalendarDate(now);
  const [company] = await tx
    .select({
      code: schema.entities.code,
      brand: schema.entities.brandName,
      legal: schema.entities.legalName,
    })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId));
  const companyNames = new Set(
    [company?.code, company?.brand, company?.legal].flatMap((n) => (n ? [n.toLowerCase()] : [])),
  );

  const skus = [...new Set(rows.map((r) => cellOf(r.raw)('sku').toUpperCase()).filter(Boolean))];
  const i = schema.items;
  const items =
    skus.length === 0
      ? []
      : await tx
          .select({
            id: i.id,
            sku: i.sku,
            tracked: i.isSerialTracked,
            months: i.warrantyMonths,
            active: sql<boolean>`(${i.isActive} and ${i.archivedAt} is null)`,
          })
          .from(i)
          .where(inArray(i.sku, skus));
  const itemOf = new Map(items.map((x) => [x.sku, x]));

  // The item's serials already entered, by number in any case (of the companies the request sees;
  // a serial of another company is refused by the unique index when the row is added).
  const held = new Set<string>();
  const tracked = items.filter((x) => x.tracked).map((x) => x.id);
  if (tracked.length > 0) {
    const s = schema.serials;
    const existing = await tx
      .select({ itemId: s.itemId, serialNo: s.serialNo })
      .from(s)
      .where(inArray(s.itemId, tracked));
    for (const e of existing) held.add(`${e.itemId}/${e.serialNo.toLowerCase()}`);
  }

  // The company's customers by mobile number.
  const phones = [
    ...new Set(
      rows.flatMap((r) => {
        const phone = normaliseIndianPhone(cellOf(r.raw)('phone'));
        return phone === null ? [] : [phone];
      }),
    ),
  ];
  const customers =
    phones.length === 0
      ? []
      : ((await tx.execute(sql`
          select distinct cp.e164 as phone, ac.account_id as "accountId"
            from contact_phones cp
            join account_contacts ac on ac.contact_id = cp.contact_id
            join account_entities ae on ae.account_id = ac.account_id and ae.entity_id = ${entityId}
           where cp.e164 = any(${`{${phones.join(',')}}`}::text[])`)) as unknown as {
          phone: string;
          accountId: string;
        }[]);
  const accountsOf = new Map<string, Set<string>>();
  for (const c of customers) {
    const set = accountsOf.get(c.phone) ?? new Set<string>();
    set.add(c.accountId);
    accountsOf.set(c.phone, set);
  }
  const accountIds = [...new Set(customers.map((c) => c.accountId))];
  const cs = schema.customerSites;
  const sites =
    accountIds.length === 0
      ? []
      : await tx
          .select({ id: cs.id, accountId: cs.accountId, village: cs.village })
          .from(cs)
          .where(and(inArray(cs.accountId, accountIds)));
  const sitesOf = new Map<string, { id: string; village: string | null }[]>();
  for (const site of sites) {
    sitesOf.set(site.accountId, [...(sitesOf.get(site.accountId) ?? []), site]);
  }

  const seen = new Set<string>();
  return rows.map((row): InstalledBaseRowFinding => {
    const cell = cellOf(row.raw);
    const errors = new Map<string, ImportRowErrorDto>();
    const add = (error: ImportRowErrorDto) => {
      if (!errors.has(error.field)) errors.set(error.field, error);
    };
    const companyCell = cell('company');
    if (companyCell !== '' && !companyNames.has(companyCell.toLowerCase())) {
      add({ field: 'company', code: 'company_mismatch' });
    }
    const skuCell = cell('sku').toUpperCase();
    const item = itemOf.get(skuCell);
    if (skuCell === '') add({ field: 'sku', code: 'required' });
    else if (item === undefined) add({ field: 'sku', code: 'sku_unknown' });
    else if (!item.active) add({ field: 'sku', code: 'item_not_stockable' });
    else if (!item.tracked) add({ field: 'sku', code: 'serial_not_tracked' });

    const serialCell = cell('serialNo');
    if (serialCell === '') add({ field: 'serialNo', code: 'required' });
    else if (serialCell.length > 100) add({ field: 'serialNo', code: 'too_long' });
    else if (item !== undefined) {
      const key = `${item.id}/${serialCell.toLowerCase()}`;
      if (held.has(key) || seen.has(key)) add({ field: 'serialNo', code: 'serial_taken' });
      seen.add(key);
    }

    const phoneCell = cell('phone');
    const phone = normaliseIndianPhone(phoneCell);
    const owners = phone === null ? undefined : accountsOf.get(phone);
    if (phoneCell === '') add({ field: 'phone', code: 'required' });
    else if (phone === null) add({ field: 'phone', code: 'phone_invalid' });
    else if (owners?.size !== 1) add({ field: 'phone', code: 'customer_unknown' });
    const accountId = owners?.size === 1 ? [...owners][0] : undefined;

    let siteId: string | null = null;
    if (accountId !== undefined) {
      const theirs = sitesOf.get(accountId) ?? [];
      const village = cell('village').toLowerCase();
      if (village === '') {
        siteId = theirs.length === 1 ? (theirs[0]?.id ?? null) : null;
      } else {
        const match = theirs.filter((s) => (s.village ?? '').trim().toLowerCase() === village);
        if (match.length === 0) add({ field: 'village', code: 'site_unknown' });
        siteId = match[0]?.id ?? null;
      }
    }

    const deliveredCell = cell('deliveredOn');
    const deliveredOn = parseSheetDate(deliveredCell);
    if (deliveredCell === '') add({ field: 'deliveredOn', code: 'required' });
    else if (deliveredOn === undefined || deliveredOn > today) {
      add({ field: 'deliveredOn', code: 'date_invalid' });
    }
    const untilCell = cell('warrantyUntil');
    let warrantyUntil: string | undefined;
    if (untilCell !== '') {
      warrantyUntil = parseSheetDate(untilCell);
      // A warranty ends on or after its delivery (two date columns swapped end before it).
      if (
        warrantyUntil === undefined ||
        (deliveredOn !== undefined && warrantyUntil < deliveredOn)
      ) {
        add({ field: 'warrantyUntil', code: 'date_invalid' });
      }
    } else if (deliveredOn !== undefined && item?.tracked === true && item.active) {
      if (item.months === null) add({ field: 'warrantyUntil', code: 'warranty_unknown' });
      else warrantyUntil = warrantyUntilFrom(deliveredOn, item.months);
    }

    if (
      errors.size > 0 ||
      item === undefined ||
      accountId === undefined ||
      deliveredOn === undefined ||
      warrantyUntil === undefined
    ) {
      return { state: 'invalid', errors: [...errors.values()] };
    }
    return {
      state: 'valid',
      input: InstalledBaseImportRowInput.parse({
        itemId: item.id,
        serialNo: serialCell,
        accountId,
        siteId,
        deliveredOn,
        warrantyUntil,
      }),
    };
  });
}

/** A row the database refused when it was added, as the row's finding (`rowRefusal`). */
export class InstalledBaseRowRefused extends Error {
  readonly finding: ImportRowErrorDto;

  constructor(finding: ImportRowErrorDto) {
    super('an installed base row was refused at commit');
    this.name = 'InstalledBaseRowRefused';
    this.finding = finding;
  }
}

/**
 * Why the database refused one row, by the constraint it named: a serial number another company
 * holds (which the preview cannot see), or a customer, site or date changed since the preview.
 */
const REFUSED_BY: Readonly<Record<string, ImportRowErrorDto>> = {
  serials_item_serial_no_unique: { field: 'serialNo', code: 'serial_taken' },
  serial_not_tracked: { field: 'sku', code: 'serial_not_tracked' },
  customer_unknown: { field: 'phone', code: 'customer_unknown' },
  site_unknown: { field: 'village', code: 'site_unknown' },
  date_invalid: { field: 'deliveredOn', code: 'date_invalid' },
  warranty_before_delivery: { field: 'warrantyUntil', code: 'date_invalid' },
};

function refusalOf(error: unknown): ImportRowErrorDto | undefined {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const constraint = (cause as { constraint_name?: unknown } | null)?.constraint_name;
  return typeof constraint === 'string' ? REFUSED_BY[constraint] : undefined;
}

/** One row, whose refusal by the database becomes its finding rather than the job's failure. */
export async function commitInstalledBaseRow(
  tx: RequestTx,
  jobId: string,
  row: BatchRow,
): Promise<string | null> {
  try {
    const [made] = await commitInstalledBaseBatch(tx, jobId, [row]);
    return made?.id ?? null;
  } catch (error) {
    const finding = refusalOf(error);
    if (finding !== undefined) throw new InstalledBaseRowRefused(finding);
    throw error;
  }
}

/**
 * Adds a batch of an installed base job through `app.installed_base_add()`, which checks the
 * grants, the job, each customer and site again; answers each row's new serial.
 */
export async function commitInstalledBaseBatch(
  tx: RequestTx,
  jobId: string,
  rows: readonly BatchRow[],
): Promise<{ rowNo: number; id: string }[]> {
  if (rows.length === 0) return [];
  const lines = rows.map((row) => {
    const input = InstalledBaseImportRowInput.parse(row.input);
    return {
      item_id: input.itemId,
      serial_no: input.serialNo,
      account_id: input.accountId,
      site_id: input.siteId,
      delivered_on: input.deliveredOn,
      warranty_until: input.warrantyUntil,
    };
  });
  const [added] = (await tx.execute(
    sql`select app.installed_base_add(${jobId}::uuid, ${JSON.stringify(lines)}::jsonb) as ids`,
  )) as unknown as { ids: string[] }[];
  const ids = added?.ids ?? [];
  return rows.map((row, index) => ({ rowNo: row.rowNo, id: ids[index] ?? '' }));
}

/**
 * Takes back the serials an installed base job added that nothing has used since; answers how
 * many it removed and how many it kept.
 */
export async function undoInstalledBase(
  tx: RequestTx,
  jobId: string,
  serialIds: readonly string[],
): Promise<{ removed: number; kept: number }> {
  if (serialIds.length === 0) return { removed: 0, kept: 0 };
  const [done] = (await tx.execute(
    sql`select app.installed_base_remove(${jobId}::uuid, ${`{${serialIds.join(',')}}`}::uuid[]) as n`,
  )) as unknown as { n: number }[];
  const removed = done?.n ?? 0;
  return { removed, kept: serialIds.length - removed };
}
