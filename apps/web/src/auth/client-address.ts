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

/** An id safe to echo into logs and the audit trail. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

/** Anything that reads a request header by name: `Headers`, or a stand-in for a plain object. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * The request id for logs and the audit trail. Vercel's own `x-vercel-id` wins whenever it is
 * there, so a caller cannot choose the id an audit row carries on a hosted deployment; where the
 * platform sets none (locally, in tests) a caller's `x-request-id` is taken if it is safe to echo.
 * Undefined when neither is usable; the caller then makes a new one.
 */
export function platformRequestId(headers: HeaderReader | undefined): string | undefined {
  if (headers === undefined) return undefined;
  const platform = headers.get('x-vercel-id');
  const given = platform ?? headers.get('x-request-id');
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
