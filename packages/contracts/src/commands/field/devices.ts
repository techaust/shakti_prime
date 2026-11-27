import { z } from 'zod';
import { SemverSchema } from '../../api/common';
import type { SessionRevokeReason } from '../../auth/enums';
import { IdSchema } from '../../ids';

/**
 * The field app's phones (docs/03-roadmap-appendix/phase4.md §6.4): one row of `mobile_devices` per
 * person and installation, holding the refresh token's hash, its family and the push token, none
 * of which leaves the auth module. A phone is signed out by the app itself (`signed_out`), from
 * Admin › Team members (`revoked`, `field.device.revoke`), by the server when a refresh token
 * is presented a second time (`refresh_reused`), or with the person's website sessions when their
 * account changes (`MOBILE_ACCOUNT_CHANGE_REASONS`, the sessions' own reasons).
 */
export const MOBILE_ACCOUNT_CHANGE_REASONS = [
  'password_changed',
  'role_changed',
  'suspended',
  'totp_reset',
] as const satisfies readonly SessionRevokeReason[];
export type MobileAccountChangeReason = (typeof MOBILE_ACCOUNT_CHANGE_REASONS)[number];

export const MOBILE_DEVICE_REVOKE_REASONS = [
  'signed_out',
  'revoked',
  'refresh_reused',
  ...MOBILE_ACCOUNT_CHANGE_REASONS,
] as const;
export const MobileDeviceRevokeReasonSchema = z.enum(MOBILE_DEVICE_REVOKE_REASONS);
export type MobileDeviceRevokeReason = z.infer<typeof MobileDeviceRevokeReasonSchema>;

/** `field.device.revoke`: signs one phone out; its next call is refused with `device_revoked`. */
export const RevokeMobileDeviceInput = z.object({ id: IdSchema }).strict();
export type RevokeMobileDeviceInput = z.infer<typeof RevokeMobileDeviceInput>;

export const RevokedMobileDeviceDto = z
  .object({ id: IdSchema, userId: IdSchema, revokedAt: z.iso.datetime() })
  .strict();
export type RevokedMobileDeviceDto = z.infer<typeof RevokedMobileDeviceDto>;

/** The phones of one person, for Admin › Team members. */
export const ListMobileDevicesInput = z.object({ userId: IdSchema }).strict();
export type ListMobileDevicesInput = z.infer<typeof ListMobileDevicesInput>;

/** One phone as the web sees it: never a token, a hash, a family or the push token. */
export const MobileDeviceDto = z
  .object({
    id: IdSchema,
    userId: IdSchema,
    /** The phone's model as the app reported it, when it did. */
    name: z.string().min(1).max(80).nullable(),
    platform: z.literal('android'),
    appVersion: SemverSchema,
    signedInAt: z.iso.datetime(),
    lastSeenAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
    revokedReason: MobileDeviceRevokeReasonSchema.nullable(),
  })
  .strict();
export type MobileDeviceDto = z.infer<typeof MobileDeviceDto>;

export const MobileDeviceListDto = z.array(MobileDeviceDto);
export type MobileDeviceListDto = z.infer<typeof MobileDeviceListDto>;
