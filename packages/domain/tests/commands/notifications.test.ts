import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type NoticeBatchDto,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { completeInboxItem } from '../../src/commands/agents/inbox';
import { assignOpportunity } from '../../src/commands/crm/assign-opportunity';
import { createLead } from '../../src/commands/crm/create-lead';
import { routeEnquiry } from '../../src/commands/crm/route-enquiry';
import { notifyEvent, recordPush, scanNotices } from '../../src/commands/notifications/notify';
import {
  markAllNoticesRead,
  markNoticesRead,
  setNotificationSettings,
  subscribePush,
  unsubscribePush,
} from '../../src/commands/notifications/own';
import { istMinute } from '../../src/notifications/push-plan';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { listInbox } from '../../src/queries/agents/inbox';
import { countNotices, listNotices } from '../../src/queries/notifications/notices';
import { loadNotificationSettings } from '../../src/queries/notifications/settings';

// Notifications (PRD RPT-04, docs/03-roadmap-appendix/phase1.md §8.1): each kind of notice reaches the person
// who acts on it and only them, once however often its event or the scan runs; quiet hours hold a
// push; a person reads, marks and sets only their own; an enquiry for a colleague's customer
// becomes routed work in that colleague's inbox. The suites never clean the CRM tables, so every
// customer here has a number of this run only.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const RUN = newId().slice(-6);
let numbers = 0;
function phone(): string {
  numbers += 1;
  return `94${RUN.replace(/[^0-9]/g, '6')
    .padEnd(6, '6')
    .slice(0, 6)}${String(numbers).padStart(2, '0')}`;
}

let team: string;
let callerA: Principal;
let callerB: Principal;
let gm: Principal;
let gm2: Principal;
let teamLead: Principal;
const workers = (entityIds: number[] = [1]) =>
  principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

beforeAll(async () => {
  team = await createTestTeam(1, 'notifications team');
  const a = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId: team }], {
    name: 'Asha Caller',
  });
  const b = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId: team }], {
    name: 'Bilal Converter',
  });
  const g = await createTestUser([{ entityId: 1, roleKey: 'general_manager' }]);
  const g2 = await createTestUser([{ entityId: 2, roleKey: 'general_manager' }]);
  const t = await createTestUser([{ entityId: 1, roleKey: 'sales_team_lead', teamId: team }]);
  callerA = principalFor('tele_caller_cc', [1], { id: a.id, teamId: team });
  callerB = principalFor('tele_caller_lc', [1], { id: b.id, teamId: team });
  gm = principalFor('general_manager', [1], { id: g.id });
  gm2 = principalFor('general_manager', [2], { id: g2.id });
  teamLead = principalFor('sales_team_lead', [1], { id: t.id, teamId: team });
});

function run<T = unknown>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  sinks: { outbox?: typeof outbox } = {},
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox: sinks.outbox ?? outbox }, input),
  ) as Promise<T>;
}

function refusal(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (e: unknown) => e,
  );
}

interface Lead {
  id: string;
  account: { id: string };
}

function newLead(owner: Principal, pipelineKey = 'farmer_pumps', number = phone()): Promise<Lead> {
  return run<Lead>(owner, createLead, {
    entityId: 1,
    pipelineKey,
    contact: { name: `Notice customer ${RUN}`, phone: number },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Notice village', pin: '422001' },
  });
}

interface NoticeRow {
  user_id: string;
  type: string;
  read_at: Date | null;
  payload_json: Record<string, unknown>;
  channel_sent_json: Record<string, unknown>;
}

/** Every notice about a record, whoever it is for (as the table owner). */
function noticesAbout(subjectId: string): Promise<NoticeRow[]> {
  return asMigrator(
    (m) => m<NoticeRow[]>`select user_id, type, read_at, payload_json, channel_sent_json
                            from notifications where subject_id = ${subjectId} order by user_id`,
  );
}

const notify = (input: Record<string, unknown>, principal: Principal = workers()) =>
  run<NoticeBatchDto>(principal, notifyEvent, input);

