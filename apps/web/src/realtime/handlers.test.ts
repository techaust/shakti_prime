import {
  DomainError,
  ErrorEnvelope,
  newId,
  StaffRoleKeySchema,
  type Principal,
} from '@shakti/contracts';
import { memoryKeyValue } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { JwksResponse, OpenIdConfiguration, RealtimeTokenResponse } from './claims';
import {
  issueRealtimeToken,
  jwksDocument,
  openIdConfigurationDocument,
  REALTIME_TOKEN_CAP,
  type TokenRouteDeps,
} from './handlers';
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

/** A GET of a discovery document, with the headers the platform or a caller sent. */
function discovery(headers: Record<string, string> = {}): Request {
  return new Request(`${ISSUER}/.well-known/jwks.json`, { headers });
}

async function envelope(response: Response) {
  return ErrorEnvelope.parse(await response.json()).error;
}

/**
 * Stands in for `realtime.token.issue`, which needs the database; the command and its audit row
 * are tested in packages/domain and apps/web/tests. It records what it was asked to issue.
 */
const issued: { principal: Principal; requestId: string; jti: string }[] = [];
const issue: TokenRouteDeps['issue'] = (principal, meta) => {
  const jti = newId();
  issued.push({ principal, requestId: meta.requestId, jti });
  return Promise.resolve({
    jti,
    sub: principal.id,
    bos_role: StaffRoleKeySchema.parse(principal.roleKey),
    entity_ids: [...principal.entityIds],
  });
};

