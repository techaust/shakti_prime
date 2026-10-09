import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  homeCaller,
  homeCredit,
  homePipeline,
  homeResponseTimes,
  homeSales,
} from '../../src/queries/home/home';

// The home pages' reads (docs/03-roadmap-appendix/phase1.md §9): the caller's queue and calls
// today, the pipeline by stage, first calls past their limit, quotes and orders this month, and
// dealer credit. They run in company 4, where figures other suites leave are counted before and
// after, so each assertion is the difference this file makes; the rows it adds are removed after.

const E = 4;
const NOW = new Date();
const ids = {
  tier: newId(),
  list: newId(),
  dealerOver: newId(),
  dealerFine: newId(),
};

let team: string;
let caller: Principal;
let gm: Principal;
let accountsUser: Principal;
let exec: Principal;
let store: Principal;
let outcome: string;
let sla: number | null;
const leads: string[] = [];

function run<T>(principal: Principal, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(createLead, { context, audit, outbox, now: NOW }, input),
  ) as Promise<T>;
}
const phone = () => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
async function newLead(owner: Principal): Promise<string> {
  const lead = await run<{ id: string }>(owner, {
    entityId: E,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Home customer', phone: phone() },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Phulera', pin: '303338' },
  });
  leads.push(lead.id);
  return lead.id;
}

const read = <T>(
  principal: Principal,
  query: (ctx: Parameters<typeof homePipeline>[0]) => Promise<T>,
) => asPrincipal(principal, (ctx) => query(ctx));

