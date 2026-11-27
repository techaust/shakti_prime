// J2 Customer loans (docs/03-roadmap-appendix/phase4.md §6.2): a company's lenders are read by every
// principal acting in it and kept only by the Executive; a customer's loan is read with the
// customer in the loan's company and written with crm.account.write over that relationship, on an
// order of the company that is not cancelled, one active loan per order even when two are written
// at once; the table holds the customer-loan machine's moves and the waiver of a turned-down loan's
// gates, and follows its order through a customer merge and its undoing; app.order_loan_gate()
// answers the dispatch gate per state, holds it after a turn-down until a new loan or a waiver, and
// answers exactly the readers the loan's read policy lets in, and the operations roles.
// Every check runs as app_user under real row security, and the reads again on the app_reader pool.
import type { Principal, RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import { asMigrator, closeDb, principalFor, tierId } from '../../src/testing/index';

const P = '01990000-0000-7000-8000-000000d2';
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;
const like = `${P}%`;

/** The person who owns the customers' relationships, a Tele-caller (CC) holding own scope. */
const OWNER = id(0x0001);
const OTHER_CALLER = id(0x0002);
const EXECUTIVE = id(0x0003);
const TEAM_1 = id(0x0004);
const TEAM_2 = id(0x0005);
/** A Tele-caller who owns a lead of a customer whose relationship OWNER holds. */
const LEAD_OWNER = id(0x0006);
/** The customer of each company, and a second one of company 1 a merge moves an order to. */
const ACCOUNT_1 = id(0x0011);
const ACCOUNT_2 = id(0x0012);
const ACCOUNT_KEPT = id(0x0013);
/** A customer of company 1 that LEAD_OWNER reads only through their own lead. */
const ACCOUNT_LEAD = id(0x0014);
/** Two customers of company 1 that app.merge_customers() merges, a lead's order and loan moving. */
const ACCOUNT_MERGE_KEPT = id(0x0015);
const ACCOUNT_MERGED = id(0x0016);
const LEAD_READ = id(0x0041);
const LEAD_MERGED = id(0x0042);
const QUOTE_MERGED = id(0x0051);
const PRICE_LIST = id(0x0061);
const MERGE = id(0x0071);
const LENDER_1 = id(0x0021);
const LENDER_2 = id(0x0022);
const LENDER_OFF = id(0x0023);
/** An order of company 1 per test, so none shares another's loan. */
const order1 = (n: number): string => id(0x0100 | n);
const ORDERS_1 = 16;
const ORDER_2 = id(0x0201);
const ORDER_CANCELLED = id(0x0202);
const ORDER_LEAD = id(0x0203);
const ORDER_MERGED = id(0x0204);
const ORDER_CANCELLED_2 = id(0x0205);
/** A loan of each company, applied for, read by the read tests. */
const LOAN_1 = id(0x0301);
const LOAN_2 = id(0x0302);

async function removeFixture(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from customer_loans where id::text like ${like} or sales_order_id::text like ${like}`;
      await tx`delete from lenders where id::text like ${like}`;
      await tx`delete from customer_merges where id::text like ${like}`;
      await tx`delete from sales_orders where id::text like ${like}`;
      await tx`delete from quotes where id::text like ${like}`;
      await tx`delete from price_lists where id::text like ${like}`;
      await tx`delete from opportunities where id::text like ${like}`;
      await tx`delete from account_entities where id::text like ${like}`;
      await tx`delete from accounts where id::text like ${like}`;
      await tx`delete from teams where id::text like ${like}`;
    }),
  );
}

beforeAll(async () => {
  await removeFixture();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      for (const [person, name] of [
        [OWNER, 'loans suite caller'],
        [OTHER_CALLER, 'loans suite other caller'],
        [EXECUTIVE, 'loans suite executive'],
        [LEAD_OWNER, 'loans suite lead owner'],
      ] as const) {
        await tx`insert into principals (id, kind, display_name)
          values (${person}, 'user', ${name}) on conflict (id) do nothing`;
      }
      await tx`insert into teams (id, entity_id, name) values
        (${TEAM_1}, 1, 'loans suite team 1'), (${TEAM_2}, 2, 'loans suite team 2')`;
      await tx`insert into accounts (id, type, name, created_by) values
        (${ACCOUNT_1}, 'farm', 'loans suite customer 1', ${OWNER}),
        (${ACCOUNT_2}, 'farm', 'loans suite customer 2', ${OWNER}),
        (${ACCOUNT_KEPT}, 'farm', 'loans suite kept customer', ${OWNER}),
        (${ACCOUNT_LEAD}, 'farm', 'loans suite customer of a lead', ${OWNER}),
        (${ACCOUNT_MERGE_KEPT}, 'farm', 'loans suite merge kept customer', ${OWNER}),
        (${ACCOUNT_MERGED}, 'farm', 'loans suite merged customer', ${OWNER})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by) values
        (${id(0x0031)}, ${ACCOUNT_1}, 1, ${OWNER}, ${TEAM_1}, ${OWNER}),
        (${id(0x0032)}, ${ACCOUNT_2}, 2, ${OWNER}, ${TEAM_2}, ${OWNER}),
        (${id(0x0033)}, ${ACCOUNT_KEPT}, 1, ${OWNER}, ${TEAM_1}, ${OWNER}),
        (${id(0x0034)}, ${ACCOUNT_LEAD}, 1, ${OWNER}, ${TEAM_1}, ${OWNER}),
        (${id(0x0035)}, ${ACCOUNT_MERGE_KEPT}, 1, ${OWNER}, ${TEAM_1}, ${OWNER}),
        (${id(0x0036)}, ${ACCOUNT_MERGED}, 1, ${OWNER}, ${TEAM_1}, ${OWNER})`;
      // A live lead of each, in a stage and its own pipeline; the merged customer's lead has an
      // accepted quote's order, on an archived price list of this file.
      for (const [lead, account, owner] of [
        [LEAD_READ, ACCOUNT_LEAD, LEAD_OWNER],
        [LEAD_MERGED, ACCOUNT_MERGED, OWNER],
      ] as const) {
        await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, created_by)
          select ${lead}, 1, ${account}, s.pipeline_id, s.id, ${owner}, ${owner}
            from (select pipeline_id, id from pipeline_stages order by id limit 1) s`;
      }
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
        values (${PRICE_LIST}, ${tierId('dealer')}, 1, 9241, '2090-01-01', now())`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal,
                 cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
        values (${QUOTE_MERGED}, 1, 'J2S/Q/2098-99/0001', '2098-99', ${LEAD_MERGED}, ${ACCOUNT_MERGED},
                ${tierId('dealer')}, ${PRICE_LIST}, 'none', '08', 'intra', now() + interval '5 days',
                0, 0, 0, 0, 0, 0, 0, ${OWNER})`;
      await tx`insert into lenders (id, entity_id, name, is_active, created_by) values
        (${LENDER_1}, 1, 'loans suite bank one', true, ${EXECUTIVE}),
        (${LENDER_2}, 2, 'loans suite bank two', true, ${EXECUTIVE}),
        (${LENDER_OFF}, 1, 'loans suite closed bank', false, ${EXECUTIVE})`;
      const orders: [string, number, string, string][] = [
        ...Array.from({ length: ORDERS_1 }, (_, n): [string, number, string, string] => [
          order1(n),
          1,
          ACCOUNT_1,
          'draft',
        ]),
        [ORDER_2, 2, ACCOUNT_2, 'draft'],
        [ORDER_CANCELLED, 1, ACCOUNT_1, 'cancelled'],
        [ORDER_LEAD, 1, ACCOUNT_LEAD, 'draft'],
        [ORDER_CANCELLED_2, 1, ACCOUNT_1, 'cancelled'],
      ];
      for (const [orderId, entity, account, state] of orders) {
        await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id,
                   place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst, tax_total,
                   round_off, grand_total, state, cancel_reason, created_by)
          values (${orderId}, ${entity}, ${`J2S/2098-99/${orderId.slice(-4)}`}, '2098-99', ${account},
                  ${tierId('dealer')}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0, ${state},
                  ${state === 'cancelled' ? 'loans suite cancel' : null}, ${OWNER})`;
      }
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, opportunity_id, quote_id,
                 tier_id, price_list_id, place_of_supply_state, supply_kind, subtotal, cgst, sgst,
                 igst, tax_total, round_off, grand_total, state, created_by)
        values (${ORDER_MERGED}, 1, 'J2S/2098-99/0204', '2098-99', ${ACCOUNT_MERGED}, ${LEAD_MERGED},
                ${QUOTE_MERGED}, ${tierId('dealer')}, ${PRICE_LIST}, '08', 'intra', 0, 0, 0, 0, 0,
                0, 0, 'draft', ${OWNER})`;
      await tx`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by) values
        (${LOAN_1}, 1, ${ACCOUNT_1}, ${order1(0)}, ${LENDER_1}, 150000.00, ${OWNER}),
        (${LOAN_2}, 2, ${ACCOUNT_2}, ${ORDER_2}, ${LENDER_2}, 90000.00, ${OWNER})`;
    }),
  );
});

