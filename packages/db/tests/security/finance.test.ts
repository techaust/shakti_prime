import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tierId } from '../../seeds/price-tiers';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  PIPELINE_SEED,
  principalFor,
  stageId,
} from '../../src/testing/index';

// FN1 proformas and payment milestones (docs/03-roadmap-appendix/phase5.md §6.1, the FN1 row
// security migration): a proforma is issued only by finance.proforma.write from a confirmed order,
// with the order's totals, and its lines only as the order's lines value for value, in the
// transaction that issued it; afterwards only its cancel changes. Payment terms are the
// Executive's and never change. An order's milestones are written only through
// app.record_order_milestones(), summing to the total and following the terms, and change by a
// request only through the Executive's waiver. finance.read decides who reads them. Company 4
// holds this file's rows; every amount is a synthetic test value.

const E = 4;
const LIST = '01990000-0000-7000-8000-000000f20001';
const ITEM = '01990000-0000-7000-8000-000000f20002';
const RATE = '01990000-0000-7000-8000-000000f20003';
const QUOTE_TOTAL = '1180.00';

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
let otherLc: Principal;
let accounts: Principal;
let exec: Principal;
let inventory: Principal;
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

/** A dealer of company 4 whose relationship `owner` holds, and its confirmed order with one line. */
async function confirmedOrder(owner: Principal = lc, state = 'confirmed'): Promise<string> {
  const account = newId();
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'dealer', 'Finance policy dealer', ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${account}, ${E}, ${owner.id}, ${owner.teamId ?? null}, ${owner.id})`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, tier_id, price_list_id,
                 place_of_supply_state, supply_kind, state, confirmed_at, confirmed_by, subtotal, cgst,
                 sgst, igst, tax_total, round_off, grand_total, created_by)
        values (${id}, ${E}, ${`FNRLS/${id}`}, '2098-99', ${account}, ${tierId('dealer')}, ${LIST}, '08',
                'intra', ${state}, ${state === 'draft' ? null : new Date()},
                ${state === 'draft' ? null : owner.id}, 1000.00, 90.00, 90.00, 0, 180.00, 0,
                ${QUOTE_TOTAL}, ${owner.id})`;
      await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku,
                 description, unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value,
                 cgst, sgst, igst, line_total)
        values (${newId()}, ${E}, ${id}, 1, ${ITEM}, 'FNRLS-ITEM', 'finance policy item', 'nos', 2,
                500.00, '8479', ${RATE}, 18.00, 1000.00, 90.00, 90.00, 0, 1180.00)`;
    }),
  );
  return id;
}

/** A proforma row of the order as `by` would insert it, with its totals overridable. */
const insertProforma = (id: string, orderId: string, by: Principal, grandTotal = QUOTE_TOTAL) =>
  sql`insert into proformas (id, entity_id, proforma_no, fy, sales_order_id, place_of_supply_state,
                             supply_kind, subtotal, cgst, sgst, igst, tax_total, round_off,
                             grand_total, created_by)
      values (${id}, ${E}, ${`FNRLS/PI/${id}`}, '2098-99', ${orderId}, '08', 'intra', 1000.00, 90.00,
              90.00, 0, 180.00, ${Number(grandTotal) - 1180}, ${grandTotal}, ${by.id})`;

/** A copy of the order's line into the proforma, with its unit price overridable. */
const copyLine = (proformaId: string, orderId: string, unitPrice = '500.00') =>
  sql`insert into proforma_lines (id, entity_id, proforma_id, sales_order_line_id, position, item_id,
                                  kit_id, sku, description, unit, qty, unit_price, hsn, works_contract,
                                  tax_rate_id, tax_rate_pct, composite_rule_id, goods_rate_pct,
                                  services_rate_pct, taxable_value, goods_taxable, services_taxable,
                                  cgst, sgst, igst, line_total)
      select ${newId()}, l.entity_id, ${proformaId}, l.id, l.position, l.item_id, l.kit_id, l.sku,
             l.description, l.unit, l.qty, ${unitPrice}::numeric, l.hsn, l.works_contract,
             l.tax_rate_id, l.tax_rate_pct, l.composite_rule_id, l.goods_rate_pct,
             l.services_rate_pct, l.taxable_value, l.goods_taxable, l.services_taxable, l.cgst,
             l.sgst, l.igst, l.line_total
        from sales_order_lines l where l.sales_order_id = ${orderId}`;

const rows = (order: string, amounts: readonly string[], keys = ['advance', 'balance']) =>
  JSON.stringify(
    amounts.map((amount, i) => ({
      id: newId(),
      key: keys[i],
      label: i === 0 ? 'Advance' : 'Balance',
      percent: '50.00',
      amount,
      dueRule: i === 0 ? 'on_confirmation' : 'before_dispatch',
      dueDays: null,
      loanGate: 'none',
      state: i === 0 ? 'due' : 'pending',
      dueOn: i === 0 ? '2098-04-01' : null,
      order,
    })),
  );

const record = (by: Principal, orderId: string, json: string, template: string | null = null) =>
  asPrincipal(by, async ({ tx }) =>
    tx.execute(
      sql`select app.record_order_milestones(${orderId}::uuid, ${template}::uuid, ${json}::jsonb) as n`,
    ),
  );

const one = async <T>(by: Principal, query: ReturnType<typeof sql>): Promise<T | undefined> =>
  asPrincipal(by, async ({ tx }) => {
    const [row] = (await tx.execute(query)) as unknown as T[];
    return row;
  });

beforeAll(async () => {
  const team = await createTestTeam(E, 'finance policy team');
  const otherTeam = await createTestTeam(E, 'finance policy other team');
  lc = await createTestPrincipal('tele_caller_lc', [E], { teamId: team });
  otherLc = await createTestPrincipal('tele_caller_lc', [E], { teamId: otherTeam });
  accounts = await createTestPrincipal('accounts', [E]);
  exec = await createTestPrincipal('executive');
  inventory = await createTestPrincipal('inventory_manager', [E]);
  await asMigrator(async (m) => {
    await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
            values (${LIST}, ${tierId('dealer')}, ${E}, 9300, '2090-01-01', now()) on conflict (id) do nothing`;
    await m`insert into items (id, sku, name, category, hsn) values
            (${ITEM}, 'FNRLS-ITEM', 'finance policy item', 'other', '8479') on conflict (id) do nothing`;
    await m`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
            values (${RATE}, ${ITEM}, 18.00, '2090-01-01', 'finance policy test') on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const orders = tx`select id from sales_orders where price_list_id = ${LIST}`;
      await tx`delete from payment_milestones where sales_order_id in (${orders})`;
      await tx`delete from proforma_lines where proforma_id in
                 (select id from proformas where sales_order_id in (${orders}))`;
      await tx`delete from proformas where sales_order_id in (${orders})`;
      await tx`delete from payment_milestone_templates where entity_id = ${E}`;
      await tx`delete from sales_order_lines where sales_order_id in (${orders})`;
      await tx`delete from sales_orders where price_list_id = ${LIST}`;
      await tx`delete from quotes where price_list_id = ${LIST}`;
      await tx`delete from tax_rates where id = ${RATE}`;
    }),
  );
  await closeDb();
});

describe('proformas and proforma_lines', () => {
  it('are issued by Accounts from a confirmed order with its totals, the lines copied value for value', async () => {
    const orderId = await confirmedOrder();
    const id = newId();
    await asPrincipal(accounts, async ({ tx }) => {
      await tx.execute(insertProforma(id, orderId, accounts));
      await tx.execute(copyLine(id, orderId));
    });
    const seen = await one<{ n: number }>(
      accounts,
      sql`select count(*)::int as n from proforma_lines where proforma_id = ${id}`,
    );
    expect(seen?.n).toBe(1);
  });

  it('refuses a proforma by a Lead Converter, of a draft order, or with totals the order does not have', async () => {
    const orderId = await confirmedOrder();
    const draft = await confirmedOrder(lc, 'draft');
    for (const [by, order, total] of [
      [lc, orderId, QUOTE_TOTAL],
      [accounts, draft, QUOTE_TOTAL],
      [accounts, orderId, '1180.50'],
    ] as const) {
      expect(
        await failure(
          asPrincipal(by, async ({ tx }) => tx.execute(insertProforma(newId(), order, by, total))),
        ),
      ).toMatch(/row-level security/);
    }
  });

  it('refuses a line whose price is not the order line’s, and a line added in a later transaction', async () => {
    const orderId = await confirmedOrder();
    const id = newId();
    expect(
      await failure(
        asPrincipal(accounts, async ({ tx }) => {
          await tx.execute(insertProforma(id, orderId, accounts));
          await tx.execute(copyLine(id, orderId, '499.00'));
        }),
      ),
    ).toMatch(/row-level security/);
    await asPrincipal(accounts, async ({ tx }) =>
      tx.execute(insertProforma(id, orderId, accounts)),
    );
    expect(
      await failure(asPrincipal(accounts, async ({ tx }) => tx.execute(copyLine(id, orderId)))),
    ).toMatch(/row-level security/);
  });

  it('keeps one live proforma per order, changes only by its cancel, once, and keeps its lines', async () => {
    const orderId = await confirmedOrder();
    const id = newId();
    await asPrincipal(accounts, async ({ tx }) => {
      await tx.execute(insertProforma(id, orderId, accounts));
      await tx.execute(copyLine(id, orderId));
    });
    expect(
      await failure(
        asPrincipal(accounts, async ({ tx }) =>
          tx.execute(insertProforma(newId(), orderId, accounts)),
        ),
      ),
    ).toMatch(/proformas_order_live_unique/);
    expect(
      await failure(
        asPrincipal(accounts, async ({ tx }) =>
          tx.execute(sql`update proformas set grand_total = 1 where id = ${id}`),
        ),
      ),
    ).toMatch(/permission denied/);
    const cancel = (by: Principal, name: string) =>
      asPrincipal(by, async ({ tx }) =>
        tx.execute(sql`update proformas set state = 'cancelled', cancel_reason = 'wrong address',
                         cancelled_at = now(), cancelled_by = ${name}, updated_by = ${by.id}
                        where id = ${id}`),
      );
    expect(await failure(cancel(accounts, exec.id))).toMatch(/changes only by its cancel/);
    await cancel(accounts, accounts.id);
    expect(await failure(cancel(accounts, accounts.id))).toMatch(/changes only by its cancel/);
    expect(await failure(asMigrator((m) => m`delete from proformas where id = ${id}`))).toMatch(
      /never removed/,
    );
    expect(
      await failure(
        asMigrator((m) => m`update proforma_lines set unit_price = 1 where proforma_id = ${id}`),
      ),
    ).toMatch(/append-only/);
  });
});

describe('payment_milestone_templates', () => {
  it('are published by the Executive alone and never changed', async () => {
    const insert = (by: Principal, version: number) =>
      asPrincipal(by, async ({ tx }) =>
        tx.execute(sql`insert into payment_milestone_templates (id, entity_id, segment, version, steps_json, created_by)
                       values (${newId()}, ${E}, 'commercial_epc', ${version}, '[{}]'::jsonb, ${by.id})`),
      );
    expect(await failure(insert(accounts, 1))).toMatch(/row-level security/);
    await insert(exec, 1);
    expect(await failure(insert(exec, 1))).toMatch(/payment_milestone_templates_version_unique/);
    expect(
      await failure(
        asMigrator(
          (m) => m`update payment_milestone_templates set version = 2 where entity_id = ${E}`,
        ),
      ),
    ).toMatch(/append-only/);
    // Read with finance.read: Accounts and a Lead Converter of the company, not a store manager.
    const count = (by: Principal) =>
      one<{ n: number }>(
        by,
        sql`select count(*)::int as n from payment_milestone_templates where segment = 'commercial_epc'`,
      );
    expect((await count(accounts))?.n).toBe(1);
    expect((await count(lc))?.n).toBe(1);
    expect((await count(await createTestPrincipal('store_manager', [E])))?.n).toBe(0);
  });
});

describe('payment_milestones and app.record_order_milestones()', () => {
  it('are never written directly by a request', async () => {
    const orderId = await confirmedOrder();
    expect(
      await failure(
        asPrincipal(accounts, async ({ tx }) =>
          tx.execute(sql`insert into payment_milestones (id, entity_id, sales_order_id, seq, key, label,
                           amount, due_rule, state, created_by)
                         values (${newId()}, ${E}, ${orderId}, 1, 'advance', 'Advance', ${QUOTE_TOTAL},
                                 'on_confirmation', 'pending', ${accounts.id})`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('records milestones summing to the total, once, for the platform or Accounts', async () => {
    const orderId = await confirmedOrder();
    expect(await failure(record(accounts, orderId, rows(orderId, ['590.00', '589.00'])))).toMatch(
      /add up to the order total/,
    );
    await record(workers(), orderId, rows(orderId, ['590.00', '590.00']));
    expect(await failure(record(accounts, orderId, rows(orderId, ['590.00', '590.00'])))).toMatch(
      /payment_milestones_order_seq_unique/,
    );
    const other = await confirmedOrder();
    await record(accounts, other, rows(other, ['1180.00'], ['whole']));
  });

  it('refuses a caller without the grants, an order outside the request, a draft order and steps the terms do not have', async () => {
    const orderId = await confirmedOrder();
    expect(await failure(record(lc, orderId, rows(orderId, ['590.00', '590.00'])))).toMatch(
      /finance.milestones.process or finance.payment.write is required/,
    );
    // Accounts of company 1: company 4's order is outside the request.
    const accounts1 = principalFor('accounts', [1], { id: accounts.id });
    expect(await failure(record(accounts1, orderId, rows(orderId, ['590.00', '590.00'])))).toMatch(
      /not one of the request/,
    );
    const draft = await confirmedOrder(lc, 'draft');
    expect(await failure(record(accounts, draft, rows(draft, ['590.00', '590.00'])))).toMatch(
      /confirmed order/,
    );
    // Terms of the order's segment exist: a plan from the named default, or from steps the terms
    // do not have, is refused.
    const template = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into payment_milestone_templates (id, entity_id, segment, version, steps_json, created_by)
               values (${template}, ${E}, 'dealer_wholesale', 1, ${m.json([
                 {
                   key: 'advance',
                   label: 'Advance',
                   percent: '50.00',
                   amount: null,
                   dueRule: 'on_confirmation',
                   dueDays: null,
                   loanGate: 'none',
                 },
                 {
                   key: 'balance',
                   label: 'Balance',
                   percent: '50.00',
                   amount: null,
                   dueRule: 'on_installation',
                   dueDays: null,
                   loanGate: 'none',
                 },
               ])}, ${exec.id})`,
    );
    expect(await failure(record(accounts, orderId, rows(orderId, ['590.00', '590.00'])))).toMatch(
      /from the current terms/,
    );
    expect(
      await failure(record(accounts, orderId, rows(orderId, ['590.00', '590.00']), template)),
    ).toMatch(/from the current terms/);
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`delete from payment_milestone_templates where id = ${template}`;
      }),
    );
  });

  it('change by a request only through the Executive’s waiver, in their own name, once', async () => {
    const orderId = await confirmedOrder();
    await record(accounts, orderId, rows(orderId, ['590.00', '590.00']));
    const waive = (by: Principal, name: string) =>
      asPrincipal(by, async ({ tx }) =>
        tx.execute(sql`update payment_milestones set state = 'waived', waived_at = now(),
                         waived_by = ${name}, waive_reason = 'settled', updated_by = ${by.id}
                        where sales_order_id = ${orderId} and key = 'balance' returning id`),
      );
    // Accounts' update reaches no row.
    expect(await waive(accounts, accounts.id)).toHaveLength(0);
    expect(await failure(waive(exec, accounts.id))).toMatch(/changes only by its waiver/);
    expect(await waive(exec, exec.id)).toHaveLength(1);
    expect(await failure(waive(exec, exec.id))).toMatch(/changes only by its waiver/);
    expect(
      await failure(
        asPrincipal(exec, async ({ tx }) =>
          tx.execute(
            sql`update payment_milestones set amount = 1 where sales_order_id = ${orderId}`,
          ),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asMigrator((m) => m`delete from payment_milestones where sales_order_id = ${orderId}`),
      ),
    ).toMatch(/never removed/);
  });
});