describe('POST /api/v1/realtime/token', () => {
  it('issues a token that verifies against the published key list', async () => {
    const vars = await env();
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: memoryKeyValue(),
      env: vars,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = RealtimeTokenResponse.parse(await response.json());

    const jwks = JwksResponse.parse(await (await jwksDocument(discovery(), vars)).json());
    const claims = await verifyRealtimeToken(body.token, jwks, ISSUER);
    expect(claims).toMatchObject({ sub: person.id, entity_ids: [2], bos_role: 'field_engineer' });
    // The token carries the id the command settled and audited, under the route's request id.
    const last = issued.at(-1);
    expect(claims.jti).toBe(last?.jti);
    expect(response.headers.get('x-request-id')).toBe(last?.requestId);
    expect(new Date(body.expiresAt).getTime()).toBe(claims.exp * 1000);
    expect(body.channels).toEqual([`user:${person.id}`, 'entity:2:queue', 'entity:2:board']);
  });

  it('carries the request id of the one rule: the platform id, else a safe id the caller sent', async () => {
    const vars = await env();
    const deps = {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: memoryKeyValue(),
      env: vars,
    };
    const platform = await issueRealtimeToken(
      post({ origin: ISSUER, 'x-vercel-id': 'bom1::rt-1', 'x-request-id': 'mine' }),
      deps,
    );
    expect(platform.headers.get('x-request-id')).toBe('bom1::rt-1');
    expect(issued.at(-1)?.requestId).toBe('bom1::rt-1');
    const given = await issueRealtimeToken(post({ origin: ISSUER, 'x-request-id': 'rt-2' }), deps);
    expect(given.headers.get('x-request-id')).toBe('rt-2');
    const refused = await issueRealtimeToken(post({ 'x-request-id': 'rt-3' }), deps);
    expect(refused.status).toBe(403);
    expect((await envelope(refused)).requestId).toBe('rt-3');
  });

  it('refuses a caller without a session', async () => {
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(undefined),
      issue,
      keyValue: memoryKeyValue(),
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
      issue,
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    expect(response.status).toBe(401);
    const error = await envelope(response);
    expect(error.details).toEqual({ reason: 'totp_required' });
    expect(error.message).toMatch(/authenticator app/);
  });

  it('accepts an empty body or an empty object, and refuses any field', async () => {
    const vars = await env();
    const call = (body: string) =>
      issueRealtimeToken(
        new Request(TOKEN_URL, { method: 'POST', headers: { origin: ISSUER }, body }),
        { principal: () => Promise.resolve(person), issue, keyValue: memoryKeyValue(), env: vars },
      );
    expect((await call('{}')).status).toBe(200);
    for (const body of ['{"entity_ids":[1]}', 'not json', '[]']) {
      const response = await call(body);
      expect(response.status).toBe(400);
      expect((await envelope(response)).code).toBe('validation_failed');
    }
  });

  it('refuses a body it never takes before looking up the caller or reading it', async () => {
    const vars = await env();
    let looked = 0;
    const deps = {
      principal: () => {
        looked += 1;
        return Promise.resolve(person);
      },
      issue,
      keyValue: memoryKeyValue(),
      env: vars,
    };
    const before = issued.length;
    const declared = new Request(TOKEN_URL, {
      method: 'POST',
      headers: { origin: ISSUER, 'content-length': '1048576' },
      body: '{}',
    });
    const refused = await issueRealtimeToken(declared, deps);
    expect(refused.status).toBe(400);
    expect((await envelope(refused)).code).toBe('validation_failed');
    expect(declared.bodyUsed).toBe(false);
    expect(looked).toBe(0);

    // Sent with no length: read only as far as the cap, then refused.
    const chunk = new TextEncoder().encode(' '.repeat(1024));
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
    });
    const streamed = await issueRealtimeToken(
      new Request(TOKEN_URL, {
        method: 'POST',
        headers: { origin: ISSUER },
        body: endless,
        duplex: 'half',
      } as RequestInit),
      deps,
    );
    expect(streamed.status).toBe(400);
    expect(pulled).toBeLessThan(5);
    expect(issued.length).toBe(before);
  });

  it('refuses a call from another site', async () => {
    const response = await issueRealtimeToken(post({ origin: 'https://elsewhere.test' }), {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    expect(response.status).toBe(403);
  });

  it('refuses a call with no Origin, which no browser sends on a POST, and issues nothing', async () => {
    const before = issued.length;
    const response = await issueRealtimeToken(post({}), {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    expect(response.status).toBe(403);
    expect((await envelope(response)).code).toBe('forbidden');
    expect(issued.length).toBe(before);
  });

  it('caps the tokens one person is issued, answering how long to wait', async () => {
    const vars = await env();
    const keyValue = memoryKeyValue();
    const callAs = (caller: Principal) =>
      issueRealtimeToken(post(), {
        principal: () => Promise.resolve(caller),
        issue,
        keyValue,
        env: vars,
      });
    for (let i = 0; i < REALTIME_TOKEN_CAP.max; i += 1) {
      expect((await callAs(person)).status).toBe(200);
    }
    const before = issued.length;
    const refused = await callAs(person);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe(String(REALTIME_TOKEN_CAP.window));
    expect((await envelope(refused)).code).toBe('rate_limited');
    // Nothing is issued, so nothing is audited, past the cap.
    expect(issued.length).toBe(before);
    // Someone else is counted on their own.
    expect((await callAs({ ...person, id: newId() })).status).toBe(200);
  });

  it('answers unavailable, issuing nothing, when the person cannot be counted', async () => {
    const before = issued.length;
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: { ...memoryKeyValue(), incr: () => Promise.reject(new Error('store down')) },
      env: await env(),
    });
    expect(response.status).toBe(503);
    expect((await envelope(response)).code).toBe('integration_unavailable');
    expect(issued.length).toBe(before);
  });

  it('refuses an agent, and a person with no entity in scope', async () => {
    for (const caller of [
      { ...person, kind: 'agent' as const, roleKey: 'agent:triage' as const },
      { ...person, entityIds: [] },
    ]) {
      const response = await issueRealtimeToken(post(), {
        principal: () => Promise.resolve(caller),
        issue,
        keyValue: memoryKeyValue(),
        env: await env(),
      });
      expect(response.status).toBe(403);
    }
  });

  it('answers unavailable, not a token, when the keys are missing or broken', async () => {
    for (const vars of [await env(false), { BETTER_AUTH_URL: ISSUER, BOS_JWT_CURRENT_KEY: '{}' }]) {
      const response = await issueRealtimeToken(post(), {
        principal: () => Promise.resolve(person),
        issue,
        keyValue: memoryKeyValue(),
        env: vars,
      });
      expect(response.status).toBe(503);
      expect((await envelope(response)).code).toBe('integration_unavailable');
    }
  });

  it('answers internal for an unexpected failure resolving the caller', async () => {
    const response = await issueRealtimeToken(post(), {
      principal: () => Promise.reject(new Error('database down')),
      issue,
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    expect(response.status).toBe(500);
  });

  it('issues nothing for a refused caller, a bad body or missing keys', async () => {
    const before = issued.length;
    await issueRealtimeToken(post({ origin: 'https://elsewhere.test' }), {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    await issueRealtimeToken(post(), {
      principal: () => Promise.resolve({ ...person, entityIds: [] }),
      issue,
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    await issueRealtimeToken(
      new Request(TOKEN_URL, { method: 'POST', headers: { origin: ISSUER }, body: '[]' }),
      {
        principal: () => Promise.resolve(person),
        issue,
        keyValue: memoryKeyValue(),
        env: await env(),
      },
    );
    await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(person),
      issue,
      keyValue: memoryKeyValue(),
      env: await env(false),
    });
    expect(issued.length).toBe(before);
  });

  it('answers forbidden when the command refuses, and internal when it fails', async () => {
    const refused = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(person),
      issue: () => Promise.reject(new DomainError('forbidden', 'refused')),
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    expect(refused.status).toBe(403);
    expect((await envelope(refused)).code).toBe('forbidden');
    const failed = await issueRealtimeToken(post(), {
      principal: () => Promise.resolve(person),
      issue: () => Promise.reject(new Error('database down')),
      keyValue: memoryKeyValue(),
      env: await env(),
    });
    expect(failed.status).toBe(500);
  });
});

describe('the discovery documents', () => {
  it('answer with the platform’s request id, or a new one when it gives none', async () => {
    const vars = await env();
    const platform = 'bom1::abcde-1727430000000-0123456789ab';
    for (const response of [
      await jwksDocument(discovery({ 'x-vercel-id': platform }), vars),
      openIdConfigurationDocument(discovery({ 'x-vercel-id': platform }), vars),
    ]) {
      expect(response.headers.get('x-request-id')).toBe(platform);
    }
    const unavailable = await jwksDocument(
      discovery({ 'x-request-id': 'probe-1' }),
      await env(false),
    );
    expect(unavailable.headers.get('x-request-id')).toBe('probe-1');
    expect((await envelope(unavailable)).requestId).toBe('probe-1');
    const fresh = openIdConfigurationDocument(discovery(), vars);
    expect(fresh.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('publish the current and next public keys with a short cache', async () => {
    const response = await jwksDocument(discovery(), await env());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    const body = JwksResponse.parse(await response.json());
    expect(body.keys.map((k) => k.kid)).toEqual(['current', 'next']);
  });

  it('answer unavailable without keys', async () => {
    expect((await jwksDocument(discovery(), await env(false))).status).toBe(503);
  });

  it('name the issuer and the key list', async () => {
    const response = openIdConfigurationDocument(discovery(), { BETTER_AUTH_URL: ISSUER });
    const body = OpenIdConfiguration.parse(await response.json());
    expect(body.issuer).toBe(ISSUER);
    expect(body.jwks_uri).toBe(`${ISSUER}/.well-known/jwks.json`);
    expect(openIdConfigurationDocument(discovery(), {}).status).toBe(503);
  });
});