afterAll(async () => {
  await removeFixture();
  await closeDb();
});

/** A person of `role` acting in `entities`, as the fixture's caller unless named otherwise. */
const as = (role: RoleKey, entities: number[], personId = OWNER): Principal =>
  principalFor(role, entities, { id: personId });

type Pool = 'app_user' | 'app_reader';

/** The fixture ids of `table` that `principal` reads, on the given pool. */
async function visible(principal: Principal, table: string, pool: Pool): Promise<string[]> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select id::text as id from ${sql.identifier(table)}
             where id::text like ${like} order by id`,
      )) as unknown as { id: string }[];
      return rows.map((r) => r.id);
    },
    { reader: pool === 'app_reader' },
  );
}

/** Rows a statement wrote as `principal` on app_user, or the error that refused it. */
async function attempt(principal: Principal, statement: SQL): Promise<number | Error> {
  try {
    return await withRequestContext(principal, {}, async ({ tx }) => {
      const rows = (await tx.execute(statement)) as unknown as unknown[];
      return rows.length;
    });
  } catch (e) {
    if (e instanceof Error) return e;
    throw e;
  }
}

const causeOf = (e: number | Error): string =>
  e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : '';

const newLoan = (
  loanId: string,
  orderId: string,
  by: string,
  extra: { lenderId?: string | null; lenderName?: string | null; state?: string } = {},
): SQL =>
  sql`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, lender_name,
        amount, state, created_by)
      values (${loanId}, 1, ${ACCOUNT_1}, ${orderId}, ${extra.lenderId === undefined ? LENDER_1 : extra.lenderId},
              ${extra.lenderName ?? null}, 100000.00, ${extra.state ?? 'applied'}, ${by})
      returning id`;

/** The gate answer as `principal` asks it, or the error that refused the question. */
async function gate(principal: Principal, orderId: string): Promise<unknown> {
  try {
    return await withRequestContext(principal, {}, async ({ tx }) => {
      const [row] = (await tx.execute(
        sql`select app.order_loan_gate(${orderId}::uuid) as gate`,
      )) as unknown as { gate: unknown }[];
      return row?.gate;
    });
  } catch (e) {
    if (e instanceof Error) return causeOf(e);
    throw e;
  }
}

/**
 * Sets a loan's state and what the state carries, as the table owner, past the machine's guard
 * (`session_replication_role`, for this transaction only).
 */
async function setLoan(
  loanId: string,
  state: 'applied' | 'sanctioned' | 'disbursed' | 'rejected',
  gates: Record<string, unknown> = { dispatch: 'disbursed' },
  waived = false,
): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update customer_loans
      set state = ${state},
          sanctioned_amount = ${state === 'sanctioned' || state === 'disbursed' ? 100000 : null},
          sanctioned_at = ${state === 'sanctioned' || state === 'disbursed' ? new Date() : null},
          disbursed_at = ${state === 'disbursed' ? new Date() : null},
          rejected_reason = ${state === 'rejected' ? 'loans suite rejection' : null},
          gates_json = ${tx.json(gates)},
          gates_waived_at = ${waived ? new Date() : null},
          gates_waived_by = ${waived ? EXECUTIVE : null},
          gates_waived_reason = ${waived ? 'loans suite waiver' : null}
      where id = ${loanId}`;
    }),
  );
}

