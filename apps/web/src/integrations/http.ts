import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The shared plumbing of the vendor wrappers (AGENTS.md §9: every external call goes through a
 * wrapper with a timeout). A wrapper never logs a message body, a phone number or a key; the
 * errors it throws carry the vendor's status and code only.
 */

export type ProviderName = 'exotel' | 'whatsapp' | 'sarvam' | 'anthropic' | 'livekit';

export type ProviderFailure = 'timeout' | 'network' | 'http' | 'invalid_response';

export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly failure: ProviderFailure;
  readonly status: number | undefined;
  /** The vendor's own error code, when it gave one. */
  readonly vendorCode: string | undefined;

  constructor(
    provider: ProviderName,
    failure: ProviderFailure,
    options: { status?: number; vendorCode?: string; cause?: unknown } = {},
  ) {
    const status = options.status === undefined ? '' : ` ${String(options.status)}`;
    const code = options.vendorCode === undefined ? '' : ` (${options.vendorCode})`;
    super(`${provider} ${failure}${status}${code}`, { cause: options.cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.failure = failure;
    this.status = options.status;
    this.vendorCode = options.vendorCode;
  }

  /** Worth another attempt later: the vendor was slow, unreachable, rate-limiting or failing. */
  get retryable(): boolean {
    if (this.failure === 'timeout' || this.failure === 'network') return true;
    return this.status === 429 || (this.status !== undefined && this.status >= 500);
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  /** Per attempt. */
  timeoutMs: number;
}

export const defaultHttpDeps = (timeoutMs: number): HttpDeps => ({
  fetch: (...args) => fetch(...args),
  timeoutMs,
});

/**
 * One call to a vendor with a timeout. Answers the response whatever its status; the wrapper reads
 * the vendor's error shape. `retries` is for calls that are safe to repeat (reads); a send, a dial
 * or anything that costs money is never retried here, because a timeout does not prove it failed.
 */
export async function providerFetch(
  provider: ProviderName,
  deps: HttpDeps,
  url: string,
  init: RequestInit,
  options: { retries?: number; backoffMs?: number } = {},
): Promise<Response> {
  const attempts = 1 + (options.retries ?? 0);
  let last: ProviderError | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await deps.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(deps.timeoutMs),
      });
      if (attempt < attempts && (response.status === 429 || response.status >= 500)) {
        last = new ProviderError(provider, 'http', { status: response.status });
      } else {
        return response;
      }
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      last = new ProviderError(provider, timedOut ? 'timeout' : 'network', { cause: error });
      if (attempt === attempts) throw last;
    }
    await new Promise((resolve) => setTimeout(resolve, (options.backoffMs ?? 250) * attempt));
  }
  throw last ?? new ProviderError(provider, 'network');
}

/** Parses a JSON body, or throws `invalid_response`. */
export async function jsonBody(provider: ProviderName, response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new ProviderError(provider, 'invalid_response', { status: response.status, cause });
  }
}

// Readers for vendor JSON, which is untrusted input (AGENTS.md §9): each answers the value only
// when it has the expected type, so a wrapper never trusts a shape it did not check.

export type JsonObject = Readonly<Record<string, unknown>>;

export function asObject(value: unknown): JsonObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Follows a path of keys and array indexes through nested JSON. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === 'number') current = asArray(current)[key];
    else current = asObject(current)?.[key];
    if (current === undefined) return undefined;
  }
  return current;
}

/** HMAC-SHA256 as lowercase hex. */
export function hmacSha256Hex(secret: string, data: string | Uint8Array): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Compares two strings in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
