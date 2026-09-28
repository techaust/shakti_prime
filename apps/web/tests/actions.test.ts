import { newId, type Principal } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
} from '@shakti/db/testing';
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
  notFound: () => {
    throw new Error('not found');
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
const {
  assignOpportunity,
  createLead,
  leadFormOptions,
  listBoardLeads,
  listLeadAssignees,
  listLeads,
  loseOpportunity,
  nurtureOpportunity,
  moveOpportunityStage,
  reopenOpportunity,
  winOpportunity,
} = await import('../src/actions/crm');
const { listEntities, updateEntity } = await import('../src/actions/org');
const { listPriceLists, listPrices, setPrice } = await import('../src/actions/pricing');
const {
  clearSignInLock,
  inviteUser,
  listAuditLog,
  listAuditPeople,
  listUserSessions,
  listUsers,
  reactivateUser,
  replayDeadLetter,
  resetTwoFactor,
  revokeSession,
  setUserRoles,
  suspendUser,
} = await import('../src/actions/admin');
const { defaultAuthDeps } = await import('../src/auth/deps');
const { screenAccess } = await import('../src/screens/access');
const { navRequires } = await import('../src/nav');

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});
beforeEach(() => {
  request.jar.clear();
  request.principal = undefined;
  request.session = undefined;
  request.forgotten.length = 0;
  request.headers = new Headers();
});

/** The data of a result that must have succeeded. */
function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

const lead = (entityId: number) => ({
  entityId,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Action test customer', phone: '9812345678' },
  account: { type: 'farm' },
});

