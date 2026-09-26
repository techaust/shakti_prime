import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actors, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { roles } from './roles';
import { teams } from './teams';

/**
 * Identity tables (docs/DATABASE.md §6.1, docs/design/backend-weeks-3-5.md §2.1). The Drizzle
 * property names are the field names Better Auth expects, so its adapter needs only the table
 * names mapped. Five of the six tables are owned by the auth module through the `auth_service`
 * role; `app_user` reads `users`, `user_entity_roles` and the non-secret columns of `sessions`.
 */

/** One row per staff user; `id` is the `principals` row of kind `user`. */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    phone: text('phone'),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').notNull().default('system'),
    status: text('status').notNull().default('invited'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('users_email_lower_check', sql`${t.email} = lower(${t.email})`),
    check('users_locale_check', sql`${t.locale} in ('en', 'hi')`),
    check('users_theme_check', sql`${t.theme} in ('system', 'light', 'dark')`),
    check(
      'users_status_check',
      sql`${t.status} in ('invited', 'active', 'suspended', 'offboarded')`,
    ),
  ],
);

/** Better Auth session store. `token` is readable by `auth_service` only. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ...timestamps,
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    check(
      'sessions_revoked_reason_check',
      sql`${t.revokedReason} is null or ${t.revokedReason} in ('admin', 'role_changed', 'suspended', 'password_changed', 'totp_enrolled', 'absolute_expiry')`,
    ),
  ],
);

/** Better Auth account store; the credential row carries the Argon2id hash. */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [
    index('auth_accounts_user_idx').on(t.userId),
    unique('auth_accounts_provider_account_key').on(t.providerId, t.accountId),
  ],
);

/** Better Auth verification store (set-password and reset links). Rows expire. */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

/** Better Auth two-factor store: encrypted TOTP secret and encrypted backup codes. */
export const userTwoFactor = pgTable(
  'user_two_factor',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('user_two_factor_user_idx').on(t.userId)],
);

/** The user's role in one entity. The rows here are the entities the user may see. */
export const userEntityRoles = pgTable(
  'user_entity_roles',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    teamId: uuid('team_id').references(() => teams.id),
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('user_entity_roles_user_entity_key').on(t.userId, t.entityId),
    index('user_entity_roles_entity_idx').on(t.entityId),
    index('user_entity_roles_role_idx').on(t.roleId),
    index('user_entity_roles_team_idx').on(t.teamId),
  ],
);