describe('lenders', () => {
  it('are read by every principal acting in the company, and no other company', async () => {
    for (const pool of ['app_user', 'app_reader'] as const) {
      expect(await visible(as('field_engineer', [1]), 'lenders', pool)).toEqual([
        LENDER_1,
        LENDER_OFF,
      ]);
      expect(await visible(as('accounts', [2]), 'lenders', pool)).toEqual([LENDER_2]);
    }
  });

  it('are added and changed only by the Executive', async () => {
    const add = (by: string) =>
      sql`insert into lenders (id, entity_id, name, created_by)
          values (${id(0x0024)}, 1, 'loans suite new bank', ${by}) returning id`;
    expect(causeOf(await attempt(as('general_manager', [1]), add(OWNER)))).toContain(
      'row-level security',
    );
    expect(await attempt(as('executive', [1], EXECUTIVE), add(EXECUTIVE))).toBe(1);
    const rename = sql`update lenders set name = 'loans suite renamed bank', updated_by = ${OWNER}
                        where id = ${id(0x0024)} returning id`;
    expect(await attempt(as('general_manager', [1]), rename)).toBe(0);
    // A lender is switched off, never removed: no request role may delete one.
    const drop = sql`delete from lenders where id = ${id(0x0024)} returning id`;
    expect(causeOf(await attempt(as('executive', [1], EXECUTIVE), drop))).toContain(
      'permission denied',
    );
  });

  it('are unique by name in a company, whatever the case', async () => {
    await expect(
      asMigrator(
        (m) => m`insert into lenders (id, entity_id, name, created_by)
          values (${id(0x0025)}, 1, 'LOANS SUITE BANK ONE ', ${EXECUTIVE})`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'lenders_entity_name_unique' });
  });
});

