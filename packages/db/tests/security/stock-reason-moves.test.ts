import {
  hasGrant,
  newId,
  ROLE_KEYS,
  serializeGrants,
  type PermissionGrant,
  type Principal,
} from '@shakti/contracts';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asMigrator, closeDb, createTestPrincipal, principalFor } from '../../src/testing/index';

afterAll(closeDb);

/**
 * X4, moves as data (docs/runs/phase3/x4-stock-reasons.md, the addenda and the review's fixes):
 * which directions a line of each reason of `app.stock_move()` may take, and how a serial moves on
 * each, is a row of `app.stock_reason_moves`. Each of H1's rows allows exactly 0231's directions and
 * moves a serial exactly as 0231's serial block did; a line, tracked or not, whose reason and
 * direction have no row is refused with `stock_movement_shape`; a reversal takes the row and the
 * grant of the reason it reverses when that reason has its own reversal rows, else H1's; and the
 * rows the wave 2 slices name (here written in a transaction that is rolled back) move a serial to
 * and from a customer of the line's company, with the delivery's customer on the line.
 *
 * Every case runs in one migrator transaction rolled back at its end, so its hubs, bins, items,
 * customers, movements and rows are never seen by another test. The definer is called there with a
 * request's settings, as `withRequestContext()` sets them; it runs as its owner whoever calls it.
 */

type Tx = postgres.TransactionSql;

interface MoveRow {
  reason: string;
  direction: string;
  reverses_reason?: string;
  from_states: string[];
  creates: boolean;
  to_state: string;
}

/** H1's serial rules, as 0231's serial block had them. */
const H1_MOVES: MoveRow[] = [
  {
    reason: 'adjust_gain',
    direction: 'in',
    from_states: ['scrapped'],
    creates: true,
    to_state: 'in_stock',
  },
  {
    reason: 'adjust_loss',
    direction: 'out',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'scrapped',
  },
  {
    reason: 'count',
    direction: 'in',
    from_states: ['scrapped'],
    creates: false,
    to_state: 'in_stock',
  },
  {
    reason: 'count',
    direction: 'out',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'scrapped',
  },
  {
    reason: 'damage',
    direction: 'out',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'scrapped',
  },
  {
    reason: 'opening',
    direction: 'in',
    from_states: ['scrapped'],
    creates: true,
    to_state: 'in_stock',
  },
  {
    reason: 'reversal',
    direction: 'in',
    from_states: ['scrapped'],
    creates: false,
    to_state: 'in_stock',
  },
  {
    reason: 'reversal',
    direction: 'out',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'scrapped',
  },
  {
    reason: 'reversal',
    direction: 'transfer',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'in_stock',
  },
  {
    reason: 'transfer',
    direction: 'transfer',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'in_stock',
  },
];

/** The rows the wave 2 slices name (each writes its own); here only in a rolled-back transaction. */
const WAVE2_GRANTS = [
  ['warranty_replacement', 'inventory.stock.adjust:entity'],
  ['return_customer', 'inventory.stock.adjust:entity'],
  ['return_supplier', 'inventory.stock.adjust:entity'],
  ['receipt', 'inventory.stock.adjust:entity'],
] as const;
const WAVE2_MOVES: MoveRow[] = [
  {
    reason: 'warranty_replacement',
    direction: 'out',
    from_states: ['in_stock'],
    creates: false,
    to_state: 'with_customer',
  },
  {
    reason: 'return_customer',
    direction: 'in',
    from_states: ['with_customer'],
    creates: false,
    to_state: 'faulty',
  },
  {
    reason: 'return_supplier',
    direction: 'out',
    from_states: ['faulty'],
    creates: false,
    to_state: 'with_supplier',
  },
  { reason: 'receipt', direction: 'in', from_states: [], creates: true, to_state: 'in_stock' },
];

const LONG_AGO = '2020-01-01T00:00:00Z';

/** A list of states as a Postgres array literal (states hold no comma, quote or brace). */
const textArray = (values: readonly string[]): string => `{${values.join(',')}}`;

let exec: Principal;

class RolledBack extends Error {}

/** Runs `fn` in a migrator transaction that is always rolled back. */
async function rolledBack(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await fn(tx);
        throw new RolledBack('roll the case back');
      }),
    );
  } catch (e) {
    if (e instanceof RolledBack) return;
    throw e;
  }
}

interface Fixture {
  tag: string;
  binA: string;
  binB: string;
  quarantine: string;
  /** Tracked by serial, and counted in metres. */
  pump: string;
  cable: string;
  /** A customer of company 1 with its site, one of company 2 only, and a site of the latter. */
  account: string;
  site: string;
  otherAccount: string;
  otherSite: string;
}

