import { JwksResponse, newId, REALTIME_TOKEN_MAX_SECONDS, type Principal } from '@shakti/contracts';
import { decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { parseSigningKeys, publicKeyList, signingKeys, SigningKeyError } from './keys';
import { newSigningKeyJson } from './test-keys';
import { bosIssuer, mintRealtimeToken, openIdConfiguration, verifyRealtimeToken } from './token';

const ISSUER = 'https://bos.shakti.test';
const principal: Principal = {
  id: newId(),
  kind: 'user',
  roleKey: 'tele_caller_cc',
  entityIds: [3, 1, 3],
  permissions: [],
};

async function keysFrom(current: string, next?: string) {
  const keys = await parseSigningKeys({
    BOS_JWT_CURRENT_KEY: current,
    ...(next === undefined ? {} : { BOS_JWT_NEXT_KEY: next }),
  });
  if (keys === undefined) throw new Error('keys expected');
  return keys;
}

describe('signing keys', () => {
  it('are absent when no current key is set', async () => {
    expect(await parseSigningKeys({})).toBeUndefined();
    expect(await parseSigningKeys({ BOS_JWT_CURRENT_KEY: '  ' })).toBeUndefined();
  });

  it('refuse a next key without a current key', async () => {
    await expect(
      parseSigningKeys({ BOS_JWT_NEXT_KEY: await newSigningKeyJson() }),
    ).rejects.toBeInstanceOf(SigningKeyError);
  });

  it('refuse a key that is not JSON, not P-256, public only, or a duplicate of the current one', async () => {
    const good = await newSigningKeyJson('k1');
    const publicOnly = JSON.stringify({ ...(JSON.parse(good) as object), d: undefined });
    for (const bad of ['not json', '[]', '{"kty":"RSA"}', publicOnly]) {
      await expect(parseSigningKeys({ BOS_JWT_CURRENT_KEY: bad })).rejects.toBeInstanceOf(
        SigningKeyError,
      );
    }
    await expect(
      parseSigningKeys({ BOS_JWT_CURRENT_KEY: good, BOS_JWT_NEXT_KEY: good }),
    ).rejects.toThrow(/same kid/);
  });

  it('never put the key itself in the error', async () => {
    const good = JSON.parse(await newSigningKeyJson()) as { d: string };
    const broken = JSON.stringify({ ...good, x: 'AAAA' });
    const error = await parseSigningKeys({ BOS_JWT_CURRENT_KEY: broken }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SigningKeyError);
    expect(String(error)).not.toContain(good.d);
  });

  it('name a key by its thumbprint when it has no kid, and publish public halves only', async () => {
    const keys = await keysFrom(await newSigningKeyJson(), await newSigningKeyJson('next-1'));
    expect(keys.current.kid).toMatch(/^[\w-]{43}$/);
    expect(keys.next?.kid).toBe('next-1');
    const list = JwksResponse.parse({ keys: publicKeyList(keys) });
    expect(list.keys.map((k) => k.kid)).toEqual([keys.current.kid, 'next-1']);
    for (const key of list.keys) expect(key).not.toHaveProperty('d');
  });

  it('are parsed once per set of values', async () => {
    const env = { BOS_JWT_CURRENT_KEY: await newSigningKeyJson() };
    const first = signingKeys(env);
    expect(signingKeys(env)).toBe(first);
    const changed = { BOS_JWT_CURRENT_KEY: await newSigningKeyJson() };
    expect(signingKeys(changed)).not.toBe(first);
  });
});

describe('the Realtime token', () => {
  it('carries the claims of ADR 0003 and the current kid', async () => {
    const keys = await keysFrom(await newSigningKeyJson('cur'));
    const now = new Date('2026-09-27T10:00:00Z');
    const minted = await mintRealtimeToken(principal, keys, { issuer: ISSUER, now });
    expect(decodeProtectedHeader(minted.token)).toEqual({ alg: 'ES256', kid: 'cur', typ: 'JWT' });
    const claims = await verifyRealtimeToken(
      minted.token,
      { keys: publicKeyList(keys) },
      ISSUER,
      now,
    );
    expect(claims).toMatchObject({
      iss: ISSUER,
      sub: principal.id,
      aud: 'shakti-realtime',
      role: 'authenticated',
      bos_role: 'tele_caller_cc',
      entity_ids: [1, 3],
    });
    expect(claims.exp - claims.iat).toBe(REALTIME_TOKEN_MAX_SECONDS);
    expect(minted.expiresAt.toISOString()).toBe('2026-09-27T10:15:00.000Z');
  });

  it('never lives longer than fifteen minutes', async () => {
    const keys = await keysFrom(await newSigningKeyJson());
    const minted = await mintRealtimeToken(principal, keys, { issuer: ISSUER, ttlSeconds: 86_400 });
    expect(minted.claims.exp - minted.claims.iat).toBe(REALTIME_TOKEN_MAX_SECONDS);
  });

  it('is refused once expired, by another issuer, or with another audience', async () => {
    const keys = await keysFrom(await newSigningKeyJson());
    const jwks = { keys: publicKeyList(keys) };
    const now = new Date('2026-09-27T10:00:00Z');
    const { token } = await mintRealtimeToken(principal, keys, { issuer: ISSUER, now });
    const later = new Date(now.getTime() + (REALTIME_TOKEN_MAX_SECONDS + 1) * 1000);
    await expect(verifyRealtimeToken(token, jwks, ISSUER, later)).rejects.toThrow();
    await expect(verifyRealtimeToken(token, jwks, 'https://other.test', now)).rejects.toThrow();

    const mobile = await new SignJWT({ sub: principal.id })
      .setProtectedHeader({ alg: 'ES256', kid: keys.current.kid })
      .setIssuer(ISSUER)
      .setAudience('shakti-mobile')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.current.privateKey);
    await expect(verifyRealtimeToken(mobile, jwks, ISSUER)).rejects.toThrow();
  });

  it('is refused when signed by a key that is not published', async () => {
    const published = await keysFrom(await newSigningKeyJson());
    const stranger = await keysFrom(await newSigningKeyJson());
    const { token } = await mintRealtimeToken(principal, stranger, { issuer: ISSUER });
    await expect(
      verifyRealtimeToken(token, { keys: publicKeyList(published) }, ISSUER),
    ).rejects.toThrow();
  });

  it('survives a rotation: the next key signs once promoted, and the old key still verifies', async () => {
    const a = await newSigningKeyJson('key-a');
    const b = await newSigningKeyJson('key-b');

    // Step 1: A signs, B is published beside it.
    const before = await keysFrom(a, b);
    const oldToken = (await mintRealtimeToken(principal, before, { issuer: ISSUER })).token;

    // Step 2: B is promoted to current and A stays published as next until its tokens expire.
    const during = await keysFrom(b, a);
    const newToken = (await mintRealtimeToken(principal, during, { issuer: ISSUER })).token;
    expect(decodeProtectedHeader(newToken).kid).toBe('key-b');
    // A relying party that fetched the list at step 1 already verifies the new token.
    await expect(
      verifyRealtimeToken(newToken, { keys: publicKeyList(before) }, ISSUER),
    ).resolves.toMatchObject({ sub: principal.id });
    await expect(
      verifyRealtimeToken(oldToken, { keys: publicKeyList(during) }, ISSUER),
    ).resolves.toMatchObject({ sub: principal.id });

    // Step 3: A is retired; its tokens no longer verify.
    const after = await keysFrom(b);
    await expect(
      verifyRealtimeToken(oldToken, { keys: publicKeyList(after) }, ISSUER),
    ).rejects.toThrow();
  });

  it('is only for a person, never an agent', async () => {
    const keys = await keysFrom(await newSigningKeyJson());
    await expect(
      mintRealtimeToken({ ...principal, kind: 'agent' }, keys, { issuer: ISSUER }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the issuer', () => {
  it('is the origin of the deployment', () => {
    expect(bosIssuer({ BETTER_AUTH_URL: 'https://shaktiprime.com/' })).toBe(
      'https://shaktiprime.com',
    );
    expect(bosIssuer({})).toBeUndefined();
    expect(bosIssuer({ BETTER_AUTH_URL: 'not a url' })).toBeUndefined();
  });

  it('publishes where its key list lives', () => {
    expect(openIdConfiguration('https://shaktiprime.com')).toMatchObject({
      issuer: 'https://shaktiprime.com',
      jwks_uri: 'https://shaktiprime.com/.well-known/jwks.json',
      id_token_signing_alg_values_supported: ['ES256'],
    });
  });
});
