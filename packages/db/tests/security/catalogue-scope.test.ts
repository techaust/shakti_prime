import { AGENT_ROLE_KEYS, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  catalogueFixture,
  CATALOGUE_FIXTURE_PREFIX,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
  type CatalogueFixture,
} from '../../src/testing/index';

let fx: CatalogueFixture;

beforeAll(async () => {
  fx = await catalogueFixture();
});
afterAll(closeDb);

const like = `${CATALOGUE_FIXTURE_PREFIX}%`;
const sorted = (ids: readonly string[]) => [...ids].sort();

async function visibleIds(principal: Principal, table: string): Promise<string[]> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select id from ${sql.identifier(table)} where id::text like ${like} order by id`,
    )) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  });
}

async function updated(principal: Principal, statement: ReturnType<typeof sql>): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(statement)) as unknown as { id: string }[];
    return rows.length;
  });
}

const rlsError = (e: unknown) =>
  e instanceof Error && e.cause instanceof Error && e.cause.message.includes('row-level security');
const deniedError = (e: unknown) =>
  e instanceof Error && e.cause instanceof Error && e.cause.message.includes('permission denied');

describe('cost gate on item_costs (finance.cost.read)', () => {
  it('Accounts sees the costs of its entity only', async () => {
    expect(await visibleIds(principalFor('accounts', [1]), 'item_costs')).toEqual(
      sorted(fx.costs.e1),
    );
    expect(await visibleIds(principalFor('accounts', [2]), 'item_costs')).toEqual(
      sorted(fx.costs.e2),
    );
  });

  it('the Executive sees every entity in scope', async () => {
    expect(await visibleIds(principalFor('executive'), 'item_costs')).toEqual(
      sorted([...fx.costs.e1, ...fx.costs.e2]),
    );
  });

  it.each([
    'general_manager',
    'inventory_manager',
    'sales_team_lead',
    'tele_caller_cc',
    'store_manager',
    'project_manager',
  ] as const)('%s sees no cost row even inside the entity', async (roleKey) => {
    expect(await visibleIds(principalFor(roleKey, [1]), 'item_costs')).toEqual([]);
  });

  it.each(AGENT_ROLE_KEYS)('%s sees no cost row', async (agent) => {
    expect(await visibleIds(principalFor(agent, [1, 2]), 'item_costs')).toEqual([]);
  });

  it('nothing is visible without a context', async () => {
    const rows = await withoutContext<{ id: string }>(
      sql`select id from item_costs where id::text like ${like}`,
    );
    expect(rows).toEqual([]);
  });

  it('a GM can neither update nor insert a cost row', async () => {
    const gm = principalFor('general_manager', [1]);
    expect(
      await updated(
        gm,
        sql`update item_costs set moving_avg_cost = moving_avg_cost where id = ${fx.costs.e1[0] ?? ''} returning id`,
      ),
    ).toBe(0);
    await expect(
      asPrincipal(gm, ({ tx }) =>
        tx.execute(sql`insert into item_costs (id, item_id, entity_id, moving_avg_cost)
          values (${`${CATALOGUE_FIXTURE_PREFIX}ffff`}, ${fx.items.cable}, 1, 1.0000)`),
      ),
    ).rejects.toSatisfy(rlsError);
  });

  it('Accounts updates its own entity and not another', async () => {
    const accounts = principalFor('accounts', [1]);
    expect(
      await updated(
        accounts,
        sql`update item_costs set moving_avg_cost = moving_avg_cost where id = ${fx.costs.e1[0] ?? ''} returning id`,
      ),
    ).toBe(1);
    expect(
      await updated(
        accounts,
        sql`update item_costs set moving_avg_cost = moving_avg_cost where id = ${fx.costs.e2[0] ?? ''} returning id`,
      ),
    ).toBe(0);
  });

  // The entity term of the cost write checks (AUDIT M40): a cost holder in entity 1 cannot
  // write entity 2's costs, by insert or by moving a row there.
  it('Accounts cannot insert a cost row for another entity or move one there', async () => {
    const accounts = principalFor('accounts', [1]);
    await expect(
      asPrincipal(accounts, ({ tx }) =>
        tx.execute(sql`insert into item_costs (id, item_id, entity_id, moving_avg_cost)
          values (${`${CATALOGUE_FIXTURE_PREFIX}fffc`}, ${fx.items.cable}, 2, 1.0000)`),
      ),
    ).rejects.toSatisfy(rlsError);
    await expect(
      asPrincipal(accounts, ({ tx }) =>
        tx.execute(sql`update item_costs set entity_id = 2 where id = ${fx.costs.e1[1] ?? ''}`),
      ),
    ).rejects.toSatisfy(rlsError);
  });
});

describe('catalogue masters', () => {
  it('every role with a context reads items, kits, components and curves', async () => {
    for (const roleKey of ['hr_admin', 'field_engineer', 'tele_caller_cc'] as const) {
      const p = principalFor(roleKey, [1]);
      expect(await visibleIds(p, 'items')).toHaveLength(3);
      expect(await visibleIds(p, 'kits')).toHaveLength(1);
      expect(await visibleIds(p, 'kit_components')).toHaveLength(2);
      expect(await visibleIds(p, 'pump_curves')).toHaveLength(2);
    }
  });

  it.each(['executive', 'general_manager', 'inventory_manager'] as const)(
    '%s can update an item (catalogue.write)',
    async (roleKey) => {
      expect(
        await updated(
          principalFor(roleKey, [1]),
          sql`update items set name = name where id = ${fx.items.pump} returning id`,
        ),
      ).toBe(1);
    },
  );

  it.each(['sales_team_lead', 'accounts', 'store_manager', 'agent:sizing'] as const)(
    '%s cannot update an item',
    async (roleKey) => {
      expect(
        await updated(
          principalFor(roleKey, [1]),
          sql`update items set name = name where id = ${fx.items.pump} returning id`,
        ),
      ).toBe(0);
    },
  );
});

describe('price lists (pricing.read / pricing.write)', () => {
  it('a caller sees the shared list and only the entity lists in scope', async () => {
    expect(await visibleIds(principalFor('tele_caller_cc', [1]), 'price_lists')).toEqual([
      fx.priceLists.sharedRetail,
    ]);
    expect(await visibleIds(principalFor('tele_caller_cc', [2]), 'price_lists')).toEqual(
      sorted([fx.priceLists.sharedRetail, fx.priceLists.dealerEntity2]),
    );
    expect(await visibleIds(principalFor('tele_caller_cc', [1]), 'price_list_items')).toEqual(
      sorted([fx.priceListItems.sharedPump, fx.priceListItems.sharedKit]),
    );
  });

  it('a role without pricing.read sees items but no prices', async () => {
    const field = principalFor('field_engineer', [1]);
    expect(await visibleIds(field, 'items')).toHaveLength(3);
    expect(await visibleIds(field, 'price_lists')).toEqual([]);
    expect(await visibleIds(field, 'price_list_items')).toEqual([]);
    expect(await visibleIds(field, 'price_change_log')).toEqual([]);
  });

  it('only the Executive changes a price, and a shared list only when acting for every company', async () => {
    const statement = sql`update price_list_items set price = price where id = ${fx.priceListItems.sharedPump} returning id`;
    expect(await updated(principalFor('executive', [1, 2, 3, 4]), statement)).toBe(1);
    // an Executive role acting for one company does not reach a list that prices all of them (AUDIT H2)
    expect(await updated(principalFor('executive', [1]), statement)).toBe(0);
    expect(await updated(principalFor('general_manager', [1]), statement)).toBe(0);
    expect(await updated(principalFor('accounts', [1]), statement)).toBe(0);
  });

  it('an Executive scoped to entity 1 cannot touch an entity-2 list', async () => {
    expect(
      await updated(
        principalFor('executive', [1]),
        sql`update price_list_items set price = price where id = ${fx.priceListItems.dealerPump} returning id`,
      ),
    ).toBe(0);
    await expect(
      asPrincipal(principalFor('executive', [1]), ({ tx }) =>
        tx.execute(sql`insert into price_list_items (id, price_list_id, item_id, price)
          values (${`${CATALOGUE_FIXTURE_PREFIX}fffb`}, ${fx.priceLists.dealerEntity2}, ${fx.items.cable}, 10.00)`),
      ),
    ).rejects.toSatisfy(rlsError);
  });
});

describe('price_change_log is append-only', () => {
  it('a log row must be signed by the caller', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, ({ tx }) =>
        tx.execute(sql`insert into price_change_log (id, price_list_item_id, old_price, new_price, changed_by)
          values (${`${CATALOGUE_FIXTURE_PREFIX}fffe`}, ${fx.priceListItems.sharedPump}, 1500.00, 1600.00, ${fx.execPrincipalId})`),
      ),
    ).rejects.toSatisfy(rlsError);
    const inserted = await updated(
      exec,
      sql`insert into price_change_log (id, price_list_item_id, old_price, new_price, changed_by)
          values (${`${CATALOGUE_FIXTURE_PREFIX}fffd`}, ${fx.priceListItems.sharedPump}, 1500.00, 1600.00, ${exec.id}) returning id`,
    );
    expect(inserted).toBe(1);
  });

  it('the application role can neither update nor delete a log row', async () => {
    const exec = principalFor('executive');
    await expect(
      asPrincipal(exec, ({ tx }) =>
        tx.execute(sql`update price_change_log set reason = 'x' where id = ${fx.priceChangeLog}`),
      ),
    ).rejects.toSatisfy(deniedError);
    await expect(
      asPrincipal(exec, ({ tx }) =>
        tx.execute(sql`delete from price_change_log where id = ${fx.priceChangeLog}`),
      ),
    ).rejects.toSatisfy(deniedError);
  });

  it('the trigger also stops the table owner', async () => {
    await expect(
      asMigrator(
        (m) => m`update price_change_log set reason = 'x' where id = ${fx.priceChangeLog}`,
      ),
    ).rejects.toThrow(/append-only/);
  });
});

describe('tax tables (tax.rates.write)', () => {
  it('everyone with a context reads rates; Accounts and the Executive write them', async () => {
    expect(await visibleIds(principalFor('field_engineer', [1]), 'tax_rates')).toEqual([
      fx.taxRate,
    ]);
    expect(await visibleIds(principalFor('tele_caller_cc', [1]), 'composite_supply_rules')).toEqual(
      [fx.compositeRule],
    );
    const statement = sql`update tax_rates set source_ref = source_ref where id = ${fx.taxRate} returning id`;
    expect(await updated(principalFor('accounts', [1]), statement)).toBe(1);
    expect(await updated(principalFor('general_manager', [1]), statement)).toBe(0);
  });

  it('two rates for one HSN cannot overlap in time', async () => {
    const accounts = principalFor('accounts', [1]);
    await expect(
      asPrincipal(accounts, ({ tx }) =>
        tx.execute(sql`insert into tax_rates (id, hsn, rate_pct, effective_from)
          values (${`${CATALOGUE_FIXTURE_PREFIX}15f0`}, '8413', 12.00, '2026-01-01')`),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('tax_rates_hsn_period_excl'),
    );
    const inserted = await updated(
      accounts,
      sql`insert into tax_rates (id, hsn, rate_pct, effective_from, effective_to)
          values (${`${CATALOGUE_FIXTURE_PREFIX}15f1`}, '8413', 12.00, '2024-01-01', '2025-09-22') returning id`,
    );
    expect(inserted).toBe(1);
  });
});

describe('document numbering', () => {
  const draw = (principal: Principal, entityId: number, fy: string) =>
    asPrincipal(principal, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select app.next_document_no(${entityId}::smallint, 'proforma', ${fy}, 'SS/PI') as no`,
      )) as unknown as { no: number }[];
      return rows[0]?.no;
    });

  it('series rows are readable in scope and never written directly', async () => {
    expect(await visibleIds(principalFor('tele_caller_cc', [1]), 'document_sequences')).toEqual([
      fx.sequence,
    ]);
    expect(await visibleIds(principalFor('tele_caller_cc', [2]), 'document_sequences')).toEqual([]);
    await expect(
      asPrincipal(principalFor('executive'), ({ tx }) =>
        tx.execute(sql`update document_sequences set next_no = 99 where id = ${fx.sequence}`),
      ),
    ).rejects.toSatisfy(deniedError);
  });

  it('numbers are gapless and sequential within a series', async () => {
    const exec = principalFor('executive', [1]);
    const fy = `${String(2100 + Math.floor(Math.random() * 800))}-00`;
    // Relative to the first draw: the random series may exist from an earlier run on this database.
    const first = (await draw(exec, 1, fy)) ?? Number.NaN;
    expect(Number.isInteger(first) && first >= 1).toBe(true);
    expect(await draw(exec, 1, fy)).toBe(first + 1);
    expect(await draw(exec, 1, fy)).toBe(first + 2);
  });

  it('concurrent callers never share a number', async () => {
    const exec = principalFor('executive', [1]);
    const fy = `${String(2100 + Math.floor(Math.random() * 800))}-01`;
    const numbers = await Promise.all(Array.from({ length: 10 }, () => draw(exec, 1, fy)));
    // Distinct and consecutive; the series may have been started by an earlier run on this database.
    const ascending = numbers.map((n) => n ?? Number.NaN).sort((a, b) => a - b);
    expect(new Set(ascending).size).toBe(10);
    expect((ascending[9] ?? 0) - (ascending[0] ?? 0)).toBe(9);
  });

  it('requires the permission that creates the document type', async () => {
    const cc = principalFor('tele_caller_cc', [1]);
    const fy = `${String(2100 + Math.floor(Math.random() * 800))}-02`;
    await expect(draw(cc, 1, fy)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('permission finance.proforma.write:own required'),
    );
    const drawn = await draw(principalFor('accounts', [1]), 1, fy);
    expect(Number.isInteger(drawn) && (drawn ?? 0) >= 1).toBe(true);
  });

  it('refuses an entity outside the scope and any call without a context', async () => {
    const outsideScope = (e: unknown) =>
      e instanceof Error &&
      e.cause instanceof Error &&
      e.cause.message.includes('outside the request scope');
    await expect(draw(principalFor('executive', [1]), 2, '2099-00')).rejects.toSatisfy(
      outsideScope,
    );
    await expect(
      withoutContext(sql`select app.next_document_no(1::smallint, 'quote', '2099-00', 'SS/Q')`),
    ).rejects.toSatisfy(outsideScope);
  });
});
