import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/**
 * HR1 (docs/03-roadmap-appendix/phase5.md §5, SECURITY §3.2): the rules the database holds
 * whatever writes, beside the role × company matrix's reads. Employees are written only by
 * hr.employee.write; a leave decision is an approver's in scope and never on their own leave; a
 * balance's movements are append-only, and `use` comes only from the approval that made it, once.
 * The people and rows are this file's own, in company 2.
 */

const E = 2;
const tag = newId().slice(-6);

let hr: Principal;
let gm: Principal;
let lead: Principal;
let caller: Principal;
let other: Principal;
let shiftId: string;
let typeId: string;
let leadEmployee: string;
let callerEmployee: string;
let otherEmployee: string;

/** The database's own error, whether thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const code = (cause as { code?: unknown }).code;
    return {
      ...(typeof code === 'string' ? { code } : {}),
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
  throw new Error('expected the statement to fail');
}

async function person(role: Parameters<typeof createTestPrincipal>[0]): Promise<Principal> {
  const user = await createTestUser([{ entityId: E, roleKey: role }]);
  return createTestPrincipal(role, [E], { id: user.id });
}

/** A leave request written as the migrator, waiting. */
async function waitingRequest(employeeId: string, day: string, requestedBy: string) {
  const id = newId();
  await asMigrator(
    (m) => m`insert into leave_requests (id, entity_id, employee_id, leave_type_id, from_date,
                                          to_date, days, requested_by)
             values (${id}, ${E}, ${employeeId}, ${typeId}, ${day}, ${day}, 1, ${requestedBy})`,
  );
  return id;
}

/** Fires a decision on a request as `principal`, straight through the table. */
function decide(principal: Principal, id: string, state: string) {
  return asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`update leave_requests
                      set state = ${state}, decided_by = ${principal.id}, decided_at = now(),
                          updated_by = ${principal.id}
                    where id = ${id}`),
  );
}

async function visible(principal: Principal, table: string, ids: string[]): Promise<string[]> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select id::text as id from ${sql.identifier(table)}
           where id::text = any(string_to_array(${ids.join(',')}, ','))`,
    )) as unknown as { id: string }[];
    return rows.map((r) => r.id).sort();
  });
}

beforeAll(async () => {
  hr = await person('hr_admin');
  gm = await person('general_manager');
  lead = await person('sales_team_lead');
  caller = await person('tele_caller_cc');
  other = await person('tele_caller_lc');
  shiftId = newId();
  typeId = newId();
  [leadEmployee, callerEmployee, otherEmployee] = [newId(), newId(), newId()];
  await asMigrator(async (m) => {
    await m`insert into shifts (id, entity_id, name, start_time, end_time, lunch_min, grace_min,
                                weekly_off_days, created_by)
            values (${shiftId}, ${E}, ${`Security ${tag}`}, '09:30', '18:00', 30, 10, '{7}', ${hr.id})`;
    await m`insert into leave_types (id, entity_id, name, days_per_year, carries_forward, is_paid,
                                     created_by)
            values (${typeId}, ${E}, ${`Security leave ${tag}`}, 10, false, true, ${hr.id})`;
    await m`insert into employees (id, entity_id, user_id, name, manager_id, shift_id, joined_on,
                                   created_by) values
      (${leadEmployee}, ${E}, ${lead.id}, 'security lead', null, ${shiftId}, '2030-01-01', ${hr.id}),
      (${callerEmployee}, ${E}, ${caller.id}, 'security caller', ${leadEmployee}, ${shiftId}, '2030-01-01', ${hr.id}),
      (${otherEmployee}, ${E}, ${other.id}, 'security other', null, ${shiftId}, '2030-01-01', ${hr.id})`;
  });
});

describe('HR1 reads', () => {
  it('fail closed with no request context', async () => {
    for (const table of ['employees', 'leave_requests', 'leave_balances', 'shifts', 'holidays']) {
      const rows = await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)}`,
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
    }
  });

  it('a person reads their own record, a team lead the people they manage, the GM and HR all', async () => {
    const all = [leadEmployee, callerEmployee, otherEmployee];
    expect(await visible(caller, 'employees', all)).toEqual([callerEmployee]);
    expect(await visible(lead, 'employees', all)).toEqual([leadEmployee, callerEmployee].sort());
    expect(await visible(gm, 'employees', all)).toEqual([...all].sort());
    expect(await visible(hr, 'employees', all)).toEqual([...all].sort());
  });

  it('a manager who left no longer reads the people they managed', async () => {
    const before = await visible(lead, 'employees', [callerEmployee]);
    expect(before).toEqual([callerEmployee]);
    await asMigrator(
      (m) =>
        m`update employees set active = false, left_on = '2031-01-01' where id = ${leadEmployee}`,
    );
    try {
      expect(await visible(lead, 'employees', [callerEmployee])).toEqual([]);
    } finally {
      await asMigrator(
        (m) => m`update employees set active = true, left_on = null where id = ${leadEmployee}`,
      );
    }
  });
});

