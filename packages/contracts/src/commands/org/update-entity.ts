import { z } from 'zod';
import { EntityIdSchema } from '../../ids.js';

/** Fields an Executive may change on an entity from Admin › Entities. */
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
  })
  .strict();

export type UpdateEntityInput = z.infer<typeof UpdateEntityInput>;
