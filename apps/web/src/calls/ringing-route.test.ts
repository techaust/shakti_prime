import { DomainError, type Principal, type ScreenPopDto } from '@shakti/contracts';
import { memoryKeyValue, type KeyValue } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import { holdRinging } from './ringing';
import { ringingRoute, type RingingRouteDeps } from './ringing-route';
import { mintRingingTicket, RINGING_TICKET_HEADER } from './ticket';

const PERSON = '01a1e99a-b000-7000-8000-000000000001';
const OTHER = '01a1e99a-b000-7000-8000-000000000002';
const ENV = { BETTER_AUTH_SECRET: 'a ticket phrase for the ringing route tests only' };
const NOW = new Date('2026-11-17T06:30:00.000Z');
const POP = {
  providerCallId: '01a1e99a-ac5e-7726-bde8-2fb433596282',
  entityId: 1,
  accountIds: ['01a1e99a-af91-76d1-83ca-7bab32272e3b'],
  // A matched customer's call is held with the number's last four digits only.
  phone: '5678',
  ringingAt: NOW.toISOString(),
};
const SHOWN: ScreenPopDto = {
  providerCallId: POP.providerCallId,
  entityId: 1,
  ringingAt: POP.ringingAt,
  phoneLast4: '5678',
  customers: [{ accountId: POP.accountIds[0] ?? '', name: 'Ramesh Kumar Meena' }],
  newLeadPhone: null,
};
const person = (id: string): Principal => ({
  id,
  kind: 'user',
  roleKey: 'tele_caller_cc',
  entityIds: [1],
  permissions: [],
});

function deps(keyValue: KeyValue, overrides: Partial<RingingRouteDeps> = {}) {
  return {
    keyValue: () => keyValue,
    personIn: vi.fn(() => Promise.resolve<Principal | undefined>(person(PERSON))),
    read: vi.fn(() => Promise.resolve(SHOWN)),
    now: () => NOW,
    env: ENV,
    ...overrides,
  };
}

const ask = (ticket?: string) =>
  new Request('http://localhost/api/v1/calls/ringing', {
    headers: ticket === undefined ? {} : { [RINGING_TICKET_HEADER]: ticket },
  });
const ticketOf = (userId: string) => mintRingingTicket(userId, NOW, ENV).ticket;

describe('GET /api/v1/calls/ringing', () => {
  it('answers 204 with no body and reads no session or database while nothing rings', async () => {
    const d = deps(memoryKeyValue());
    const answer = await ringingRoute(ask(ticketOf(PERSON)), d);
    expect(answer.status).toBe(204);
    expect(await answer.text()).toBe('');
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(d.personIn).not.toHaveBeenCalled();
    expect(d.read).not.toHaveBeenCalled();
  });

  it('shows the person’s ringing call once, read under their own session in its company', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const d = deps(kv);
    const answer = await ringingRoute(ask(ticketOf(PERSON)), d);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(SHOWN);
    expect(d.personIn).toHaveBeenCalledWith(1);
    expect(d.read).toHaveBeenCalledWith(person(PERSON), POP, expect.any(String));
    expect((await ringingRoute(ask(ticketOf(PERSON)), d)).status).toBe(204);
  });

  it('never shows one person’s call to another', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const d = deps(kv, { personIn: vi.fn(() => Promise.resolve(person(OTHER))) });
    // The other person's own ticket finds nothing of this person's.
    expect((await ringingRoute(ask(ticketOf(OTHER)), d)).status).toBe(204);
    // This person's ticket with another person's session shows nothing.
    const answer = await ringingRoute(ask(ticketOf(PERSON)), d);
    expect(answer.status).toBe(401);
    expect(d.read).not.toHaveBeenCalled();
  });

  it('leaves the call for the person’s own screen when a screen’s session is not theirs', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    // A tab whose session lapsed, then a tab another person signed in on, both with her ticket.
    for (const session of [undefined, person(OTHER)]) {
      const stale = deps(kv, { personIn: vi.fn(() => Promise.resolve(session)) });
      expect((await ringingRoute(ask(ticketOf(PERSON)), stale)).status).toBe(401);
    }
    // Her own screen still gets it, once.
    const own = deps(kv);
    const answer = await ringingRoute(ask(ticketOf(PERSON)), own);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(SHOWN);
    expect((await ringingRoute(ask(ticketOf(PERSON)), own)).status).toBe(204);
  });

  it('never clears a newer call held while the session was being read', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const newer = { ...POP, providerCallId: '01a1e99a-ac5e-7726-bde8-2fb433596284' };
    const d = deps(kv, {
      personIn: vi.fn(async () => {
        // The next call rings her between the read and the take.
        await holdRinging(kv, PERSON, newer);
        return person(PERSON);
      }),
    });
    // The call read is gone (replaced), so nothing is shown now and nothing is cleared.
    const first = await ringingRoute(ask(ticketOf(PERSON)), d);
    expect(first.status).toBe(204);
    expect(d.read).not.toHaveBeenCalled();
    // The next ask takes the newer call.
    const next = deps(kv);
    expect((await ringingRoute(ask(ticketOf(PERSON)), next)).status).toBe(200);
    expect(next.read).toHaveBeenCalledWith(person(PERSON), newer, expect.any(String));
  });

  it('serves a call to only one of two screens of the person asking at once', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const d = deps(kv);
    const answers = await Promise.all([
      ringingRoute(ask(ticketOf(PERSON)), d),
      ringingRoute(ask(ticketOf(PERSON)), d),
    ]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 204]);
    expect(d.read).toHaveBeenCalledTimes(1);
  });

  it('refuses a missing, forged or ended ticket before the store is read', async () => {
    const kv = memoryKeyValue();
    const get = vi.spyOn(kv, 'get');
    const d = deps(kv);
    const ended = mintRingingTicket(PERSON, new Date(NOW.getTime() - 3_600_000), ENV).ticket;
    for (const ticket of [undefined, 'not a ticket', ended, `${ticketOf(PERSON)}0`]) {
      const answer = await ringingRoute(ask(ticket), d);
      expect(answer.status).toBe(401);
      expect(await answer.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('shows nothing without a session, and refuses a person who places no calls', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const none = deps(kv, { personIn: vi.fn(() => Promise.resolve(undefined)) });
    expect((await ringingRoute(ask(ticketOf(PERSON)), none)).status).toBe(401);

    await holdRinging(kv, PERSON, {
      ...POP,
      providerCallId: '01a1e99a-ac5e-7726-bde8-2fb433596283',
    });
    const refused = deps(kv, {
      read: vi.fn(() => Promise.reject(new DomainError('forbidden', 'no calls.dial'))),
    });
    expect((await ringingRoute(ask(ticketOf(PERSON)), refused)).status).toBe(403);
  });

  it('answers unavailable when the store cannot be read', async () => {
    const kv = memoryKeyValue();
    vi.spyOn(kv, 'get').mockRejectedValue(new Error('store down'));
    const answer = await ringingRoute(ask(ticketOf(PERSON)), deps(kv));
    expect(answer.status).toBe(503);
  });
});