describe('HR1 writes', () => {
  it('only hr.employee.write adds or changes an employee', async () => {
    const insert = (p: Principal) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into employees (id, entity_id, name, joined_on, created_by)
                       values (${newId()}, ${E}, 'security added', '2030-01-01', ${p.id})`),
      );
    expect((await failure(insert(gm))).code).toBe('42501');
    expect((await failure(insert(caller))).code).toBe('42501');
    await expect(insert(hr)).resolves.toBeDefined();
    // The GM reads the record but may not change it: the update finds no row.
    const changed = await asPrincipal(gm, async ({ tx }) =>
      tx.execute(sql`update employees set name = 'renamed', updated_by = ${gm.id}
                      where id = ${otherEmployee} returning id`),
    );
    expect(changed as unknown as unknown[]).toHaveLength(0);
    // Nobody moves a record to another company.
    expect(
      (
        await failure(
          asPrincipal(hr, ({ tx }) =>
            tx.execute(sql`update employees set entity_id = 1 where id = ${otherEmployee}`),
          ),
        )
      ).code,
    ).toBe('42501');
  });

  it('a person asks only for their own leave, of a type of their company', async () => {
    const ask = (p: Principal, employeeId: string, leaveType = typeId) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into leave_requests (id, entity_id, employee_id, leave_type_id,
                                                   from_date, to_date, days, requested_by)
                       values (${newId()}, ${E}, ${employeeId}, ${leaveType}, '2032-01-05',
                               '2032-01-05', 1, ${p.id})`),
      );
    expect((await failure(ask(caller, otherEmployee))).code).toBe('42501');
    const foreignType = newId();
    await asMigrator(
      (m) => m`insert into leave_types (id, entity_id, name, days_per_year, carries_forward,
                                        is_paid, created_by)
               values (${foreignType}, 1, ${`Foreign ${tag}`}, 1, false, false, ${hr.id})`,
    );
    expect((await failure(ask(caller, callerEmployee, foreignType))).code).toBe('42501');
    await expect(ask(caller, callerEmployee)).resolves.toBeDefined();
    // A second request over the same day is refused.
    expect((await failure(ask(caller, callerEmployee))).code).toBe('23P01');
  });

  it('nobody approves their own leave, and a team lead decides only for the people they manage', async () => {
    const leads = await waitingRequest(leadEmployee, '2032-02-02', lead.id);
    expect((await failure(decide(lead, leads, 'approved'))).code).toBe('42501');
    const others = await waitingRequest(otherEmployee, '2032-02-03', other.id);
    // The lead cannot even see the request of someone they do not manage.
    await decide(lead, others, 'approved');
    expect(await visible(hr, 'leave_requests', [others])).toEqual([others]);
    const [state] = await asMigrator(
      (m) => m<{ state: string }[]>`select state from leave_requests where id = ${others}`,
    );
    expect(state?.state).toBe('requested');
    // A caller cannot decide, even on a request they can read.
    const callers = await waitingRequest(callerEmployee, '2032-02-04', caller.id);
    expect((await failure(decide(caller, callers, 'approved'))).code).toBe('42501');
    // The lead approves for the caller they manage, as themselves only.
    await decide(lead, callers, 'approved');
    const [after] = await asMigrator(
      (m) =>
        m<
          { state: string; decided_by: string }[]
        >`select state, decided_by from leave_requests where id = ${callers}`,
    );
    expect(after).toEqual({ state: 'approved', decided_by: lead.id });
    // A decided request does not go back.
    expect((await failure(decide(lead, callers, 'requested'))).code).toBe('42501');
  });

  it('the person who asked cancels a waiting request; an approver does not', async () => {
    const asked = await waitingRequest(callerEmployee, '2032-03-02', caller.id);
    expect((await failure(decide(lead, asked, 'cancelled'))).code).toBe('42501');
    await decide(caller, asked, 'cancelled');
    const [row] = await asMigrator(
      (m) => m<{ state: string }[]>`select state from leave_requests where id = ${asked}`,
    );
    expect(row?.state).toBe('cancelled');
  });

  it('a balance takes an approval once, by its approver, for its days; movements never change', async () => {
    const asked = await waitingRequest(callerEmployee, '2032-04-06', caller.id);
    await decide(lead, asked, 'approved');
    const use = (p: Principal, days: number) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into leave_balances (id, entity_id, employee_id, leave_type_id, kind,
                                                   days, leave_request_id, created_by)
                       values (${newId()}, ${E}, ${callerEmployee}, ${typeId}, 'use', ${days},
                               ${asked}, ${p.id})`),
      );
    // Someone other than the approver, or the wrong number of days, is refused.
    expect((await failure(use(gm, -1))).code).toBe('42501');
    expect((await failure(use(lead, -3))).code).toBe('42501');
    await expect(use(lead, -1)).resolves.toBeDefined();
    expect((await failure(use(lead, -1))).code).toBe('23505');
    // A grant is HR's, with a reason; nobody changes or removes a movement.
    const grant = (p: Principal, reason: string | null) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into leave_balances (id, entity_id, employee_id, leave_type_id, kind,
                                                   days, reason, created_by)
                       values (${newId()}, ${E}, ${callerEmployee}, ${typeId}, 'grant', 5,
                               ${reason}, ${p.id}) returning id`),
      );
    expect((await failure(grant(lead, 'not theirs'))).code).toBe('42501');
    expect((await failure(grant(hr, null))).code).toBe('23514');
    const [made] = (await grant(hr, 'opening balance')) as unknown as { id: string }[];
    expect(made).toBeDefined();
    expect(
      (
        await failure(
          asMigrator((m) => m`update leave_balances set days = 50 where id = ${made?.id ?? ''}`),
        )
      ).message,
    ).toMatch(/append-only/);
    expect(
      (await failure(asMigrator((m) => m`delete from leave_balances where id = ${made?.id ?? ''}`)))
        .message,
    ).toMatch(/append-only/);
  });

  it('a group setting is written only in a request covering every company', async () => {
    const insertShift = (p: Principal) =>
      asPrincipal(p, ({ tx }) =>
        tx.execute(sql`insert into shifts (id, entity_id, name, start_time, end_time, lunch_min,
                                           grace_min, created_by)
                       values (${newId()}, null, ${`Group security ${newId().slice(-6)}`}, '09:00',
                               '17:00', 30, 10, ${p.id})`),
      );
    expect((await failure(insertShift(hr))).code).toBe('42501');
    const hrEverywhere = await createTestPrincipal('hr_admin', ALL_ENTITY_IDS, { id: hr.id });
    await expect(insertShift(hrEverywhere)).resolves.toBeDefined();
    expect((await failure(insertShift(gm))).code).toBe('42501');
  });
});