/** Scans company 1 until it has nothing left, so earlier suites' rows never hide this run's. */
async function scanAll(): Promise<NoticeBatchDto['notices']> {
  const written: NoticeBatchDto['notices'] = [];
  for (let i = 0; i < 20; i += 1) {
    const batch = await run<NoticeBatchDto>(workers(), scanNotices, { entityId: 1 });
    written.push(...batch.notices);
    if (!batch.more) break;
  }
  return written;
}

describe('the notify and scan commands are the worker’s alone', () => {
  it('refuses a person, and a company outside the request', async () => {
    const input = {
      event: 'crm.duplicate.found',
      entityId: 1,
      eventId: newId(),
      candidateId: newId(),
    };
    for (const [command, payload] of [
      [notifyEvent, input],
      [scanNotices, { entityId: 1 }],
      [recordPush, { entityId: 1, outcomes: [], gone: [], delivered: [] }],
    ] as const) {
      await expect(run(gm, command, payload)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(run(workers([2]), command, payload)).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });
});

describe('a lead given to someone (lead_assigned)', () => {
  it('tells the new owner once, and nobody else', async () => {
    const lead = await newLead(callerA);
    const events = memoryOutboxSink();
    await run(
      teamLead,
      assignOpportunity,
      { entityId: 1, opportunityId: lead.id, ownerId: callerB.id },
      { outbox: events },
    );
    const assigned = events.records.find((r) => r.type === 'crm.opportunity.assigned');
    expect(assigned?.payload).toMatchObject({ ownerId: callerB.id, assignedById: teamLead.id });
    const input = {
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: lead.id,
      ownerId: callerB.id,
      assignedById: teamLead.id,
    };
    const first = await notify(input);
    expect(first.notices).toEqual([
      expect.objectContaining({ userId: callerB.id, type: 'lead_assigned', push: 'none' }),
    ]);
    // A repeated delivery of the same event writes nothing.
    expect((await notify(input)).notices).toEqual([]);
    const rows = await noticesAbout(lead.id);
    expect(rows.map((r) => [r.user_id, r.type])).toEqual([[callerB.id, 'lead_assigned']]);
    expect(rows[0]?.payload_json).toEqual({ accountId: lead.account.id, opportunityId: lead.id });
    // The owner it left since is not told about an older assignment.
    expect((await notify({ ...input, eventId: newId(), ownerId: callerA.id })).notices).toEqual([]);
  });

  it('tells nobody when a person took the lead themselves', async () => {
    const lead = await newLead(callerA);
    const batch = await notify({
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: lead.id,
      ownerId: callerA.id,
      assignedById: callerA.id,
    });
    expect(batch.notices).toEqual([]);
  });
});

describe('a possible duplicate (duplicate_found)', () => {
  it('tells the owners of both leads in the card’s company, once', async () => {
    const first = await newLead(callerA);
    const second = await newLead(callerB);
    const [low, high] = [first.id, second.id].sort();
    const candidate = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into duplicate_candidates (id, entity_id, kind, opportunity_id, other_opportunity_id, reason, confidence, created_by)
               values (${candidate}, 1, 'lead', ${low ?? ''}, ${high ?? ''}, 'phone', 90, ${callerA.id})`,
    );
    const input = {
      event: 'crm.duplicate.found',
      entityId: 1,
      eventId: newId(),
      candidateId: candidate,
    };
    const batch = await notify(input);
    expect(batch.notices.map((n) => n.userId).sort()).toEqual([callerA.id, callerB.id].sort());
    expect((await notify({ ...input, eventId: newId() })).notices).toEqual([]);
    const rows = await noticesAbout(candidate);
    expect(rows.every((r) => r.type === 'duplicate_found')).toBe(true);
    expect(rows.map((r) => r.user_id)).not.toContain(gm.id);
  });
});

describe('the scan (call_due, quote_expiring, first_call_late)', () => {
  it('tells a person once of their call falling due, and nothing of one due days ago', async () => {
    const lead = await newLead(callerA);
    const due = newId();
    const old = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind, due_at, created_by) values
        (${due}, 1, ${lead.id}, ${lead.account.id}, ${callerA.id}, ${team}, 'callback', now() - interval '5 minutes', ${callerA.id}),
        (${old}, 1, ${lead.id}, ${lead.account.id}, ${callerA.id}, ${team}, 'callback', now() - interval '3 days', ${callerA.id})`,
    );
    const written = await scanAll();
    expect(written.filter((n) => n.subjectId === due).map((n) => [n.userId, n.type])).toEqual([
      [callerA.id, 'call_due'],
    ]);
    expect(await noticesAbout(old)).toEqual([]);
    const again = await scanAll();
    expect(again.filter((n) => n.subjectId === due)).toEqual([]);
    expect(await noticesAbout(due)).toHaveLength(1);
  });

  it('tells the lead’s owner once of a quote lapsing within a day', async () => {
    const lead = await newLead(callerA);
    const list = newId();
    const quote = newId();
    const later = newId();
    await asMigrator(async (m) => {
      const [site] = await m<
        { site_id: string }[]
      >`select site_id from opportunities where id = ${lead.id}`;
      await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
              values (${list}, ${tierId('dealer')}, 1, ${10_000 + Math.floor(Math.random() * 80_000)}, '2090-01-01', now())`;
      for (const [id, valid, no] of [
        [quote, "now() + interval '6 hours'", 'A'],
        [later, "now() + interval '5 days'", 'B'],
      ] as const) {
        await m.unsafe(
          `insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id, tier_id,
             price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal, cgst,
             sgst, igst, tax_total, round_off, grand_total, created_by)
           values ($1, 1, $2, '2098-99', $3, $4, $5, $6, $7, 'none', '08', 'intra', ${valid},
                   0, 0, 0, 0, 0, 0, 0, $8)`,
          [
            id,
            `N1${RUN}/${no}`,
            lead.id,
            lead.account.id,
            site?.site_id ?? null,
            tierId('dealer'),
            list,
            callerA.id,
          ],
        );
      }
    });
    await scanAll();
    const rows = await noticesAbout(quote);
    expect(rows.map((r) => [r.user_id, r.type])).toEqual([[callerA.id, 'quote_expiring']]);
    expect(rows[0]?.payload_json).toMatchObject({ quoteId: quote, opportunityId: lead.id });
    expect(await noticesAbout(later)).toEqual([]);
    await scanAll();
    expect(await noticesAbout(quote)).toHaveLength(1);
  });

  it('tells the company’s General Manager once of a new lead past its first-contact limit', async () => {
    const pipeline = newId();
    const key = `n1-sla-${RUN}`;
    await asMigrator(async (m) => {
      await m`insert into pipelines (id, entity_id, key, name, segment, first_contact_sla_minutes)
              values (${pipeline}, 1, ${key}, ${`Notice SLA ${RUN}`}, 'farmer_pumps', 5)`;
      await m`insert into pipeline_stages (id, pipeline_id, entity_id, key, name, position, kind) values
        (${newId()}, ${pipeline}, 1, 'new', 'New', 1, 'open'),
        (${newId()}, ${pipeline}, 1, 'qualified', 'Qualified', 2, 'open')`;
    });
    const late = await newLead(callerA, key);
    const called = await newLead(callerA, key);
    const fresh = await newLead(callerA, key);
    await asMigrator(async (m) => {
      await m`update opportunities set created_at = now() - interval '20 minutes'
               where id in (${late.id}, ${called.id})`;
      await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                 disposition_id, attempt_no, started_at)
               select ${newId()}, 1, ${called.id}, ${callerA.id}, 'outbound', 'manual', d.id, 1, now()
                 from call_dispositions d
                where d.entity_id is null and d.segment is null and d.archived_at is null
                order by d.position limit 1`;
    });
    await scanAll();
    // Every General Manager of company 1 is told (earlier suites made some); never another person.
    const told = (await noticesAbout(late.id))
      .filter((r) => r.type === 'first_call_late')
      .map((r) => r.user_id);
    expect(told.filter((id) => id === gm.id)).toHaveLength(1);
    expect(told).not.toContain(gm2.id);
    expect(told).not.toContain(callerA.id);
    const roles = await asMigrator(
      (m) => m<{ key: string }[]>`select distinct r.key from user_entity_roles uer
                                   join roles r on r.id = uer.role_id
                                  where uer.entity_id = 1 and uer.user_id = any(${told}::uuid[])`,
    );
    expect(roles.map((r) => r.key)).toEqual(['general_manager']);
    expect((await noticesAbout(called.id)).filter((r) => r.type === 'first_call_late')).toEqual([]);
    expect((await noticesAbout(fresh.id)).filter((r) => r.type === 'first_call_late')).toEqual([]);
    await scanAll();
    expect(
      (await noticesAbout(late.id)).filter(
        (r) => r.type === 'first_call_late' && r.user_id === gm.id,
      ),
    ).toHaveLength(1);
  });
});