describe('a customer loan is read with the customer in its company', () => {
  it('by a reader of the relationship, on both pools, never another company', async () => {
    for (const pool of ['app_user', 'app_reader'] as const) {
      expect(await visible(as('tele_caller_cc', [1]), 'customer_loans', pool)).toContain(LOAN_1);
      expect(await visible(as('tele_caller_cc', [1]), 'customer_loans', pool)).not.toContain(
        LOAN_2,
      );
      expect(
        await visible(as('general_manager', [2], OTHER_CALLER), 'customer_loans', pool),
      ).toEqual([LOAN_2]);
      // Own scope reads only the relationships the person owns.
      expect(
        await visible(as('tele_caller_cc', [1], OTHER_CALLER), 'customer_loans', pool),
      ).toEqual([]);
      // HR reads no customer.
      expect(await visible(as('hr_admin', [1, 2]), 'customer_loans', pool)).toEqual([]);
    }
  });
});

describe('a customer loan is applied for with crm.account.write over the relationship', () => {
  it('by the owner of the relationship, on an order of the company', async () => {
    expect(await attempt(as('tele_caller_cc', [1]), newLoan(id(0x0401), order1(1), OWNER))).toBe(1);
  });

  it('never by a person outside the relationship or without the grant', async () => {
    for (const principal of [
      as('tele_caller_cc', [1], OTHER_CALLER),
      as('accounts', [1], OTHER_CALLER),
      as('inventory_manager', [1], OTHER_CALLER),
      as('general_manager', [2], OTHER_CALLER),
    ]) {
      expect(
        causeOf(await attempt(principal, newLoan(id(0x0402), order1(2), OTHER_CALLER))),
      ).toContain('row-level security');
    }
  });

  it('only as applied, by its maker, on an order that is not cancelled', async () => {
    const gm = as('general_manager', [1], OTHER_CALLER);
    for (const statement of [
      newLoan(id(0x0403), order1(2), OTHER_CALLER, { state: 'disbursed' }),
      newLoan(id(0x0403), order1(2), OWNER),
      newLoan(id(0x0403), ORDER_CANCELLED, OTHER_CALLER),
    ]) {
      expect(causeOf(await attempt(gm, statement))).toMatch(
        /row-level security|violates check constraint/,
      );
    }
  });

  it('names an active lender of the company, or a typed name only while it has none', async () => {
    const gm = as('general_manager', [1], OTHER_CALLER);
    expect(
      causeOf(
        await attempt(gm, newLoan(id(0x0404), order1(3), OTHER_CALLER, { lenderId: LENDER_OFF })),
      ),
    ).toContain('row-level security');
    expect(
      causeOf(
        await attempt(
          gm,
          newLoan(id(0x0404), order1(3), OTHER_CALLER, {
            lenderId: null,
            lenderName: 'Typed bank',
          }),
        ),
      ),
    ).toContain('row-level security');
    // Another company's lender does not fit the loan's company (the composite key).
    expect(
      causeOf(
        await attempt(gm, newLoan(id(0x0404), order1(3), OTHER_CALLER, { lenderId: LENDER_2 })),
      ),
    ).toMatch(/foreign key|row-level security/);
  });

  it('once per order while one is active, even when two are written at the same moment', async () => {
    const gm = as('general_manager', [1], OTHER_CALLER);
    const results = await Promise.all([
      attempt(gm, newLoan(id(0x0405), order1(4), OTHER_CALLER)),
      attempt(gm, newLoan(id(0x0406), order1(4), OTHER_CALLER)),
    ]);
    expect(results.filter((r) => r === 1)).toHaveLength(1);
    expect(causeOf(results.find((r) => r !== 1) ?? 0)).toContain('customer_loans_active_unique');
    // A rejected loan leaves room for another.
    const [taken] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from customer_loans where sales_order_id = ${order1(4)}`,
    );
    await setLoan(taken?.id ?? '', 'rejected');
    expect(await attempt(gm, newLoan(id(0x0407), order1(4), OTHER_CALLER))).toBe(1);
  });
});

describe('a customer loan moves only as the machine allows', () => {
  const gm = () => as('general_manager', [1], OTHER_CALLER);
  const move = (loanId: string, set: SQL) =>
    sql`update customer_loans set ${set}, updated_by = ${OTHER_CALLER} where id = ${loanId} returning id`;

  it('changes only its moving columns', async () => {
    expect(await attempt(gm(), newLoan(id(0x0410), order1(5), OTHER_CALLER))).toBe(1);
    for (const set of [
      sql`amount = 1.00`,
      sql`gates_json = '{"dispatch": "none"}'::jsonb`,
      sql`lender_id = ${LENDER_OFF}`,
      sql`account_id = ${ACCOUNT_KEPT}`,
    ]) {
      expect(causeOf(await attempt(gm(), move(id(0x0410), set)))).toContain('permission denied');
    }
    const remove = sql`delete from customer_loans where id = ${id(0x0410)} returning id`;
    expect(causeOf(await attempt(gm(), remove))).toContain('permission denied');
  });

  it('applied to sanctioned or rejected, sanctioned to disbursed or rejected, and no further', async () => {
    expect(await attempt(gm(), newLoan(id(0x0411), order1(6), OTHER_CALLER))).toBe(1);
    const disburseEarly = move(
      id(0x0411),
      sql`state = 'disbursed', sanctioned_amount = 1.00, sanctioned_at = now(), disbursed_at = now()`,
    );
    expect(causeOf(await attempt(gm(), disburseEarly))).toContain('customer-loan machine');
    const sanction = move(
      id(0x0411),
      sql`state = 'sanctioned', sanctioned_amount = 80000.00, sanctioned_at = now()`,
    );
    expect(await attempt(gm(), sanction)).toBe(1);
    const resanction = move(id(0x0411), sql`sanctioned_amount = 90000.00`);
    expect(causeOf(await attempt(gm(), resanction))).toContain('does not change');
    expect(
      await attempt(gm(), move(id(0x0411), sql`state = 'disbursed', disbursed_at = now()`)),
    ).toBe(1);
    expect(causeOf(await attempt(gm(), move(id(0x0411), sql`reference = 'LN-1'`)))).toContain(
      'does not change',
    );
    const reject = move(id(0x0411), sql`state = 'rejected', rejected_reason = 'late'`);
    expect(causeOf(await attempt(gm(), reject))).toMatch(/customer-loan machine|does not change/);
  });

  it('only by a person who may write the relationship', async () => {
    expect(await attempt(gm(), newLoan(id(0x0412), order1(7), OTHER_CALLER))).toBe(1);
    const reject = move(id(0x0412), sql`state = 'rejected', rejected_reason = 'late'`);
    expect(await attempt(as('accounts', [1], OTHER_CALLER), reject)).toBe(0);
    expect(await attempt(as('tele_caller_cc', [1], OTHER_CALLER), reject)).toBe(0);
  });
});

describe('a sanction or payout needs an order that is not cancelled', () => {
  it('refuses them on a cancelled order, and lets a turn-down close the loan there', async () => {
    const gm = as('general_manager', [1], OTHER_CALLER);
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by)
        values (${id(0x0415)}, 1, ${ACCOUNT_1}, ${ORDER_CANCELLED_2}, ${LENDER_1}, 1000.00, ${OWNER})`,
    );
    const sanction = sql`update customer_loans
      set state = 'sanctioned', sanctioned_amount = 1000.00, sanctioned_at = now(), updated_by = ${OTHER_CALLER}
      where id = ${id(0x0415)} returning id`;
    expect(causeOf(await attempt(gm, sanction))).toContain('row-level security');
    const reject = sql`update customer_loans
      set state = 'rejected', rejected_reason = 'order cancelled', updated_by = ${OTHER_CALLER}
      where id = ${id(0x0415)} returning id`;
    expect(await attempt(gm, reject)).toBe(1);
  });
});

