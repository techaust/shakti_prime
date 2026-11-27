import {
  hasGrant,
  newId,
  OPEN_STOCK_REASONS,
  PERMISSION_KEYS,
  PERMISSION_SCOPES,
  ROLE_KEYS,
  SCOPES,
  STOCK_REASONS,
  type PermissionKey,
  type Principal,
  type Scope,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/**
 * X4, the stock ledger's reason registry (docs/runs/phase3/x4-stock-reasons.md): the permission
 * each movement reason of `app.stock_move()` needs is a row of `app.stock_reason_grants`, which
 * only the definer reads. Every row gives exactly its permission, a reason with no row is refused
 * with `stock_reason_not_open`, and one insert opens a reason. The directions and serial rules
 * beside it (`app.stock_reason_moves`), and the reversal's grant, which depends on the movement it
 * reverses, are tested in stock-reason-moves.test.ts; H1's own ledger tests (stock-ledger.test.ts
 * here, packages/domain/tests/stock) run unchanged beside these.
 */

interface ReasonGrant {
  reason: string;
  permission: string;
  reversible: boolean;
  opened_by: string;
}

/** The reasons H1's reversal path reversed: every one of its own but the reversal. */
const H1_REVERSIBLE = ['adjust_gain', 'adjust_loss', 'count', 'damage', 'opening', 'transfer'];

/** H1's mapping, as its `case` had it before the registry. */
const H1_GRANTS: Record<string, string> = {
  opening: 'inventory.stock.adjust:entity',
  adjust_gain: 'inventory.stock.adjust:entity',
  adjust_loss: 'inventory.stock.adjust:entity',
  damage: 'inventory.stock.adjust:entity',
  count: 'inventory.stock.adjust:entity',
  reversal: 'inventory.stock.adjust:entity',
  transfer: 'inventory.stock.move:entity',
};

const ALL_PRIVILEGES = 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER';

let grants: ReasonGrant[] = [];

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

/**
 * One line of `reason` that passes the reason and its grant and is then refused for its shape (a
 * reference type with no reference), before any company, bin or item is read or anything locked:
 * so the answer tells only whether the grant let it through.
 */
function probe(reason: string | null): string {
  return JSON.stringify([
    {
      reason,
      entity_id: 1,
      item_id: newId(),
      to_bin_id: newId(),
      qty: '1',
      ref_type: 'registry probe',
      ref_id: null,
    },
  ]);
}

function post(principal: Principal, reason: string | null) {
  return asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`select app.stock_move(${probe(reason)}::jsonb)`),
  );
}

const SHAPE_REFUSED = { code: '23514', message: 'stock movement refused: stock_movement_shape' };
const NOT_OPEN = { code: '23514', message: 'stock movement refused: stock_reason_not_open' };

function splitPermission(permission: string): { key: PermissionKey; scope: Scope } {
  const [key, scope] = permission.split(':') as [PermissionKey, Scope];
  return { key, scope };
}

beforeAll(async () => {
  grants = await asMigrator(
    (m) => m<ReasonGrant[]>`
      select reason, permission, reversible, opened_by from app.stock_reason_grants order by reason`,
  );
});

