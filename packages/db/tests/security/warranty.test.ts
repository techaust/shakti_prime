import { newId, ROLE_KEYS, STAFF_ROLE_KEYS, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/**
 * R3 (docs/03-roadmap-appendix/phase3.md §7.5): a company's warranty claims read with
 * inventory.stock.read or inventory.warranty.write for the company, raised with
 * inventory.warranty.write, moved on only through their step columns, final once closed or
 * rejected; their costs (warranty_claim_costs) read only with finance.cost.read, on both pools,
 * and written only by the claim's definers. The role × company matrix covers each table's rows by
 * role and company; this file asks the policies, grants and definers themselves.
 */

const tag = newId().slice(-8).toUpperCase();
const account = newId();
const otherAccount = newId();
const item = newId();
const serial = newId();
const replacement = newId();
const vendor = newId();
/** A claim awaiting its supplier, one identified, and one rejected (final). */
const awaiting = newId();
const identified = newId();
const rejected = newId();
let owner: Principal;

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

const CLAIMS = [awaiting, identified, rejected];

/** What the principal reads of this file's claims and their costs, on either pool. */
async function seen(
  principal: Principal,
  reader: boolean,
): Promise<{ claims: number; costs: number }> {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => {
      const rows = (await tx.execute(sql`
        select (select count(*)::int from warranty_claims
                 where id in (${awaiting}, ${identified}, ${rejected})) as claims,
               (select count(*)::int from warranty_claim_costs
                 where claim_id in (${awaiting}, ${identified}, ${rejected})) as costs
      `)) as unknown as { claims: number; costs: number }[];
      return rows[0] ?? { claims: -1, costs: -1 };
    },
    { readOnly: true, reader },
  );
}

function holds(principal: Principal, key: string): boolean {
  return principal.permissions.some(
    (g) => g.key === key && g.scope !== 'own' && g.scope !== 'team',
  );
}

beforeAll(async () => {
  owner = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by) values
        (${account}, 'farm', ${`Warranty customer ${tag}`}, ${owner.id}),
        (${otherAccount}, 'farm', ${`Warranty other ${tag}`}, ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by) values
        (${newId()}, ${account}, 1, ${owner.id}),
        (${newId()}, ${otherAccount}, 2, ${owner.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
        values (${item}, ${`WP-${tag}`}, ${`Warranty pump ${tag}`}, 'pump', '8413', 'nos', true, true)`;
      await tx`insert into serials (id, entity_id, item_id, serial_no, state, account_id, warranty_until, created_by) values
        (${serial}, 1, ${item}, ${`WS-${tag}`}, 'with_customer', ${account}, '2099-12-31', ${owner.id}),
        (${replacement}, 1, ${item}, ${`WR-${tag}`}, 'with_customer', ${account}, '2099-12-31', ${owner.id})`;
      await tx`insert into vendors (id, name, created_by) values (${vendor}, ${`Warranty vendor ${tag}`}, ${owner.id})`;
      await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, item_id, serial_id, reported_fault, state,
                 replacement_serial_id, vendor_id, supplier_rma_ref, created_by)
        values (${awaiting}, 1, ${`WT${tag}/1`}, ${account}, ${item}, ${serial}, 'No water flow', 'rma_raised',
                ${replacement}, ${vendor}, 'RMA-1', ${owner.id})`;
      await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, reported_fault, state, created_by) values
        (${identified}, 1, ${`WT${tag}/2`}, ${account}, 'Motor hums', 'raised', ${owner.id})`;
      await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, reported_fault, state, rejected_reason, created_by)
        values (${rejected}, 1, ${`WT${tag}/3`}, ${account}, 'Broken by a fall', 'rejected', 'Physical damage', ${owner.id})`;
      await tx`insert into warranty_claim_costs (claim_id, entity_id, replacement_cost)
        values (${awaiting}, 1, 18500.00), (${identified}, 1, 0.00), (${rejected}, 1, 0.00)`;
    }),
  );
});

