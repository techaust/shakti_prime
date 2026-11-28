import type { MeResponse, MobileTokenResponse } from '@shakti/contracts';
import type { Api, ApiResult } from '../auth/api';

/** A pair as the server answers it; the tokens are shapes only, never real ones. */
export function tokenPair(n = 1): MobileTokenResponse {
  return {
    tokenType: 'Bearer',
    accessToken: `eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIke259In0.${String(n).padStart(4, 's')}`,
    accessTokenExpiresAt: '2026-11-27T10:15:00.000Z',
    refreshToken: String(n).padStart(43, 'r'),
    refreshTokenExpiresAt: '2026-12-27T10:00:00.000Z',
    userId: '01a21d7b-ba63-77bb-afdc-c19e89ace56a',
  };
}

export function me(minimumAppVersion = '1.0.0'): MeResponse {
  return {
    principal: {
      id: '01a21d7b-ba63-77bb-afdc-c19e89ace56a',
      kind: 'user',
      name: 'Rakesh Meena',
      email: 'rakesh.meena@shaktisupreme.in',
      theme: 'system',
    },
    roles: [{ entityId: 1, entityCode: 'SS', roleKey: 'field_engineer', teamId: null }],
    permissions: [{ key: 'projects.read', scope: 'own' }],
    featureFlags: {},
    minimumAppVersion,
    latestAppVersion: minimumAppVersion,
    serverTime: '2026-11-27T10:00:00.000Z',
  };
}

const ok = <T>(data: T): Promise<ApiResult<T>> => Promise.resolve({ ok: true, data });
const no = (reason: string): Promise<ApiResult<never>> => Promise.resolve({ ok: false, reason });

/** An API whose answers each test sets; every call is a jest mock to look at. */
export function fakeApi(overrides: Partial<Record<keyof Api, jest.Mock>> = {}) {
  return {
    signIn: jest.fn(() => ok(tokenPair(1))),
    refresh: jest.fn(() => ok(tokenPair(2))),
    revoke: jest.fn(() =>
      ok({ revoked: true as const, deviceId: '6f1c2a4e-8b3d-4c5a-9e7f-0a1b2c3d4e5f' }),
    ),
    me: jest.fn(() => ok(me())),
    ...overrides,
  };
}

export { no, ok };
