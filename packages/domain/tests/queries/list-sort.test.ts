import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listUsers } from '../../src/queries/admin/list-users';
import { listLeads } from '../../src/queries/crm/list-leads';
import { listImportJobs } from '../../src/queries/imports/import-queries';
import { encodeCursor } from '../../src/queries/parse-input';
import { listPrices } from '../../src/queries/pricing/list-prices';

afterAll(closeDb);

/*
 * Every sortable column of the four grids, read over a page boundary in both directions. The
 * suites never clean up, so each list also holds earlier runs' rows: this run's values are made
 * to sit together in each order (a random tag for names, a random range for counts and times),
 * and the reading starts from a position just before them, as a cursor would.
 */
const tag = `srt${newId().slice(-12)}`;
const MIN_ID = '00000000-0000-7000-8000-000000000000';
const MAX_ID = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
/** A count range no other run uses. */
const base = 100_000_000 + Math.floor(Math.random() * 800_000_000);
/**
 * A day in the last century no other run uses, as epoch milliseconds: in the past, so these rows
 * never come first in a list other suites read newest first.
 */
const day = Date.UTC(1900, 0, 1) + Math.floor(Math.random() * 36_000) * 86_400_000;
const when = (seconds: number) => new Date(day + seconds * 1000).toISOString();

type Direction = 'asc' | 'desc';
/** A cursor that starts the list at `v`: before this run's rows going up, after them going down. */
const from = (column: string, direction: Direction, v: string | null, id?: string) =>
  encodeCursor({
    s: `${column}.${direction}`,
    v,
    id: id ?? (direction === 'asc' ? MIN_ID : MAX_ID),
  });

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** The first page after `start` and the page after it, joined: the rows either side of a boundary. */
async function twoPages<T>(
  read: (cursor: string | undefined) => Promise<Page<T>>,
  start?: string,
): Promise<T[]> {
  const first = await read(start);
  if (first.nextCursor === null) return first.items;
  const second = await read(first.nextCursor);
  return [...first.items, ...second.items];
}

/**
 * Pages from `start` until every row of `wanted` has been read, for an order where rows of
 * other suites running at the same time may fall between this run's rows.
 */
async function walk<T>(
  read: (cursor: string | undefined) => Promise<Page<T>>,
  start: string,
  id: (row: T) => string,
  wanted: readonly string[],
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined = start;
  for (let pages = 0; cursor !== undefined && pages < 100; pages += 1) {
    const page: Page<T> = await read(cursor);
    rows.push(...page.items);
    if (wanted.every((w) => rows.some((r) => id(r) === w))) break;
    cursor = page.nextCursor ?? undefined;
  }
  return rows;
}