async function fixture(tx: Tx): Promise<Fixture> {
  const tag = newId().slice(-8).toUpperCase();
  const f: Fixture = {
    tag,
    binA: newId(),
    binB: newId(),
    quarantine: newId(),
    pump: newId(),
    cable: newId(),
    account: newId(),
    site: newId(),
    otherAccount: newId(),
    otherSite: newId(),
  };
  const hub = newId();
  await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
    values (${hub}, ${`X${tag}`}, ${`Serial moves ${tag}`}, 'godown', '08', '302001', ${exec.id})`;
  await tx`insert into bins (id, warehouse_id, code, kind, created_by) values
    (${f.binA}, ${hub}, 'A1', 'storage', ${exec.id}),
    (${f.binB}, ${hub}, 'B1', 'storage', ${exec.id}),
    (${f.quarantine}, ${hub}, 'Q1', 'quarantine', ${exec.id})`;
  await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active) values
    (${f.pump}, ${`XP-${tag}`}, ${`Serial moves pump ${tag}`}, 'pump', '8413', 'nos', true, true),
    (${f.cable}, ${`XC-${tag}`}, ${`Serial moves cable ${tag}`}, 'cable', '8544', 'metre', false, true)`;
  await tx`insert into accounts (id, type, name, created_by) values
    (${f.account}, 'farm', 'serial moves customer', ${exec.id}),
    (${f.otherAccount}, 'farm', 'serial moves other customer', ${exec.id})`;
  await tx`insert into account_entities (id, account_id, entity_id, created_by) values
    (${newId()}, ${f.account}, 1, ${exec.id}),
    (${newId()}, ${f.otherAccount}, 2, ${exec.id})`;
  await tx`insert into customer_sites (id, account_id, type, created_by) values
    (${f.site}, ${f.account}, 'borewell', ${exec.id}),
    (${f.otherSite}, ${f.otherAccount}, 'borewell', ${exec.id})`;
  return f;
}

type Line = Record<string, unknown>;

interface Posted {
  ids?: string[];
  code?: string;
  refusal?: string;
}

/** Posts a batch as `who` would in a request on `entityIds`; answers the ids or the refusal. */
async function post(
  tx: Tx,
  lines: Line[],
  entityIds: readonly number[] = [1, 2],
  who: Principal = exec,
): Promise<Posted> {
  await tx`select set_config('app.user_id', ${who.id}, true),
                  set_config('app.entity_ids', ${`{${entityIds.join(',')}}`}, true),
                  set_config('app.role', ${who.roleKey}, true),
                  set_config('app.permissions', ${serializeGrants(who.permissions)}, true)`;
  try {
    const rows = await tx.savepoint(
      (sp) => sp<{ ids: string[] }[]>`
        select app.stock_move(${JSON.stringify(lines)}::text::jsonb) as ids`,
    );
    return { ids: rows[0]?.ids ?? [] };
  } catch (e) {
    const failure = e as { code?: unknown; constraint_name?: unknown };
    return {
      ...(typeof failure.code === 'string' ? { code: failure.code } : {}),
      ...(typeof failure.constraint_name === 'string' ? { refusal: failure.constraint_name } : {}),
    };
  }
}

/** Posts a batch that must post, and answers its movement ids. */
async function posted(tx: Tx, lines: Line[], entityIds?: readonly number[]): Promise<string[]> {
  const outcome = await post(tx, lines, entityIds);
  expect(outcome.code, JSON.stringify(outcome)).toBeUndefined();
  return outcome.ids ?? [];
}

const refused = (refusal: string): Posted => ({ code: '23514', refusal });

interface SerialRow {
  id: string;
  state: string;
  bin: string | null;
  moved: boolean;
  account: string | null;
  site: string | null;
  delivered: string | null;
  warranty: string | null;
}

/** A serial as the table owner reads it; `moved` is whether its state changed since `LONG_AGO`. */
async function serial(tx: Tx, itemId: string, serialNo: string): Promise<SerialRow | undefined> {
  const [row] = await tx<SerialRow[]>`
    select id, state, bin_id as bin, state_changed_at > ${LONG_AGO}::timestamptz as moved,
           account_id as account, site_id as site,
           to_char(delivered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as delivered,
           warranty_until::text as warranty
      from serials where item_id = ${itemId} and lower(serial_no) = lower(${serialNo})`;
  return row;
}

/** Marks a serial's last state change as long ago, so the next movement shows whether it moved. */
async function settle(tx: Tx, itemId: string, serialNo: string): Promise<void> {
  await tx`update serials set state_changed_at = ${LONG_AGO}::timestamptz
            where item_id = ${itemId} and lower(serial_no) = lower(${serialNo})`;
}

const gain = (f: Fixture, serialNo: string, bin = f.binA): Line => ({
  reason: 'adjust_gain',
  entity_id: 1,
  item_id: f.pump,
  to_bin_id: bin,
  qty: '1',
  serial_no: serialNo,
});

const lose = (f: Fixture, serialNo: string, bin = f.binA): Line => ({
  reason: 'adjust_loss',
  entity_id: 1,
  item_id: f.pump,
  from_bin_id: bin,
  qty: '1',
  serial_no: serialNo,
});

