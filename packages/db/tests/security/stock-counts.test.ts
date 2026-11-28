import {
  hasGrant,
  newId,
  ROLE_KEYS,
  type PermissionGrant,
  type Principal,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withRequestContext } from '../../src/context';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/**
 * H3 (docs/03-roadmap-appendix/phase3.md §7.3): counting is blind. No request role, on either
 * pool, selects a line's expected quantity from the table; the lines themselves are read only with
 * inventory.stock.adjust; the expected quantities reach the Inventory Manager only through
 * app.stock_count_review(), which refuses everyone without inventory.stock.adjust; the counter's
 * app.stock_count_sheet() has no column for them; and every line is written by the definers alone.
 */

const tag = newId().slice(-8).toUpperCase();
const hub = newId();
const binA = newId();
const binB = newId();
const cable = newId();
const pump = newId();
const serial = newId();
const countId = newId();
let owner: Principal;
let manager: Principal;

/** Someone who counts and does nothing else: inventory.count.record and inventory.stock.read for the company. */
function counter(entityIds: readonly number[] = [1]): Principal {
  const permissions: PermissionGrant[] = [
    { key: 'inventory.count.record', scope: 'entity' },
    { key: 'inventory.stock.read', scope: 'entity' },
  ];
  return principalFor('store_manager', entityIds, { permissions });
}

/** A counter who does not read stock: inventory.count.record alone, the design's counter. */
function blindCounter(entityIds: readonly number[] = [1]): Principal {
  return principalFor('store_manager', entityIds, {
    permissions: [{ key: 'inventory.count.record', scope: 'entity' }],
  });
}

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

/** Runs `query` as `principal` on the request pool or the readers' pool. */
async function as<T>(principal: Principal, reader: boolean, query: ReturnType<typeof sql>) {
  return withRequestContext(
    principal,
    {},
    async ({ tx }) => (await tx.execute(query)) as unknown as T[],
    reader ? { readOnly: true, reader: true } : {},
  );
}

const POOLS = [false, true] as const;

beforeAll(async () => {
  owner = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [1]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${hub}, ${`SC${tag}`}, 'count test hub', 'godown', '08', '302001', ${owner.id})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by) values
        (${binA}, ${hub}, 'SC-A1', 'storage', ${owner.id}),
        (${binB}, ${hub}, 'SC-B1', 'storage', ${owner.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked) values
        (${cable}, ${`SCC-${tag}`}, 'count test cable', 'cable', '8544', 'metre', false),
        (${pump}, ${`SCP-${tag}`}, 'count test pump', 'pump', '8413', 'nos', true)`;
      await tx`insert into serials (id, entity_id, item_id, serial_no, state, bin_id, created_by)
        values (${serial}, 1, ${pump}, ${`SCS-${tag}`}, 'in_stock', ${binA}, ${owner.id})`;
      await tx`insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand) values
        (${newId()}, 1, ${hub}, ${binA}, ${cable}, 25),
        (${newId()}, 1, ${hub}, ${binA}, ${pump}, 1)`;
    }),
  );
  await withRequestContext(manager, {}, async ({ tx }) => {
    await tx.execute(sql`insert into stock_counts (id, entity_id, warehouse_id, scope, state, started_by, updated_by)
      values (${countId}, 1, ${hub}, 'hub', 'open', ${manager.id}, ${manager.id})`);
    await tx.execute(sql`select app.stock_count_start(${countId}::uuid)`);
  });
});

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from stock_count_lines where count_id = ${countId}`;
      await tx`delete from stock_counts where id = ${countId}`;
    }),
  );
});

