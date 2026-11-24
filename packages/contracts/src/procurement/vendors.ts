import { z } from 'zod';
import { ItemCategorySchema, ItemUnitSchema } from '../catalogue/enums';
import { EntityGstinSchema, GstStateCodeSchema } from '../commands/org/update-entity';
import { EmailSchema } from '../auth/enums';
import { E164Schema, PhoneInputSchema } from '../crm/phone';
import { IdSchema } from '../ids';

/**
 * The group's vendor master (docs/03-roadmap-appendix/phase3.md §6.3, question 6 (a)): one list
 * for every company, read with `inventory.stock.read` or `procurement.po.write` and written with
 * `procurement.po.write`. Nothing in this file carries a supplier's rate: rates are
 * `procurement/quotes.ts`, behind `procurement.rate.read`.
 */

export const VENDOR_NAME_MAX = 160;
export const VENDOR_NOTES_MAX = 2000;
export const VENDOR_CONTACTS_MAX = 20;
/** Payment terms and lead times are whole days up to a year. */
export const VENDOR_DAYS_MAX = 365;

/** A PAN as a person types it: ten characters, five letters, four digits, a letter. */
export const PanSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/);

/** A PIN code of six digits, the first not zero. */
const PinSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/);

const Days = z.number().int().min(0).max(VENDOR_DAYS_MAX);

/** A vendor's address as the vendor sheet takes it; every line optional. */
export const VendorAddressSchema = z
  .object({
    line1: z.string().trim().min(2).max(120).optional(),
    line2: z.string().trim().min(2).max(120).optional(),
    city: z.string().trim().min(2).max(80).optional(),
    pin: PinSchema.optional(),
  })
  .strict();
export type VendorAddress = z.infer<typeof VendorAddressSchema>;

const vendorFields = {
  name: z.string().trim().min(2).max(VENDOR_NAME_MAX),
  /** Left out or null for a supplier without GST registration. */
  gstin: EntityGstinSchema.nullable().optional(),
  /** Taken from the GSTIN when one is given; a different state is refused. */
  stateCode: GstStateCodeSchema.nullable().optional(),
  /** Taken from the GSTIN when one is given; a different PAN is refused. */
  pan: PanSchema.nullable().optional(),
  address: VendorAddressSchema.default({}),
  paymentTermsDays: Days.nullable().optional(),
  leadTimeDays: Days.nullable().optional(),
  notes: z.string().trim().min(1).max(VENDOR_NOTES_MAX).nullable().optional(),
};

interface VendorIdentity {
  gstin?: string | null | undefined;
  stateCode?: string | null | undefined;
  pan?: string | null | undefined;
}

/** A GSTIN holds the vendor's state (its first two digits) and PAN (characters 3 to 12). */
function checkIdentity(value: VendorIdentity, ctx: z.RefinementCtx): void {
  if (value.gstin === null || value.gstin === undefined) return;
  if (
    value.stateCode !== null &&
    value.stateCode !== undefined &&
    value.stateCode !== value.gstin.slice(0, 2)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'the state is not the GSTIN’s',
      path: ['stateCode'],
    });
  }
  if (value.pan !== null && value.pan !== undefined && value.pan !== value.gstin.slice(2, 12)) {
    ctx.addIssue({ code: 'custom', message: 'the PAN is not the GSTIN’s', path: ['pan'] });
  }
}

/** Fills the state and the PAN from the GSTIN, so they are stored the one way the checks allow. */
function withIdentity<T extends VendorIdentity>(value: T): T {
  if (value.gstin === null || value.gstin === undefined) return value;
  return { ...value, stateCode: value.gstin.slice(0, 2), pan: value.gstin.slice(2, 12) };
}

/**
 * `procurement.vendor.create`: a vendor of the group. A GSTIN already on another vendor answers
 * `vendor_gstin_taken`.
 */
export const CreateVendorInput = z
  .object(vendorFields)
  .strict()
  .superRefine(checkIdentity)
  .transform(withIdentity);
export type CreateVendorInput = z.input<typeof CreateVendorInput>;

/** `procurement.vendor.update`: every field of the vendor sheet, sent as the sheet shows it. */
export const UpdateVendorInput = z
  .object({ vendorId: IdSchema, ...vendorFields })
  .strict()
  .superRefine(checkIdentity)
  .transform(withIdentity);
export type UpdateVendorInput = z.input<typeof UpdateVendorInput>;

/**
 * `procurement.vendor.archive`: the vendor leaves the active list. Its quotes, links and contacts
 * stay readable; archiving withdraws nothing.
 */
export const ArchiveVendorInput = z.object({ vendorId: IdSchema }).strict();
export type ArchiveVendorInput = z.infer<typeof ArchiveVendorInput>;

/** One of a vendor's people as the sheet takes them. */
export const VendorContactInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    role: z.string().trim().min(1).max(80).nullable().optional(),
    phone: PhoneInputSchema.nullable().optional(),
    email: EmailSchema.nullable().optional(),
  })
  .strict();
export type VendorContactInput = z.input<typeof VendorContactInput>;