describe('a person’s choices: quiet hours and the centre', () => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${newId()}`;
  const keys = { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) };

  it('holds the push of a notice in the person’s quiet hours, and sends it otherwise', async () => {
    await run(callerB, subscribePush, { endpoint, keys });
    // Quiet hours around now, in IST.
    const minute = istMinute(new Date());
    const at = (m: number) => {
      const v = (m + 1440) % 1440;
      return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
    };
    const settings = { types: [], quietFrom: at(minute - 60), quietTo: at(minute + 60) };
    await run(callerB, setNotificationSettings, settings);
    const lead = await newLead(callerA);
    const held = await notify({
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: lead.id,
      ownerId: callerA.id,
      assignedById: callerB.id,
    });
    expect(held.notices[0]).toMatchObject({ userId: callerA.id, push: 'none' });

    const second = await newLead(callerA);
    await run(teamLead, assignOpportunity, {
      entityId: 1,
      opportunityId: second.id,
      ownerId: callerB.id,
    });
    const batch = await notify({
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: second.id,
      ownerId: callerB.id,
      assignedById: teamLead.id,
    });
    expect(batch.notices[0]).toMatchObject({ userId: callerB.id, push: 'held', targets: [] });
    expect((await noticesAbout(second.id))[0]?.channel_sent_json).toEqual({
      inApp: true,
      push: 'held',
    });

    await run(callerB, setNotificationSettings, { types: [], quietFrom: null, quietTo: null });
    const third = await newLead(callerA);
    await run(teamLead, assignOpportunity, {
      entityId: 1,
      opportunityId: third.id,
      ownerId: callerB.id,
    });
    const sent = await notify({
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: third.id,
      ownerId: callerB.id,
      assignedById: teamLead.id,
    });
    expect(sent.notices[0]).toMatchObject({
      push: 'send',
      targets: [{ endpoint, ...keys }],
    });
  });

  it('records what became of a push and removes a browser the push service says is gone', async () => {
    const result = await run<{ recorded: number; removed: number }>(workers(), recordPush, {
      entityId: 1,
      outcomes: [],
      gone: [endpoint],
      delivered: [],
    });
    expect(result.removed).toBe(1);
    const left = await asMigrator(
      (m) => m`select 1 from push_subscriptions where endpoint = ${endpoint}`,
    );
    expect(left).toHaveLength(0);
  });

  it('keeps a kind the person turned off out of the centre and the count, and still stops a repeat', async () => {
    await run(callerA, setNotificationSettings, {
      types: [{ type: 'duplicate_found', inApp: false, push: false }],
      quietFrom: null,
      quietTo: null,
    });
    const settings = await asPrincipal(callerA, (context) => loadNotificationSettings(context));
    expect(settings.types.find((t) => t.type === 'duplicate_found')).toEqual({
      type: 'duplicate_found',
      inApp: false,
      push: false,
    });
    expect(settings.types.find((t) => t.type === 'call_due')).toEqual({
      type: 'call_due',
      inApp: true,
      push: true,
    });
    const first = await newLead(callerA);
    const second = await newLead(callerA);
    const [low, high] = [first.id, second.id].sort();
    const candidate = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into duplicate_candidates (id, entity_id, kind, opportunity_id, other_opportunity_id, reason, confidence, created_by)
               values (${candidate}, 1, 'lead', ${low ?? ''}, ${high ?? ''}, 'phone', 90, ${callerA.id})`,
    );
    const batch = await notify({
      event: 'crm.duplicate.found',
      entityId: 1,
      eventId: newId(),
      candidateId: candidate,
    });
    expect(batch.notices).toEqual([expect.objectContaining({ userId: callerA.id, push: 'off' })]);
    const [row] = await noticesAbout(candidate);
    expect(row?.read_at).not.toBeNull();
    const page = await asPrincipal(callerA, (context) => listNotices(context, { limit: 50 }));
    expect(page.items.map((n) => n.subjectId)).not.toContain(candidate);
    await run(callerA, setNotificationSettings, {
      types: [{ type: 'duplicate_found', inApp: true, push: true }],
      quietFrom: null,
      quietTo: null,
    });
  });
});