const transfer = (f: Fixture, serialNo: string, from = f.binA, to = f.binB): Line => ({
  reason: 'transfer',
  entity_id: 1,
  item_id: f.pump,
  from_bin_id: from,
  to_bin_id: to,
  qty: '1',
  serial_no: serialNo,
});

/** A serial in stock in bin A, and one scrapped (gained then lost), with their numbers. */
async function serials(tx: Tx, f: Fixture): Promise<{ inStock: string; scrapped: string }> {
  const inStock = `IN-${f.tag}`;
  const scrapped = `SC-${f.tag}`;
  await posted(tx, [gain(f, inStock), gain(f, scrapped)]);
  await posted(tx, [lose(f, scrapped)]);
  await settle(tx, f.pump, inStock);
  await settle(tx, f.pump, scrapped);
  return { inStock, scrapped };
}

/** Reverses every company 2 opening not yet reversed, so an opening may post in this case. */
async function clearOpenings(tx: Tx): Promise<void> {
  const open = await tx<{ id: string }[]>`
    select m.id from stock_movements m
     where m.entity_id = 2 and m.reason = 'opening'
       and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`;
  if (open.length > 0) {
    await posted(
      tx,
      open.map((o) => ({ reason: 'reversal', reverses_id: o.id })),
    );
  }
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [1, 2]);
});

describe('app.stock_reason_moves, the directions and serial rules', () => {
  it('holds H1’s serial rules exactly, as H1’s rows', async () => {
    const rows = await asMigrator(
      (m) => m<(MoveRow & { opened_by: string })[]>`
        select reason, direction, reverses_reason, from_states, creates, to_state, opened_by
          from app.stock_reason_moves order by reason, direction, reverses_reason`,
    );
    const h1 = rows
      .filter((r) => r.opened_by === 'h1-stock-ledger')
      .map((r) => ({
        reason: r.reason,
        direction: r.direction,
        reverses_reason: r.reverses_reason,
        from_states: r.from_states,
        creates: r.creates,
        to_state: r.to_state,
      }));
    // H1's reversal rows are keyed by no reason: they serve a reversal of any reason.
    expect(h1).toEqual(H1_MOVES.map((m) => ({ ...m, reverses_reason: '' })));
  });

  it('refuses a row the ledger could never post', async () => {
    const attempts: [string, string, string[], boolean, string, string, string?][] = [
      // A direction the ledger has not, and a state the serial machine has not.
      ['count', 'sideways', ['in_stock'], false, 'in_stock', '23514'],
      ['receipt', 'in', ['lost'], false, 'in_stock', '23514'],
      ['receipt', 'in', ['scrapped'], false, 'lost', '23514'],
      // A new serial only into a bin; any other row moves a serial from some state.
      ['receipt', 'out', [], true, 'scrapped', '23514'],
      ['receipt', 'in', [], false, 'in_stock', '23514'],
      // Into a bin from a state in a bin; out of the company to a state in a bin; a serial taken
      // from a bin in a state that has none; a move between bins that leaves every bin.
      ['return_customer', 'in', ['in_stock'], false, 'faulty', '23514'],
      ['warranty_replacement', 'out', ['in_stock'], false, 'in_stock', '23514'],
      ['return_supplier', 'out', ['with_customer'], false, 'with_supplier', '23514'],
      ['transfer', 'transfer', ['in_stock'], false, 'scrapped', '23514'],
      // A reason with no grant row.
      ['surplus_in', 'in', ['scrapped'], false, 'in_stock', '23503'],
      // Only a reversal row is keyed by the reason it reverses, and never by the reversal itself.
      ['adjust_gain', 'in', ['scrapped'], false, 'in_stock', '23514', 'receipt'],
      ['reversal', 'out', ['in_stock'], false, 'scrapped', '23514', 'reversal'],
      ['reversal', 'out', ['in_stock'], false, 'scrapped', '23514', 'restock'],
    ];
    for (const [reason, direction, fromStates, creates, toState, code, reverses = ''] of attempts) {
      const outcome = await asMigrator(async (m) => {
        try {
          await m.begin(async (tx) => {
            await tx`insert into app.stock_reason_grants (reason, permission, opened_by)
              select r, 'inventory.stock.adjust:entity', 'x4-stock-reasons'
                from unnest(array['receipt', 'return_customer', 'warranty_replacement', 'return_supplier']) r
              on conflict (reason) do nothing`;
            await tx`delete from app.stock_reason_moves where reason = ${reason}`;
            await tx`insert into app.stock_reason_moves
                (reason, direction, reverses_reason, from_states, creates, to_state, opened_by)
              values (${reason}, ${direction}, ${reverses}, ${textArray(fromStates)}::text[], ${creates},
                      ${toState}, 'x4-stock-reasons')`;
            throw new RolledBack('the row was let in');
          });
        } catch (e) {
          return (e as { code?: unknown }).code;
        }
        return undefined;
      });
      expect({ reason, direction, reverses, fromStates, toState, code: outcome }).toEqual({
        reason,
        direction,
        reverses,
        fromStates,
        toState,
        code,
      });
    }
  });
});

