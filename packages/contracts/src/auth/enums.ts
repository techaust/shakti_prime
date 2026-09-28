import { z } from 'zod';
import type { StaffRoleKey } from '../roles';

/** Lifecycle of a staff user (docs/DATABASE.md §6.1). */
export const USER_STATUSES = ['invited', 'active', 'suspended', 'offboarded'] as const;
export const UserStatusSchema = z.enum(USER_STATUSES);
export type UserStatus = z.infer<typeof UserStatusSchema>;

/** Theme preference (DESIGN.md §7): System by default, Light or Dark override. */
export const ThemeSchema = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof ThemeSchema>;

/** Contrast preference (DESIGN.md §2.1): standard, or the higher contrast for field phones. */
export const ContrastSchema = z.enum(['standard', 'high']);
export type ContrastPreference = z.infer<typeof ContrastSchema>;

/** Roles that must enrol an authenticator app before they can act (docs/SECURITY.md §2). */
export const TOTP_REQUIRED_ROLES: readonly StaffRoleKey[] = [
  'executive',
  'general_manager',
  'accounts',
];

export function requiresTotp(roleKeys: readonly string[]): boolean {
  return roleKeys.some((key) => (TOTP_REQUIRED_ROLES as readonly string[]).includes(key));
}

/** Password policy (docs/SECURITY.md §2). Length is checked here and by Better Auth. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Session limits (docs/SECURITY.md §2). Idle is enforced by Better Auth, absolute by the app. */
export const SESSION_IDLE_SECONDS = 12 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;

/** Lower-cased, trimmed email; the unique key of a user. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email())
  .pipe(z.string().max(254));

/** Why a session stopped being valid. Shown to admins on the sessions screen, never to the user. */
export const SESSION_REVOKE_REASONS = [
  'admin',
  'role_changed',
  'suspended',
  'password_changed',
  'totp_enrolled',
  'totp_reset',
  'absolute_expiry',
] as const;
export const SessionRevokeReasonSchema = z.enum(SESSION_REVOKE_REASONS);
export type SessionRevokeReason = z.infer<typeof SessionRevokeReasonSchema>;