describe('warranty claims and their costs, read', () => {
  it('return no row without a request context', async () => {
    const [row] = await withoutContext<{ claims: number; costs: number }>(sql`
      select (select count(*)::int from warranty_claims) as claims,
             (select count(*)::int from warranty_claim_costs) as costs`);
    expect(row).toEqual({ claims: 0, costs: 0 });
  });

  it.each(STAFF_ROLE_KEYS)(
    '%s reads claims with inventory.stock.read or warranty.write, costs only with finance.cost.read, on both pools',
    async (roleKey) => {
      const principal = principalFor(roleKey, [1]);
      const claims =
        holds(principal, 'inventory.stock.read') || holds(principal, 'inventory.warranty.write')
          ? CLAIMS.length
          : 0;
      const costs = holds(principal, 'finance.cost.read') ? CLAIMS.length : 0;
      expect(await seen(principal, false)).toEqual({ claims, costs });
      expect(await seen(principal, true)).toEqual({ claims, costs });
    },
  );

  it('reads nothing of a company the request does not act for', async () => {
    for (const roleKey of ['executive', 'inventory_manager', 'accounts'] as const) {
      expect(await seen(principalFor(roleKey, [2, 3, 4]), false), roleKey).toEqual({
        claims: 0,
        costs: 0,
      });
    }
  });

  it('no agent reads a claim cost', async () => {
    for (const agent of ROLE_KEYS.filter((r) => r.startsWith('agent:'))) {
      const { costs } = await seen(principalFor(agent, [1, 2, 3, 4]), true);
      expect({ agent, costs }).toEqual({ agent, costs: 0 });
    }
  });
});