describe('each of H1’s rows moves a serial as 0231 did', () => {
  it('opening in: a new number makes a serial in stock; a scrapped one comes back; one in stock is refused', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      await clearOpenings(tx);
      const ref = newId();
      const opening = (serialNo: string, entityId = 2): Line => ({
        reason: 'opening',
        entity_id: entityId,
        item_id: f.pump,
        to_bin_id: f.binA,
        qty: '1',
        serial_no: serialNo,
        ref_type: 'opening_stock',
        ref_id: ref,
      });
      const scrapped = `OS-${f.tag}`;
      const held = `OH-${f.tag}`;
      await posted(tx, [
        { ...gain(f, scrapped), entity_id: 2 },
        { ...gain(f, held), entity_id: 2 },
      ]);
      await posted(tx, [{ ...lose(f, scrapped), entity_id: 2 }]);
      await settle(tx, f.pump, scrapped);
      await posted(tx, [opening(`ON-${f.tag}`), opening(scrapped)]);
      expect(await serial(tx, f.pump, `ON-${f.tag}`)).toMatchObject({
        state: 'in_stock',
        bin: f.binA,
      });
      expect(await serial(tx, f.pump, scrapped)).toMatchObject({
        state: 'in_stock',
        bin: f.binA,
        moved: true,
      });
      expect(await post(tx, [opening(held)])).toEqual(refused('stock_serial_exists'));
      // Another company's number is taken for a new serial.
      expect(await post(tx, [opening(held, 1)])).toEqual(refused('stock_serial_exists'));
    });
  });

  it('adjust_gain in: a new number makes a serial in stock; a scrapped one comes back; one in stock is refused', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock, scrapped } = await serials(tx, f);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({ state: 'in_stock', bin: f.binA });
      await posted(tx, [gain(f, scrapped, f.binB)]);
      expect(await serial(tx, f.pump, scrapped)).toMatchObject({
        state: 'in_stock',
        bin: f.binB,
        moved: true,
      });
      expect(await post(tx, [gain(f, inStock, f.binB)])).toEqual(refused('stock_serial_exists'));
    });
  });

  it.each(['adjust_loss', 'damage'])(
    '%s out: a serial in its bin is scrapped with no bin; one elsewhere or scrapped is refused',
    async (reason) => {
      await rolledBack(async (tx) => {
        const f = await fixture(tx);
        const { inStock, scrapped } = await serials(tx, f);
        const out = (serialNo: string, bin = f.binA): Line => ({
          ...lose(f, serialNo, bin),
          reason,
        });
        expect(await post(tx, [out(inStock, f.binB)])).toEqual(refused('stock_serial_not_in_bin'));
        expect(await post(tx, [out(scrapped)])).toEqual(refused('stock_serial_not_in_bin'));
        await posted(tx, [out(inStock)]);
        expect(await serial(tx, f.pump, inStock)).toMatchObject({
          state: 'scrapped',
          bin: null,
          moved: true,
        });
        // Never a new number.
        expect(await post(tx, [out(`NEW-${f.tag}`)])).toEqual(refused('stock_serial_unknown'));
      });
    },
  );

  it('count in: a scrapped serial comes back; a new number or one in stock is refused', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock, scrapped } = await serials(tx, f);
      const count = (serialNo: string): Line => ({ ...gain(f, serialNo, f.binB), reason: 'count' });
      expect(await post(tx, [count(`NEW-${f.tag}`)])).toEqual(refused('stock_serial_unknown'));
      expect(await post(tx, [count(inStock)])).toEqual(refused('stock_serial_exists'));
      await posted(tx, [count(scrapped)]);
      expect(await serial(tx, f.pump, scrapped)).toMatchObject({
        state: 'in_stock',
        bin: f.binB,
        moved: true,
      });
    });
  });

  it('count out: a serial in its bin is scrapped; one scrapped is refused', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock, scrapped } = await serials(tx, f);
      const count = (serialNo: string): Line => ({ ...lose(f, serialNo), reason: 'count' });
      expect(await post(tx, [count(scrapped)])).toEqual(refused('stock_serial_not_in_bin'));
      await posted(tx, [count(inStock)]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'scrapped',
        bin: null,
        moved: true,
      });
    });
  });

  it('transfer: a serial in stock changes bin and keeps its state and when it last changed', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock, scrapped } = await serials(tx, f);
      expect(await post(tx, [transfer(f, inStock, f.binB, f.binA)])).toEqual(
        refused('stock_serial_not_in_bin'),
      );
      expect(await post(tx, [transfer(f, scrapped)])).toEqual(refused('stock_serial_not_in_bin'));
      await posted(tx, [transfer(f, inStock)]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'in_stock',
        bin: f.binB,
        moved: false,
      });
    });
  });

  it('reversal in: the loss reversed brings its serial back; refused once it is back another way', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock, scrapped } = await serials(tx, f);
      const [lossA] = await posted(tx, [lose(f, inStock)]);
      const lossB = await tx<{ id: string }[]>`
        select m.id from stock_movements m join serials s on s.id = m.serial_id
         where s.item_id = ${f.pump} and s.serial_no = ${scrapped} and m.reason = 'adjust_loss'`;
      await settle(tx, f.pump, inStock);
      await posted(tx, [{ reason: 'reversal', reverses_id: lossA }]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'in_stock',
        bin: f.binA,
        moved: true,
      });
      // The scrapped serial counted back in meanwhile: its loss can no longer be reversed.
      await posted(tx, [{ ...gain(f, scrapped, f.binB), reason: 'count' }]);
      expect(await post(tx, [{ reason: 'reversal', reverses_id: lossB[0]?.id }])).toEqual(
        refused('stock_serial_not_in_bin'),
      );
    });
  });

  it('reversal out: the gain reversed scraps its serial; refused once the serial left its bin', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const first = `R1-${f.tag}`;
      const second = `R2-${f.tag}`;
      const [gainFirst, gainSecond] = await posted(tx, [gain(f, first), gain(f, second)]);
      await settle(tx, f.pump, first);
      await posted(tx, [{ reason: 'reversal', reverses_id: gainFirst }]);
      expect(await serial(tx, f.pump, first)).toMatchObject({
        state: 'scrapped',
        bin: null,
        moved: true,
      });
      await posted(tx, [transfer(f, second)]);
      expect(await post(tx, [{ reason: 'reversal', reverses_id: gainSecond }])).toEqual(
        refused('stock_serial_not_in_bin'),
      );
    });
  });

  it('reversal transfer: the move reversed takes its serial back to its bin', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock } = await serials(tx, f);
      const [moved] = await posted(tx, [transfer(f, inStock)]);
      await posted(tx, [{ reason: 'reversal', reverses_id: moved }]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'in_stock',
        bin: f.binA,
        moved: false,
      });
    });
  });
});

