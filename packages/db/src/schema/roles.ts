import { sql } from 'drizzle-orm';
import { ROLE_KEYS } from '@shakti/contracts';
import { boolean, check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';

/**
 * Roles are permission templates that Executives can edit (docs/BLUEPRINT.md §7.1). The set of
 * roles is fixed (AUDIT L17): a key outside the catalogue cannot be stored. `customisedAt` marks a
 * role whose grants an Executive has changed; the seed then leaves them alone and only adds
 * permissions created after it (AUDIT M21).
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    customisedAt: timestamp('customised_at', { withTimezone: true }),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  () => [
    check(
      'roles_key_check',
      // Built from the contracts list, so a new role key changes the check in the next migration.
      sql.raw(`"roles"."key" in (${ROLE_KEYS.map((k) => `'${k}'`).join(', ')})`),
    ),
  ],
);

/** The permission catalogue as data (docs/SECURITY.md §3.2). */
export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
  ...timestamps,
});

/** A role holds a permission at one scope. The seed is the matrix in docs/SECURITY.md §3.2. */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
    scope: text('scope').notNull(),
    ...timestamps,
    ...actors,
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    check('role_permissions_scope_check', sql`${t.scope} in ('own', 'team', 'entity', 'all')`),
  ],
);
