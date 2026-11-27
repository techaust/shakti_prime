// J2 Customer loans (docs/03-roadmap-appendix/phase4.md §6.2): a company's lenders are read by every
// principal acting in it and kept only by the Executive; a customer's loan is read with the
// customer in the loan's company and written with crm.account.write over that relationship, on an
// order of the company that is not cancelled, one active loan per order even when two are written
// at once; the table holds the customer-loan machine's moves and follows its order through a
// customer merge; app.order_loan_gate() answers each gate per state, only to the callers it names.
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
/** The customer of each company, and a second one of company 1 a merge moves an order to. */
const ACCOUNT_1 = id(0x0011);
const ACCOUNT_2 = id(0x0012);
const ACCOUNT_KEPT = id(0x0013);
const LENDER_1 = id(0x0021);
const LENDER_2 = id(0x0022);
const LENDER_OFF = id(0x0023);
/** An order of company 1 per test, so none shares another's loan. */
const order1 = (n: number): string => id(0x0100 | n);
const ORDERS_1 = 16;
const ORDER_2 = id(0x0201);
const ORDER_CANCELLED = id(0x0202);
/** A loan of each company, applied for, read by the read tests. */
const LOAN_1 = id(0x0301);
const LOAN_2 = id(0x0302);

async function removeFixture(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from customer_loans where id::text like ${like} or sales_order_id::text like ${like}`;
      await tx`delete from lenders where id::text like ${like}`;
      await tx`delete from sales_orders where id::text like ${like}`;
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
      ] as const) {
        await tx`insert into principals (id, kind, display_name)
          values (${person}, 'user', ${name}) on conflict (id) do nothing`;
      }
      await tx`insert into teams (id, entity_id, name) values
        (${TEAM_1}, 1, 'loans suite team 1'), (${TEAM_2}, 2, 'loans suite team 2')`;
      await tx`insert into accounts (id, type, name, created_by) values
        (${ACCOUNT_1}, 'farm', 'loans suite customer 1', ${OWNER}),
        (${ACCOUNT_2}, 'farm', 'loans suite customer 2', ${OWNER}),
        (${ACCOUNT_KEPT}, 'farm', 'loans suite kept customer', ${OWNER})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by) values
        (${id(0x0031)}, ${ACCOUNT_1}, 1, ${OWNER}, ${TEAM_1}, ${OWNER}),
        (${id(0x0032)}, ${ACCOUNT_2}, 2, ${OWNER}, ${TEAM_2}, ${OWNER}),
        (${id(0x0033)}, ${ACCOUNT_KEPT}, 1, ${OWNER}, ${TEAM_1}, ${OWNER})`;
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
      ];
      for (const [orderId, entity, account, state] of orders) {
        await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id,
                   place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst, tax_total,
                   round_off, grand_total, state, cancel_reason, created_by)
          values (${orderId}, ${entity}, ${`J2S/2098-99/${orderId.slice(-4)}`}, '2098-99', ${account},
                  ${tierId('dealer')}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0, ${state},
                  ${state === 'cancelled' ? 'loans suite cancel' : null}, ${OWNER})`;
      }
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
          gates_json = ${tx.json(gates)}
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
});

describe('app.order_loan_gate() answers each gate', () => {
  const gm = () => as('general_manager', [1], OTHER_CALLER);

  it('none while the order has no active loan', async () => {
    expect(await gate(gm(), order1(9))).toEqual({
      loanId: null,
      loanState: null,
      dispatch: 'none',
      milestones: {},
    });
  });

  it('per state, for the dispatch and each milestone', async () => {
    const loan = id(0x0430);
    await asMigrator(
      (
        m,
      ) => m`insert into customer_loans (id, entity_id, account_id, sales_order_id, lender_id, amount, gates_json, created_by)
        values (${loan}, 1, ${ACCOUNT_1}, ${order1(10)}, ${LENDER_1}, 1000.00,
                ${m.json({ dispatch: 'disbursed', milestones: { advance: 'sanctioned', balance: 'disbursed' } })},
                ${OWNER})`,
    );
    const expected = {
      applied: { dispatch: 'pending', milestones: { advance: 'pending', balance: 'pending' } },
      sanctioned: { dispatch: 'pending', milestones: { advance: 'met', balance: 'pending' } },
      disbursed: { dispatch: 'met', milestones: { advance: 'met', balance: 'met' } },
    } as const;
    for (const state of ['applied', 'sanctioned', 'disbursed'] as const) {
      await setLoan(loan, state, {
        dispatch: 'disbursed',
        milestones: { advance: 'sanctioned', balance: 'disbursed' },
      });
      expect({ state, answer: await gate(gm(), order1(10)) }).toEqual({
        state,
        answer: { loanId: loan, loanState: state, ...expected[state] },
      });
    }
  });

  it('on sanction when the dispatch waits for it; none when it waits for nothing; none once rejected', async () => {
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
    await setLoan(loan, 'rejected', { dispatch: 'disbursed' });
    expect(await gate(gm(), order1(11))).toMatchObject({ dispatch: 'none', loanId: null });
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