describe('finance.read and the gates', () => {
  it('reads an order’s milestones with finance.read over it: its LC, not another LC, not the platform', async () => {
    const orderId = await confirmedOrder();
    await record(accounts, orderId, rows(orderId, ['590.00', '590.00']));
    const count = (by: Principal) =>
      one<{ n: number }>(
        by,
        sql`select count(*)::int as n from payment_milestones where sales_order_id = ${orderId}`,
      );
    expect((await count(lc))?.n).toBe(2);
    expect((await count(accounts))?.n).toBe(2);
    expect((await count(otherLc))?.n).toBe(0);
    expect((await count(workers()))?.n).toBe(0);
    expect((await count(inventory))?.n).toBe(0);
  });

  it('app.order_dispatch_payment_gate() is open while a before-dispatch milestone is unsettled', async () => {
    const orderId = await confirmedOrder();
    const gate = (by: Principal) =>
      one<{ gate: string | null }>(
        by,
        sql`select app.order_dispatch_payment_gate(${orderId}::uuid) as gate`,
      );
    // No milestones yet: nothing holds the dispatch.
    expect((await gate(inventory))?.gate).toBe('clear');
    await record(accounts, orderId, rows(orderId, ['590.00', '590.00']));
    expect((await gate(inventory))?.gate).toBe('open');
    expect((await gate(lc))?.gate).toBe('open');
    expect((await gate(otherLc))?.gate).toBeNull();
    expect(await failure(gate(workers()))).toMatch(/inventory.dispatch.write or finance.read/);
    await asMigrator(
      (m) => m`update payment_milestones set state = 'paid', paid_amount = amount
                where sales_order_id = ${orderId} and due_rule = 'before_dispatch'`,
    );
    expect((await gate(inventory))?.gate).toBe('clear');
  });

  it('app.order_milestone_facts() names a lead order’s segment by its pipeline, and answers only its callers', async () => {
    const orderId = await confirmedOrder();
    const facts = (by: Principal, order: string) =>
      one<{ facts: Record<string, unknown> | null }>(
        by,
        sql`select app.order_milestone_facts(${order}::uuid) as facts`,
      );
    expect((await facts(workers(), orderId))?.facts).toMatchObject({
      segment: 'dealer_wholesale',
      grandTotal: QUOTE_TOTAL,
      planned: false,
      template: null,
    });
    expect(await failure(facts(lc, orderId))).toMatch(/is required/);
    // A rooftop lead's order, made from its quote.
    const pipeline = PIPELINE_SEED.findIndex((p) => p.segment === 'residential_rooftop');
    const account = newId();
    const lead = newId();
    const quote = newId();
    const order = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into accounts (id, type, name, created_by)
          values (${account}, 'household', 'Finance policy customer', ${lc.id})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values (${newId()}, ${account}, ${E}, ${lc.id}, ${lc.teamId ?? null}, ${lc.id})`;
        await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${lead}, ${E}, ${account}, ${PIPELINE_SEED[pipeline]?.id ?? ''}, ${stageId(pipeline + 1, 1)},
                  ${lc.id}, ${lc.teamId ?? null}, ${lc.id})`;
        await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                   price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal,
                   cgst, sgst, igst, tax_total, round_off, grand_total, state, created_by)
          values (${quote}, ${E}, ${`FNRLS/Q/${quote}`}, '2098-99', ${lead}, ${account}, ${tierId('dealer')},
                  ${LIST}, 'none', '08', 'intra', now() + interval '1 day', 0, 0, 0, 0, 0, 0, 0,
                  'draft', ${lc.id})`;
        await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                   tier_id, price_list_id, place_of_supply_state, supply_kind, state, confirmed_at,
                   confirmed_by, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
          values (${order}, ${E}, ${`FNRLS/${order}`}, '2098-99', ${quote}, ${lead}, ${account},
                  ${tierId('dealer')}, ${LIST}, '08', 'intra', 'confirmed', now(), ${lc.id},
                  0, 0, 0, 0, 0, 0, 0, ${lc.id})`;
      }),
    );
    expect((await facts(workers(), order))?.facts).toMatchObject({
      segment: 'residential_rooftop',
    });
  });

  it('app.order_loan_gate() answers the platform planning milestones', async () => {
    const orderId = await confirmedOrder();
    const gate = await one<{ gate: Record<string, unknown> | null }>(
      workers(),
      sql`select app.order_loan_gate(${orderId}::uuid) as gate`,
    );
    expect(gate?.gate).toMatchObject({ dispatch: 'none', milestones: {} });
  });

  it('finance.milestones.process is platform-only and held by no person’s role', async () => {
    const [row] = await asMigrator(
      (m) => m<{ listed: boolean; held: number }[]>`
        select 'finance.milestones.process' = any (app.platform_only_permissions()) as listed,
               (select count(*)::int from role_permissions rp join roles r on r.id = rp.role_id
                 where rp.permission_key = 'finance.milestones.process'
                   and r.key not like 'system:%') as held`,
    );
    expect(row).toEqual({ listed: true, held: 0 });
  });
});