describe('app.stock_reason_grants, the registry', () => {
  it('holds H1’s mapping exactly, as H1’s rows', () => {
    const h1 = Object.fromEntries(
      grants.filter((g) => g.opened_by === 'h1-stock-ledger').map((g) => [g.reason, g.permission]),
    );
    expect(h1).toEqual(H1_GRANTS);
    expect(
      grants.filter((g) => g.opened_by === 'h1-stock-ledger' && g.reversible).map((g) => g.reason),
    ).toEqual(H1_REVERSIBLE);
  });

  it('opens exactly the reasons the contracts open, each with a catalogue key and one of its scopes', () => {
    expect(
      Object.fromEntries(grants.map((g) => [g.reason, splitPermission(g.permission).key])),
    ).toEqual(OPEN_STOCK_REASONS);
    for (const g of grants) {
      const { key, scope } = splitPermission(g.permission);
      expect(STOCK_REASONS, g.reason).toContain(g.reason);
      expect(PERMISSION_KEYS, g.permission).toContain(key);
      expect(PERMISSION_SCOPES[key], g.permission).toContain(scope);
    }
  });

  it('its reason check names the ledger’s reasons, the same list as stock_movements_reason_check', async () => {
    const rows = await withoutContext<{ name: string; def: string }>(sql`
      select c.conname as name, pg_get_constraintdef(c.oid) as def
        from pg_constraint c
       where c.conname in ('stock_reason_grants_reason_check', 'stock_movements_reason_check')
    `);
    const values = (def: string) => [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
    const byName = Object.fromEntries(rows.map((r) => [r.name, values(r.def)]));
    expect(byName.stock_reason_grants_reason_check).toEqual([...STOCK_REASONS].sort());
    expect(byName.stock_movements_reason_check).toEqual([...STOCK_REASONS].sort());
  });

  it('refuses a reason outside the ledger’s, a permission without its scope and an empty slice name', async () => {
    const attempts: [string, string, string][] = [
      ['restock', 'inventory.stock.adjust:entity', 'x4-stock-reasons'],
      ['surplus_in', 'inventory.stock.adjust', 'x4-stock-reasons'],
      ['surplus_in', 'inventory.stock.adjust:company', 'x4-stock-reasons'],
      ['surplus_in', 'inventory.stock.adjust:entity', ''],
    ];
    for (const [reason, permission, openedBy] of attempts) {
      // Rolled back even if the check let the row in, so a failing run leaves nothing behind.
      const refused = await failure(
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`insert into app.stock_reason_grants (reason, permission, opened_by)
              values (${reason}, ${permission}, ${openedBy})`;
            throw new Error('the row was let in');
          }),
        ),
      );
      expect({ reason, permission, openedBy, code: refused.code }).toEqual({
        reason,
        permission,
        openedBy,
        code: '23514',
      });
    }
  });
});

describe('app.stock_move() reads the registry', () => {
  it('every row gives exactly its permission, role by role and agent by agent', async () => {
    expect(grants.length).toBeGreaterThanOrEqual(Object.keys(H1_GRANTS).length);
    // A reversal's grant is checked once the movement it reverses is read (stock-reason-moves).
    for (const g of grants.filter((r) => r.reason !== 'reversal')) {
      const { key, scope } = splitPermission(g.permission);
      const holders: string[] = [];
      const others: string[] = [];
      for (const roleKey of ROLE_KEYS) {
        const principal = principalFor(roleKey, [1]);
        const holds = hasGrant(principal.permissions, key, scope);
        (holds ? holders : others).push(roleKey);
        const refused = await failure(post(principal, g.reason));
        expect({ reason: g.reason, roleKey, ...refused }).toEqual({
          reason: g.reason,
          roleKey,
          ...(holds
            ? SHAPE_REFUSED
            : {
                code: '42501',
                message: `${g.permission} is required for a ${g.reason} movement`,
              }),
        });
      }
      // The walk means something only when some roles hold the grant and some do not.
      expect(holders.length, g.reason).toBeGreaterThan(0);
      expect(others.length, g.reason).toBeGreaterThan(0);
    }
  });

  it('refuses a reason with no row with stock_reason_not_open, even to an Executive', async () => {
    const open = new Set(grants.map((g) => g.reason));
    const closed = STOCK_REASONS.filter((r) => !open.has(r));
    const exec = principalFor('executive', [1]);
    for (const reason of [...closed, 'restock', null]) {
      expect({ reason, ...(await failure(post(exec, reason))) }).toEqual({ reason, ...NOT_OPEN });
    }
  });

  it('one insert opens a reason, with the permission its row names and no other', async () => {
    const sentinel = new Error('roll the probe back');
    const seen: { code?: string; message: string }[] = [];
    // In one transaction rolled back at its end, so no other test ever sees the row.
    const outcome = await failure(
      asMigrator((m) =>
        m.begin(async (tx) => {
          await tx`insert into app.stock_reason_grants (reason, permission, opened_by)
            values ('surplus_in', 'inventory.stock.move:entity', 'x4-stock-reasons')
            on conflict (reason) do nothing`;
          const asCaller = async (permissions: string) => {
            await tx`select set_config('app.user_id', ${newId()}, true),
                            set_config('app.entity_ids', '{1}', true),
                            set_config('app.permissions', ${permissions}, true)`;
            seen.push(
              await failure(
                tx.savepoint(
                  (sp) => sp`select app.stock_move(${probe('surplus_in')}::text::jsonb)`,
                ),
              ),
            );
          };
          await asCaller('inventory.stock.adjust:entity,inventory.stock.adjust:own');
          await asCaller('inventory.stock.move:entity,inventory.stock.move:own');
          throw sentinel;
        }),
      ),
    );
    expect(outcome.message).toBe(sentinel.message);
    expect(seen).toEqual([
      {
        code: '42501',
        message: 'inventory.stock.move:entity is required for a surplus_in movement',
      },
      SHAPE_REFUSED,
    ]);
    // Never committed: the reason is as closed as before.
    expect(await failure(post(principalFor('executive', [1]), 'surplus_in'))).toEqual(NOT_OPEN);
  });
});