describe('warranty claims, written', () => {
  it('app_user selects, inserts and updates step columns only; app_reader and the reporter only select or nothing', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'warranty_claims', 'INSERT') as i,
             has_table_privilege('app_user', 'warranty_claims', 'UPDATE') as u,
             has_table_privilege('app_user', 'warranty_claims', 'DELETE') as d,
             has_column_privilege('app_user', 'warranty_claims', 'state', 'UPDATE') as state,
             has_column_privilege('app_user', 'warranty_claims', 'claim_no', 'UPDATE') as no,
             has_column_privilege('app_user', 'warranty_claims', 'account_id', 'UPDATE') as acct,
             has_column_privilege('app_user', 'warranty_claims', 'entity_id', 'UPDATE') as ent,
             has_table_privilege('app_reader', 'warranty_claims', 'SELECT') as rs,
             has_table_privilege('app_reader', 'warranty_claims', 'INSERT, UPDATE, DELETE') as rw,
             has_table_privilege('readonly_reporter', 'warranty_claims', 'SELECT') as reporter,
             has_any_column_privilege('app_user', 'warranty_claim_costs', 'INSERT')
               or has_any_column_privilege('app_user', 'warranty_claim_costs', 'UPDATE')
               or has_table_privilege('app_user', 'warranty_claim_costs', 'DELETE') as costs,
             has_table_privilege('readonly_reporter', 'warranty_claim_costs', 'SELECT') as reporterCosts
    `);
    expect(row).toEqual({
      i: true,
      u: false,
      d: false,
      state: true,
      no: false,
      acct: false,
      ent: false,
      rs: true,
      rw: false,
      reporter: false,
      costs: false,
      reportercosts: false,
    });
  });

  it('a claim is raised only with inventory.warranty.write for its company, as the caller', async () => {
    const insert = (who: Principal, entityId: number, createdBy: string) =>
      asPrincipal(who, ({ tx }) =>
        tx.execute(sql`insert into warranty_claims (id, entity_id, claim_no, account_id, reported_fault, state, created_by)
          values (${newId()}, ${entityId}, ${`WX${tag}/${newId().slice(-6)}`}, ${account}, 'Leaking seal', 'raised', ${createdBy})`),
      );
    for (const roleKey of ['general_manager', 'store_manager', 'accounts'] as const) {
      const who = await createTestPrincipal(roleKey, [1]);
      expect((await failure(insert(who, 1, who.id))).code, roleKey).toBe('42501');
    }
    const manager = await createTestPrincipal('inventory_manager', [1, 2]);
    expect((await failure(insert(manager, 1, owner.id))).code).toBe('42501');
    expect((await failure(insert(principalFor('inventory_manager', [1]), 2, owner.id))).code).toBe(
      '42501',
    );
    await insert(manager, 1, manager.id);
  });

  it('a claim moves on only with its steps’ grants, and is final once closed or rejected', async () => {
    const step = (who: Principal, id: string) =>
      asPrincipal(who, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`update warranty_claims set reported_fault = reported_fault, updated_by = ${who.id}
               where id = ${id} returning id`,
        )) as unknown as unknown[];
        return rows.length;
      });
    // reported_fault has no update grant: the statement is refused outright.
    const manager = await createTestPrincipal('inventory_manager', [1]);
    expect((await failure(step(manager, identified))).code).toBe('42501');
    const move = (who: Principal, id: string, state: string) =>
      asPrincipal(who, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`update warranty_claims set state = ${state}, rejected_reason = 'Not a fault', updated_by = ${who.id}
               where id = ${id} returning id`,
        )) as unknown as unknown[];
        return rows.length;
      });
    const gm = await createTestPrincipal('general_manager', [1]);
    expect(await move(gm, identified, 'rejected')).toBe(0);
    expect((await failure(move(manager, rejected, 'rejected'))).message).toMatch(/is rejected/);
  });

  it('costs take no direct write, even from an Executive holding every grant', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    for (const statement of [
      sql`insert into warranty_claim_costs (claim_id, entity_id, supplier_credit_amount) values (${identified}, 1, 10)`,
      sql`update warranty_claim_costs set replacement_cost = 1 where claim_id = ${awaiting}`,
      sql`delete from warranty_claim_costs where claim_id = ${awaiting}`,
    ]) {
      expect((await failure(asPrincipal(exec, ({ tx }) => tx.execute(statement)))).code).toBe(
        '42501',
      );
    }
  });
});

describe('app.warranty_claim_record_credit()', () => {
  const credit = (who: Principal, claim: string, amount: string) =>
    asPrincipal(who, ({ tx }) =>
      tx.execute(sql`select app.warranty_claim_record_credit(${claim}::uuid, ${amount}::numeric)`),
    );

  it('is run by app_user only', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.warranty_claim_record_credit(uuid,numeric)', 'execute') as app,
             has_function_privilege('app_reader', 'app.warranty_claim_record_credit(uuid,numeric)', 'execute') as reader,
             has_function_privilege('readonly_reporter', 'app.warranty_claim_record_credit(uuid,numeric)', 'execute') as reporter,
             has_function_privilege('public', 'app.warranty_claim_record_credit(uuid,numeric)', 'execute') as pub`);
    expect(row).toEqual({ app: true, reader: false, reporter: false, pub: false });
  });

  it('needs procurement.grn.write for the claim’s company and a claim awaiting its supplier', async () => {
    for (const roleKey of ['general_manager', 'accounts', 'store_manager'] as const) {
      expect((await failure(credit(principalFor(roleKey, [1]), awaiting, '100.00'))).code).toBe(
        '42501',
      );
    }
    const elsewhere = principalFor('inventory_manager', [2]);
    expect((await failure(credit(elsewhere, awaiting, '100.00'))).code).toBe('42501');
    const manager = principalFor('inventory_manager', [1]);
    expect((await failure(credit(manager, identified, '100.00'))).code).toBe('23514');
    expect((await failure(credit(manager, awaiting, '0'))).code).toBe('23514');
    expect((await failure(credit(manager, awaiting, '10.005'))).code).toBe('23514');
  });

  it('records the credit once, which only a holder of finance.cost.read reads back', async () => {
    const manager = principalFor('inventory_manager', [1]);
    await credit(manager, awaiting, '16250.50');
    expect((await failure(credit(manager, awaiting, '1.00'))).code).toBe('23514');
    const [row] = await asMigrator(
      (m) => m<{ credit: string; cost: string }[]>`
        select supplier_credit_amount::text as credit, replacement_cost::text as cost
          from warranty_claim_costs where claim_id = ${awaiting}`,
    );
    expect(row).toEqual({ credit: '16250.50', cost: '18500.00' });
    const read = (who: Principal) =>
      asPrincipal(
        who,
        async ({ tx }) =>
          (await tx.execute(
            sql`select supplier_credit_amount::text as credit from warranty_claim_costs where claim_id = ${awaiting}`,
          )) as unknown as { credit: string }[],
      );
    expect(await read(manager)).toEqual([]);
    expect(await read(principalFor('accounts', [1]))).toEqual([{ credit: '16250.50' }]);
  });
});

describe('the warranty_claim series', () => {
  it('numbers a claim only for a holder of inventory.warranty.write', async () => {
    const draw = (who: Principal) =>
      asPrincipal(who, ({ tx }) =>
        tx.execute(
          sql`select app.next_document_no(1::smallint, 'warranty_claim', '2098-99', ${`WT${tag}/WC`})`,
        ),
      );
    expect((await failure(draw(principalFor('general_manager', [1])))).code).toBe('42501');
    const rows = (await draw(principalFor('inventory_manager', [1]))) as unknown as unknown[];
    expect(rows).toHaveLength(1);
  });
});