const DIRECTIONS = ['in', 'out', 'transfer'] as const;
type Direction = (typeof DIRECTIONS)[number];

/** A line's bins for a direction: into bin B, out of bin A, or from A to B. */
const binsFor = (f: Fixture, direction: Direction): Line =>
  direction === 'in'
    ? { to_bin_id: f.binB }
    : direction === 'out'
      ? { from_bin_id: f.binA }
      : { from_bin_id: f.binA, to_bin_id: f.binB };

/** Ten metres of cable gained into bin A, so a line may take cable out of it. */
const cableStock = (f: Fixture): Line => ({
  reason: 'adjust_gain',
  entity_id: 1,
  item_id: f.cable,
  to_bin_id: f.binA,
  qty: '10',
});

/** A post of the reason on every direction, an untracked line and a tracked one, refused for its shape. */
async function refusedEveryWay(
  tx: Tx,
  f: Fixture,
  reason: string,
  serialNo: string,
  directions: readonly Direction[] = DIRECTIONS,
): Promise<void> {
  for (const direction of directions) {
    for (const item of [{ item_id: f.cable }, { item_id: f.pump, serial_no: serialNo }]) {
      const outcome = await post(tx, [
        { reason, entity_id: 1, qty: '1', ...binsFor(f, direction), ...item },
      ]);
      expect({ reason, direction, ...item, ...outcome }).toEqual({
        reason,
        direction,
        ...item,
        ...refused('stock_movement_shape'),
      });
    }
  }
}