async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table dealer_terms disable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding disable trigger dealer_outstanding_append_only`;
      await tx`delete from dealer_terms where account_id in (${ids.dealerOver}, ${ids.dealerFine})`;
      await tx`delete from dealer_outstanding where account_id in (${ids.dealerOver}, ${ids.dealerFine})`;
      await tx`alter table dealer_terms enable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding enable trigger dealer_outstanding_append_only`;
      await tx`delete from sales_orders where tier_id = ${ids.tier}`;
      await tx`delete from quotes where tier_id = ${ids.tier}`;
      await tx`delete from account_entities where account_id in (${ids.dealerOver}, ${ids.dealerFine})`;
      await tx`delete from accounts where id in (${ids.dealerOver}, ${ids.dealerFine})`;
    }),
  );
}

beforeAll(async () => {
  await removeRows();
  team = await createTestTeam(E, 'home team');
  const make = async (role: Parameters<typeof createTestUser>[0][0]['roleKey'], name: string) => {
    const user = await createTestUser(
      [{ entityId: E, roleKey: role, ...(role === 'tele_caller_cc' ? { teamId: team } : {}) }],
      { name },
    );
    return createTestPrincipal(role, [E], {
      id: user.id,
      ...(role === 'tele_caller_cc' ? { teamId: team } : {}),
    });
  };
  caller = await make('tele_caller_cc', 'Home Caller');
  gm = await make('general_manager', 'Home GM');
  accountsUser = await make('accounts', 'Home Accounts');
  exec = await make('executive', 'Home Exec');
  store = await make('store_manager', 'Home Store');
  const [row] = await asMigrator(
    (m) => m<{ id: string }[]>`select id from call_dispositions
      where entity_id is null and segment is null and archived_at is null order by position limit 1`,
  );
  if (!row) throw new Error('no call outcome seeded');
  outcome = row.id;
  const [pipeline] = await asMigrator(
    (m) => m<{ sla: number | null }[]>`select first_contact_sla_minutes as sla from pipelines
      where entity_id is null and segment = 'farmer_pumps' and archived_at is null limit 1`,
  );
  sla = pipeline?.sla ?? null;
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`update pipelines set first_contact_sla_minutes = ${sla}
             where entity_id is null and segment = 'farmer_pumps'`;
    await m`alter table calls disable trigger calls_append_only`;
    await m`delete from calls where opportunity_id = any(${leads}::uuid[])`;
    await m`alter table calls enable trigger calls_append_only`;
  });
  await removeRows();
  await closeDb();
});

describe('homeCaller', () => {
  it('counts the caller’s queue and the calls they logged today', async () => {
    const before = (await read(caller, (c) => homeCaller(c, NOW)))[0];
    const lead = await newLead(caller);
    await asMigrator(async (m) => {
      for (let i = 0; i < 2; i += 1) {
        await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
          values (${newId()}, ${E}, ${lead}, ${caller.id}, 'outbound', 'manual', ${outcome}, 1, ${NOW})`;
      }
    });
    const after = (await read(caller, (c) => homeCaller(c, NOW)))[0];
    expect(before).toMatchObject({ entityId: E, waiting: 0, callsToday: 0 });
    expect(after?.callsToday).toBe(2);
    // A lead that has been called is still in the queue, and a new one waits to be called.
    expect(after?.waiting).toBe(1);
  });

  it('is refused to a role that logs no calls', async () => {
    await expect(read(accountsUser, (c) => homeCaller(c, NOW))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('homePipeline', () => {
  it('counts the company’s open leads by stage for the General Manager, not for a store manager', async () => {
    const before = await read(gm, (c) => homePipeline(c));
    const count = (rows: Awaited<typeof before>) =>
      rows
        .filter((p) => p.pipelineName.length > 0)
        .reduce((n, p) => n + p.stages.reduce((m, s) => m + s.leads, 0), 0);
    await newLead(caller);
    await newLead(caller);
    const after = await read(gm, (c) => homePipeline(c));
    expect(count(after) - count(before)).toBe(2);
    for (const p of after) {
      expect(p.entityId).toBe(E);
      const positions = p.stages.map((s) => s.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
    await expect(read(store, (c) => homePipeline(c))).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('homeResponseTimes', () => {
  it('counts leads waiting past the limit and first calls made late, only when a limit is set', async () => {
    await asMigrator(
      (m) => m`update pipelines set first_contact_sla_minutes = null
                where entity_id is null and segment = 'farmer_pumps'`,
    );
    const [none] = await read(gm, (c) => homeResponseTimes(c, NOW));
    expect(none?.limitSet).toBe(false);

    await asMigrator(
      (m) => m`update pipelines set first_contact_sla_minutes = 60
                where entity_id is null and segment = 'farmer_pumps'`,
    );
    const [before] = await read(gm, (c) => homeResponseTimes(c, NOW));
    const waiting = await newLead(caller);
    const late = await newLead(caller);
    const onTime = await newLead(caller);
    await asMigrator(async (m) => {
      await m`update opportunities set created_at = ${new Date(NOW.getTime() - 3 * 3_600_000)}
               where id = any(${[waiting, late, onTime]}::uuid[])`;
      // One first call two hours after the lead came in (late), one ten minutes after (on time).
      await m`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
        values (${newId()}, ${E}, ${late}, ${caller.id}, 'outbound', 'manual', ${outcome}, 1, ${new Date(NOW.getTime() - 3_600_000)}),
               (${newId()}, ${E}, ${onTime}, ${caller.id}, 'outbound', 'manual', ${outcome}, 1, ${new Date(NOW.getTime() - 3 * 3_600_000 + 600_000)})`;
    });
    const [after] = await read(gm, (c) => homeResponseTimes(c, NOW));
    expect(after?.limitSet).toBe(true);
    expect((after?.waitingPastLimit ?? 0) - (before?.waitingPastLimit ?? 0)).toBe(1);
    expect((after?.calledLate ?? 0) - (before?.calledLate ?? 0)).toBe(1);
  });

  it('reads the limit as set for a company with no open lead and no recent lead', async () => {
    // A company with nothing in the window the counts cover: its limit is still set (AUDIT: the
    // answer comes from the pipelines, not from the leads that happen to be in the window).
    const [quiet] = await asMigrator(
      (m) => m<{ id: number }[]>`select e.id from entities e
        where not exists (select 1 from opportunities o where o.entity_id = e.id
                            and (o.state = 'open' or o.created_at >= ${NOW}::timestamptz - interval '31 days'))
        order by e.id limit 1`,
    );
    if (!quiet) throw new Error('every company has an open or recent lead');
    const user = await createTestUser([{ entityId: quiet.id, roleKey: 'general_manager' }], {
      name: 'Quiet GM',
    });
    const quietGm = await createTestPrincipal('general_manager', [quiet.id], { id: user.id });
    await asMigrator(
      (m) => m`update pipelines set first_contact_sla_minutes = 60
                where entity_id is null and segment = 'farmer_pumps'`,
    );
    const [row] = await read(quietGm, (c) => homeResponseTimes(c, NOW));
    expect(row).toMatchObject({
      entityId: quiet.id,
      limitSet: true,
      waitingPastLimit: 0,
      calledLate: 0,
    });
  });
});

describe('homeSales', () => {
  it('counts quotes waiting and accepted and the orders confirmed this month, with their value', async () => {
    const [before] = await read(exec, (c) => homeSales(c, NOW));
    const lead = await newLead(caller);
    const [row] = await asMigrator(
      (m) => m<{ account_id: string }[]>`select account_id from opportunities where id = ${lead}`,
    );
    const account = row?.account_id ?? '';
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        const quote = (state: string) => tx`
          insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id, price_list_id,
                              scheme, place_of_supply_state, supply_kind, valid_until, state,
                              accepted_via, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
          values (${newId()}, ${E}, ${`HOME/${newId()}`}, '2098-99', ${lead}, ${account}, ${ids.tier}, ${ids.list},
                  'none', '08', 'intra', ${new Date(NOW.getTime() + 864e5 * 10)}, ${state},
                  ${state === 'accepted' ? 'whatsapp_reply' : null}, 0, 0, 0, 0, 0, 0, 0, ${caller.id})`;
        await quote('sent');
        await quote('sent');
        await quote('accepted');
        const order = (total: string, state: string) => tx`
          insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, tier_id,
                                    place_of_supply_state, supply_kind, state, cancel_reason, confirmed_at,
                                    confirmed_by, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
          values (${newId()}, ${E}, ${`HOME/${newId()}`}, '2098-99', ${newId()}, ${lead}, ${account}, ${ids.tier},
                  '08', 'intra', ${state}, ${state === 'cancelled' ? 'test' : null}, ${NOW}, ${caller.id},
                  ${total}, 0, 0, 0, 0, 0, ${total}, ${caller.id})`;
        await order('1000.50', 'confirmed');
        await order('2000.25', 'dispatched');
        await order('9999.00', 'cancelled');
      }),
    );
    const [after] = await read(exec, (c) => homeSales(c, NOW));
    expect((after?.quotesSent ?? 0) - (before?.quotesSent ?? 0)).toBe(2);
    expect((after?.quotesAccepted ?? 0) - (before?.quotesAccepted ?? 0)).toBe(1);
    expect((after?.ordersConfirmed ?? 0) - (before?.ordersConfirmed ?? 0)).toBe(2);
    const cents = (s: string | undefined) => Math.round(Number(s ?? '0') * 100);
    expect(cents(after?.ordersValue) - cents(before?.ordersValue)).toBe(300075);
    // Sales figures only: no cost or margin leaves the query.
    expect(Object.keys(after ?? {}).sort()).toEqual([
      'entityId',
      'ordersConfirmed',
      'ordersValue',
      'quotesAccepted',
      'quotesSent',
    ]);
  });
});

describe('homeCredit', () => {
  it('counts held orders, dealers over their limit and dealers with an overdue invoice', async () => {
    const [before] = await read(accountsUser, (c) => homeCredit(c));
    await asMigrator((m) =>
      m.begin(async (tx) => {
        for (const [dealer, name] of [
          [ids.dealerOver, 'Home dealer over'],
          [ids.dealerFine, 'Home dealer fine'],
        ] as const) {
          await tx`insert into accounts (id, type, name, created_by) values (${dealer}, 'dealer', ${name}, ${exec.id})`;
          await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
            values (${newId()}, ${dealer}, ${E}, ${exec.id}, ${exec.id})`;
        }
        await tx`insert into dealer_terms (id, entity_id, account_id, credit_limit, credit_days, created_by) values
          (${newId()}, ${E}, ${ids.dealerOver}, 1000.00, 30, ${exec.id}),
          (${newId()}, ${E}, ${ids.dealerFine}, 100000.00, 30, ${exec.id})`;
        // Over its limit, with an invoice 60 days old, against 30 credit days: counts twice.
        await tx`insert into dealer_outstanding (id, entity_id, account_id, outstanding, oldest_unpaid_invoice_date, oldest_unpaid_invoice_no, as_of, entered_by)
          values (${newId()}, ${E}, ${ids.dealerOver}, 5000.00, (now() at time zone 'Asia/Kolkata')::date - 60, 'INV-1',
                  (now() at time zone 'Asia/Kolkata')::date, ${exec.id}),
                 (${newId()}, ${E}, ${ids.dealerFine}, 500.00, null, null,
                  (now() at time zone 'Asia/Kolkata')::date, ${exec.id})`;
        await tx`set local session_replication_role = replica`;
        await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id, place_of_supply_state,
                    supply_kind, state, credit_held_at, credit_hold_reason, credit_hold_json,
                    subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
          values (${newId()}, ${E}, ${`HOME/${newId()}`}, '2098-99', ${ids.dealerOver}, ${ids.tier}, '08',
                  'intra', 'draft', now(), 'credit_limit_exceeded', '{}'::jsonb, 0, 0, 0, 0, 0, 0, 0, ${exec.id})`;
      }),
    );
    const [after] = await read(accountsUser, (c) => homeCredit(c));
    expect((after?.heldOrders ?? 0) - (before?.heldOrders ?? 0)).toBe(1);
    expect((after?.dealersOverLimit ?? 0) - (before?.dealersOverLimit ?? 0)).toBe(1);
    expect((after?.overdueInvoices ?? 0) - (before?.overdueInvoices ?? 0)).toBe(1);
  });

  it('is refused to a role that does not enter dealer credit', async () => {
    await expect(read(gm, (c) => homeCredit(c))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
