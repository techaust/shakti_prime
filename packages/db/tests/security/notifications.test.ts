import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// Notifications (docs/03-roadmap-appendix/phase1.md §8.1, DATABASE §6.9): a person's own notices, settings and
// browsers, the notify worker's definers, and routed work in the Agent Inbox. The suites never
// clean these tables, so every row here is found by this run's own ids.

afterAll(closeDb);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

async function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const workers = (entityIds: number[], permissions: Principal['permissions']) =>
  principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID, permissions });
const SEND = [{ key: 'notifications.send' as const, scope: 'all' as const }];

const ENDPOINT = () => `https://fcm.googleapis.com/fcm/send/${newId()}`;
const P256DH = 'B'.repeat(87);
const AUTH = 'A'.repeat(22);

let caller: Principal;
let callerBoth: Principal;
let other: Principal;
let colleague: Principal;
let inactiveId: string;
let team: string;
const notices: Record<string, string> = {};

beforeAll(async () => {
  team = await createTestTeam(1, 'notifications colleague team');
  const callerUser = await createTestUser([
    { entityId: 1, roleKey: 'tele_caller_cc' },
    { entityId: 2, roleKey: 'tele_caller_cc' },
  ]);
  const otherUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }]);
  const colleagueUser = await createTestUser(
    [{ entityId: 1, roleKey: 'tele_caller_cc', teamId: team }],
    { name: 'Notice Colleague' },
  );
  const inactive = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc' }], {
    status: 'suspended',
  });
  inactiveId = inactive.id;
  caller = principalFor('tele_caller_cc', [1], { id: callerUser.id });
  callerBoth = principalFor('tele_caller_cc', [1, 2], { id: callerUser.id });
  other = principalFor('tele_caller_cc', [1], { id: otherUser.id });
  colleague = principalFor('tele_caller_cc', [1], { id: colleagueUser.id, teamId: team });
  for (const [name, user, entity] of [
    ['caller1', callerUser.id, 1],
    ['caller2', callerUser.id, 2],
    ['other1', otherUser.id, 1],
  ] as const) {
    const id = newId();
    notices[name] = id;
    await asMigrator(
      (
        m,
      ) => m`insert into notifications (id, user_id, entity_id, type, subject_type, subject_id, dedupe_key)
        values (${id}, ${user}, ${entity}, 'call_due', 'task', ${newId()}, ${`test:${id}`})`,
    );
  }
});

const visible = (principal: Principal, ids: string[]) =>
  rows<{ id: string }>(
    principal,
    sql`select id from notifications where id = any(${`{${ids.join(',')}}`}::uuid[]) order by id`,
  ).then((r) => r.map((x) => x.id).sort());

