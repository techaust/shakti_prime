import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { users } from './identity';
import { principals } from './principals';

/**
 * The field app's phones (docs/03-roadmap-appendix/phase4.md §6.4, docs/06-api.md §2): one row per
 * person and installation of the app, holding the current refresh token's hash (never the token),
 * its family and the push token. Owned by the auth module through `auth_service`, which signs a
 * phone in, rotates its refresh token and signs it out; `app_user` reads the columns that hold no
 * secret and signs a phone out (`field.device.revoke`, column grants in the custom migration).
 *
 * One installation holds one person's tokens at a time, so at most one row per installation is
 * live (not revoked): a sign-in on the installation signs any other person's row out.
 */
export const mobileDevices = pgTable(
  'mobile_devices',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** The installation's id, generated once by the app; the `sid` of its access tokens. */
    deviceId: uuid('device_id').notNull(),
    platform: text('platform').notNull().default('android'),
    /** The phone's model as the app reported it. */
    name: text('name'),
    osVersion: text('os_version'),
    appVersion: text('app_version').notNull(),
    /** SHA-256 of the current refresh token, in hex; the token itself is never stored. */
    refreshTokenHash: text('refresh_token_hash').notNull(),
    /** Set at sign-in and kept by every rotation; presenting a retired token revokes it. */
    refreshFamilyId: uuid('refresh_family_id').notNull(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    /** When the family began: an access token issued before it is refused. */
    signedInAt: timestamp('signed_in_at', { withTimezone: true }).notNull(),
    pushToken: text('push_token'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    /** Who signed the phone out from the web; null when the app or the server did. */
    revokedBy: uuid('revoked_by').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    unique('mobile_devices_user_device_unique').on(t.userId, t.deviceId),
    unique('mobile_devices_refresh_token_hash_unique').on(t.refreshTokenHash),
    uniqueIndex('mobile_devices_live_device_idx')
      .on(t.deviceId)
      .where(sql`${t.revokedAt} is null`),
    index('mobile_devices_revoked_by_idx').on(t.revokedBy),
    check('mobile_devices_platform_check', sql`${t.platform} in ('android')`),
    check('mobile_devices_name_length_check', sql`char_length(${t.name}) between 1 and 80`),
    check(
      'mobile_devices_os_version_length_check',
      sql`char_length(${t.osVersion}) between 1 and 20`,
    ),
    check(
      'mobile_devices_app_version_check',
      sql`${t.appVersion} ~ '^[0-9]{1,4}\\.[0-9]{1,4}\\.[0-9]{1,6}$'`,
    ),
    check('mobile_devices_refresh_token_hash_check', sql`${t.refreshTokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'mobile_devices_push_token_length_check',
      sql`char_length(${t.pushToken}) between 1 and 4096`,
    ),
    check(
      'mobile_devices_revoked_reason_check',
      sql`${t.revokedReason} in ('signed_out', 'revoked', 'refresh_reused')`,
    ),
    check(
      'mobile_devices_revoked_pair_check',
      sql`(${t.revokedAt} is null) = (${t.revokedReason} is null)`,
    ),
  ],
);