describe('a person’s own notices', () => {
  it('lists them newest first with the customer, and marks only their own read', async () => {
    const lead = await newLead(callerA);
    await run(teamLead, assignOpportunity, {
      entityId: 1,
      opportunityId: lead.id,
      ownerId: callerB.id,
    });
    await notify({
      event: 'crm.opportunity.assigned',
      entityId: 1,
      eventId: newId(),
      opportunityId: lead.id,
      ownerId: callerB.id,
      assignedById: teamLead.id,
    });
    const page = await asPrincipal(callerB, (context) => listNotices(context, { limit: 5 }));
    const notice = page.items.find((n) => n.subjectId === lead.id);
    expect(notice).toMatchObject({
      type: 'lead_assigned',
      accountId: lead.account.id,
      customerName: `Notice customer ${RUN}`,
      readAt: null,
    });
    const before = await asPrincipal(callerB, (context) => countNotices(context));
    expect(before.unread).toBeGreaterThan(0);
    // Someone else's notice is as if it did not exist.
    expect(
      await run<{ read: number }>(callerA, markNoticesRead, { ids: [notice?.id ?? newId()] }),
    ).toEqual({ read: 0 });
    expect(
      await run<{ read: number }>(callerB, markNoticesRead, { ids: [notice?.id ?? newId()] }),
    ).toEqual({ read: 1 });
    await run(callerB, markAllNoticesRead, {});
    expect(await asPrincipal(callerB, (context) => countNotices(context))).toEqual({ unread: 0 });
    // A page further on starts after the last one.
    if (page.nextCursor !== null) {
      const next = await asPrincipal(callerB, (context) =>
        listNotices(context, { limit: 5, cursor: page.nextCursor ?? undefined }),
      );
      expect(next.items.map((n) => n.id)).not.toContain(page.items[0]?.id);
    }
  });

  it('keeps the people-only commands from agents, and the person’s commands from a company outside', async () => {
    const agent = principalFor('agent:copilot', [1], { id: callerA.id });
    for (const [command, input] of [
      [markNoticesRead, { ids: [newId()] }],
      [markAllNoticesRead, {}],
      [setNotificationSettings, { types: [], quietFrom: null, quietTo: null }],
      [
        subscribePush,
        {
          endpoint: `https://fcm.googleapis.com/fcm/send/${newId()}`,
          keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
        },
      ],
      [unsubscribePush, { endpoint: `https://fcm.googleapis.com/fcm/send/${newId()}` }],
    ] as const) {
      await expect(run(agent, command, input)).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a browser on a service the app does not send to', async () => {
    await expect(
      run(callerA, subscribePush, {
        endpoint: 'https://push.example.org/send/1',
        keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('an enquiry for a colleague’s customer (crm.enquiry.route, RPT-04 criterion 2)', () => {
  it('is refused to a role without lead rights, outside the request, and for one’s own customer', async () => {
    const hr = await createTestPrincipal('hr_admin', [1]);
    const input = { entityId: 1, pipelineKey: 'farmer_pumps', phone: phone() };
    await expect(run(hr, routeEnquiry, input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(callerB, routeEnquiry, { ...input, entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const mine = await newLead(callerA);
    expect(
      await refusal(
        run(callerA, routeEnquiry, {
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          existingAccountId: mine.account.id,
        }),
      ),
    ).toMatchObject({ code: 'not_found', details: { reason: 'enquiry_holder_missing' } });
  });

  it('goes to the colleague’s Agent Inbox with its interest, tells them, and they mark it done', async () => {
    const number = phone();
    const lead = await newLead(callerA, 'farmer_pumps', number);
    // The second caller's lead for the same number is refused as the colleague's customer.
    expect(await refusal(newLead(callerB, 'farmer_pumps', number))).toMatchObject({
      code: 'conflict',
      details: { reason: 'customer_held_by_colleague' },
    });
    const events = memoryOutboxSink();
    const routed = await run<{ itemId: string; colleagueName: string; segment: string }>(
      callerB,
      routeEnquiry,
      { entityId: 1, pipelineKey: 'farmer_pumps', phone: number, note: 'Asked about a 5 HP pump' },
      { outbox: events },
    );
    expect(routed).toMatchObject({ colleagueName: 'Asha Caller', segment: 'farmer_pumps' });
    const event = events.records.find((r) => r.type === 'crm.enquiry.routed');
    expect(event?.payload).toMatchObject({ assigneeId: callerA.id, accountId: lead.account.id });

    const inbox = (p: Principal) => asPrincipal(p, (context) => listInbox(context, { limit: 50 }));
    const item = (await inbox(callerA)).items.find((i) => i.id === routed.itemId);
    expect(item).toMatchObject({
      kind: 'routed_work',
      accountId: lead.account.id,
      segment: 'farmer_pumps',
      note: 'Asked about a 5 HP pump',
    });
    expect((await inbox(callerB)).items.map((i) => i.id)).not.toContain(routed.itemId);

    const told = await notify({
      event: 'crm.enquiry.routed',
      entityId: 1,
      eventId: newId(),
      itemId: routed.itemId,
      assigneeId: callerA.id,
      accountId: lead.account.id,
    });
    expect(told.notices.map((n) => [n.userId, n.type])).toEqual([[callerA.id, 'enquiry_routed']]);

    await expect(
      run(callerB, completeInboxItem, { entityId: 1, itemId: routed.itemId }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await run(callerA, completeInboxItem, { entityId: 1, itemId: routed.itemId })).toEqual({
      itemId: routed.itemId,
      state: 'done',
    });
    expect((await inbox(callerA)).items.map((i) => i.id)).not.toContain(routed.itemId);
  });

  it('routes a known customer’s enquiry by the customer', async () => {
    const lead = await newLead(callerA);
    const routed = await run<{ colleagueName: string }>(callerB, routeEnquiry, {
      entityId: 1,
      pipelineKey: 'residential_rooftop',
      existingAccountId: lead.account.id,
    });
    expect(routed).toMatchObject({ colleagueName: 'Asha Caller', segment: 'residential_rooftop' });
  });
});

describe('the scan as a whole', () => {
  it('answers ids and kinds only, never names or numbers', async () => {
    const batch = await run<NoticeBatchDto>(workers(), scanNotices, { entityId: 1 });
    expect(JSON.stringify(batch)).not.toMatch(/Notice customer|\+91/);
    // Reading the settings back through a query uses the person's own rows only.
    const rows = await asPrincipal(callerB, ({ tx }) =>
      tx.execute(sql`select user_id from notification_preferences`),
    );
    expect((rows as unknown as { user_id: string }[]).every((r) => r.user_id === callerB.id)).toBe(
      true,
    );
  });
});
