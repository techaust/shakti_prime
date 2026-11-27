import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { SerialStateSchema } from './enums';

/**
 * Warranty claims and supplier returns (R3, docs/03-roadmap-appendix/phase3.md §7.5, PRD INV-08).
 * No DTO here carries a cost except `WarrantyClaimCostsDto`, read only with `finance.cost.read`.
 */

/** The states of a claim (the `warranty_claim` machine); equal to `warranty_claims_state_check`. */
export const WARRANTY_CLAIM_STATES = [
  'raised',
  'serial_identified',
  'replacement_issued',
  'rma_raised',
  'closed',
  'rejected',
] as const;
export const WarrantyClaimStateSchema = z.enum(WARRANTY_CLAIM_STATES);
export type WarrantyClaimState = z.infer<typeof WarrantyClaimStateSchema>;

/** The open states, which hold a serial to one claim. */
export const OPEN_WARRANTY_CLAIM_STATES = [
  'raised',
  'serial_identified',
  'replacement_issued',
  'rma_raised',
] as const satisfies readonly WarrantyClaimState[];

/** How the supplier settles: a credit, or a replacement serial received into stock. */
export const WARRANTY_SETTLEMENTS = ['credit', 'replacement'] as const;
export const WarrantySettlementSchema = z.enum(WARRANTY_SETTLEMENTS);
export type WarrantySettlement = z.infer<typeof WarrantySettlementSchema>;

const ReportedFault = z.string().trim().min(3).max(1000);
const Reason = z.string().trim().min(3).max(300);

/**
 * `inventory.warranty.raise`: a claim on a customer (from Account 360), or on a serial found by
 * scan or search (from the serial's page), whose customer the claim takes.
 */
export const RaiseWarrantyClaimInput = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema.optional(),
    siteId: IdSchema.nullable().optional(),
    serialId: IdSchema.optional(),
    reportedFault: ReportedFault,
  })
  .strict()
  .refine((v) => v.accountId !== undefined || v.serialId !== undefined, {
    message: 'a customer or a serial',
    path: ['accountId'],
  });
export type RaiseWarrantyClaimInput = z.input<typeof RaiseWarrantyClaimInput>;

/** `inventory.warranty.identify_serial`: the failed serial, in warranty by its date in India. */
export const IdentifyWarrantySerialInput = z
  .object({ entityId: EntityIdSchema, claimId: IdSchema, serialId: IdSchema })
  .strict();
export type IdentifyWarrantySerialInput = z.input<typeof IdentifyWarrantySerialInput>;

/** `inventory.warranty.reject`: out of warranty or not a fault, with why. */
export const RejectWarrantyClaimInput = z
  .object({ entityId: EntityIdSchema, claimId: IdSchema, rejectedReason: Reason })
  .strict();
export type RejectWarrantyClaimInput = z.input<typeof RejectWarrantyClaimInput>;

/** A serial number as scanned or typed: trimmed, 1 to 100 characters. */
const SerialNo = z.string().trim().min(1).max(100);

/**
 * `inventory.warranty.replace`: a replacement of the same product issued from stock, a serial in
 * the bin named, by its number (scanned or typed). When the failed serial has come back already,
 * `faultyBinId` names the quarantine bin it goes into, in the same step.
 */
export const ReplaceWarrantyInput = z
  .object({
    entityId: EntityIdSchema,
    claimId: IdSchema,
    fromBinId: IdSchema,
    replacementSerialNo: SerialNo,
    faultyBinId: IdSchema.optional(),
  })
  .strict();
export type ReplaceWarrantyInput = z.input<typeof ReplaceWarrantyInput>;

/**
 * `inventory.warranty.rma_raise` (`procurement.po.write`): the failed serial goes to its supplier
 * under their warranty, with the supplier's return reference. A failed serial still with the
 * customer comes back first, into the quarantine bin `faultyBinId` names.
 */
export const RaiseWarrantyRmaInput = z
  .object({
    entityId: EntityIdSchema,
    claimId: IdSchema,
    vendorId: IdSchema,
    supplierRmaRef: z.string().trim().min(1).max(100),
    faultyBinId: IdSchema.optional(),
  })
  .strict();
export type RaiseWarrantyRmaInput = z.input<typeof RaiseWarrantyRmaInput>;

/** A supplier's credit: a positive amount in rupees and paise. */
export const SupplierCreditSchema = MoneySchema.refine((v) => Number(v) > 0, {
  message: 'more than zero',
});

