import { sql } from 'drizzle-orm';
import { rawDb } from '../client';

/** One row per (entity, permission) of a user, as `app.user_grants()` returns it. */
export interface UserGrantRow {
  status: string;
  theme: string;
  contrast: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  entityId: number | null;
  entityName: string | null;
  roleKey: string | null;
  teamId: string | null;
  permissionKey: string | null;
  scope: string | null;
}

/**
 * Loads what principal resolution needs (docs/design/backend-weeks-3-5.md §2.3). Runs on the
 * application connection through a security-definer function, so it needs no request context and
 * returns no secret column. An unknown user yields an empty array. It answers for any user id, so
 * it is reached only through `@shakti/db/grants`, which the lint fences to principal resolution in
 * apps/web/src/auth and the import worker.
 */
export async function loadUserGrants(userId: string): Promise<UserGrantRow[]> {
  const rows = (await rawDb().execute(sql`
    select status, theme, contrast, name, email,
           two_factor_enabled as "twoFactorEnabled",
           entity_id as "entityId", entity_name as "entityName", role_key as "roleKey", team_id as "teamId",
           permission_key as "permissionKey", scope
      from app.user_grants(${userId}::uuid)
  `)) as unknown as UserGrantRow[];
  return rows;
}
