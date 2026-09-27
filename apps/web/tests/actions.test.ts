import type { Principal } from '@shakti/contracts';
import { closeDb, createTestPrincipal, createTestUser } from '@shakti/db/testing';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Server actions outside a Next.js request (AUDIT M41): the request headers and cookies, the
// redirect and the signed-in caller are stand-ins; the commands and the database are real.
interface RequestState {
  jar: Map<string, string>;
  principal: Principal | undefined;
  session: unknown;
  forgotten: string[];
  headers: Headers;
}

const request = vi.hoisted((): RequestState => ({
  jar: new Map(),
  principal: undefined,
  session: undefined,
  forgotten: [],
  headers: new Headers(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        request.jar.has(name) ? { name, value: request.jar.get(name) } : undefined,
      set: (name: string, value: string) => {
        request.jar.set(name, value);
      },
      delete: (name: string) => {
        request.jar.delete(name);
      },
    }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock('../src/auth/current-principal', () => ({
  ACTIVE_ENTITY_COOKIE: 'entity',
  TWO_FACTOR_PENDING_COOKIE: 'shakti.two_factor',
  currentPrincipal: () => Promise.resolve(request.principal),
  currentSession: () => Promise.resolve(request.session),
  forgetPrincipal: (userId: string) => {
    request.forgotten.push(userId);
    return Promise.resolve();
  },
}));

const { switchEntity } = await import('../src/actions/auth');
const { createLead } = await import('../src/actions/crm');
const { listAuditLog, setUserRoles } = await import('../src/actions/admin');

afterAll(closeDb);
beforeEach(() => {
  request.jar.clear();
  request.principal = undefined;
  request.session = undefined;
  request.forgotten.length = 0;
  request.headers = new Headers();
});

const lead = (entityId: number) => ({
  entityId,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Action test customer', phone: '9812345678' },
  account: { type: 'farm' },
});

describe('server actions (AUDIT M41)', () => {
  it('ask who is calling before reading the input', async () => {
    await expect(createLead({ nonsense: true })).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('narrow the request to the company named in the input', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(createLead(lead(2))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('drop the cached principal of a user whose roles change', async () => {
    request.principal = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    await setUserRoles({
      userId: target.id,
      entityRoles: [{ entityId: 1, roleKey: 'store_manager' }],
    });
    expect(request.forgotten).toEqual([target.id]);
  });

  it('the company switcher keeps only a company the user holds', async () => {
    const form = (value: string) => {
      const data = new FormData();
      data.set('entityId', value);
      return data;
    };
    await expect(switchEntity(form('2'))).rejects.toThrow('redirect /sign-in');

    request.session = { access: { entities: [{ entityId: 1 }, { entityId: 2 }] } };
    await expect(switchEntity(form('2'))).rejects.toThrow('redirect /home');
    expect(request.jar.get('entity')).toBe('2');
    await expect(switchEntity(form('3'))).rejects.toThrow('redirect /home');
    expect(request.jar.get('entity')).toBe('2');
    await expect(switchEntity(form(''))).rejects.toThrow('redirect /home');
    expect(request.jar.has('entity')).toBe(false);
  });

  it('record the caller’s address, browser and request on the audit trail, read back by an Executive', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    request.principal = caller;
    const requestId = `req-${caller.id}`;
    request.headers = new Headers({
      'x-forwarded-for': '198.51.100.23',
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/140',
      'x-request-id': requestId,
    });
    const created = await createLead(lead(1));

    request.principal = await createTestPrincipal('executive');
    const now = Date.now();
    const page = await listAuditLog({
      from: new Date(now - 60_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
      actorPrincipalId: caller.id,
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        command: 'crm.lead.create',
        outcome: 'ok',
        entityId: 1,
        aggregateId: created.id,
        ip: '198.51.100.23',
        device: 'Mozilla/5.0 (Linux; Android 14) Chrome/140',
        requestId,
      }),
    ]);
  });

  it('keep the audit trail from a role without audit.read', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const now = Date.now();
    await expect(
      listAuditLog({
        from: new Date(now - 60_000).toISOString(),
        to: new Date(now + 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
