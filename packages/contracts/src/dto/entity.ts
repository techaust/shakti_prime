import { z } from 'zod';
import { EntityIdSchema } from '../ids';

/** A selling entity as returned to callers. Strict: undeclared columns never leave the command. */
export const EntityDto = z
  .object({
    id: EntityIdSchema,
    code: z.string(),
    legalName: z.string(),
    brandName: z.string(),
    stateCode: z.string().length(2),
    gstin: z.string().nullable(),
    upiId: z.string().nullable(),
    /** The registered address (workshop pack SALE-2); its state is `stateCode`. */
    addressLine1: z.string().nullable(),
    addressLine2: z.string().nullable(),
    city: z.string().nullable(),
    pin: z.string().nullable(),
    /** Whether a bank account is recorded; the account itself never leaves in this DTO. */
    bankDetailsSet: z.boolean(),
  })
  .strict();

export type EntityDto = z.infer<typeof EntityDto>;
