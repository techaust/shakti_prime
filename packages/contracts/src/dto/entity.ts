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
  })
  .strict();

export type EntityDto = z.infer<typeof EntityDto>;