describe('every line takes only a direction its reason has a row for', () => {
  /** H1's directions, as 0231's direction check had them. */
  const H1_DIRECTIONS: Record<string, readonly Direction[]> = {
    opening: ['in'],
    adjust_gain: ['in'],
    adjust_loss: ['out'],
    damage: ['out'],
    count: ['in', 'out'],
    transfer: ['transfer'],
  };

  it.each(Object.keys(H1_DIRECTIONS))(
    '%s: a line posts in each of 0231’s directions and is refused in the others, tracked or not',
    async (reason) => {
      await rolledBack(async (tx) => {
        const f = await fixture(tx);
        const { inStock } = await serials(tx, f);
        await posted(tx, [cableStock(f)]);
        // Opening stock goes to company 2 under one reference, as the opening rule takes it.
        await clearOpenings(tx);
        const opening =
          reason === 'opening'
            ? { entity_id: 2, ref_type: 'opening_stock', ref_id: newId() }
            : { entity_id: 1 };
        const allowed = H1_DIRECTIONS[reason] ?? [];
        for (const direction of allowed) {
          await posted(tx, [
            { reason, item_id: f.cable, qty: '1', ...binsFor(f, direction), ...opening },
          ]);
        }
        await refusedEveryWay(
          tx,
          f,
          reason,
          inStock,
          DIRECTIONS.filter((d) => !allowed.includes(d)),
        );
      });
    },
  );

  it('an opened reason is refused in a direction it has no row for, tracked or not', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock } = await serials(tx, f);
      await posted(tx, [cableStock(f)]);
      // A receipt opened as U2 names it: into a bin only.
      await tx`insert into app.stock_reason_grants (reason, permission, reversible, opened_by)
        values ('receipt', 'inventory.stock.adjust:entity', true, 'x4-stock-reasons')`;
      await tx`insert into app.stock_reason_moves (reason, direction, from_states, creates, to_state, opened_by)
        values ('receipt', 'in', '{}', true, 'in_stock', 'x4-stock-reasons')`;
      await posted(tx, [
        { reason: 'receipt', entity_id: 1, item_id: f.cable, qty: '4', ...binsFor(f, 'in') },
      ]);
      await refusedEveryWay(tx, f, 'receipt', inStock, ['out', 'transfer']);
      // A reason opened with its grant alone takes no direction at all.
      await tx`insert into app.stock_reason_grants (reason, permission, opened_by)
        values ('surplus_in', 'inventory.stock.adjust:entity', 'x4-stock-reasons')`;
      await refusedEveryWay(tx, f, 'surplus_in', inStock);
    });
  });

  it('a row taken away closes its direction, for a reversal too', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      const { inStock } = await serials(tx, f);
      const [gained] = await posted(tx, [cableStock(f)]);
      await tx`delete from app.stock_reason_moves where reason = 'count' and direction = 'out'`;
      await refusedEveryWay(tx, f, 'count', inStock, ['out']);
      await posted(tx, [
        { reason: 'count', entity_id: 1, item_id: f.cable, qty: '1', ...binsFor(f, 'in') },
      ]);
      // A gain reversed goes out of its bin: with H1's reversal row out taken away, it cannot.
      await tx`delete from app.stock_reason_moves where reason = 'reversal' and direction = 'out'`;
      expect(await post(tx, [{ reason: 'reversal', reverses_id: gained }])).toEqual(
        refused('stock_movement_shape'),
      );
      expect(await serial(tx, f.pump, inStock)).toMatchObject({ state: 'in_stock', bin: f.binA });
    });
  });
});

describe('which reasons a reversal reverses (addendum 2)', () => {
  it('a reason its grant row marks reversible, and no other', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      // A reason a later slice opens as reversible (U2's receipt), and one it opens as not.
      await tx`insert into app.stock_reason_grants (reason, permission, reversible, opened_by) values
        ('receipt', 'inventory.stock.adjust:entity', true, 'x4-stock-reasons'),
        ('surplus_in', 'inventory.stock.adjust:entity', false, 'x4-stock-reasons')`;
      await tx`insert into app.stock_reason_moves (reason, direction, from_states, creates, to_state, opened_by) values
        ('receipt', 'in', '{}', true, 'in_stock', 'x4-stock-reasons'),
        ('surplus_in', 'in', '{scrapped}', false, 'in_stock', 'x4-stock-reasons')`;
      const into = (reason: string): Line => ({
        reason,
        entity_id: 1,
        item_id: f.cable,
        to_bin_id: f.binA,
        qty: '2',
      });
      const [receipt, surplus, gained] = await posted(tx, [
        into('receipt'),
        into('surplus_in'),
        into('adjust_gain'),
      ]);
      const [reversal] = await posted(tx, [{ reason: 'reversal', reverses_id: receipt }]);
      const [{ q } = { q: '' }] = await tx<{ q: string }[]>`
        select qty_on_hand::text as q from stock_balances
         where entity_id = 1 and bin_id = ${f.binA} and item_id = ${f.cable}`;
      expect(q).toBe('4.000');
      const notAllowed = refused('stock_reversal_not_allowed');
      expect(await post(tx, [{ reason: 'reversal', reverses_id: surplus }])).toEqual(notAllowed);
      // A reversal is never reversed, as in H1.
      expect(await post(tx, [{ reason: 'reversal', reverses_id: reversal }])).toEqual(notAllowed);
      // One of H1's rows marked not reversible: its movements are no longer reversed.
      await tx`update app.stock_reason_grants set reversible = false where reason = 'adjust_gain'`;
      expect(await post(tx, [{ reason: 'reversal', reverses_id: gained }])).toEqual(notAllowed);
    });
  });
});

