import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tierId } from '../../seeds/price-tiers';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
} from '../../src/testing/index';

// Orders, dealer credit and commission (docs/05-database.md §6.4, migration 0117): a dealer's order
// without a quote is made with sales.order.create over the dealer's relationship, as a draft with
// no hold, release or confirmation; its lines only in the transaction that made it; afterwards a
// person changes only the state, hold, release and cancel columns, and the release only as the
// Executive in their own name. Dealer terms and outstanding are append-only entries of
// sales.credit.write; commission is written only by its definers, which check their permission.
// Company 4 holds this file's rows.

const E = 4;
/** A price list the test orders name: archived, so it prices nothing anywhere. */
const LIST = '01990000-0000-7000-8000-000000a60001';
const ITEM = '01990000-0000-7000-8000-000000a60002';
const RATE = '01990000-0000-7000-8000-000000a60003';

/** The database's message for a refused statement (drizzle wraps it as the cause). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

let lc: Principal;
let colleague: Principal;
let gm: Principal;
let exec: Principal;
let accounts: Principal;
let dealer: string;
let household: string;
/** Dealers the merge tests make, cleaned up with the rest. */
const mergeDealers: string[] = [];

async function customer(type: 'dealer' | 'household', owner: Principal): Promise<string> {
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${id}, ${type}, 'Order policy customer', ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${id}, ${E}, ${owner.id}, ${owner.teamId ?? null}, ${owner.id})`;
    }),
  );
  return id;
}

const insertOrder = (
  accountId: string,
  by: Principal,
  row: { id?: string; state?: string; confirmed?: boolean } = {},
) =>
  sql`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id, price_list_id,
                                place_of_supply_state, supply_kind, state, confirmed_at, confirmed_by,
                                subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
      values (${row.id ?? newId()}, ${E}, ${`ORLS/${newId()}`}, '2098-99', ${accountId}, ${tierId('dealer')},
              ${LIST}, '08', 'intra', ${row.state ?? 'draft'},
              ${row.confirmed === true ? sql`now()` : null}, ${row.confirmed === true ? by.id : null},
              0, 0, 0, 0, 0, 0, 0, ${by.id})`;

const insertLine = (orderId: string) =>
  sql`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku, description,
                                     unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value,
                                     cgst, sgst, igst, line_total)
      values (${newId()}, ${E}, ${orderId}, ${Math.floor(Math.random() * 1e6) + 1}, ${ITEM}, 'ORLS-ITEM',
              'order policy item', 'nos', 1, 0, '8479', ${RATE}, 0.00, 0, 0, 0, 0, 0)`;

/** A draft order of the dealer with one line, made in one transaction as the LC. */
async function draftOrder(): Promise<string> {
  const id = newId();
  await asPrincipal(lc, async ({ tx }) => {
    await tx.execute(insertOrder(dealer, lc, { id }));
    await tx.execute(insertLine(id));
  });
  return id;
}

beforeAll(async () => {
  const team = await createTestTeam(E, 'order policy team');
  const otherTeam = await createTestTeam(E, 'order policy other team');
  lc = await createTestPrincipal('tele_caller_lc', [E], { teamId: team });
  colleague = await createTestPrincipal('tele_caller_lc', [E], { teamId: otherTeam });
  gm = await createTestPrincipal('general_manager', [E]);
  exec = await createTestPrincipal('executive');
  accounts = await createTestPrincipal('accounts', [E]);
  dealer = await customer('dealer', lc);
  household = await customer('household', lc);
  await asMigrator(async (m) => {
    await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
            values (${LIST}, ${tierId('dealer')}, ${E}, 9200, '2090-01-01', now()) on conflict (id) do nothing`;
    await m`insert into items (id, sku, name, category, hsn) values
            (${ITEM}, 'ORLS-ITEM', 'order policy item', 'other', '8479') on conflict (id) do nothing`;
    await m`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
            values (${RATE}, ${ITEM}, 0.00, '2090-01-01', 'order policy test') on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const orders = tx`select id from sales_orders where price_list_id = ${LIST}`;
      await tx`alter table sales_order_lines disable trigger sales_order_lines_append_only`;
      await tx`delete from sales_order_lines where sales_order_id in (${orders})`;
      await tx`alter table sales_order_lines enable trigger sales_order_lines_append_only`;
      await tx`delete from sales_orders where price_list_id = ${LIST}`;
      await tx`alter table dealer_terms disable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding disable trigger dealer_outstanding_append_only`;
      const accountIds = [dealer, household, ...mergeDealers];
      await tx`delete from dealer_terms where account_id in ${tx(accountIds)}`;
      await tx`delete from dealer_outstanding where account_id in ${tx(accountIds)}`;
      await tx`alter table dealer_terms enable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding enable trigger dealer_outstanding_append_only`;
      await tx`delete from tax_rates where id = ${RATE}`;
    }),
  );
  await closeDb();
});

describe('sales_orders and sales_order_lines (0117)', () => {
  it('a dealer order is made over the dealer’s relationship, as a plain draft, with its lines', async () => {
    const id = await draftOrder();
    const seen = await asPrincipal(lc, async ({ tx }) => [
      ...(await tx.execute(
        sql`select count(*)::int as n from sales_order_lines where sales_order_id = ${id}`,
      )),
    ]);
    expect(seen).toEqual([{ n: 1 }]);
    // Read with the dealer: not by a colleague who does not hold the relationship.
    const theirs = await asPrincipal(colleague, async ({ tx }) => [
      ...(await tx.execute(sql`select count(*)::int as n from sales_orders where id = ${id}`)),
    ]);
    expect(theirs).toEqual([{ n: 0 }]);
  });

  it('refuses an order a colleague makes for the dealer, one for a customer who is not a dealer, and one made confirmed', async () => {
    for (const [who, account, row] of [
      [colleague, dealer, {}],
      [lc, household, {}],
      [lc, dealer, { state: 'confirmed', confirmed: true }],
    ] as const) {
      expect(
        await failure(
          asPrincipal(who, async ({ tx }) => tx.execute(insertOrder(account, who, row))),
        ),
      ).toMatch(/row-level security/);
    }
  });

  it('takes lines only in the transaction that made the order, and never changes them', async () => {
    const id = await draftOrder();
    expect(await failure(asPrincipal(lc, async ({ tx }) => tx.execute(insertLine(id))))).toMatch(
      /row-level security/,
    );
    expect(
      await failure(
        asMigrator((m) => m`update sales_order_lines set qty = 2 where sales_order_id = ${id}`),
      ),
    ).toMatch(/append-only/);
  });

  it('changes only its moving columns, and a release only as the Executive in their own name', async () => {
    const id = await draftOrder();
    expect(
      await failure(
        asPrincipal(lc, async ({ tx }) =>
          tx.execute(sql`update sales_orders set grand_total = 1 where id = ${id}`),
        ),
      ),
    ).toMatch(/permission denied/);
    const release = (by: Principal, name: string) =>
      asPrincipal(by, async ({ tx }) =>
        tx.execute(sql`update sales_orders set credit_release_by = ${name},
                         credit_release_reason = 'released', credit_released_at = now()
                        where id = ${id}`),
      );
    expect(await failure(release(gm, gm.id))).toMatch(/released only by the Executive/);
    expect(await failure(release(exec, gm.id))).toMatch(/released only by the Executive/);
    await release(exec, exec.id);
    const [row] = await asMigrator(
      (m) => m<{ by: string }[]>`select credit_release_by as by from sales_orders where id = ${id}`,
    );
    expect(row?.by).toBe(exec.id);
  });
});

describe('dealer_terms and dealer_outstanding (0117)', () => {
  const terms = (by: Principal, account: string) =>
    asPrincipal(by, async ({ tx }) =>
      tx.execute(sql`insert into dealer_terms (id, entity_id, account_id, credit_limit, credit_days, created_by)
                     values (${newId()}, ${E}, ${account}, 1000.00, 10, ${by.id})`),
    );
  const outstanding = (by: Principal, account: string) =>
    asPrincipal(by, async ({ tx }) =>
      tx.execute(sql`insert into dealer_outstanding (id, entity_id, account_id, outstanding, as_of, entered_by)
                     values (${newId()}, ${E}, ${account}, 10.00, '2026-04-01', ${by.id})`),
    );

  it('are entered with sales.credit.write for a dealer, and read with the dealer', async () => {
    await terms(accounts, dealer);
    await outstanding(accounts, dealer);
    for (const write of [terms, outstanding]) {
      expect(await failure(write(lc, dealer))).toMatch(/row-level security/);
      expect(await failure(write(accounts, household))).toMatch(/row-level security/);
    }
    const read = (who: Principal) =>
      asPrincipal(who, async ({ tx }) => [
        ...(await tx.execute(
          sql`select (select count(*)::int from dealer_terms where account_id = ${dealer}) as t,
                     (select count(*)::int from dealer_outstanding where account_id = ${dealer}) as o`,
        )),
      ]);
    expect(await read(lc)).toEqual([{ t: 1, o: 1 }]);
    expect(await read(colleague)).toEqual([{ t: 0, o: 0 }]);
  });

  it('are append-only', async () => {
    for (const table of ['dealer_terms', 'dealer_outstanding']) {
      expect(
        await failure(
          asMigrator((m) => m.unsafe(`delete from ${table} where account_id = '${dealer}'`)),
        ),
      ).toMatch(/append-only/);
    }
  });
});

describe('commission accruals and the credit definers (0117)', () => {
  it('no request role writes a commission directly', async () => {
    const id = await draftOrder();
    expect(
      await failure(
        asPrincipal(exec, async ({ tx }) =>
          tx.execute(sql`insert into commission_accruals (id, entity_id, partner_id, opportunity_id,
                           sales_order_id, commission_rule_id, basis, rate, measure, amount, created_by)
                         values (${newId()}, ${E}, ${newId()}, ${newId()}, ${id}, ${newId()}, 'fixed',
                                 1, 1, 1, ${exec.id})`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('lets no request role execute app.may_confirm_order(), which only the definers call', async () => {
    const [row] = await asMigrator(
      (m) => m<{ u: boolean; r: boolean; o: boolean }[]>`
        select has_function_privilege('app_user', 'app.may_confirm_order(uuid)', 'execute') as u,
               has_function_privilege('app_reader', 'app.may_confirm_order(uuid)', 'execute') as r,
               has_function_privilege('readonly_reporter', 'app.may_confirm_order(uuid)', 'execute') as o`,
    );
    expect(row).toEqual({ u: false, r: false, o: false });
  });

  it('answers a dealer’s credit position only to Accounts or to whoever may confirm the order', async () => {
    const id = await draftOrder();
    const position = (who: Principal, order: string | null) =>
      asPrincipal(who, async ({ tx }) => [
        ...(await tx.execute(
          sql`select confirmed_unpaid::text as c
                from app.dealer_credit_position(${E}::smallint, ${dealer}::uuid, ${order}::uuid)`,
        )),
      ]);
    expect(await position(accounts, null)).toEqual([{ c: '0' }]);
    expect(await position(lc, id)).toEqual([{ c: '0' }]);
    expect(await failure(position(lc, null))).toMatch(/sales.credit.write or sales.order.confirm/);
    expect(await failure(position(colleague, id))).toMatch(
      /sales.credit.write or sales.order.confirm/,
    );
    expect(
      await failure(
        asPrincipal(colleague, async ({ tx }) =>
          tx.execute(sql`select * from app.order_commission_rule(${id}::uuid)`),
        ),
      ),
    ).toMatch(/sales.order.confirm over the order/);
    expect(
      await failure(
        asPrincipal(lc, async ({ tx }) =>
          tx.execute(sql`select app.cancel_commission_accrual(${id}::uuid)`),
        ),
      ),
    ).toMatch(/sales.order.cancel over a cancelled order/);
  });
});

describe('customer merges move a dealer’s orders, terms and outstanding (0117)', () => {
  async function mergeDealer(): Promise<string> {
    const id = await customer('dealer', lc);
    mergeDealers.push(id);
    return id;
  }

  /** A confirmed order of the dealer, made without a lead. */
  async function confirmedOrder(account: string): Promise<string> {
    const id = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id, price_list_id,
                  place_of_supply_state, supply_kind, state, confirmed_at, confirmed_by,
                  subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
               values (${id}, ${E}, ${`ORLS/${newId()}`}, '2098-99', ${account}, ${tierId('dealer')},
                       ${LIST}, '08', 'intra', 'confirmed', now(), ${lc.id},
                       0, 0, 0, 0, 0, 0, 0, ${lc.id})`,
    );
    return id;
  }

  async function credit(account: string, limit: string): Promise<void> {
    await asMigrator(async (m) => {
      await m`insert into dealer_terms (id, entity_id, account_id, credit_limit, credit_days, created_by)
              values (${newId()}, ${E}, ${account}, ${limit}, 30, ${accounts.id})`;
      await m`insert into dealer_outstanding (id, entity_id, account_id, outstanding, as_of, entered_by)
              values (${newId()}, ${E}, ${account}, ${limit}, '2026-04-01', ${accounts.id})`;
    });
  }

  /** Where the dealer's orders, terms and outstanding are, by account. */
  async function holdings(
    account: string,
  ): Promise<{ orders: number; terms: number; out: number }> {
    const [row] = await asMigrator(
      (m) => m<{ orders: number; terms: number; out: number }[]>`
        select (select count(*)::int from sales_orders where account_id = ${account}) as orders,
               (select count(*)::int from dealer_terms where account_id = ${account}) as terms,
               (select count(*)::int from dealer_outstanding where account_id = ${account}) as out`,
    );
    return row ?? { orders: -1, terms: -1, out: -1 };
  }

  const merge = (kept: string, merged: string, id: string) =>
    asPrincipal(exec, async ({ tx }) => {
      const rows = await tx.execute(
        sql`select app.merge_customers(${id}::uuid, ${kept}::uuid, ${merged}::uuid, ${E}::smallint, null::uuid) as r`,
      );
      return ([...rows][0] as { r: { status: string } }).r;
    });

  it('moves the merged dealer’s own order, terms and outstanding to the kept dealer, and back on the undo', async () => {
    const kept = await mergeDealer();
    const merged = await mergeDealer();
    await confirmedOrder(merged);
    await credit(merged, '9000.00');
    const mergeId = newId();
    expect((await merge(kept, merged, mergeId)).status).toBe('merged');
    expect(await holdings(kept)).toEqual({ orders: 1, terms: 1, out: 1 });
    expect(await holdings(merged)).toEqual({ orders: 0, terms: 0, out: 0 });
    // The kept dealer's credit position now includes what the merged one had.
    const position = await asPrincipal(accounts, async ({ tx }) => [
      ...(await tx.execute(
        sql`select credit_limit::text as l, outstanding::text as o
              from app.dealer_credit_position(${E}::smallint, ${kept}::uuid, null::uuid)`,
      )),
    ]);
    expect(position).toEqual([{ l: '9000.00', o: '9000.00' }]);

    const undone = await asPrincipal(exec, async ({ tx }) => {
      const rows = await tx.execute(sql`select app.unmerge_customers(${mergeId}::uuid) as r`);
      return ([...rows][0] as { r: { status: string } }).r;
    });
    expect(undone.status).toBe('undone');
    expect(await holdings(kept)).toEqual({ orders: 0, terms: 0, out: 0 });
    expect(await holdings(merged)).toEqual({ orders: 1, terms: 1, out: 1 });
  });

  it('keeps the kept dealer’s own terms and outstanding as the current ones', async () => {
    const kept = await mergeDealer();
    const merged = await mergeDealer();
    await credit(kept, '5000.00');
    await confirmedOrder(merged);
    await credit(merged, '9000.00');
    expect((await merge(kept, merged, newId())).status).toBe('merged');
    // The order moved; the merged dealer's entries stay on it, so the kept dealer's figures stand.
    expect(await holdings(kept)).toEqual({ orders: 1, terms: 1, out: 1 });
    expect(await holdings(merged)).toEqual({ orders: 0, terms: 1, out: 1 });
    const position = await asPrincipal(accounts, async ({ tx }) => [
      ...(await tx.execute(
        sql`select credit_limit::text as l, outstanding::text as o
              from app.dealer_credit_position(${E}::smallint, ${kept}::uuid, null::uuid)`,
      )),
    ]);
    expect(position).toEqual([{ l: '5000.00', o: '5000.00' }]);
  });

  it('refuses even the table owner a change to a dealer entry outside a merge', async () => {
    const dealerId = await mergeDealer();
    await credit(dealerId, '100.00');
    for (const table of ['dealer_terms', 'dealer_outstanding']) {
      expect(
        await failure(
          asMigrator((m) =>
            m.unsafe(
              `update ${table} set account_id = '${household}' where account_id = '${dealerId}'`,
            ),
          ),
        ),
      ).toMatch(/append-only/);
    }
  });

  it('lets a merge move a dealer entry and change nothing else', async () => {
    const dealerId = await mergeDealer();
    await credit(dealerId, '100.00');
    const changes = {
      dealer_terms: 'credit_limit = credit_limit + 1',
      dealer_outstanding: 'outstanding = outstanding + 1',
    };
    for (const [table, change] of Object.entries(changes)) {
      expect(
        await failure(
          asMigrator((m) =>
            m.begin(async (tx) => {
              await tx`select set_config('app.customer_merge', ${newId()}, true)`;
              await tx.unsafe(`update ${table} set ${change} where account_id = '${dealerId}'`);
            }),
          ),
        ),
      ).toMatch(/append-only/);
      await asMigrator((m) =>
        m.begin(async (tx) => {
          await tx`select set_config('app.customer_merge', ${newId()}, true)`;
          await tx.unsafe(
            `update ${table} set account_id = '${household}' where account_id = '${dealerId}'`,
          );
        }),
      );
    }
  });
});