/** `procurement.vendor.contact.set`: the vendor's people as a set, in order; empty removes all. */
export const SetVendorContactsInput = z
  .object({
    vendorId: IdSchema,
    contacts: z.array(VendorContactInput).max(VENDOR_CONTACTS_MAX),
  })
  .strict();
export type SetVendorContactsInput = z.input<typeof SetVendorContactsInput>;

/**
 * `procurement.item_vendor.set`: whether the vendor supplies the item, the vendor's own code for
 * it and whether it is the item's preferred vendor (one per item: marking one unmarks the other).
 * `supplies: false` removes the link.
 */
export const SetItemVendorInput = z
  .object({
    vendorId: IdSchema,
    itemId: IdSchema,
    supplies: z.boolean().default(true),
    vendorItemCode: z.string().trim().min(1).max(60).nullable().optional(),
    isPreferred: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.supplies || !v.isPreferred, {
    message: 'a vendor that does not supply the item is not its preferred vendor',
    path: ['isPreferred'],
  });
export type SetItemVendorInput = z.input<typeof SetItemVendorInput>;

/** A vendor as every reader of the master sees it. No rate, by construction. Strict. */
export const VendorDto = z
  .object({
    id: IdSchema,
    name: z.string(),
    gstin: z.string().nullable(),
    stateCode: z.string().nullable(),
    pan: z.string().nullable(),
    address: VendorAddressSchema,
    paymentTermsDays: z.number().int().nullable(),
    leadTimeDays: z.number().int().nullable(),
    isActive: z.boolean(),
    notes: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type VendorDto = z.infer<typeof VendorDto>;

export const VendorContactDto = z
  .object({
    id: IdSchema,
    name: z.string(),
    role: z.string().nullable(),
    phone: E164Schema.nullable(),
    email: z.string().nullable(),
    position: z.number().int(),
  })
  .strict();
export type VendorContactDto = z.infer<typeof VendorContactDto>;

/** The answer of `procurement.vendor.contact.set`: the vendor's people as now stored. */
export const VendorContactsDto = z
  .object({ vendorId: IdSchema, contacts: z.array(VendorContactDto) })
  .strict();
export type VendorContactsDto = z.infer<typeof VendorContactsDto>;

/** An item a vendor supplies, with the item's own names. No rate. */
export const ItemVendorDto = z
  .object({
    id: IdSchema,
    vendorId: IdSchema,
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    category: ItemCategorySchema,
    unit: ItemUnitSchema,
    vendorItemCode: z.string().nullable(),
    isPreferred: z.boolean(),
  })
  .strict();
export type ItemVendorDto = z.infer<typeof ItemVendorDto>;

/** The answer of `procurement.item_vendor.set`: the link as now stored, or null once removed. */
export const ItemVendorSetDto = z
  .object({ vendorId: IdSchema, itemId: IdSchema, link: ItemVendorDto.nullable() })
  .strict();
export type ItemVendorSetDto = z.infer<typeof ItemVendorSetDto>;

/** One row of Procurement › Vendors. No rate. */
export const VendorListRowDto = z
  .object({
    id: IdSchema,
    name: z.string(),
    gstin: z.string().nullable(),
    stateCode: z.string().nullable(),
    city: z.string().nullable(),
    paymentTermsDays: z.number().int().nullable(),
    leadTimeDays: z.number().int().nullable(),
    isActive: z.boolean(),
    itemCount: z.number().int().min(0),
  })
  .strict();
export type VendorListRowDto = z.infer<typeof VendorListRowDto>;

export const VendorListPageDto = z
  .object({ items: z.array(VendorListRowDto), nextCursor: z.string().nullable() })
  .strict();
export type VendorListPageDto = z.infer<typeof VendorListPageDto>;

/** Procurement › Vendors: by name, a page at a time; archived vendors only when asked for. */
export const ListVendorsInput = z
  .object({
    cursor: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    /** Part of the name or the GSTIN. */
    q: z.string().trim().min(1).max(80).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict();
export type ListVendorsInput = z.input<typeof ListVendorsInput>;

export const GetVendorInput = z.object({ vendorId: IdSchema }).strict();
export type GetVendorInput = z.infer<typeof GetVendorInput>;

/**
 * U1: one row of a vendor list as the import's preview checks it and its commit writes it: the
 * vendor, and one of its people when the row names one. A GSTIN already in the vendor master
 * updates that vendor with what the row gives.
 */
export const VendorImportRowInput = z
  .object({
    vendor: z
      .object({
        name: vendorFields.name,
        gstin: EntityGstinSchema.optional(),
        /** Filled from the GSTIN, as the vendor sheet fills it. */
        stateCode: GstStateCodeSchema.optional(),
        pan: PanSchema.optional(),
        address: VendorAddressSchema.default({}),
        paymentTermsDays: Days.optional(),
        leadTimeDays: Days.optional(),
      })
      .strict()
      .superRefine(checkIdentity)
      .transform(withIdentity),
    contact: VendorContactInput.optional(),
  })
  .strict();
export type VendorImportRowInput = z.infer<typeof VendorImportRowInput>;