describe('the expected quantity on either pool', () => {
  it('is selected by no request role from the table, whatever it holds', async () => {
    for (const role of ROLE_KEYS) {
      for (const reader of POOLS) {
        const who = principalFor(role, [1]);
        const e = await failure(
          as(
            who,
            reader,
            sql`select expected_qty from stock_count_lines where count_id = ${countId}`,
          ),
        );
        expect({ role, reader, e }).toMatchObject({ role, reader, e: { code: '42501' } });
        const star = await failure(
          as(who, reader, sql`select * from stock_count_lines where count_id = ${countId}`),
        );
        expect({ role, reader, star }).toMatchObject({ role, reader, star: { code: '42501' } });
      }
    }
  });

  it('is granted to no request role at all, by column', async () => {
    const rows = await withoutContext<{ role: string; s: boolean; u: boolean; i: boolean }>(sql`
      select r.role,
             has_column_privilege(r.role, 'stock_count_lines', 'expected_qty', 'SELECT') as s,
             has_column_privilege(r.role, 'stock_count_lines', 'expected_qty', 'UPDATE') as u,
             has_column_privilege(r.role, 'stock_count_lines', 'expected_qty', 'INSERT') as i
        from (values ('app_user'), ('app_reader'), ('readonly_reporter'), ('auth_service'),
                     ('outbox_publisher')) as r(role)`);
    for (const row of rows) expect(row).toEqual({ role: row.role, s: false, u: false, i: false });
  });

  it('reaches only a holder of inventory.stock.adjust, through the review', async () => {
    for (const role of ROLE_KEYS) {
      const who = principalFor(role, [1]);
      const adjusts = hasGrant(who.permissions, 'inventory.stock.adjust', 'entity');
      for (const reader of POOLS) {
        const query = sql`select line_id, expected_qty from app.stock_count_review(${countId}::uuid)`;
        if (adjusts) {
          const rows = await as<{ expected_qty: string }>(who, reader, query);
          expect({ role, reader, n: rows.length }).toEqual({ role, reader, n: 2 });
        } else {
          expect({ role, reader, e: await failure(as(who, reader, query)) }).toMatchObject({
            role,
            reader,
            e: { code: '42501' },
          });
        }
      }
    }
    for (const reader of POOLS) {
      expect(
        await failure(
          as(counter(), reader, sql`select * from app.stock_count_review(${countId}::uuid)`),
        ),
      ).toMatchObject({ code: '42501' });
    }
  });

  it('is refused outside the count’s company, even to the Inventory Manager of another', async () => {
    const other = principalFor('inventory_manager', [2]);
    expect(
      await failure(as(other, false, sql`select * from app.stock_count_review(${countId}::uuid)`)),
    ).toMatchObject({ code: '42501' });
    expect(
      await failure(as(other, true, sql`select * from app.stock_count_sheet(${countId}::uuid)`)),
    ).toMatchObject({ code: '42501' });
  });

  it('has no column in the counter’s sheet, and no line count either', async () => {
    const [columns] = await withoutContext<{ names: string[] }>(sql`
      select array_agg(a) as names from (
        select unnest(p.proargnames) as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname in ('stock_count_sheet', 'stock_count_progress')) x`);
    expect(columns?.names.some((n) => /expected|variance|difference/.test(n))).toBe(false);
    for (const reader of POOLS) {
      const rows = await as<Record<string, unknown>>(
        counter(),
        reader,
        sql`select * from app.stock_count_sheet(${countId}::uuid)`,
      );
      // One row per item in a bin: the cable and the pump in A1, never one per serial.
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(Object.keys(row).some((k) => /expected|variance/.test(k))).toBe(false);
        expect(row.counted_qty).toBeNull();
      }
      const [progress] = await as<{ items_in_bins: number; to_count: number }>(
        counter(),
        reader,
        sql`select * from app.stock_count_progress(${countId}::uuid)`,
      );
      expect(progress).toMatchObject({ items_in_bins: 2, to_count: 2 });
    }
  });
});

describe('the lines', () => {
  it('are read, without the expected quantity, only with inventory.stock.adjust', async () => {
    for (const role of ROLE_KEYS) {
      const who = principalFor(role, [1]);
      const adjusts = hasGrant(who.permissions, 'inventory.stock.adjust', 'entity');
      for (const reader of POOLS) {
        const [row] = await as<{ n: number }>(
          who,
          reader,
          sql`select count(id)::int as n from stock_count_lines where count_id = ${countId}`,
        );
        expect({ role, reader, n: row?.n }).toEqual({ role, reader, n: adjusts ? 2 : 0 });
      }
    }
    const [row] = await as<{ n: number }>(
      counter(),
      false,
      sql`select count(id)::int as n from stock_count_lines where count_id = ${countId}`,
    );
    expect(row?.n).toBe(0);
  });

  it('are written by no request role, only by the definers', async () => {
    const statements = [
      sql`insert into stock_count_lines (id, entity_id, count_id, bin_id, item_id, expected_qty)
          values (${newId()}, 1, ${countId}, ${binB}, ${cable}, 0)`,
      sql`update stock_count_lines set counted_qty = 1 where count_id = ${countId}`,
      sql`delete from stock_count_lines where count_id = ${countId}`,
    ];
    for (const statement of statements) {
      expect(await failure(as(owner, false, statement))).toMatchObject({ code: '42501' });
    }
  });

  it('take a counter’s count through the definer, and never from a reader of stock alone', async () => {
    const reader = principalFor('general_manager', [1]);
    expect(
      await failure(
        as(
          reader,
          false,
          sql`select app.stock_count_record(${countId}::uuid, ${binA}::uuid, ${cable}::uuid, 3, null)`,
        ),
      ),
    ).toMatchObject({ code: '42501' });
    expect(
      await failure(as(manager, true, sql`select app.stock_count_start(${countId}::uuid)`)),
    ).toMatchObject({ code: '42501' });
  });
});

