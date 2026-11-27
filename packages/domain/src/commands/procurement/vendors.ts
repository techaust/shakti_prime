import {
  ArchiveVendorInput,
  CreateVendorInput,
  DomainError,
  newId,
  UpdateVendorInput,
  VendorDto,
  type VendorAddress,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { toVendorDto } from '../../queries/procurement/vendor-read';
import { eventEntity } from '../catalogue/shared';

/**
 * The group's vendor master (docs/03-roadmap-appendix/phase3.md §6.3, question 6 (a)): one list
 * for every company, so any holder of `procurement.po.write` adds or edits a vendor, audited. No
 * agent runs these commands, and none of them reads or writes a rate.
 */

type VendorRow = typeof schema.vendors.$inferSelect;

/** Every field a vendor's audit rows may carry. */
export const VENDOR_AUDIT_FIELDS = [
  'vendorName',
  'gstin',
  'stateCode',
  'pan',
  'address',
  'paymentTermsDays',
  'leadTimeDays',
  'isActive',
  'note',
] as const;

/** The address on one line, as the Activity log shows it. */
function addressLine(address: VendorAddress): string | null {
  const parts = [address.line1, address.line2, address.city, address.pin].filter(
    (p): p is string => p !== undefined,
  );
  return parts.length === 0 ? null : parts.join(', ');
}

/** The audited form of a vendor: what a person edits, never an id or a date. */
function auditedVendor(row: VendorRow) {
  return {
    vendorName: row.name,
    gstin: row.gstin,
    stateCode: row.stateCode,
    pan: row.pan,
    address: addressLine(toVendorDto(row).address),
    paymentTermsDays: row.paymentTermsDays,
    leadTimeDays: row.leadTimeDays,
    isActive: row.isActive,
    note: row.notes,
  };
}

/**
 * The vendor, locked for a change, or `vendor_missing`; an archived one answers `vendor_archived`
 * unless `archivedToo`.
 */
export async function lockVendor(
  ctx: CommandContext,
  vendorId: string,
  options: { archivedToo?: boolean } = {},
): Promise<VendorRow> {
  const [row] = await ctx.tx
    .select()
    .from(schema.vendors)
    .where(eq(schema.vendors.id, vendorId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `vendor ${vendorId} is not readable`, {
      reason: 'vendor_missing',
    });
  }
  if (!row.isActive && options.archivedToo !== true) {
    throw new DomainError('conflict', `vendor ${vendorId} is archived`, {
      reason: 'vendor_archived',
    });
  }
  return row;
}

/** `procurement.vendor.create`: a vendor of the group. */
export const createVendor = defineCommand({
  name: 'procurement.vendor.create',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: CreateVendorInput,
  output: VendorDto,
  auditFields: VENDOR_AUDIT_FIELDS,
  constraintReasons: { vendors_gstin_unique: 'vendor_gstin_taken' },
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .insert(schema.vendors)
      .values({
        id: newId(),
        name: input.name,
        gstin: input.gstin ?? null,
        stateCode: input.stateCode ?? null,
        pan: input.pan ?? null,
        addressJson: input.address,
        paymentTermsDays: input.paymentTermsDays ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'vendor insert returned no row');
    ctx.audit({
      aggregateType: 'vendor',
      aggregateId: row.id,
      entityId: null,
      before: null,
      after: auditedVendor(row),
    });
    ctx.emit({
      type: 'procurement.vendor.created',
      entityId: eventEntity(ctx),
      aggregateType: 'vendor',
      aggregateId: row.id,
      payload: {},
    });
    return toVendorDto(row);
  },
});

/** `procurement.vendor.update`: every field of an active vendor, as the vendor sheet sends it. */
export const updateVendor = defineCommand({
  name: 'procurement.vendor.update',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: UpdateVendorInput,
  output: VendorDto,
  auditFields: VENDOR_AUDIT_FIELDS,
  constraintReasons: { vendors_gstin_unique: 'vendor_gstin_taken' },
  async handler(ctx, input) {
    const before = await lockVendor(ctx, input.vendorId);
    const [row] = await ctx.tx
      .update(schema.vendors)
      .set({
        name: input.name,
        gstin: input.gstin ?? null,
        stateCode: input.stateCode ?? null,
        pan: input.pan ?? null,
        addressJson: input.address,
        paymentTermsDays: input.paymentTermsDays ?? null,
        leadTimeDays: input.leadTimeDays ?? null,
        notes: input.notes ?? null,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.vendors.id, input.vendorId))
      .returning();
    if (!row) throw new DomainError('internal', 'vendor update returned no row');
    ctx.audit({
      aggregateType: 'vendor',
      aggregateId: row.id,
      entityId: null,
      before: auditedVendor(before),
      after: auditedVendor(row),
    });
    ctx.emit({
      type: 'procurement.vendor.updated',
      entityId: eventEntity(ctx),
      aggregateType: 'vendor',
      aggregateId: row.id,
      payload: { part: 'details' },
    });
    return toVendorDto(row);
  },
});

/**
 * `procurement.vendor.archive`: the vendor leaves the active list. Its quotes, people and items
 * stay on record and readable; archiving withdraws no quote.
 */
export const archiveVendor = defineCommand({
  name: 'procurement.vendor.archive',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ArchiveVendorInput,
  output: VendorDto,
  auditFields: ['isActive'],
  async handler(ctx, input) {
    await lockVendor(ctx, input.vendorId);
    const [row] = await ctx.tx
      .update(schema.vendors)
      .set({ isActive: false, updatedBy: ctx.principal.id })
      .where(eq(schema.vendors.id, input.vendorId))
      .returning();
    if (!row) throw new DomainError('internal', 'vendor archive returned no row');
    ctx.audit({
      aggregateType: 'vendor',
      aggregateId: row.id,
      entityId: null,
      before: { isActive: true },
      after: { isActive: false },
    });
    ctx.emit({
      type: 'procurement.vendor.archived',
      entityId: eventEntity(ctx),
      aggregateType: 'vendor',
      aggregateId: row.id,
      payload: {},
    });
    return toVendorDto(row);
  },
});
