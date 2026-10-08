import { z } from 'zod';
import { EmailSchema } from '../auth/enums';
import { EntityIdSchema } from '../ids';
import { StaffRoleKeySchema } from '../roles';
import {
  BaseClaims,
  BosJwtSchema,
  expiresWithin,
  SemverSchema,
  TOKEN_AUDIENCES,
  TOKEN_LIFETIMES,
} from './common';

/**
 * Field app sign-in (docs/06-api.md §2, §3.1; docs/03-roadmap-appendix/backend-weeks-3-5.md §2.4). The access
 * token is a 15-minute ES256 JWT; the refresh token is an opaque 256-bit value stored hashed,
 * bound to one device and rotated on every refresh.
 */

/** The device a token pair is bound to. `deviceId` is generated once per installation. */
export const MobileDevice = z
  .object({
    deviceId: z.uuid(),
    platform: z.literal('android'),
    model: z.string().trim().min(1).max(80).optional(),
    osVersion: z.string().trim().min(1).max(20).optional(),
    appVersion: SemverSchema,
    pushToken: z.string().min(1).max(4096).optional(),
  })
  .strict();
export type MobileDevice = z.infer<typeof MobileDevice>;

/** The refresh token as it travels: 256 random bits in base64url (43 characters). */
export const RefreshTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

const TotpCode = z.string().regex(/^\d{6}$/);
const BackupCode = z.string().regex(/^[A-Za-z0-9-]{8,20}$/);

/**
 * `POST /auth/mobile/token`. Executive, GM and Accounts send `totpCode` (or one `backupCode`);
 * without it the call answers `unauthorized` with reason `totp_required`, and the app asks for
 * the code and sends the same body again.
 */
export const MobileTokenRequest = z
  .object({
    email: EmailSchema,
    password: z.string().min(1).max(128),
    totpCode: TotpCode.optional(),
    backupCode: BackupCode.optional(),
    device: MobileDevice,
  })
  .strict()
  .refine((v) => v.totpCode === undefined || v.backupCode === undefined, {
    message: 'send an authenticator code or a backup code, not both',
    path: ['backupCode'],
  });
export type MobileTokenRequest = z.infer<typeof MobileTokenRequest>;

/** The token pair every sign-in and refresh answers with. */
export const MobileTokenResponse = z
  .object({
    tokenType: z.literal('Bearer'),
    accessToken: BosJwtSchema,
    accessTokenExpiresAt: z.iso.datetime(),
    refreshToken: RefreshTokenSchema,
    refreshTokenExpiresAt: z.iso.datetime(),
    userId: z.uuidv7(),
  })
  .strict();
export type MobileTokenResponse = z.infer<typeof MobileTokenResponse>;

/**
 * `POST /auth/mobile/refresh`. A refresh token presented a second time revokes its whole
 * family (reuse detection) and answers `unauthorized` with reason `refresh_reused`.
 */
export const MobileRefreshRequest = z
  .object({
    refreshToken: RefreshTokenSchema,
    deviceId: z.uuid(),
    appVersion: SemverSchema,
  })
  .strict();
export type MobileRefreshRequest = z.infer<typeof MobileRefreshRequest>;

export const MobileRefreshResponse = MobileTokenResponse;
export type MobileRefreshResponse = MobileTokenResponse;

/** `POST /auth/mobile/revoke`: signs this device out; the bearer names the device. */
export const MobileRevokeRequest = z.object({}).strict();
export type MobileRevokeRequest = z.infer<typeof MobileRevokeRequest>;

export const MobileRevokeResponse = z
  .object({ revoked: z.literal(true), deviceId: z.uuid() })
  .strict();
export type MobileRevokeResponse = z.infer<typeof MobileRevokeResponse>;

/**
 * Claims of the mobile access token. `sid` names the device (`mobile_devices.device_id`), whose
 * revocation is checked from a 60-second cache; `bos_role` carries the BOS role, as in the
 * Realtime token, so no BOS token ever puts an application role in `role` (ADR 0003).
 */
export const MobileAccessClaims = BaseClaims.extend({
  aud: z.literal(TOKEN_AUDIENCES.mobile),
  sid: z.uuid(),
  entity_ids: z.array(EntityIdSchema).min(1),
  bos_role: StaffRoleKeySchema,
})
  .strict()
  .refine(...expiresWithin(TOKEN_LIFETIMES.mobileAccess));
export type MobileAccessClaims = z.infer<typeof MobileAccessClaims>;

/** Reasons the mobile auth routes give in `details.reason` of an `unauthorized` answer. */
export const MOBILE_AUTH_REASONS = [
  'invalid_credentials',
  'totp_required',
  'totp_invalid',
  'account_locked',
  'account_suspended',
  'refresh_expired',
  'refresh_reused',
  'device_revoked',
] as const;
export const MobileAuthReasonSchema = z.enum(MOBILE_AUTH_REASONS);