describe('the definers’ grants', () => {
  it('are executed only by the roles that need them', async () => {
    const rows = await withoutContext<{
      fn: string;
      user: boolean;
      reader: boolean;
      reporter: boolean;
      pub: boolean;
    }>(sql`
      select p.oid::regprocedure::text as fn,
             has_function_privilege('app_user', p.oid, 'execute') as user,
             has_function_privilege('app_reader', p.oid, 'execute') as reader,
             has_function_privilege('readonly_reporter', p.oid, 'execute') as reporter,
             has_function_privilege('public', p.oid, 'execute') as pub
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname like 'stock_count%'
       order by 1`);
    const expected: Record<string, [boolean, boolean]> = {
      stock_count_start: [true, false],
      stock_count_record: [true, false],
      stock_count_recount: [true, false],
      stock_count_sheet: [true, true],
      stock_count_progress: [true, true],
      stock_count_review: [true, true],
      stock_count_hub: [true, true],
      stock_count_hidden: [true, true],
      stock_count_bins: [true, true],
      stock_count_refuse: [false, false],
      stock_count_of: [false, false],
      stock_count_moved: [false, false],
      stock_counts_guard: [false, false],
    };
    expect(rows.map((r) => r.fn.replace(/^app\./, '').replace(/\(.*$/, '')).sort()).toEqual(
      Object.keys(expected).sort(),
    );
    for (const row of rows) {
      const name = row.fn.replace(/^app\./, '').replace(/\(.*$/, '');
      const [user, reader] = expected[name] ?? [true, true];
      expect(row).toEqual({ ...row, user, reader, reporter: false, pub: false });
    }
  });
});

describe('a count’s state', () => {
  it('moves only as the machine says, each move with its grant', async () => {
    const id = newId();
    await withRequestContext(manager, {}, async ({ tx }) => {
      await tx.execute(sql`insert into stock_counts (id, entity_id, warehouse_id, scope, state, started_by, updated_by)
        values (${id}, 2, ${hub}, 'hub', 'open', ${manager.id}, ${manager.id})`);
    }).catch(() => undefined);
    // The Inventory Manager of company 1 cannot start one in company 2.
    const [none] = await asMigrator(
      (m) => m<{ n: number }[]>`
      select count(*)::int as n from stock_counts where id = ${id}`,
    );
    expect(none?.n).toBe(0);
    // A counter cannot post or cancel by writing the state.
    const who = counter();
    const writes = {
      posted: sql`update stock_counts set state = 'posted', posted_at = now(), posted_by = ${who.id},
                         post_note = 'by hand', updated_by = ${who.id}
                   where id = ${countId}`,
      cancelled: sql`update stock_counts set state = 'cancelled', cancelled_at = now(),
                            cancelled_by = ${who.id}, cancel_reason = 'by hand', updated_by = ${who.id}
                      where id = ${countId}`,
    };
    for (const [state, write] of Object.entries(writes)) {
      const e = await failure(as(who, false, write));
      expect({ state, e }).toMatchObject({ state, e: { code: '23514' } });
      // Posting from open carries posting stamps outside their step; cancelling needs adjust.
      expect(e.message).toMatch(/does not move|its own step/);
    }
    const [still] = await asMigrator(
      (m) => m<{ state: string }[]>`
      select state from stock_counts where id = ${countId}`,
    );
    expect(still?.state).toBe('open');
  });

  it('changes a stamp only with its own step', async () => {
    const who = counter();
    const writes = {
      submitted: sql`update stock_counts set submitted_at = now(), submitted_by = ${who.id},
                            updated_by = ${who.id} where id = ${countId}`,
      noted: sql`update stock_counts set post_note = 'by hand', updated_by = ${who.id}
                  where id = ${countId}`,
      posted: sql`update stock_counts set posted_at = now(), posted_by = ${who.id},
                         updated_by = ${who.id} where id = ${countId}`,
      cancelReason: sql`update stock_counts set cancel_reason = 'by hand', updated_by = ${who.id}
                         where id = ${countId}`,
      stateTime: sql`update stock_counts set state_changed_at = now(), updated_by = ${who.id}
                      where id = ${countId}`,
      // A step that carries another step's stamp: open to counting with a posting note.
      withAnother: sql`update stock_counts set state = 'counting', state_changed_at = now(),
                              post_note = 'by hand', updated_by = ${who.id}
                        where id = ${countId}`,
    };
    for (const [stamp, write] of Object.entries(writes)) {
      const e = await failure(as(who, false, write));
      expect({ stamp, e }).toMatchObject({ stamp, e: { code: '23514' } });
      expect(e.message).toMatch(/its own step/);
    }
    const [still] = await asMigrator(
      (m) => m<{ state: string; note: string | null; submitted: string | null }[]>`
      select state, post_note as note, submitted_at::text as submitted
        from stock_counts where id = ${countId}`,
    );
    expect(still).toEqual({ state: 'open', note: null, submitted: null });
  });

  it('takes a counter who does not read stock through the definers, and shows them no stock', async () => {
    const who = blindCounter();
    // The count, its hub's name, the sheet and the bins to count in.
    const [listed] = await as<{ code: string }>(
      who,
      false,
      sql`select w.code from stock_counts c, app.stock_count_hub(c.warehouse_id) w
           where c.id = ${countId}`,
    );
    expect(listed?.code).toBe(`SC${tag}`);
    const sheet = await as<{ bin_code: string }>(
      who,
      false,
      sql`select bin_code from app.stock_count_sheet(${countId}::uuid)`,
    );
    expect(sheet.length).toBeGreaterThan(0);
    const bins = await as<{ code: string }>(
      who,
      true,
      sql`select code from app.stock_count_bins(${countId}::uuid)`,
    );
    expect(bins.map((b) => b.code)).toEqual(['SC-A1', 'SC-B1']);
    // Nothing of the stock itself: balances, movements, serials' bins, hubs or bins by hand.
    for (const reader of POOLS) {
      for (const table of ['stock_balances', 'stock_movements', 'serials', 'warehouses', 'bins']) {
        const [n] = await as<{ n: number }>(
          who,
          reader,
          sql.raw(`select count(*)::int as n from ${table}`),
        );
        expect({ table, reader, n: n?.n }).toEqual({ table, reader, n: 0 });
      }
    }
    // The hub's name and the bins are the count's only: another company's counter reads neither.
    const other = blindCounter([2]);
    expect(await as(other, false, sql`select * from app.stock_count_hub(${hub}::uuid)`)).toEqual(
      [],
    );
    expect(
      await failure(as(other, false, sql`select * from app.stock_count_bins(${countId}::uuid)`)),
    ).toMatchObject({ code: '42501' });
    // Someone who neither reads stock nor counts reads no hub name.
    const caller = principalFor('store_manager', [1], {
      permissions: [{ key: 'crm.lead.read', scope: 'own' }],
    });
    expect(await as(caller, false, sql`select * from app.stock_count_hub(${hub}::uuid)`)).toEqual(
      [],
    );
  });

  it('is never started for someone else, or past open', async () => {
    const e = await failure(
      withRequestContext(manager, {}, ({ tx }) =>
        tx.execute(sql`insert into stock_counts (id, entity_id, warehouse_id, scope, state, started_by, updated_by)
          values (${newId()}, 1, ${hub}, 'hub', 'counting', ${manager.id}, ${manager.id})`),
      ),
    );
    expect(e.code).toBe('42501');
  });
});

describe('blind counting (owner, question B)', () => {
  it('hides a counted bin’s stock from a counter who cannot adjust, while the count is live', async () => {
    const t = newId().slice(-6).toUpperCase();
    const ids = {
      hub: newId(),
      counted: newId(),
      outside: newId(),
      serial: newId(),
      move: newId(),
      outsideMove: newId(),
      count: newId(),
    };
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
          values (${ids.hub}, ${`BL${t}`}, 'blind test hub', 'godown', '08', '302001', ${owner.id})`;
        await tx`insert into bins (id, warehouse_id, code, kind, created_by) values
          (${ids.counted}, ${ids.hub}, 'BL-A1', 'storage', ${owner.id}),
          (${ids.outside}, ${ids.hub}, 'BL-B1', 'storage', ${owner.id})`;
        await tx`insert into serials (id, entity_id, item_id, serial_no, state, bin_id, created_by)
          values (${ids.serial}, 1, ${pump}, ${`BLS-${t}`}, 'in_stock', ${ids.counted}, ${owner.id})`;
        await tx`insert into stock_movements (id, entity_id, item_id, to_bin_id, qty, reason, batch_id, moved_by) values
          (${ids.move}, 1, ${cable}, ${ids.counted}, 7, 'adjust_gain', ${ids.move}, ${owner.id}),
          (${ids.outsideMove}, 1, ${cable}, ${ids.outside}, 3, 'adjust_gain', ${ids.outsideMove}, ${owner.id})`;
        // Every movement has its cost, as app.stock_move() writes it.
        await tx`insert into stock_movement_costs (movement_id, entity_id, unit_cost) values
          (${ids.move}, 1, 10), (${ids.outsideMove}, 1, 10)`;
        await tx`insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand) values
          (${newId()}, 1, ${ids.hub}, ${ids.counted}, ${cable}, 7),
          (${newId()}, 1, ${ids.hub}, ${ids.outside}, ${cable}, 3),
          (${newId()}, 1, ${ids.hub}, ${ids.counted}, ${pump}, 1)`;
        // A live count of one bin of the hub.
        await tx`insert into stock_counts (id, entity_id, warehouse_id, scope, scope_bin_ids, state, started_by)
          values (${ids.count}, 1, ${ids.hub}, 'bins', ${[ids.counted]}::uuid[], 'counting', ${manager.id})`;
      }),
    );
    /** What a principal reads of the two bins, on one pool. */
    const seen = async (who: Principal, reader: boolean) => {
      const [row] = await as<Record<string, number>>(
        who,
        reader,
        sql`select
              (select count(*)::int from stock_balances where bin_id = ${ids.counted}) as "countedBalances",
              (select count(*)::int from stock_balances where bin_id = ${ids.outside}) as "outsideBalances",
              (select count(*)::int from stock_movements where id = ${ids.move}) as "countedMoves",
              (select count(*)::int from stock_movements where id = ${ids.outsideMove}) as "outsideMoves",
              (select count(*)::int from serials where id = ${ids.serial}) as serials`,
      );
      return row;
    };
    const hidden = {
      countedBalances: 0,
      outsideBalances: 1,
      countedMoves: 0,
      outsideMoves: 1,
      serials: 0,
    };
    const visible = {
      countedBalances: 2,
      outsideBalances: 1,
      countedMoves: 1,
      outsideMoves: 1,
      serials: 1,
    };
    const storeManager = principalFor('store_manager', [1]);
    const readers = [
      principalFor('inventory_manager', [1]),
      principalFor('general_manager', [1]),
      principalFor('tele_caller_lc', [1]),
    ];
    for (const reader of POOLS) {
      expect({ reader, ...(await seen(storeManager, reader)) }).toEqual({ reader, ...hidden });
      for (const who of readers) {
        expect({ who: who.roleKey, reader, ...(await seen(who, reader)) }).toEqual({
          who: who.roleKey,
          reader,
          ...visible,
        });
      }
    }
    // A counter of another company is not blinded by company 1's count, and reads nothing of it.
    expect(await seen(principalFor('store_manager', [2]), false)).toEqual({
      countedBalances: 0,
      outsideBalances: 0,
      countedMoves: 0,
      outsideMoves: 0,
      serials: 0,
    });
    // Cancelled, the count no longer hides the bin.
    await withRequestContext(manager, {}, async ({ tx }) => {
      await tx.execute(sql`update stock_counts set state = 'cancelled', state_changed_at = now(),
                                  cancelled_at = now(), cancelled_by = ${manager.id},
                                  cancel_reason = 'Test over', updated_by = ${manager.id}
                            where id = ${ids.count}`);
    });
    for (const reader of POOLS) {
      expect({ reader, ...(await seen(storeManager, reader)) }).toEqual({ reader, ...visible });
    }
    // An items count hides only its items in the bins it covers.
    const itemsCount = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into stock_counts (id, entity_id, warehouse_id, scope, scope_item_ids, state, started_by)
        values (${itemsCount}, 1, ${ids.hub}, 'items', ${[pump]}::uuid[], 'review', ${manager.id})`,
    );
    expect(await seen(storeManager, false)).toEqual({ ...visible, countedBalances: 1, serials: 0 });
    await withRequestContext(manager, {}, async ({ tx }) => {
      await tx.execute(sql`update stock_counts set state = 'cancelled', state_changed_at = now(),
                                  cancelled_at = now(), cancelled_by = ${manager.id},
                                  cancel_reason = 'Test over', updated_by = ${manager.id}
                            where id = ${itemsCount}`);
    });
    expect(await seen(storeManager, false)).toEqual(visible);
  });
});
