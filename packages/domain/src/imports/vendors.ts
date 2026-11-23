import {
  DomainError,
  VendorImportRowInput,
  type ImportCreatedType,
  type ImportRowErrorDto,
  type VendorImportField,
  type VendorImportMapping,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { eq } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { setVendorContacts } from '../commands/procurement/vendor-links';
import { createVendor, updateVendor } from '../commands/procurement/vendors';
import { readContacts, toVendorDto } from '../queries/procurement/vendor-read';
import type { BatchRow } from './commit-leads';

/**
 * U1: the vendors import kind (docs/03-roadmap-appendix/phase3.md §6.3): a vendor list's rows
 * become vendors of the group, a GSTIN already in the master updating that vendor. Every row is
 * written through `procurement.vendor.create`, `.update` and `.contact.set`, so the importer needs
 * `procurement.po.write` as well as `imports.write`, and the commands' own checks apply.
 */

/** What the preview found for one row of a vendor list. */
export type VendorRowCheck =
  | { state: 'valid'; input: VendorImportRowInput; gstin: string | null; errors: [] }
  | { state: 'invalid'; input: null; gstin: null; errors: ImportRowErrorDto[] };

/** Where an input path points among the fields a file can fill. */
const FIELD_OF_PATH: Readonly<Record<string, VendorImportField>> = {
  'vendor.name': 'vendorName',
  'vendor.gstin': 'gstin',
  'vendor.stateCode': 'gstin',
  'vendor.pan': 'pan',
  'vendor.address.line1': 'addressLine',
  'vendor.address.city': 'city',
  'vendor.address.pin': 'pin',
  'vendor.paymentTermsDays': 'paymentTermsDays',
  'vendor.leadTimeDays': 'leadTimeDays',
  'contact.name': 'personName',
  'contact.role': 'personRole',
  'contact.phone': 'personPhone',
  'contact.email': 'personEmail',
};

/** A whole number of days as a cell gives it; anything else stays text, for the check to refuse. */
function days(value: string | undefined): number | string | undefined {
  if (value === undefined) return undefined;
  return /^\d{1,3}$/.test(value) ? Number(value) : value;
}

/**
 * Checks one row of a vendor list and answers the vendor it becomes, or its findings, one per
 * field. A person's phone, email or role without their name is refused, since a person is kept
 * by name.
 */
export function checkVendorRow(
  raw: Readonly<Record<string, string>>,
  mapping: VendorImportMapping,
): VendorRowCheck {
  const cell = (field: VendorImportField): string | undefined => {
    const column = mapping.columns[field];
    const value = column === undefined ? '' : (raw[column] ?? '').replace(/\s+/g, ' ').trim();
    return value === '' ? undefined : value;
  };
  const errors = new Map<string, ImportRowErrorDto>();
  const add = (error: ImportRowErrorDto) => {
    if (!errors.has(error.field)) errors.set(error.field, error);
  };

  const address = {
    ...(cell('addressLine') === undefined ? {} : { line1: cell('addressLine') }),
    ...(cell('city') === undefined ? {} : { city: cell('city') }),
    ...(cell('pin') === undefined ? {} : { pin: cell('pin') }),
  };
  const vendor: Record<string, unknown> = {
    name: cell('vendorName'),
    ...(cell('gstin') === undefined ? {} : { gstin: cell('gstin') }),
    ...(cell('pan') === undefined ? {} : { pan: cell('pan') }),
    address,
    ...(cell('paymentTermsDays') === undefined
      ? {}
      : { paymentTermsDays: days(cell('paymentTermsDays')) }),
    ...(cell('leadTimeDays') === undefined ? {} : { leadTimeDays: days(cell('leadTimeDays')) }),
  };
  const person = {
    name: cell('personName'),
    role: cell('personRole'),
    phone: cell('personPhone'),
    email: cell('personEmail'),
  };
  const hasPerson = Object.values(person).some((v) => v !== undefined);
  const candidate: Record<string, unknown> = {
    vendor,
    ...(hasPerson
      ? {
          contact: Object.fromEntries(
            Object.entries(person).filter(([key, v]) => v !== undefined || key === 'name'),
          ),
        }
      : {}),
  };

  const parsed = VendorImportRowInput.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String);
      const field =
        FIELD_OF_PATH[path.slice(0, 3).join('.')] ??
        FIELD_OF_PATH[path.slice(0, 2).join('.')] ??
        'row';
      let at: unknown = candidate;
      for (const key of path) at = (at as Record<string, unknown> | undefined)?.[key];
      if (at === undefined) add({ field, code: 'required' });
      else if (field === 'personPhone') add({ field, code: 'phone_invalid' });
      else if (issue.code === 'too_big' && typeof at === 'string') add({ field, code: 'too_long' });
      else add({ field, code: 'invalid' });
    }
  }
  if (!parsed.success || errors.size > 0) {
    return { state: 'invalid', input: null, gstin: null, errors: [...errors.values()] };
  }
  return {
    state: 'valid',
    input: parsed.data,
    gstin: parsed.data.vendor.gstin ?? null,
    errors: [],
  };
}