describe('a person’s notices are their own (docs/03-roadmap-appendix/phase1.md §8.1)', () => {
  it('shows nothing without a request context', async () => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from notifications`,
    );
    expect(row?.n).toBe(0);
  });

  it('shows a person their own notices in the companies they act in, and nobody else’s', async () => {
    const all = Object.values(notices);
    expect(await visible(caller, all)).toEqual([notices.caller1].sort());
    expect(await visible(callerBoth, all)).toEqual([notices.caller1, notices.caller2].sort());
    expect(await visible(other, all)).toEqual([notices.other1]);
    const executive = principalFor('executive', [1, 2]);
    expect(await visible(executive, all)).toEqual([]);
  });

  it('lets no request write a notice, and the reporting role read none', async () => {
    expect(
      await failure(
        rows(
          caller,
          sql`insert into notifications (id, user_id, entity_id, type, subject_type, subject_id, dedupe_key)
              values (${newId()}, ${caller.id}, 1, 'call_due', 'task', ${newId()}, 'self-made')`,
        ),
      ),
    ).toMatch(/permission denied/);
    const [grants] = await withoutContext<{
      reporter: boolean;
      update: boolean;
      type: boolean;
    }>(sql`
      select has_any_column_privilege('readonly_reporter', 'notifications', 'SELECT') as reporter,
             has_column_privilege('app_user', 'notifications', 'read_at', 'UPDATE') as update,
             has_column_privilege('app_user', 'notifications', 'type', 'UPDATE') as type`);
    expect(grants).toEqual({ reporter: false, update: true, type: false });
  });

  it('lets a person mark only their own notice read, and change nothing else of it', async () => {
    const mark = (principal: Principal, id: string | undefined) =>
      rows(principal, sql`update notifications set read_at = now() where id = ${id} returning id`);
    expect(await mark(other, notices.caller1)).toHaveLength(0);
    expect(await mark(caller, notices.caller1)).toHaveLength(1);
    expect(
      await failure(
        rows(
          caller,
          sql`update notifications set type = 'lead_assigned' where id = ${notices.caller1}`,
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('notification settings and browsers are a person’s own', () => {
  it('keeps each person’s settings to themselves, written only by a person', async () => {
    await rows(
      caller,
      sql`insert into notification_preferences (id, user_id, type, in_app, push)
          values (${newId()}, ${caller.id}, 'call_due', true, false)
          on conflict on constraint notification_preferences_user_type_unique do nothing`,
    );
    const mine = await rows(
      caller,
      sql`select type from notification_preferences where user_id = ${caller.id}`,
    );
    expect(mine.length).toBeGreaterThan(0);
    expect(
      await rows(other, sql`select 1 from notification_preferences where user_id = ${caller.id}`),
    ).toHaveLength(0);
    expect(
      await failure(
        rows(
          other,
          sql`insert into notification_preferences (id, user_id, type) values (${newId()}, ${caller.id}, 'lead_assigned')`,
        ),
      ),
    ).toMatch(/row-level security/);
    const agent = principalFor('agent:copilot', [1], { id: caller.id });
    expect(
      await failure(
        rows(
          agent,
          sql`insert into notification_preferences (id, user_id, type) values (${newId()}, ${caller.id}, 'quote_expiring')`,
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('holds quiet hours on a row of no kind, both times or neither, never equal', async () => {
    expect(
      await failure(
        rows(
          other,
          sql`insert into notification_preferences (id, user_id, type, quiet_from, quiet_to)
              values (${newId()}, ${other.id}, null, '22:00', '22:00')`,
        ),
      ),
    ).toMatch(/notification_preferences_quiet_check/);
    expect(
      await failure(
        rows(
          other,
          sql`insert into notification_preferences (id, user_id, type, quiet_from, quiet_to)
              values (${newId()}, ${other.id}, 'call_due', '22:00', '07:00')`,
        ),
      ),
    ).toMatch(/notification_preferences_quiet_check/);
  });

  it('adds a browser only through the claim, which takes it over from whoever had it', async () => {
    const endpoint = ENDPOINT();
    expect(
      await failure(
        rows(
          caller,
          sql`insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
              values (${newId()}, ${caller.id}, ${endpoint}, ${P256DH}, ${AUTH})`,
        ),
      ),
    ).toMatch(/permission denied/);
    const claim = (principal: Principal) =>
      rows(
        principal,
        sql`select app.claim_push_subscription(${endpoint}, ${P256DH}, ${AUTH}, null) as id`,
      );
    await claim(caller);
    const seen = (principal: Principal) =>
      rows(principal, sql`select 1 from push_subscriptions where endpoint = ${endpoint}`);
    expect(await seen(caller)).toHaveLength(1);
    expect(await seen(other)).toHaveLength(0);
    await claim(other);
    expect(await seen(caller)).toHaveLength(0);
    expect(await seen(other)).toHaveLength(1);
    expect(
      await rows(
        caller,
        sql`delete from push_subscriptions where endpoint = ${endpoint} returning id`,
      ),
    ).toHaveLength(0);
    expect(
      await rows(
        other,
        sql`delete from push_subscriptions where endpoint = ${endpoint} returning id`,
      ),
    ).toHaveLength(1);
    const agent = principalFor('agent:copilot', [1], { id: caller.id });
    expect(await failure(claim(agent))).toMatch(/a person with profile.write is required/);
  });
});

describe('the notify worker’s definers', () => {
  const definers = (entity: number): SQL[] => [
    sql`select * from app.notice_lead(${entity}::smallint, ${newId()}::uuid)`,
    sql`select * from app.notice_duplicate_owners(${entity}::smallint, ${newId()}::uuid)`,
    sql`select * from app.notice_order_people(${entity}::smallint, ${newId()}::uuid)`,
    sql`select * from app.notice_due_calls(${entity}::smallint, now(), 10)`,
    sql`select * from app.notice_expiring_quotes(${entity}::smallint, now(), 10)`,
    sql`select * from app.notice_late_first_calls(${entity}::smallint, now(), 10)`,
    sql`select * from app.notice_settings(${entity}::smallint, array[]::uuid[])`,
    sql`select * from app.notice_push_targets(${entity}::smallint, array[]::uuid[])`,
    sql`select * from app.write_notices(${entity}::smallint, '[]'::jsonb)`,
    sql`select * from app.record_notice_push(${entity}::smallint, '[]'::jsonb, array[]::text[], array[]::text[])`,
    sql`select * from app.notice_pending_pushes(${entity}::smallint, 120, 10)`,
  ];

  it('refuses a caller without notifications.send, and a company outside the request', async () => {
    for (const statement of definers(1)) {
      expect(
        await failure(rows(workers([1], [{ key: 'files.process', scope: 'all' }]), statement)),
      ).toMatch(/notifications.send is required/);
      expect(await failure(rows(caller, statement))).toMatch(/notifications.send is required/);
    }
    for (const statement of definers(2)) {
      expect(await failure(rows(workers([1], SEND), statement))).toMatch(
        /the company is outside the request/,
      );
    }
  });

  it('writes a notice once per person and reason, only for someone who may receive it there', async () => {
    const subject = newId();
    const write = (user: string, entity: number) =>
      rows<{ id: string }>(
        workers([entity], SEND),
        sql`select id from app.write_notices(${entity}::smallint, ${JSON.stringify([
          {
            id: newId(),
            user_id: user,
            type: 'lead_assigned',
            subject_type: 'opportunity',
            subject_id: subject,
            payload: {},
            dedupe_key: `test-dedupe:${subject}`,
            in_app: true,
            push: 'none',
          },
        ])}::jsonb)`,
      );
    expect(await write(caller.id, 1)).toHaveLength(1);
    expect(await write(caller.id, 1)).toHaveLength(0);
    // A suspended person, and someone with no role in the company, are not written to.
    expect(await write(inactiveId, 1)).toHaveLength(0);
    expect(await write(other.id, 2)).toHaveLength(0);
  });
});

describe('routed work (PRD RPT-04 criterion 2)', () => {
  let account: string;

  beforeAll(async () => {
    account = newId();
    await asMigrator(async (m) => {
      await m`insert into accounts (id, type, name, created_by) values (${account}, 'farm', 'routed customer', ${colleague.id})`;
      await m`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
              values (${newId()}, ${account}, 1, ${colleague.id}, ${team}, ${colleague.id})`;
    });
  });

  const file = (
    principal: Principal,
    assignee: string,
    teamId: string | null,
    kind = 'routed_work',
  ) =>
    rows(
      principal,
      sql`insert into inbox_items (id, entity_id, kind, assignee_id, team_id, subject_type, subject_id, segment, created_by)
          values (${newId()}, 1, ${kind}, ${assignee}, ${teamId}, 'account', ${account}, 'farmer_pumps', ${principal.id})`,
    );

  it('names the colleague who looks after the customer, and nothing about the customer', async () => {
    const holder = await rows<{ owner_id: string; owner_name: string }>(
      caller,
      sql`select owner_id, owner_name from app.enquiry_holder(1::smallint, ${account}::uuid, null)`,
    );
    expect(holder).toEqual([{ owner_id: colleague.id, owner_name: 'Notice Colleague' }]);
    expect(
      await rows(
        colleague,
        sql`select * from app.enquiry_holder(1::smallint, ${account}::uuid, null)`,
      ),
    ).toHaveLength(0);
  });

  it('lets a person file routed work for the colleague who looks after the customer, and nobody else', async () => {
    await file(caller, colleague.id, team);
    expect(await failure(file(caller, other.id, null))).toMatch(/row-level security/);
    expect(await failure(file(caller, colleague.id, null))).toMatch(/row-level security/);
    // The colleague's own customer is not routed to themselves.
    expect(await failure(file(colleague, colleague.id, team))).toMatch(/row-level security/);
    const agent = principalFor('agent:triage', [1], { id: caller.id });
    expect(await failure(file(agent, colleague.id, team))).toMatch(/row-level security/);
    // The routed item is the colleague's: the caller does not read it.
    expect(
      await rows(caller, sql`select 1 from inbox_items where subject_id = ${account}`),
    ).toHaveLength(0);
    expect(
      await rows(colleague, sql`select 1 from inbox_items where subject_id = ${account}`),
    ).toHaveLength(1);
  });
});