describe("a turned-down loan's gates are waived once, at company scope", () => {
  const waive = (loanId: string, by: string) =>
    sql`update customer_loans
      set gates_waived_at = now(), gates_waived_by = ${by}, gates_waived_reason = 'Paid in cash',
          updated_by = ${by}
      where id = ${loanId} returning id`;

  it('only on a rejected loan, by a person writing customers across the company, and never again', async () => {
    const gm = as('general_manager', [1], OTHER_CALLER);
    expect(await attempt(gm, newLoan(id(0x0416), order1(13), OTHER_CALLER))).toBe(1);
    expect(causeOf(await attempt(gm, waive(id(0x0416), OTHER_CALLER)))).toContain(
      "only a rejected loan's gates",
    );
    await setLoan(id(0x0416), 'rejected');
    // The relationship's owner writes the customer, at own scope only.
    expect(causeOf(await attempt(as('tele_caller_cc', [1]), waive(id(0x0416), OWNER)))).toContain(
      'company scope',
    );
    // A waiver is recorded whole.
    const partial = sql`update customer_loans
      set gates_waived_at = now(), updated_by = ${OTHER_CALLER} where id = ${id(0x0416)} returning id`;
    expect(causeOf(await attempt(gm, partial))).toContain('customer_loans_waiver_check');
    expect(await attempt(gm, waive(id(0x0416), OTHER_CALLER))).toBe(1);
    expect(causeOf(await attempt(gm, waive(id(0x0416), OTHER_CALLER)))).toContain(
      'recorded waiver does not change',
    );
    const touch = sql`update customer_loans set reference = 'LN-2', updated_by = ${OTHER_CALLER}
                       where id = ${id(0x0416)} returning id`;
    expect(causeOf(await attempt(gm, touch))).toContain('does not change');
  });
});

