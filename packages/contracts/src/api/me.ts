import { z } from 'zod';
import { ThemeSchema } from '../auth/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { PermissionGrantSchema } from '../permissions';
import { PrincipalKindSchema } from '../principal';
import { RoleKeySchema } from '../roles';
import { FeatureFlagKeySchema } from '../commands/admin/feature-flags';
import { SemverSchema } from './common';

/**
 * `GET /me` (docs/06-api.md §3.1): who the caller is, what they hold in each company, the feature
 * flags that apply to them and the oldest field app version the server still accepts. The app
 * calls it after sign-in and on every start; below `minimumAppVersion` it shows the update gate.
 */
export const MeRole = z
  .object({
    entityId: EntityIdSchema,
    entityCode: z.string().min(1).max(10),
    roleKey: RoleKeySchema,
    teamId: IdSchema.nullable(),
  })
  .strict();
export type MeRole = z.infer<typeof MeRole>;

export const MeResponse = z
  .object({
    principal: z
      .object({
        id: IdSchema,
        kind: PrincipalKindSchema,
        name: z.string().min(1).max(120),
        email: z.email().nullable(),
        theme: ThemeSchema,
      })
      .strict(),
    roles: z.array(MeRole).min(1),
    /** The effective grants for the whole session, narrowest role wins (docs/07-security.md §3). */
    permissions: z.array(PermissionGrantSchema),
    /**
     * Flags resolved for this person from `feature_flags`: a flag is on when it is on in any of
     * their companies, a company's own row winning over the group's.
     */
    featureFlags: z.record(FeatureFlagKeySchema, z.boolean()),
    minimumAppVersion: SemverSchema,
    latestAppVersion: SemverSchema,
    serverTime: z.iso.datetime(),
  })
  .strict();
export type MeResponse = z.infer<typeof MeResponse>;