/** The registry's two tables, written only by migrations and read only by the definer. */
const REGISTRY = ['app.stock_reason_grants', 'app.stock_reason_moves'] as const;

describe.each(REGISTRY)('no request role, reporting or agent reads or writes %s', (table) => {
  it('no database role but the backup holds a privilege on it, and the backup only reads', async () => {
    const roles = await withoutContext<{ name: string }>(sql`
      select rolname as name from pg_roles
       where rolname in ('app_user', 'app_reader', 'readonly_reporter', 'auth_service',
                         'outbox_publisher', 'webhook_receiver', 'app_backup',
                         'anon', 'authenticated', 'service_role')
       order by 1
    `);
    expect(roles.map((r) => r.name)).toEqual(
      expect.arrayContaining(['app_reader', 'app_user', 'readonly_reporter']) as unknown,
    );
    for (const { name } of [...roles, { name: 'public' }]) {
      const [row] = await withoutContext<{ any: boolean; read: boolean; columns: boolean }>(sql`
        select has_table_privilege(${name}, ${table}, ${ALL_PRIVILEGES}) as any,
               has_table_privilege(${name}, ${table}, 'SELECT') as read,
               has_any_column_privilege(${name}, ${table}, 'SELECT, INSERT, UPDATE, REFERENCES') as columns
      `);
      const backup = name === 'app_backup';
      // The 6-hourly backup reads every table of the BOS's schemas so pg_dump copies them whole.
      expect({ name, ...row }).toEqual({ name, any: backup, read: backup, columns: backup });
    }
    const [write] = await withoutContext<{ write: boolean }>(sql`
      select has_table_privilege('app_backup', ${table},
                                 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') as write
    `);
    expect(write?.write).toBe(false);
  });

  it('refuses a read without a request context', async () => {
    expect((await failure(withoutContext(sql`select count(*) from ${sql.raw(table)}`))).code).toBe(
      '42501',
    );
  });

  it.each(ROLE_KEYS)('%s reads it on neither pool and writes it on none', async (roleKey) => {
    const principal = principalFor(roleKey, [1, 2, 3, 4]);
    const read = sql`select count(*) from ${sql.raw(table)}`;
    const app = await failure(asPrincipal(principal, ({ tx }) => tx.execute(read)));
    const reader = await failure(
      withRequestContext(principal, {}, ({ tx }) => tx.execute(read), { reader: true }),
    );
    const writes =
      table === 'app.stock_reason_grants'
        ? [
            sql`insert into app.stock_reason_grants (reason, permission, opened_by)
                values ('surplus_out', 'inventory.stock.adjust:entity', 'x4-stock-reasons')`,
            sql`update app.stock_reason_grants set permission = 'inventory.stock.read:entity'`,
            sql`delete from app.stock_reason_grants`,
          ]
        : [
            sql`insert into app.stock_reason_moves (reason, direction, from_states, to_state, opened_by)
                values ('transfer', 'out', '{in_stock}', 'scrapped', 'x4-stock-reasons')`,
            sql`update app.stock_reason_moves set from_states = '{in_stock,faulty}'`,
            sql`delete from app.stock_reason_moves`,
          ];
    const codes = [app.code, reader.code];
    for (const write of writes) {
      codes.push((await failure(asPrincipal(principal, ({ tx }) => tx.execute(write)))).code);
    }
    expect({ roleKey, codes }).toEqual({ roleKey, codes: codes.map(() => '42501') });
  });
});

// Guards the walk above against a scope list that grows without this file noticing.
it('the permission check of the registry names every scope of the catalogue', async () => {
  const [row] = await withoutContext<{ def: string }>(sql`
    select pg_get_constraintdef(c.oid) as def from pg_constraint c
     where c.conname = 'stock_reason_grants_permission_check'
  `);
  expect(row?.def).toContain(`(${SCOPES.join('|')})`);
});