describe('the gates hold the dispatch and nothing else', () => {
  it('refuses gates without a dispatch, with another key, or with an unknown value', async () => {
    for (const gates of [{}, { dispatch: 'disbursed', milestones: {} }, { dispatch: 'later' }]) {
      const refused = await asMigrator(
        (
          m,
        ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, gates_json, created_by)
          values (${id(0x0417)}, 1, ${ACCOUNT_1}, ${order1(14)}, ${LENDER_1}, 1000.00, ${m.json(gates)}, ${OWNER})`,
      ).then(
        () => 'inserted',
        (e: unknown) => String((e as { constraint_name?: unknown }).constraint_name),
      );
      expect({ gates, refused }).toEqual({
        gates,
        refused: expect.stringMatching(/^customer_loans_gates(_dispatch)?_check$/) as unknown,
      });
    }
  });
});

describe('a customer merge moves a loan with its order', () => {
  it('follows the order to the kept customer (ON UPDATE CASCADE)', async () => {
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by)
        values (${id(0x0420)}, 1, ${ACCOUNT_1}, ${order1(8)}, ${LENDER_1}, 1000.00, ${OWNER})`,
    );
    await asMigrator(
      (m) => m`update sales_orders set account_id = ${ACCOUNT_KEPT} where id = ${order1(8)}`,
    );
    const [row] = await asMigrator(
      (m) => m<{ account: string }[]>`select account_id::text as account from customer_loans
        where id = ${id(0x0420)}`,
    );
    expect(row?.account).toBe(ACCOUNT_KEPT);
  });

  it("moves a paid-out loan of a lead's order through app.merge_customers(), and back on the undo", async () => {
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount,
               state, sanctioned_amount, sanctioned_at, disbursed_at, created_by)
        values (${id(0x0421)}, 1, ${ACCOUNT_MERGED}, ${ORDER_MERGED}, ${LENDER_1}, 1000.00,
                'disbursed', 1000.00, now(), now(), ${OWNER})`,
    );
    const where = async () => {
      const [row] = await asMigrator(
        (m) => m<{ loan: string; order: string; state: string }[]>`
          select cl.account_id::text as loan, so.account_id::text as order, cl.state
            from customer_loans cl join sales_orders so on so.id = cl.sales_order_id
           where cl.id = ${id(0x0421)}`,
      );
      return row;
    };
    const exec = as('executive', [1], EXECUTIVE);
    const call = async (statement: SQL) =>
      withRequestContext(exec, {}, async ({ tx }) => {
        const [row] = (await tx.execute(statement)) as unknown as { r: { status: string } }[];
        return row?.r.status;
      });
    expect(
      await call(
        sql`select app.merge_customers(${MERGE}::uuid, ${ACCOUNT_MERGE_KEPT}::uuid,
                                       ${ACCOUNT_MERGED}::uuid, 1::smallint, null::uuid) as r`,
      ),
    ).toBe('merged');
    // The lead moved, its order with it, and the loan with the order (the guard lets a merge move
    // a paid-out loan's customer and nothing else).
    expect(await where()).toEqual({
      loan: ACCOUNT_MERGE_KEPT,
      order: ACCOUNT_MERGE_KEPT,
      state: 'disbursed',
    });
    expect(await call(sql`select app.unmerge_customers(${MERGE}::uuid) as r`)).toBe('undone');
    expect(await where()).toEqual({
      loan: ACCOUNT_MERGED,
      order: ACCOUNT_MERGED,
      state: 'disbursed',
    });
  });
});

describe('app.order_loan_gate() answers the dispatch gate', () => {
  const gm = () => as('general_manager', [1], OTHER_CALLER);
  const nothing = { loanId: null, loanState: null, dispatch: 'none', waived: false, reason: null };

  it('none while the order has no loan', async () => {
    expect(await gate(gm(), order1(9))).toEqual(nothing);
  });

  it('per state, with the loan and its state', async () => {
    const loan = id(0x0430);
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by)
        values (${loan}, 1, ${ACCOUNT_1}, ${order1(10)}, ${LENDER_1}, 1000.00, ${OWNER})`,
    );
    const expected = { applied: 'pending', sanctioned: 'pending', disbursed: 'met' } as const;
    for (const state of ['applied', 'sanctioned', 'disbursed'] as const) {
      await setLoan(loan, state);
      expect({ state, answer: await gate(gm(), order1(10)) }).toEqual({
        state,
        answer: {
          loanId: loan,
          loanState: state,
          dispatch: expected[state],
          waived: false,
          reason: null,
        },
      });
    }
  });

  it('on sanction when the dispatch waits for it, and none when it waits for nothing', async () => {
    const loan = id(0x0431);
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, gates_json, created_by)
        values (${loan}, 1, ${ACCOUNT_1}, ${order1(11)}, ${LENDER_1}, 1000.00,
                ${m.json({ dispatch: 'sanctioned' })}, ${OWNER})`,
    );
    expect(await gate(gm(), order1(11))).toMatchObject({ dispatch: 'pending' });
    await setLoan(loan, 'sanctioned', { dispatch: 'sanctioned' });
    expect(await gate(gm(), order1(11))).toMatchObject({ dispatch: 'met' });
    await setLoan(loan, 'sanctioned', { dispatch: 'none' });
    expect(await gate(gm(), order1(11))).toMatchObject({
      dispatch: 'none',
      loanState: 'sanctioned',
    });
    // A turned-down loan that held nothing back holds nothing.
    await setLoan(loan, 'rejected', { dispatch: 'none' });
    expect(await gate(gm(), order1(11))).toMatchObject({
      dispatch: 'none',
      loanId: loan,
      loanState: 'rejected',
      reason: null,
    });
  });

  it('pending after a turn-down, until a new loan replaces it or its gates are waived', async () => {
    const first = id(0x0433);
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by)
        values (${first}, 1, ${ACCOUNT_1}, ${order1(15)}, ${LENDER_1}, 1000.00, ${OWNER})`,
    );
    await setLoan(first, 'sanctioned');
    await setLoan(first, 'rejected');
    const heldBy = (loanId: string) => ({
      loanId,
      loanState: 'rejected',
      dispatch: 'pending',
      waived: false,
      reason: 'loan_rejected',
    });
    expect(await gate(gm(), order1(15))).toEqual(heldBy(first));
    // A new loan replaces it: the gate follows the new loan.
    const second = id(0x0434);
    expect(await attempt(gm(), newLoan(second, order1(15), OTHER_CALLER))).toBe(1);
    expect(await gate(gm(), order1(15))).toMatchObject({
      loanId: second,
      loanState: 'applied',
      dispatch: 'pending',
      reason: null,
    });
    // Turned down too, the newest turned-down loan holds the order; its waiver releases it.
    await setLoan(second, 'rejected');
    expect(await gate(gm(), order1(15))).toEqual(heldBy(second));
    await setLoan(second, 'rejected', { dispatch: 'disbursed' }, true);
    expect(await gate(gm(), order1(15))).toEqual({
      loanId: second,
      loanState: 'rejected',
      dispatch: 'none',
      waived: true,
      reason: null,
    });
  });

  it('to the person dispatching and to Accounts, who may not read the customer', async () => {
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by)
        values (${id(0x0432)}, 1, ${ACCOUNT_1}, ${order1(12)}, ${LENDER_1}, 1000.00, ${OWNER})`,
    );
    for (const principal of [
      as('inventory_manager', [1], OTHER_CALLER),
      as('accounts', [1], OTHER_CALLER),
      as('tele_caller_cc', [1]),
    ]) {
      expect(await gate(principal, order1(12))).toMatchObject({ dispatch: 'pending' });
    }
  });

  it('to exactly the readers the loan read policy lets in: a person reading the customer through their own lead', async () => {
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, created_by)
        values (${id(0x0435)}, 1, ${ACCOUNT_LEAD}, ${ORDER_LEAD}, ${LENDER_1}, 1000.00, ${OWNER})`,
    );
    const leadOwner = as('tele_caller_cc', [1], LEAD_OWNER);
    for (const pool of ['app_user', 'app_reader'] as const) {
      expect(await visible(leadOwner, 'customer_loans', pool)).toContain(id(0x0435));
    }
    expect(await gate(leadOwner, ORDER_LEAD)).toMatchObject({
      loanId: id(0x0435),
      dispatch: 'pending',
    });
    // An archived lead reads the customer no more: neither the loan nor its gate.
    await asMigrator(
      (m) => m`update opportunities set archived_at = now() where id = ${LEAD_READ}`,
    );
    try {
      expect(await visible(leadOwner, 'customer_loans', 'app_user')).not.toContain(id(0x0435));
      expect(await gate(leadOwner, ORDER_LEAD)).toBeNull();
    } finally {
      await asMigrator(
        (m) => m`update opportunities set archived_at = null where id = ${LEAD_READ}`,
      );
    }
  });

  it('to no one else: null outside the request or the relationship, refused without a grant', async () => {
    expect(await gate(as('general_manager', [2], OTHER_CALLER), order1(12))).toBeNull();
    expect(await gate(as('tele_caller_cc', [1], OTHER_CALLER), order1(12))).toBeNull();
    expect(await gate(as('hr_admin', [1], OTHER_CALLER), order1(12))).toContain('loan gate');
  });

  it('is the only definer the reader pool and the application may call for it', async () => {
    const [row] = await asMigrator(
      (m) => m<{ pub: boolean; reporter: boolean; reader: boolean; app: boolean }[]>`
        select has_function_privilege('public', 'app.order_loan_gate(uuid)', 'EXECUTE') as pub,
               has_function_privilege('readonly_reporter', 'app.order_loan_gate(uuid)', 'EXECUTE') as reporter,
               has_function_privilege('app_reader', 'app.order_loan_gate(uuid)', 'EXECUTE') as reader,
               has_function_privilege('app_user', 'app.order_loan_gate(uuid)', 'EXECUTE') as app`,
    );
    expect(row).toEqual({ pub: false, reporter: false, reader: true, app: true });
  });
});