describe('server actions (AUDIT M41)', () => {
  it('ask who is calling before reading the input', async () => {
    await expect(createLead({ nonsense: true })).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('narrow the request to the company named in the input', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(createLead(lead(2))).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('drop the cached principal of a user whose roles change', async () => {
    request.principal = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    ok(
      await setUserRoles({
        userId: target.id,
        entityRoles: [{ entityId: 1, roleKey: 'store_manager' }],
      }),
    );
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

  it('the company switcher returns to the screen it was on, and only to a BOS screen', async () => {
    const form = (returnTo: string) => {
      const data = new FormData();
      data.set('entityId', '1');
      data.set('returnTo', returnTo);
      return data;
    };
    request.session = { access: { entities: [{ entityId: 1 }] } };
    await expect(switchEntity(form('/leads'))).rejects.toThrow('redirect /leads');
    await expect(switchEntity(form('//evil.example/leads'))).rejects.toThrow('redirect /home');
    await expect(switchEntity(form('/sign-in'))).rejects.toThrow('redirect /home');
  });

  it('the company switcher answers a failure as a form state with a reference, not a throw', async () => {
    // A session whose access cannot be read stands in for a failing session lookup.
    request.session = { access: null };
    const data = new FormData();
    data.set('entityId', '1');
    const state = await switchEntity(data);
    expect(state.error).toBe('internal');
    expect(state.reference).toMatch(/^[0-9A-Z]{6,}$/);
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
    const created = ok(await createLead(lead(1)));

    request.principal = await createTestPrincipal('executive');
    const now = Date.now();
    const page = ok(
      await listAuditLog({
        from: new Date(now - 60_000).toISOString(),
        to: new Date(now + 60_000).toISOString(),
        actorPrincipalId: caller.id,
      }),
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        actorName: 'test tele_caller_cc',
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

  it('store the events of a change with it and have the publisher deliver them after the commit', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const created = ok(await createLead(lead(1)));
    const [row, ...more] = await asOutboxPublisher(
      (p) => p<
        { type: string; entity_id: number; payload_json: unknown; published_at: Date | null }[]
      >`
        select type, entity_id, payload_json, published_at
          from outbox_events where aggregate_id = ${created.id}`,
    );
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      type: 'crm.lead.created',
      entity_id: 1,
      payload_json: { v: 1, pipelineKey: 'farmer_pumps', sourceCode: null, existingAccount: false },
    });
    // No worker listens to this event yet, so the local run marks it delivered without sending.
    expect(row?.published_at).toBeInstanceOf(Date);
  });

  it('act once for a form sent twice with one key, and refuse a key that is not one', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const key = crypto.randomUUID();
    const first = ok(await createLead(lead(1), key));
    const repeat = ok(await createLead(lead(1), key));
    expect(repeat.id).toBe(first.id);
    await expect(createLead(lead(1), 'not-a-key')).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
  });

  it('reset a lost authenticator app, drop the cached principal and tell the user once', async () => {
    request.principal = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
      twoFactorEnabled: true,
      name: 'Meena',
    });
    await asMigrator(
      (m) => m`insert into user_two_factor (id, user_id, secret, backup_codes)
               values (${crypto.randomUUID()}, ${target.id}, 'sealed', 'sealed')`,
    );
    const send = vi.spyOn(defaultAuthDeps().mailer, 'send');
    try {
      const user = ok(await resetTwoFactor({ userId: target.id }));
      expect(user.twoFactorEnabled).toBe(false);
      expect(request.forgotten).toEqual([target.id]);
      expect(send).toHaveBeenCalledTimes(1);
      const [mail] = send.mock.calls[0] ?? [];
      expect(mail?.to).toBe(target.email);
      expect(mail?.subject).toBe('Your Shakti Prime authenticator app was reset');
      expect(mail?.text).toMatch(/^Hello Meena,/);

      // Nothing left to reset: the answer is the same and no second email goes out.
      ok(await resetTwoFactor({ userId: target.id }));
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
    }
  });

  it('keep a reset when the notice email fails', async () => {
    request.principal = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
      twoFactorEnabled: true,
    });
    await asMigrator(
      (m) => m`insert into user_two_factor (id, user_id, secret, backup_codes)
               values (${crypto.randomUUID()}, ${target.id}, 'sealed', 'sealed')`,
    );
    const send = vi
      .spyOn(defaultAuthDeps().mailer, 'send')
      .mockRejectedValue(new Error('mail provider down'));
    try {
      const user = ok(await resetTwoFactor({ userId: target.id }));
      expect(user.twoFactorEnabled).toBe(false);
    } finally {
      send.mockRestore();
    }
  });

  it('keep the audit trail and its people from a role without audit.read', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const now = Date.now();
    const window = {
      from: new Date(now - 60_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    };
    await expect(listAuditLog(window)).resolves.toEqual({ ok: false, error: 'forbidden' });
    await expect(listAuditPeople(window)).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('offer the Activity log the people who acted in the window', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    // A name that sorts first, so the filter's cap of 500 never leaves this caller out.
    const name = `Aa activity person ${caller.id.slice(-6)}`;
    await asMigrator(
      (m) => m`update principals set display_name = ${name} where id = ${caller.id}`,
    );
    request.principal = caller;
    ok(await createLead(lead(1)));
    request.principal = await createTestPrincipal('general_manager', [1]);
    const now = Date.now();
    const people = ok(
      await listAuditPeople({
        from: new Date(now - 60_000).toISOString(),
        to: new Date(now + 60_000).toISOString(),
      }),
    );
    expect(people).toContainEqual({ id: caller.id, name });
    await expect(listAuditPeople({ from: 'yesterday', to: 'today' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
  });
});

describe('command and query actions answer a result, never a thrown error (review 3)', () => {
  it('name the field of an input problem', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const bad = { ...lead(1), contact: { name: 'Field check customer', phone: '12' } };
    await expect(createLead(bad)).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      field: 'contact.phone',
    });
  });

  it('create a lead from All companies with the caller team in the chosen company (AUDIT M24)', async () => {
    const team1 = await createTestTeam(1, 'form path team 1');
    const team2 = await createTestTeam(2, 'form path team 2');
    request.principal = await createTestPrincipal('tele_caller_cc', [1, 2], {
      entityTeams: [
        { entityId: 1, teamId: team1 },
        { entityId: 2, teamId: team2 },
      ],
    });
    const created = ok(await createLead(lead(2), crypto.randomUUID()));
    expect(created.entityId).toBe(2);
    expect(created.teamId).toBe(team2);
  });

  it('move a lead once for a form sent twice, and answer the machine refusals as sentences', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const created = ok(await createLead(lead(1)));
    const pipelineStages = ok(await leadFormOptions()).pipelines.find(
      (p) => p.id === created.pipelineId,
    )?.stages;
    const next = pipelineStages?.find((s) => s.id !== created.stageId && s.kind === 'open');
    if (next === undefined) throw new Error('the pipeline has no second open stage');
    const move = { entityId: 1, opportunityId: created.id, stageId: next.id };
    const key = crypto.randomUUID();
    const first = ok(await moveOpportunityStage(move, key));
    expect(ok(await moveOpportunityStage(move, key))).toEqual(first);
    expect(first).toMatchObject({ stageId: next.id, state: 'open' });

    const target = { entityId: 1, opportunityId: created.id };
    await expect(winOpportunity(target)).resolves.toEqual({ ok: false, error: 'win_needs_order' });
    await expect(reopenOpportunity(target)).resolves.toEqual({
      ok: false,
      error: 'opportunity_transition_not_allowed',
    });
    await expect(loseOpportunity({ ...target, reasonCode: 'weather' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
      field: 'reasonCode',
    });
    expect(ok(await loseOpportunity({ ...target, reasonCode: 'no_budget' }))).toMatchObject({
      state: 'lost',
    });
  });

  it('send a failed message again for an Executive only, and answer a second try as a sentence', async () => {
    const eventId = newId();
    await asMigrator(
      (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                          payload_json, attempts, last_error, dead_lettered_at)
               values (${eventId}, 1, 'admin.user.reactivated', 'test_action_replay', ${newId()},
                       '{"v": 1}'::jsonb, 10, 'http_404', now())`,
    );
    request.principal = await createTestPrincipal('general_manager', [1]);
    await expect(replayDeadLetter({ eventId })).resolves.toEqual({ ok: false, error: 'forbidden' });

    request.principal = await createTestPrincipal('executive');
    expect(ok(await replayDeadLetter({ eventId }))).toEqual({
      eventId,
      requeued: true,
      attempts: 0,
    });
    await expect(replayDeadLetter({ eventId })).resolves.toEqual({
      ok: false,
      error: 'not_dead_lettered',
    });
    await expect(replayDeadLetter({ eventId: newId() })).resolves.toEqual({
      ok: false,
      error: 'dead_letter_missing',
    });
  });

  it('read the leads board of one company and pipeline, and refuse another company', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const created = ok(await createLead(lead(1)));
    const board = ok(await listBoardLeads({ entityId: 1, pipelineKey: 'farmer_pumps' }));
    expect(board.items.map((l) => l.id)).toEqual([created.id]);
    expect(board.counts).toEqual([{ stageId: created.stageId, count: 1 }]);
    expect(board.items[0]).toMatchObject({
      customerName: 'Action test customer',
      ownerId: request.principal.id,
      sla: null,
    });
    await expect(listBoardLeads({ entityId: 2, pipelineKey: 'farmer_pumps' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    await expect(
      listBoardLeads({ entityId: 1, pipelineKey: 'farmer_pumps', states: [] }),
    ).resolves.toMatchObject({ ok: false, error: 'validation_failed', field: 'states' });
    await expect(listBoardLeads({ pipelineKey: 'no_such_pipeline' })).resolves.toEqual({
      ok: false,
      error: 'lead_pipeline_missing',
    });
  });

  it('offer the people to hand a lead to, then assign, park and reopen it from the board', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(listLeadAssignees({ entityId: 1 })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });

    const team = await createTestTeam(1, 'board action team');
    // The dialog lists people by name, a bounded number of them; a name that sorts before every
    // earlier run's keeps this person on the list however many people the suites have added.
    const converter = await createTestUser(
      [{ entityId: 1, roleKey: 'tele_caller_lc', teamId: team }],
      { name: `0 ${String(1e13 - Date.now()).padStart(13, '0')} board converter` },
    );
    request.principal = await createTestPrincipal('general_manager', [1]);
    const people = ok(await listLeadAssignees({ entityId: 1 }));
    expect(people.map((p) => p.id)).toContain(converter.id);

    const created = ok(
      await createLead({ ...lead(1), contact: { ...lead(1).contact, phone: '9812300011' } }),
    );
    const target = { entityId: 1, opportunityId: created.id };
    const assigned = ok(
      await assignOpportunity({ ...target, ownerId: converter.id }, crypto.randomUUID()),
    );
    expect(assigned).toMatchObject({ ownerId: converter.id, teamId: team });
    const parked = ok(
      await nurtureOpportunity({ ...target, reasonCode: 'waiting_for_funds' }, crypto.randomUUID()),
    );
    expect(parked.state).toBe('nurture');
    const nurtureBoard = ok(
      await listBoardLeads({ entityId: 1, pipelineKey: 'farmer_pumps', states: ['nurture'] }),
    );
    expect(nurtureBoard.items.find((l) => l.id === created.id)).toMatchObject({
      state: 'nurture',
      ownerId: converter.id,
      ownerName: expect.stringContaining('board converter') as unknown,
    });
    expect(ok(await reopenOpportunity(target, crypto.randomUUID())).state).toBe('open');
  });

  it('list leads a page at a time, and give the lead form its choices', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [3]);
    const a = ok(await createLead(lead(3)));
    const b = ok(await createLead(lead(3)));
    const first = ok(await listLeads({ limit: 1 }));
    expect(first.items.map((l) => l.id)).toEqual([b.id]);
    expect(first.nextCursor).not.toBeNull();
    const second = ok(await listLeads({ limit: 1, cursor: first.nextCursor ?? '' }));
    expect(second.items.map((l) => l.id)).toEqual([a.id]);
    const options = ok(await leadFormOptions());
    expect(options.pipelines.map((p) => p.key)).toContain('farmer_pumps');
    expect(options.sources.length).toBeGreaterThan(0);
  });

  it('list team members and their sign-ins for an Executive only', async () => {
    request.principal = await createTestPrincipal('general_manager', [1]);
    await expect(listUsers({})).resolves.toEqual({ ok: false, error: 'forbidden' });

    request.principal = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    const session = newId();
    await asMigrator(
      (m) => m`insert into sessions (id, user_id, token, expires_at)
               values (${session}, ${target.id}, ${`t-${session}`}, now() + interval '1 day')`,
    );
    const page = ok(await listUsers({ limit: 5 }));
    expect(page.items.length).toBeGreaterThan(0);
    const sessions = ok(await listUserSessions({ userId: target.id }));
    expect(sessions.map((s) => s.id)).toEqual([session]);

    const revoked = ok(await revokeSession({ sessionId: session }, crypto.randomUUID()));
    expect(revoked.revokedSessionIds).toEqual([session]);
    await expect(revokeSession({ sessionId: session })).resolves.toEqual({
      ok: false,
      error: 'session_missing',
    });
  });

  it('suspend and reactivate a person, and lift a sign-in lock', async () => {
    request.principal = await createTestPrincipal('executive');
    const target = await createTestUser([{ entityId: 1, roleKey: 'store_manager' }]);
    const suspended = ok(await suspendUser({ userId: target.id }, crypto.randomUUID()));
    expect(suspended.status).toBe('suspended');
    const back = ok(await reactivateUser({ userId: target.id }, crypto.randomUUID()));
    expect(back.status).toBe('active');
    await expect(clearSignInLock({ userId: target.id })).resolves.toEqual({ ok: true, data: null });
    request.principal = await createTestPrincipal('general_manager', [1]);
    await expect(clearSignInLock({ userId: target.id })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('invite a person, and refuse the email of someone already active', async () => {
    request.principal = await createTestPrincipal('executive');
    const email = `invite-${crypto.randomUUID().slice(0, 8)}@shakti.test`;
    const invite = {
      email,
      displayName: 'Invited colleague',
      entityRoles: [{ entityId: 1, roleKey: 'accounts' }],
    };
    const invited = ok(await inviteUser(invite, crypto.randomUUID()));
    expect(invited).toMatchObject({ email, status: 'invited' });
    const active = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    await expect(inviteUser({ ...invite, email: active.email })).resolves.toEqual({
      ok: false,
      error: 'invite_email_taken',
    });
  });

  it('read companies and refuse a company change to someone without the permission', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const companies = ok(await listEntities());
    expect(companies.map((c) => c.id)).toEqual([1]);
    await expect(updateEntity({ entityId: 1, brandName: 'Unchanged name' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    request.principal = await createTestPrincipal('executive');
    await expect(updateEntity({ entityId: 1, upiId: 'not a upi' })).resolves.toEqual({
      ok: false,
      error: 'validation_failed',
      field: 'upiId',
    });
  });

  it('read price lists and prices, and keep price changes to an Executive', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const lists = ok(await listPriceLists());
    const list = lists[0];
    if (list !== undefined) {
      const page = ok(await listPrices({ priceListId: list.id, limit: 2 }));
      expect(page.items.length).toBeLessThanOrEqual(2);
      for (const row of page.items) expect(row).not.toHaveProperty('cost');
      if (page.nextCursor !== null) {
        const next = ok(await listPrices({ priceListId: list.id, cursor: page.nextCursor }));
        const seen = new Set(page.items.map((r) => r.itemId));
        for (const row of next.items) expect(seen.has(row.itemId)).toBe(false);
      }
      const item = page.items[0];
      if (item !== undefined) {
        await expect(
          setPrice({ priceListId: list.id, itemId: item.itemId, price: '100.00' }),
        ).resolves.toEqual({ ok: false, error: 'forbidden' });
      }
    }
    await expect(listPrices({ priceListId: 'nope' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
  });
});

describe('screen guards match the menu', () => {
  const session = (principal: Principal) => ({ principal, access: { entities: [] } });

  it('a tele-caller opening Settings › Companies by its address gets the not-found screen', async () => {
    request.session = session(await createTestPrincipal('tele_caller_cc', [1]));
    await expect(screenAccess(navRequires('settings-companies'))).rejects.toThrow('not found');
  });

  it('an Executive opens Settings › Companies', async () => {
    const executive = await createTestPrincipal('executive');
    request.session = session(executive);
    await expect(screenAccess(navRequires('settings-companies'))).resolves.toMatchObject({
      principal: { id: executive.id },
    });
  });

  it('New lead needs the customer write grant as well as the lead write grant', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    request.session = session({
      ...caller,
      permissions: caller.permissions.filter((g) => g.key !== 'crm.account.write'),
    });
    await expect(screenAccess(navRequires('leads-new'))).rejects.toThrow('not found');
    request.session = session(caller);
    await expect(screenAccess(navRequires('leads-new'))).resolves.toBeDefined();
  });

  it('sends a caller with no session to sign in', async () => {
    await expect(screenAccess(navRequires('home'))).rejects.toThrow('redirect /sign-in');
  });
});
