import type { BetterAuthOptions } from 'better-auth';
import { getIP } from 'better-auth/api';

/** Where the caller's address comes from: the first hop Vercel records (docs/SECURITY.md §2). */
export const ADDRESS_OPTIONS = {
  advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 } },
} satisfies Pick<BetterAuthOptions, 'advanced'>;

/** The caller's address, the same one the sign-in lockout counts and the audit trail records. */
export function clientAddress(headers: Headers | undefined): string | undefined {
  if (headers === undefined) return undefined;
  return getIP(headers, ADDRESS_OPTIONS) ?? undefined;
}

/** A request id supplied by the platform, when it is safe to echo into logs and the audit. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

export function platformRequestId(headers: Headers | undefined): string | undefined {
  const given = headers?.get('x-request-id') ?? headers?.get('x-vercel-id') ?? null;
  return given !== null && SAFE_ID.test(given) ? given : undefined;
}

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
