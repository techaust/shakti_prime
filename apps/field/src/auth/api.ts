import {
  API_HEADERS,
  ErrorEnvelope,
  MeResponse,
  MobileRevokeResponse,
  MobileTokenResponse,
  type MobileDevice,
} from '@shakti/contracts';
import { apiBaseUrl, appVersion } from '../config';

/**
 * The field app's calls to the BOS (docs/06-api.md §3.1). Each sends the app's version, which the
 * server's update gate reads, and answers either the parsed body or why it failed: the server's
 * reason (`invalid_credentials`, `device_revoked`, `app_update_required` and the rest), the error
 * code when it gave none, or `offline` when the phone could not reach the server at all.
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; reason: string; status?: number };

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; accessToken?: string },
  parser: Parser<T>,
  fetchImpl: typeof fetch,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { [API_HEADERS.appVersion]: appVersion() };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.accessToken !== undefined) headers.authorization = `Bearer ${init.accessToken}`;
  let response: Response;
  try {
    response = await fetchImpl(`${apiBaseUrl()}${path}`, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    return { ok: false, reason: 'offline' };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  if (response.ok) {
    const parsed = parser.safeParse(json);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, reason: 'unexpected' };
  }
  const envelope = ErrorEnvelope.safeParse(json);
  if (!envelope.success) return { ok: false, reason: 'unexpected', status: response.status };
  const reason = envelope.data.error.details?.reason;
  return {
    ok: false,
    reason: typeof reason === 'string' ? reason : envelope.data.error.code,
    status: response.status,
  };
}

export interface SignInBody {
  email: string;
  password: string;
  totpCode?: string;
  device: MobileDevice;
}

export function createApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  return {
    signIn: (body: SignInBody) =>
      call('/auth/mobile/token', { method: 'POST', body }, MobileTokenResponse, fetchImpl),
    refresh: (refreshToken: string, deviceId: string) =>
      call(
        '/auth/mobile/refresh',
        { method: 'POST', body: { refreshToken, deviceId, appVersion: appVersion() } },
        MobileTokenResponse,
        fetchImpl,
      ),
    revoke: (accessToken: string) =>
      call(
        '/auth/mobile/revoke',
        { method: 'POST', body: {}, accessToken },
        MobileRevokeResponse,
        fetchImpl,
      ),
    me: (accessToken: string) => call('/me', { method: 'GET', accessToken }, MeResponse, fetchImpl),
  };
}

export type Api = ReturnType<typeof createApi>;
