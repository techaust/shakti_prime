import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * Feature flags (docs/03-roadmap-appendix/phase4.md §6.4, docs/04-architecture.md): a key that is
 * on or off for the group, and optionally for one company, which then wins over the group's row
 * for that company. `GET /me` and the server read them; an Executive writes them
 * (`admin.flags.write`).
 */
export const FeatureFlagKeySchema = z.string().regex(/^[a-z][a-z0-9_.]{1,63}$/);
export type FeatureFlagKey = z.infer<typeof FeatureFlagKeySchema>;

/** `admin.flag.set`: switches a flag on or off for the group (`entityId` null) or one company. */
export const SetFeatureFlagInput = z
  .object({
    key: FeatureFlagKeySchema,
    entityId: EntityIdSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict();
export type SetFeatureFlagInput = z.infer<typeof SetFeatureFlagInput>;

export const FeatureFlagDto = z
  .object({
    id: IdSchema,
    key: FeatureFlagKeySchema,
    entityId: EntityIdSchema.nullable(),
    enabled: z.boolean(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type FeatureFlagDto = z.infer<typeof FeatureFlagDto>;
