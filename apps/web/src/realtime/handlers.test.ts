import {
  DomainError,
  ErrorEnvelope,
  JwksResponse,
  newId,
  OpenIdConfiguration,
  RealtimeTokenResponse,
  type Principal,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { issueRealtimeToken, jwksDocument, openIdConfigurationDocument } from './handlers';
import type { Env } from './keys';
import { newSigningKeyJson } from './test-keys';
import { verifyRealtimeToken } from './token';

const ISSUER = 'https://bos.shakti.test';
const TOKEN_URL = `${ISSUER}/api/v1/realtime/token`;
const person: Principal = {
  id: newId(),
  kind: 'user',
  roleKey: 'field_engineer',
  entityIds: [2],
  permissions: [],
};

async function env(withKeys = true): Promise<Env> {
  return {
    BETTER_AUTH_URL: ISSUER,
    ...(withKeys
      ? {
          BOS_JWT_CURRENT_KEY: await newSigningKeyJson('current'),
          BOS_JWT_NEXT_KEY: await newSigningKeyJson('next'),
        }
      : {}),
  };
}

function post(headers: Record<string, string> = { origin: ISSUER }): Request {
  return new Request(TOKEN_URL, { method: 'POST', headers });
}

async function envelope(response: Response) {
  return ErrorEnvelope.parse(await response.json()).error;
}

describe('POST /api/v1/realtime/token', () => {
  it('issues a token that verifies against the published key list', async () => {
    const vars = await env();
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(person),
      env: vars,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = RealtimeTokenResponse.parse(await response.json());

    const jwks = JwksResponse.parse(await (await jwksDocument(vars)).json());
    const claims = await verifyRealtimeToken(body.token, jwks, ISSUER);
    expect(claims).toMatchObject({ sub: person.id, entity_ids: [2], bos_role: 'field_engineer' });
    expect(new Date(body.expiresAt).getTime()).toBe(claims.exp * 1000);
  });

  it('refuses a caller without a session', async () => {
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(undefined),
      env: await env(),
    });
    expect(response.status).toBe(401);
    const error = await envelope(response);
    expect(error.code).toBe('unauthorized');
    expect(error.message).toBe('Please sign in to continue.');
    expect(response.headers.get('x-request-id')).toBe(error.requestId);
  });

  it('refuses a person who still has to set up an authenticator app, with that sentence', async () => {
    const response = await issueRealtimeToken(post(), {
      principal: () =>
        Promise.reject(new DomainError('unauthorized', 'totp', { reason: 'totp_required' })),
      env: await env(),
    });
    expect(response.status).toBe(401);
    const error = await envelope(response);
    expect(error.details).toEqual({ reason: 'totp_required' });
    expect(error.message).toMatch(/authenticator app/);
  });

  it('refuses a call from another site', async () => {
    const response = await issueRealtimeToken(post({ origin: 'https://elsewhere.test' }), {
      principal: () => Promise.resolve(person),
      env: await env(),
    });
    expect(response.status).toBe(403);
  });

  it('refuses an agent', async () => {
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve({ ...person, kind: 'agent', roleKey: 'agent:triage' }),
      env: await env(),
    });
    expect(response.status).toBe(403);
  });

  it('answers unavailable, not a token, when the keys are missing or broken', async () => {
    for (const vars of [await env(false), { BETTER_AUTH_URL: ISSUER, BOS_JWT_CURRENT_KEY: '{}' }]) {
      const response = await issueRealtimeToken(post(), {
        principal: () => Promise.resolve(person),
        env: vars,
      });
      expect(response.status).toBe(503);
      expect((await envelope(response)).code).toBe('integration_unavailable');
    }
  });

  it('answers internal for an unexpected failure resolving the caller', async () => {
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.reject(new Error('database down')),
      env: await env(),
    });
    expect(response.status).toBe(500);
  });
});

describe('the discovery documents', () => {
  it('publish the current and next public keys with a short cache', async () => {
    const response = await jwksDocument(await env());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const body = JwksResponse.parse(await response.json());
    expect(body.keys.map((k) => k.kid)).toEqual(['current', 'next']);
  });

  it('answer unavailable without keys', async () => {
    expect((await jwksDocument(await env(false))).status).toBe(503);
  });

  it('name the issuer and the key list', async () => {
    const response = openIdConfigurationDocument({ BETTER_AUTH_URL: ISSUER });
    const body = OpenIdConfiguration.parse(await response.json());
    expect(body.issuer).toBe(ISSUER);
    expect(body.jwks_uri).toBe(`${ISSUER}/.well-known/jwks.json`);
    expect(openIdConfigurationDocument({}).status).toBe(503);
  });
});