describe('a reversal is described by the reason it reverses', () => {
  const only = (...grants: PermissionGrant[]): Principal => ({ ...exec, permissions: grants });
  const adjust: PermissionGrant = { key: 'inventory.stock.adjust', scope: 'entity' };

  it.each(['transfer', 'adjust_gain'])(
    'H1’s %s reversed takes the reversal row’s grant, role by role, as in H1',
    async (reason) => {
      await rolledBack(async (tx) => {
        const f = await fixture(tx);
        const { inStock } = await serials(tx, f);
        const [moved] = await posted(tx, [
          reason === 'transfer' ? transfer(f, inStock) : gain(f, `RG-${f.tag}`),
        ]);
        const reverse: Line = { reason: 'reversal', reverses_id: moved };
        await posted(tx, [reverse]);
        // Reversed once already: a caller with the grant meets that, one without meets the grant.
        const holders: string[] = [];
        const others: string[] = [];
        for (const roleKey of ROLE_KEYS) {
          const who = principalFor(roleKey, [1]);
          const holds = hasGrant(who.permissions, 'inventory.stock.adjust', 'entity');
          (holds ? holders : others).push(roleKey);
          expect({ roleKey, ...(await post(tx, [reverse], [1], who)) }).toEqual({
            roleKey,
            ...(holds ? refused('stock_already_reversed') : { code: '42501' }),
          });
        }
        expect(holders.length).toBeGreaterThan(0);
        expect(others.length).toBeGreaterThan(0);
        // A transfer's own grant does not reverse it.
        expect(
          await post(tx, [reverse], [1], only({ key: 'inventory.stock.move', scope: 'entity' })),
        ).toEqual({ code: '42501' });
      });
    },
  );

  it('an opened reason with its own reversal row: reversed with that reason’s grant, by that row', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      // A receipt whose reversal sends the goods back to their supplier, under the receipt's grant.
      await tx`insert into app.stock_reason_grants (reason, permission, reversible, opened_by)
        values ('receipt', 'procurement.grn.write:entity', true, 'x4-stock-reasons')`;
      await tx`insert into app.stock_reason_moves
          (reason, direction, reverses_reason, from_states, creates, to_state, opened_by) values
        ('receipt', 'in', '', '{}', true, 'in_stock', 'x4-stock-reasons'),
        ('reversal', 'out', 'receipt', '{in_stock}', false, 'with_supplier', 'x4-stock-reasons')`;
      const receive = (item: Line): Line => ({
        reason: 'receipt',
        entity_id: 1,
        to_bin_id: f.binB,
        qty: '1',
        ...item,
      });
      const first = `RV-${f.tag}`;
      const [pumpIn, secondIn, cableIn] = await posted(tx, [
        receive({ item_id: f.pump, serial_no: first }),
        receive({ item_id: f.pump, serial_no: `RW-${f.tag}` }),
        receive({ item_id: f.cable, qty: '3' }),
      ]);
      const [gained] = await posted(tx, [gain(f, `RG-${f.tag}`)]);
      const store = only({ key: 'procurement.grn.write', scope: 'entity' });

      // The receipt's grant reverses it; the stock grant alone does not.
      expect(
        await post(tx, [{ reason: 'reversal', reverses_id: secondIn }], [1], only(adjust)),
      ).toEqual({ code: '42501' });
      await settle(tx, f.pump, first);
      expect(
        (
          await post(
            tx,
            [
              { reason: 'reversal', reverses_id: pumpIn },
              { reason: 'reversal', reverses_id: cableIn },
            ],
            [1],
            store,
          )
        ).code,
      ).toBeUndefined();
      // By the receipt's own row: back to the supplier, where H1's row would have scrapped it.
      expect(await serial(tx, f.pump, first)).toMatchObject({
        state: 'with_supplier',
        bin: null,
        moved: true,
      });
      const [{ q } = { q: '' }] = await tx<{ q: string }[]>`
        select qty_on_hand::text as q from stock_balances
         where entity_id = 1 and bin_id = ${f.binB} and item_id = ${f.cable}`;
      expect(q).toBe('0.000');
      // H1's movements keep the reversal row's grant, whoever opened the receipt.
      expect(await post(tx, [{ reason: 'reversal', reverses_id: gained }], [1], store)).toEqual({
        code: '42501',
      });
      await posted(tx, [{ reason: 'reversal', reverses_id: gained }]);
    });
  });
});

