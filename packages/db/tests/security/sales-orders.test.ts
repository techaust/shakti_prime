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

// Orders, dealer credit and commission (docs/DATABASE.md §6.4, migration 0117): a dealer's order
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
      await tx`delete from dealer_terms where account_id in (${dealer}, ${household})`;
      await tx`delete from dealer_outstanding where account_id in (${dealer}, ${household})`;
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
