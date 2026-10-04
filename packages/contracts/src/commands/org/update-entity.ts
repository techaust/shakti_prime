import { z } from 'zod';
import { GstinSchema } from '../../api/connector';
import { EntityIdSchema } from '../../ids';
import { StateCodeSchema } from '../../tax/engine';

/** A GST state or union territory code: 01 to 38, or 97 for other territory. */
export const GstStateCodeSchema = StateCodeSchema.refine((code) => {
  const n = Number(code);
  return (n >= 1 && n <= 38) || n === 97;
});

/** A company's GSTIN as an Executive types it: spaces trimmed, letters in capitals. */
const EntityGstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(GstinSchema)
  .refine((gstin) => GstStateCodeSchema.safeParse(gstin.slice(0, 2)).success);

const AddressLineSchema = z.string().trim().min(2).max(120);

/**
 * A company's bank account, printed on its documents for payment (BLUEPRINT §7: sensitive). Stored
 * only sealed by the field cipher (`entities.bank_json`), never logged, and audited as the last
 * four digits of the account number.
 */
export const BankDetailsSchema = z
  .object({
    bankName: z.string().trim().min(2).max(80),
    /** An Indian bank account number: 9 to 18 digits. */
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{9,18}$/),
    /** The branch's IFSC: four letters, a zero, then six letters or digits. */
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
    branch: z.string().trim().min(2).max(80),
  })
  .strict();
export type BankDetails = z.infer<typeof BankDetailsSchema>;

/**
 * Fields an Executive may change on an entity from Settings › Companies: the brand name, the UPI
 * id, the GSTIN and the registered address (workshop pack SALE-2). The GSTIN starts with the
 * company's GST state code; when only one of the two is sent, the command checks it against the
 * other as stored. `null` clears a field that may be empty. `bankDetails` replaces the bank account
 * as a whole, or clears it with `null`.
 */
export const UpdateEntityInput = z
  .object({
    entityId: EntityIdSchema,
    brandName: z.string().trim().min(2).max(80).optional(),
    upiId: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/)
      .nullable()
      .optional(),
    gstin: EntityGstinSchema.nullable().optional(),
    stateCode: GstStateCodeSchema.optional(),
    addressLine1: AddressLineSchema.nullable().optional(),
    addressLine2: AddressLineSchema.nullable().optional(),
    city: z.string().trim().min(2).max(60).nullable().optional(),
    pin: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/)
      .nullable()
      .optional(),
    bankDetails: BankDetailsSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.gstin === undefined ||
      v.gstin === null ||
      v.stateCode === undefined ||
      v.gstin.startsWith(v.stateCode),
    { path: ['gstin'], message: 'the GSTIN starts with the GST state code' },
  );

export type UpdateEntityInput = z.infer<typeof UpdateEntityInput>;

/** `readCompanyBankDetails`: the company whose bank account an Executive opens to change it. */
export const ReadBankDetailsInput = z.object({ entityId: EntityIdSchema }).strict();
export type ReadBankDetailsInput = z.infer<typeof ReadBankDetailsInput>;

/** A company's bank account in clear, for an Executive and the print loader only; null when unset. */
export const EntityBankDetailsDto = z
  .object({ entityId: EntityIdSchema, bankDetails: BankDetailsSchema.nullable() })
  .strict();
export type EntityBankDetailsDto = z.infer<typeof EntityBankDetailsDto>;