describe('the rows the wave 2 slices name, and a delivery’s customer on a line', () => {
  async function openWave2(tx: Tx): Promise<void> {
    for (const [reason, permission] of WAVE2_GRANTS) {
      await tx`insert into app.stock_reason_grants (reason, permission, opened_by)
        values (${reason}, ${permission}, 'x4-stock-reasons') on conflict (reason) do nothing`;
    }
    for (const m of WAVE2_MOVES) {
      await tx`insert into app.stock_reason_moves
          (reason, direction, from_states, creates, to_state, opened_by)
        values (${m.reason}, ${m.direction}, ${textArray(m.from_states)}::text[], ${m.creates}, ${m.to_state},
                'x4-stock-reasons')
        on conflict (reason, direction, reverses_reason) do nothing`;
    }
  }

  const replace = (f: Fixture, serialNo: string, extra: Line = {}): Line => ({
    reason: 'warranty_replacement',
    entity_id: 1,
    item_id: f.pump,
    from_bin_id: f.binA,
    qty: '1',
    serial_no: serialNo,
    ...extra,
  });
  const customer = (f: Fixture): Line => ({
    account_id: f.account,
    site_id: f.site,
    delivered_at: '2026-11-20T06:30:00Z',
    warranty_until: '2031-11-19',
  });

  it('a serial goes to a customer with the customer, comes back faulty, and goes to its supplier', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      await openWave2(tx);
      const { inStock, scrapped } = await serials(tx, f);
      await posted(tx, [replace(f, inStock, customer(f))], [1]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'with_customer',
        bin: null,
        moved: true,
        account: f.account,
        site: f.site,
        delivered: '2026-11-20T06:30:00Z',
        warranty: '2031-11-19',
      });
      expect(await post(tx, [replace(f, scrapped)])).toEqual(refused('stock_serial_not_in_bin'));

      // Back from the customer as a fault, into quarantine; the customer stays on the serial.
      const back = (serialNo: string): Line => ({
        reason: 'return_customer',
        entity_id: 1,
        item_id: f.pump,
        to_bin_id: f.quarantine,
        qty: '1',
        serial_no: serialNo,
      });
      await settle(tx, f.pump, inStock);
      await posted(tx, [back(inStock)]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'faulty',
        bin: f.quarantine,
        moved: true,
        account: f.account,
        warranty: '2031-11-19',
      });
      // A serial still in stock is in stock; one scrapped never went to a customer.
      const held = `HE-${f.tag}`;
      await posted(tx, [gain(f, held)]);
      expect(await post(tx, [back(held)])).toEqual(refused('stock_serial_exists'));
      expect(await post(tx, [back(scrapped)])).toEqual(refused('stock_serial_state'));
      // A faulty serial in its bin is not sent to a customer as a replacement.
      expect(await post(tx, [{ ...replace(f, inStock), from_bin_id: f.quarantine }])).toEqual(
        refused('stock_serial_state'),
      );

      // To the supplier: out of every bin; only from faulty.
      const toSupplier = (serialNo: string, bin: string): Line => ({
        reason: 'return_supplier',
        entity_id: 1,
        item_id: f.pump,
        from_bin_id: bin,
        qty: '1',
        serial_no: serialNo,
      });
      expect(await post(tx, [toSupplier(held, f.binA)])).toEqual(refused('stock_serial_state'));
      await posted(tx, [toSupplier(inStock, f.quarantine)]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'with_supplier',
        bin: null,
        account: f.account,
      });
    });
  });

  it('a receipt makes only new serials', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      await openWave2(tx);
      const { inStock, scrapped } = await serials(tx, f);
      const receive = (serialNo: string): Line => ({
        ...gain(f, serialNo, f.binB),
        reason: 'receipt',
      });
      await posted(tx, [receive(`RC-${f.tag}`)]);
      expect(await serial(tx, f.pump, `RC-${f.tag}`)).toMatchObject({
        state: 'in_stock',
        bin: f.binB,
      });
      expect(await post(tx, [receive(inStock)])).toEqual(refused('stock_serial_exists'));
      expect(await post(tx, [receive(scrapped)])).toEqual(refused('stock_serial_exists'));
    });
  });

  it('takes a customer only on a line whose serial goes to one, and only one the line’s company knows', async () => {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      await openWave2(tx);
      const { inStock } = await serials(tx, f);
      const shape = refused('stock_movement_shape');
      // On a gain, on an untracked item, and a site without its customer.
      expect(await post(tx, [{ ...gain(f, `CG-${f.tag}`), account_id: f.account }])).toEqual(shape);
      expect(await post(tx, [{ ...gain(f, `CW-${f.tag}`), warranty_until: '2031-11-19' }])).toEqual(
        shape,
      );
      expect(
        await post(tx, [
          {
            reason: 'warranty_replacement',
            entity_id: 1,
            item_id: f.cable,
            from_bin_id: f.binA,
            qty: '1',
            delivered_at: '2026-11-20T06:30:00Z',
          },
        ]),
      ).toEqual(shape);
      expect(await post(tx, [replace(f, inStock, { site_id: f.site })])).toEqual(shape);
      // A customer of company 2 alone, for a company 1 serial; a site of another customer.
      const missing = refused('stock_customer_missing');
      expect(await post(tx, [replace(f, inStock, { account_id: f.otherAccount })], [1])).toEqual(
        missing,
      );
      expect(
        await post(tx, [replace(f, inStock, { account_id: f.account, site_id: f.otherSite })], [1]),
      ).toEqual(missing);
      // Still refused in a request on company 2 as well: the customer must be the line's company's.
      expect(await post(tx, [replace(f, inStock, { account_id: f.otherAccount })], [1, 2])).toEqual(
        missing,
      );
      // The line's company's customer, without a site, in the same request.
      await posted(tx, [replace(f, inStock, { account_id: f.account })], [1, 2]);
      expect(await serial(tx, f.pump, inStock)).toMatchObject({
        state: 'with_customer',
        account: f.account,
        site: null,
        delivered: null,
      });
    });
  });
});
