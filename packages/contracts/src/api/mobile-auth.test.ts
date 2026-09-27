import { describe, expect, it } from 'vitest';
import { API_FIXTURES, fixtureJwt, MOBILE_CLAIMS } from './fixtures';
import {
  MobileAccessClaims,
  MobileRefreshRequest,
  MobileTokenRequest,
  MobileTokenResponse,
} from './mobile-auth';

const signIn = API_FIXTURES['auth.mobile.token'].request as Record<string, unknown>;

describe('field app sign-in', () => {
  it('lower-cases the email, as the account key is stored', () => {
    expect(MobileTokenRequest.parse(signIn).email).toBe('engineer.bikaner@shaktisupreme.in');
  });

  it('takes an authenticator code or a backup code, not both', () => {
    expect(MobileTokenRequest.safeParse({ ...signIn, totpCode: '123456' }).success).toBe(true);
    expect(
      MobileTokenRequest.safeParse({ ...signIn, totpCode: '123456', backupCode: 'abcd-efgh-12' })
        .success,
    ).toBe(false);
    expect(MobileTokenRequest.safeParse({ ...signIn, totpCode: '12345' }).success).toBe(false);
  });

  it('binds the pair to an Android device with a version', () => {
    const device = { ...(signIn.device as object), platform: 'ios' };
    expect(MobileTokenRequest.safeParse({ ...signIn, device }).success).toBe(false);
    expect(MobileTokenRequest.safeParse({ ...signIn, device: undefined }).success).toBe(false);
  });

  it('refuses a refresh token that is not 256 bits in base64url', () => {
    const body = API_FIXTURES['auth.mobile.refresh'].request as Record<string, unknown>;
    expect(MobileRefreshRequest.safeParse({ ...body, refreshToken: 'short' }).success).toBe(false);
  });

  it('answers with an ES256 access token only', () => {
    const pair = API_FIXTURES['auth.mobile.token'].response as Record<string, unknown>;
    const hs = fixtureJwt('HS256', MOBILE_CLAIMS);
    expect(MobileTokenResponse.safeParse({ ...pair, accessToken: hs }).success).toBe(false);
  });
});

describe('the mobile access token claims', () => {
  it('accept the documented claims', () => {
    expect(MobileAccessClaims.parse(MOBILE_CLAIMS)).toEqual(MOBILE_CLAIMS);
  });

  it('live 15 minutes at most', () => {
    const long = { ...MOBILE_CLAIMS, exp: MOBILE_CLAIMS.iat + 15 * 60 + 1 };
    expect(MobileAccessClaims.safeParse(long).success).toBe(false);
  });

  it('carry the BOS role as bos_role, never in role (ADR 0003)', () => {
    expect(MobileAccessClaims.safeParse({ ...MOBILE_CLAIMS, role: 'field_engineer' }).success).toBe(
      false,
    );
  });

  it('are refused under another audience', () => {
    expect(MobileAccessClaims.safeParse({ ...MOBILE_CLAIMS, aud: 'shakti-realtime' }).success).toBe(
      false,
    );
  });
});