/**
 * `inventory.warranty.settle` (`procurement.grn.write`): the supplier's credit, recorded on the
 * claim's restricted costs. A supplier's replacement serial is received into stock through the
 * goods receipt's `receipt` reason, which this settlement takes once U2 has opened it.
 */
export const SettleWarrantyClaimInput = z
  .object({
    entityId: EntityIdSchema,
    claimId: IdSchema,
    settlement: z.literal('credit'),
    creditAmount: SupplierCreditSchema,
  })
  .strict();
export type SettleWarrantyClaimInput = z.input<typeof SettleWarrantyClaimInput>;

/** What a claim command answers: the claim's number and where it now stands, never a cost. */
export const WarrantyClaimChangedDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    claimNo: z.string(),
    state: WarrantyClaimStateSchema,
  })
  .strict();
export type WarrantyClaimChangedDto = z.infer<typeof WarrantyClaimChangedDto>;

const SerialRef = z
  .object({
    id: IdSchema,
    serialNo: z.string(),
    state: SerialStateSchema,
    /** The serial's warranty to the customer, a calendar date in India. */
    warrantyUntil: z.string().nullable(),
  })
  .strict();

/** One claim as the list and the claim sheet show it; no cost. */
export const WarrantyClaimDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    claimNo: z.string(),
    state: WarrantyClaimStateSchema,
    stateChangedAt: z.string(),
    createdAt: z.string(),
    /** The customer's name is null for a viewer who may not read that customer. */
    account: z.object({ id: IdSchema, name: z.string().nullable() }).strict(),
    site: z
      .object({ id: IdSchema, village: z.string().nullable(), type: z.string().nullable() })
      .strict()
      .nullable(),
    item: z.object({ id: IdSchema, sku: z.string(), name: z.string() }).strict().nullable(),
    serial: SerialRef.nullable(),
    reportedFault: z.string(),
    replacementSerial: SerialRef.nullable(),
    vendor: z.object({ id: IdSchema, name: z.string() }).strict().nullable(),
    supplierRmaRef: z.string().nullable(),
    settlement: WarrantySettlementSchema.nullable(),
    supplierSerial: SerialRef.nullable(),
    rejectedReason: z.string().nullable(),
  })
  .strict();
export type WarrantyClaimDto = z.infer<typeof WarrantyClaimDto>;

/** `/inventory/warranty`: one company's claims in one state, newest first. */
export const ListWarrantyClaimsInput = z
  .object({
    entityId: EntityIdSchema,
    state: WarrantyClaimStateSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListWarrantyClaimsInput = z.input<typeof ListWarrantyClaimsInput>;

export const WarrantyClaimPageDto = z
  .object({
    items: z.array(WarrantyClaimDto),
    nextCursor: z.string().nullable(),
    /** How many claims stand in each state, for the tabs. */
    counts: z.record(WarrantyClaimStateSchema, z.number().int().min(0)),
  })
  .strict();
export type WarrantyClaimPageDto = z.infer<typeof WarrantyClaimPageDto>;

export const GetWarrantyClaimInput = z
  .object({ entityId: EntityIdSchema, claimId: IdSchema })
  .strict();
export type GetWarrantyClaimInput = z.input<typeof GetWarrantyClaimInput>;

/** A claim's costs (`finance.cost.read` only): the replacement's cost and the supplier's credit. */
export const WarrantyClaimCostsDto = z
  .object({
    claimId: IdSchema,
    replacementCost: MoneySchema.nullable(),
    supplierCreditAmount: MoneySchema.nullable(),
  })
  .strict();
export type WarrantyClaimCostsDto = z.infer<typeof WarrantyClaimCostsDto>;

/** The customer's serials delivered by the company, for a claim to identify one. */
export const ListClaimSerialsInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema })
  .strict();
export type ListClaimSerialsInput = z.input<typeof ListClaimSerialsInput>;

export const ClaimSerialDto = z
  .object({
    id: IdSchema,
    serialNo: z.string(),
    item: z.object({ id: IdSchema, sku: z.string(), name: z.string() }).strict(),
    warrantyUntil: z.string().nullable(),
    /** The serial's open claim, if it has one. */
    openClaimId: IdSchema.nullable(),
  })
  .strict();
export type ClaimSerialDto = z.infer<typeof ClaimSerialDto>;

export const ClaimSerialListDto = z.object({ serials: z.array(ClaimSerialDto) }).strict();
export type ClaimSerialListDto = z.infer<typeof ClaimSerialListDto>;
