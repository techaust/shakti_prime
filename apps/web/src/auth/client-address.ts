import type { BetterAuthOptions } from 'better-auth';
import { getIP } from 'better-auth/api';

/** Where the caller's address comes from: the first hop Vercel records (docs/07-security.md §2). */
export const ADDRESS_OPTIONS = {
  advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 } },
} satisfies Pick<BetterAuthOptions, 'advanced'>;

/** The caller's address, the same one the sign-in lockout counts and the audit trail records. */
export function clientAddress(headers: Headers | undefined): string | undefined {
  if (headers === undefined) return undefined;
  return getIP(headers, ADDRESS_OPTIONS) ?? undefined;
}

// The request-id rule lives with the routes' own (request-id.ts): one rule everywhere.
export { platformRequestId, type HeaderReader } from '../request-id';

/** The address and browser of a request, as the audit trail records them. */
export function clientMeta(headers: Headers | undefined): {
  ip: string | null;
  device: string | null;
} {
  return {
    ip: clientAddress(headers) ?? null,
    device: headers?.get('user-agent') ?? null,
  };
}