/** The vendors of the master with these GSTINs, by GSTIN, with whether each is active. */
export async function vendorsByGstin(
  tx: RequestTx,
  gstins: readonly string[],
): Promise<Map<string, { id: string; isActive: boolean }>> {
  const found = new Map<string, { id: string; isActive: boolean }>();
  for (const gstin of new Set(gstins)) {
    const [row] = await tx
      .select({ id: schema.vendors.id, isActive: schema.vendors.isActive })
      .from(schema.vendors)
      .where(eq(schema.vendors.gstin, gstin))
      .limit(1);
    if (row) found.set(gstin, row);
  }
  return found;
}

/**
 * Commits one row of a vendor list: a new vendor, or the vendor with the row's GSTIN updated with
 * what the row gives (what it leaves blank stays as it is), and the row's person added to the
 * vendor's people unless one of that name is there already or the vendor has twenty. A GSTIN of an
 * archived vendor is refused (`vendor_archived`). Each change is the command's own, run inside the
 * batch, which writes one summary audit row.
 */
export async function commitVendorRow(
  ctx: CommandContext,
  tx: RequestTx,
  row: BatchRow,
): Promise<{ id: string; type: ImportCreatedType }> {
  const input = VendorImportRowInput.parse(row.input);
  const nested = { tx, auditedByCaller: true, inImportBatch: true };
  const v = input.vendor;
  const existing =
    v.gstin === undefined ? undefined : (await vendorsByGstin(tx, [v.gstin])).get(v.gstin);
  if (existing !== undefined && !existing.isActive) {
    throw new DomainError('conflict', 'the GSTIN is an archived vendor’s', {
      reason: 'vendor_archived',
    });
  }

  let vendorId: string;
  let type: ImportCreatedType;
  if (existing === undefined) {
    const made = await ctx.run(createVendor, v, nested);
    vendorId = made.id;
    type = 'vendor';
  } else {
    const [current] = await tx
      .select()
      .from(schema.vendors)
      .where(eq(schema.vendors.id, existing.id))
      .limit(1);
    if (!current) {
      throw new DomainError('not_found', 'vendor is not readable', { reason: 'vendor_missing' });
    }
    const now = toVendorDto(current);
    const changed = {
      vendorId: existing.id,
      name: v.name,
      gstin: v.gstin,
      pan: v.pan ?? now.pan,
      address: Object.keys(v.address).length > 0 ? v.address : now.address,
      paymentTermsDays: v.paymentTermsDays ?? now.paymentTermsDays,
      leadTimeDays: v.leadTimeDays ?? now.leadTimeDays,
      notes: now.notes,
    };
    await ctx.run(updateVendor, changed, nested);
    vendorId = existing.id;
    type = 'vendor_update';
  }

  const person = input.contact;
  if (person !== undefined) {
    const people = await readContacts(tx, vendorId);
    const known = people.some((p) => p.name.toLowerCase() === person.name.toLowerCase());
    if (!known && people.length < 20) {
      const contacts = {
        vendorId,
        contacts: [
          ...people.map((p) => ({ name: p.name, role: p.role, phone: p.phone, email: p.email })),
          person,
        ],
      };
      await ctx.run(setVendorContacts, contacts, nested);
    }
  }
  return { id: vendorId, type };
}