describe('listLeads sort', () => {
  let owner: Principal;
  let ids: string[];

  beforeAll(async () => {
    owner = await createTestPrincipal('tele_caller_cc', [1]);
    ids = [];
    for (const name of ['first', 'second', 'third']) {
      const lead = await asPrincipal(owner, (context) =>
        runCommand(
          createLead,
          { context, audit, outbox },
          {
            entityId: 1,
            pipelineKey: 'farmer_pumps',
            contact: {
              name: `${tag} ${name}`,
              phone: `93${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`,
            },
            account: { type: 'farm' },
          },
        ),
      );
      ids.push(lead.id);
    }
  });

  const read = (direction: Direction | undefined) => (cursor: string | undefined) =>
    asPrincipal(owner, (ctx) =>
      listLeads(ctx, {
        limit: 2,
        cursor,
        sort: direction === undefined ? undefined : { column: 'updated', direction },
      }),
    );

  it('reads the last change oldest or newest first across pages, newest by default', async () => {
    const order = async (d: Direction | undefined) => (await twoPages(read(d))).map((l) => l.id);
    expect(await order('asc')).toEqual(ids);
    expect(await order('desc')).toEqual([...ids].reverse());
    expect(await order(undefined)).toEqual([...ids].reverse());
  });

  it('refuses a cursor made for another order', async () => {
    const page = await read('asc')(undefined);
    await expect(read('desc')(page.nextCursor ?? undefined)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('listUsers sort', () => {
  // a, b and c sign in at this run's times; d has never signed in. c and d use an authenticator.
  const people: Record<'a' | 'b' | 'c' | 'd', string> = { a: '', b: '', c: '', d: '' };
  let before: string;

  beforeAll(async () => {
    before = newId();
    const specs = [
      ['a', 0, false],
      ['b', 60, false],
      ['c', 120, true],
      ['d', null, true],
    ] as const;
    for (const [key, seconds, twoFactor] of specs) {
      const user = await createTestUser([{ entityId: 1, roleKey: 'accounts' }], {
        name: `${tag} ${key}`,
        twoFactorEnabled: twoFactor,
      });
      people[key] = user.id;
      await asMigrator(
        (m) =>
          m`update users set email = ${`${tag}-${key}@shakti.test`},
            last_login_at = ${seconds === null ? null : when(seconds)} where id = ${user.id}`,
      );
    }
  });

  const read =
    (column: 'name' | 'email' | 'authenticator' | 'lastSignIn', direction: Direction) =>
    (cursor: string | undefined) =>
      asPrincipal(principalFor('executive', [1]), (ctx) =>
        listUsers(ctx, { limit: 2, cursor, sort: { column, direction } }),
      );
  const ids = (rows: { id: string }[], n = 3) => rows.slice(0, n).map((u) => u.id);
  const userId = (u: { id: string }) => u.id;
  const mine = (rows: { id: string }[]) =>
    rows.map((u) => u.id).filter((id) => Object.values(people).includes(id));

  it('sorts by name and by email both ways, across a page boundary', async () => {
    for (const column of ['name', 'email'] as const) {
      const low = column === 'name' ? tag : `${tag}-`;
      const up = await twoPages(read(column, 'asc'), from(column, 'asc', low));
      expect(ids(up, 4)).toEqual([people.a, people.b, people.c, people.d]);
      const high = column === 'name' ? `${tag} z` : `${tag}-z`;
      const down = await twoPages(read(column, 'desc'), from(column, 'desc', high));
      expect(ids(down, 4)).toEqual([people.d, people.c, people.b, people.a]);
    }
  });

  it('sorts by last sign-in both ways, with never signed in last either way', async () => {
    const up = await twoPages(read('lastSignIn', 'asc'), from('lastSignIn', 'asc', when(-1)));
    expect(ids(up)).toEqual([people.a, people.b, people.c]);
    const down = await twoPages(read('lastSignIn', 'desc'), from('lastSignIn', 'desc', when(3600)));
    expect(ids(down)).toEqual([people.c, people.b, people.a]);
    // After the last date come the people who never signed in, in either direction.
    for (const direction of ['asc', 'desc'] as const) {
      const edge = direction === 'asc' ? '9999-12-31T00:00:00Z' : '0001-01-01T00:00:00Z';
      const after = await read('lastSignIn', direction)(from('lastSignIn', direction, edge));
      expect(after.items.length).toBeGreaterThan(0);
      expect(after.items.every((u) => u.lastLoginAt === null)).toBe(true);
    }
    // Among them the order is by id, and a cursor on an empty value continues it.
    const empty = await walk(
      read('lastSignIn', 'asc'),
      from('lastSignIn', 'asc', null, before),
      userId,
      [people.d],
    );
    expect(empty.every((u) => u.lastLoginAt === null)).toBe(true);
    expect(mine(empty)).toEqual([people.d]);
  });

  it('sorts by authenticator both ways, by id within each', async () => {
    // Those without one first going up: this run's two, oldest first.
    const off = await walk(
      read('authenticator', 'asc'),
      from('authenticator', 'asc', 'false', before),
      userId,
      [people.a, people.b],
    );
    expect(mine(off)).toEqual([people.a, people.b]);
    expect(off.every((u) => !u.twoFactorEnabled)).toBe(true);
    // Those with one first going down: this run's two, newest first.
    const on = await walk(
      read('authenticator', 'desc'),
      from('authenticator', 'desc', 'true'),
      userId,
      [people.c, people.d],
    );
    expect(mine(on)).toEqual([people.d, people.c]);
    expect(on.every((u) => u.twoFactorEnabled)).toBe(true);
    // Past the last of one value come the others.
    const pastOff = await read(
      'authenticator',
      'asc',
    )(from('authenticator', 'asc', 'false', MAX_ID));
    expect(pastOff.items.every((u) => u.twoFactorEnabled)).toBe(true);
    const pastOn = await read(
      'authenticator',
      'desc',
    )(from('authenticator', 'desc', 'true', MIN_ID));
    expect(pastOn.items.every((u) => !u.twoFactorEnabled)).toBe(true);
  });
});

describe('listPrices sort', () => {
  const list = newId();
  const tier = newId();
  // Three priced items (x, y, z) in a different order for each column, and one not priced.
  const item = { x: newId(), y: newId(), z: newId(), bare: newId() };

  beforeAll(async () => {
    await asMigrator((m) =>
      m.begin(async (tx) => {
        const rows = [
          [item.x, `${tag}-3`, `${tag} b`, `${tag} c`],
          [item.y, `${tag}-1`, `${tag} c`, `${tag} a`],
          [item.z, `${tag}-2`, `${tag} a`, `${tag} b`],
          [item.bare, `${tag}-4`, `${tag} d`, `${tag} d`],
        ] as const;
        for (const [id, sku, name, category] of rows) {
          await tx`insert into items (id, sku, name, category, hsn, unit)
            values (${id}, ${sku}, ${name}, ${category}, '8413', 'nos')`;
        }
        await tx`insert into price_tiers (id, code, name) values (${tier}, ${`list_sort_${tag}`}, ${`list sort ${tag}`})`;
        await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from)
          values (${list}, ${tier}, 1, 1, '2026-04-01')`;
        const signer = newId();
        await tx`insert into principals (id, kind, display_name) values (${signer}, 'user', 'list sort signer')`;
        // Prices y < x < z; dates z < y < x.
        const priced = [
          [item.x, '1500.00', when(120)],
          [item.y, '250.50', when(60)],
          [item.z, '99999.99', when(0)],
        ] as const;
        for (const [itemId, price, at] of priced) {
          await tx`insert into price_list_items (id, price_list_id, item_id, price, created_by, updated_at)
            values (${newId()}, ${list}, ${itemId}, ${price}, ${signer}, ${at})`;
        }
      }),
    );
  });

  const read =
    (column: 'item' | 'code' | 'category' | 'price' | 'updated', direction: Direction) =>
    (cursor: string | undefined) =>
      asPrincipal(principalFor('accounts', [1]), (ctx) =>
        listPrices(ctx, { priceListId: list, limit: 2, cursor, sort: { column, direction } }),
      );
  const ids = (rows: { itemId: string }[]) => rows.slice(0, 3).map((r) => r.itemId);

  it('sorts by item, code and category both ways, across a page boundary', async () => {
    const expected = {
      item: [item.z, item.x, item.y],
      code: [item.y, item.z, item.x],
      category: [item.y, item.z, item.x],
    };
    for (const column of ['item', 'code', 'category'] as const) {
      const low = column === 'code' ? `${tag}-` : tag;
      const high = column === 'code' ? `${tag}-9` : `${tag} z`;
      const up = await twoPages(read(column, 'asc'), from(column, 'asc', low));
      expect(ids(up)).toEqual(expected[column]);
      // Going down from above this run's items, the item not priced comes first.
      const down = await twoPages(read(column, 'desc'), from(column, 'desc', high));
      expect(down.slice(0, 4).map((r) => r.itemId)).toEqual([
        item.bare,
        ...[...expected[column]].reverse(),
      ]);
    }
  });

  it('sorts by price and by its date both ways, with items not priced last', async () => {
    const expected = { price: [item.y, item.x, item.z], updated: [item.z, item.y, item.x] };
    for (const column of ['price', 'updated'] as const) {
      const up = await twoPages(read(column, 'asc'));
      expect(ids(up)).toEqual(expected[column]);
      expect(up[3]?.price).toBeNull();
      const down = await twoPages(read(column, 'desc'));
      expect(ids(down)).toEqual([...expected[column]].reverse());
      expect(down[3]?.price).toBeNull();
    }
  });
});

describe('listImportJobs sort', () => {
  // Three jobs: a still waiting for its columns (no valid count yet), b checked, c added.
  const beforeJobs = newId();
  const job = { a: newId(), b: newId(), c: newId() };
  let gm: Principal;

  beforeAll(async () => {
    gm = await createTestPrincipal('general_manager', [1]);
    await asMigrator((m) =>
      m.begin(async (tx) => {
        const specs = [
          // key, file name, starter, state, total, valid, committed, started
          [job.a, `${tag} c.csv`, `${tag} b`, 'uploaded', base + 3, 0, 0, when(60)],
          [job.b, `${tag} a.csv`, `${tag} c`, 'previewed', base + 1, base + 1, base + 1, when(0)],
          [job.c, `${tag} b.csv`, `${tag} a`, 'committed', base + 2, base + 2, base + 2, when(120)],
        ] as const;
        for (const [id, fileName, starter, state, total, valid, committed, started] of specs) {
          const file = newId();
          const person = newId();
          await tx`insert into principals (id, kind, display_name) values (${person}, 'user', ${starter})`;
          await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
            values (${file}, 1, 'import', 'memory', ${`imports/1/${file}`}, ${fileName}, 'text/csv', 10,
                    ${'0'.repeat(64)}, 'ready', ${person})`;
          await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
              total_rows, valid_rows, committed_rows, created_at, created_by)
            values (${id}, 1, 'leads', ${file}, 'csv', '[]'::jsonb, ${state},
                    ${total}, ${valid}, ${committed}, ${started}, ${person})`;
        }
      }),
    );
  });

  type Column = 'file' | 'total' | 'valid' | 'committed' | 'startedBy' | 'started';
  const read =
    (column: Column, direction: Direction, limit = 2) =>
    (cursor: string | undefined) =>
      asPrincipal(gm, (ctx) =>
        listImportJobs(ctx, { entityId: 1, limit, cursor, sort: { column, direction } }),
      );

  const cases: {
    column: Column;
    low: string;
    high: string;
    order: string[];
  }[] = [
    { column: 'file', low: tag, high: `${tag} z`, order: [job.b, job.c, job.a] },
    { column: 'startedBy', low: tag, high: `${tag} z`, order: [job.c, job.a, job.b] },
    {
      column: 'total',
      low: String(base),
      high: String(base + 10),
      order: [job.b, job.c, job.a],
    },
    { column: 'started', low: when(-1), high: when(3600), order: [job.b, job.a, job.c] },
  ];

  it('sorts by file, starter, total and start both ways, across a page boundary', async () => {
    for (const { column, low, high, order } of cases) {
      const up = await twoPages(read(column, 'asc'), from(column, 'asc', low));
      expect(up.slice(0, 3).map((j) => j.id)).toEqual(order);
      const down = await twoPages(read(column, 'desc'), from(column, 'desc', high));
      expect(down.slice(0, 3).map((j) => j.id)).toEqual([...order].reverse());
    }
  });

  it('sorts by valid and added counts both ways, with a count not known yet last', async () => {
    for (const column of ['valid', 'committed'] as const) {
      const up = await twoPages(read(column, 'asc', 1), from(column, 'asc', String(base)));
      expect(up.map((j) => j.id)).toEqual([job.b, job.c]);
      const down = await twoPages(read(column, 'desc', 1), from(column, 'desc', String(base + 10)));
      expect(down.map((j) => j.id)).toEqual([job.c, job.b]);
    }
    // The job whose rows are not checked yet has no valid count: it sits with the empty ones.
    const empty = await walk(
      read('valid', 'asc'),
      from('valid', 'asc', null, beforeJobs),
      (j) => j.id,
      [job.a],
    );
    expect(empty.map((j) => j.id)).toContain(job.a);
    expect(empty.every((j) => j.state === 'uploaded' || j.state === 'mapped')).toBe(true);
  });
});
