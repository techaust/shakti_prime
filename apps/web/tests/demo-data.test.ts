import { newId, type Principal } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeDb, createTestUser, principalFor, testPhone } from '@shakti/db/testing';
import {
  executeQuery,
  listCustomers,
  listItems,
  listKitPrices,
  listKits,
  listPriceLists,
  listPrices,
  listUsers,
  loadAccount360,
  memoryKeyValue,
  memoryMailer,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { firstExecutive } from '../src/auth/operator-principal';
import {
  DemoAlreadyRemoved,
  demoSet,
  loadDemoData,
  removeDemoData,
  setPasswordLinks,
  type DemoDeps,
} from '../scripts/demo-data-loader';

// The demo data loader of the screen review (scripts/demo-data.ts) on real Postgres: `load` twice
// writes the set once, `remove` takes it off through the commands, and every list a reviewer
// opens then shows none of its items, kits, prices, open leads or live accounts. The database is
// shared with the other suites and never cleaned, so the run's tag keeps its codes, names, phones
// and addresses its own.
vi.setConfig({ testTimeout: 120_000 });

// Long enough to satisfy Better Auth, low-entropy so the secret scan does not mistake it for a key.
const TEST_AUTH_SECRET = 'test-only-secret-test-only-secret-test-only-secret';
const RUN = newId().slice(-8).toUpperCase();
const set = demoSet({
  tag: RUN,
  phone: (() => {
    const phones = Array.from({ length: 5 }, () => testPhone());
    return (index: number) => phones[index] ?? '';
  })(),
});
const forgotten: string[] = [];
let operator: Principal;
let deps: DemoDeps;

afterAll(async () => {
  await closeAuthDb();
  await closeDb();
});

beforeAll(async () => {
  const executive = await createTestUser(
    [1, 2, 3, 4].map((entityId) => ({ entityId, roleKey: 'executive' as const })),
    { twoFactorEnabled: true, name: 'Demo loader Executive' },
  );
  operator = principalFor('executive', [1, 2, 3, 4], { id: executive.id });
  deps = {
    operator,
    set,
    emailDomain: `run-${RUN.toLowerCase()}.example.com`,
    issueLink: setPasswordLinks(
      {
        keyValue: memoryKeyValue(),
        mailer: memoryMailer(),
        fetch: () => Promise.reject(new Error('no network in this test')),
        now: () => new Date(),
        turnstileSecretKey: 'secret',
      },
      { baseURL: 'http://localhost:3000', secret: TEST_AUTH_SECRET },
    ),
    forget: (userId) => {
      forgotten.push(userId);
      return Promise.resolve();
    },
    log: () => undefined,
  };
});

const read = <T>(fn: Parameters<typeof executeQuery<T>>[2], entityIds?: number[]) =>
  executeQuery(operator, entityIds === undefined ? {} : { entityIds }, fn, { name: 'demoTest' });

async function demoUsers() {
  const found = [];
  let cursor: string | undefined;
  do {
    const page = await read((ctx) =>
      listUsers(ctx, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    );
    found.push(...page.items.filter((u) => u.email.endsWith(`@${deps.emailDomain}`)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return found;
}

async function customer(name: string) {
  const page = await read((ctx) => listCustomers(ctx, { q: name, limit: 200 }));
  return page.items.filter((row) => row.name === name);
}

async function retailList(): Promise<string> {
  const lists = await read((ctx) => listPriceLists(ctx));
  const live = lists.find(
    (l) => l.tierCode === 'retail' && l.entityId === null && l.state === 'live',
  );
  if (!live) throw new Error('no live retail list');
  return live.id;
}

async function pricedOn(priceListId: string) {
  const items = await read((ctx) => listPrices(ctx, { priceListId, limit: 200 }));
  const kits = await read((ctx) => listKitPrices(ctx, { priceListId, limit: 200 }));
  return [
    ...items.items.filter((r) => r.sku.startsWith(set.codePrefix)).map((r) => [r.sku, r.price]),
    ...kits.items.filter((r) => r.sku.startsWith(set.codePrefix)).map((r) => [r.sku, r.price]),
  ];
}

describe('the demo data loader', () => {
  it('finds the first Executive who can act, as their sign-in would resolve them', async () => {
    const found = await firstExecutive();
    expect(found.kind).toBe('ready');
    if (found.kind !== 'ready') return;
    expect(found.principal.roleKey).toBe('executive');
    expect(found.principal.permissions).toContainEqual({ key: 'admin.users.write', scope: 'all' });
  });

  it('loads the set once: a second load changes nothing', async () => {
    const first = await loadDemoData(deps);
    expect(first.writes).toBeGreaterThan(0);
    expect(first.accounts).toHaveLength(11);
    for (const account of first.accounts) {
      expect(account.link).toMatch(/^http:\/\/localhost:3000\/.+/);
    }

    const second = await loadDemoData(deps);
    expect(second.writes).toBe(0);
    expect(second.accounts.map((a) => a.link)).toEqual(Array.from({ length: 11 }, () => undefined));

    // Links lost before the session: a fresh one each, and still nothing written by a command.
    const fresh = await loadDemoData({ ...deps, newLinks: true });
    expect(fresh.writes).toBe(0);
    for (const account of fresh.accounts) {
      expect(account.link).toMatch(/^http:\/\/localhost:3000\/.+/);
    }
  });

  it('puts the items, kits and prices, the customers and one account per role in place', async () => {
    const items = await read((ctx) => listItems(ctx, { q: set.codePrefix, limit: 200 }));
    expect(items.items.filter((i) => i.sku.startsWith(set.codePrefix))).toHaveLength(9);
    const kits = await read((ctx) => listKits(ctx, { q: set.codePrefix, limit: 200 }));
    expect(kits.items.filter((k) => k.sku.startsWith(set.codePrefix))).toHaveLength(3);
    for (const thing of [...items.items, ...kits.items]) expect(thing.name).toMatch(/\(demo\)$/);

    const prices = new Map((await pricedOn(await retailList())) as [string, string | null][]);
    expect(prices.get(`${set.codePrefix}KIT-5HP`)).toBe('285000.00');
    expect(prices.get(`${set.codePrefix}PUMP-3HP`)).toBe('31000.00');
    expect(prices.size).toBe(12);

    const bhanwar = set.customers[0];
    if (!bhanwar) throw new Error('the set has no customers');
    const rows = await customer(bhanwar.name);
    expect(rows.map((r) => r.entityId).sort()).toEqual([1, 3]);
    const view = await read(
      (ctx) => loadAccount360(ctx, { accountId: rows[0]?.accountId ?? '', entityId: 1 }),
      [1],
    );
    expect(view.leads).toHaveLength(1);
    expect(view.leads[0]?.stageName).toBe('Qualified');
    expect(view.sites[0]?.tehsil).toBe('Chomu');
    expect(view.timeline.items.some((a) => a.body === bhanwar.note)).toBe(true);
    expect(view.consents).toHaveLength(1);
    expect(view.account.tierName).toBeTruthy();

    const users = await demoUsers();
    expect(users).toHaveLength(11);
    expect(new Set(users.map((u) => u.entityRoles[0]?.roleKey)).size).toBe(11);
    for (const user of users) {
      expect(user.status).toBe('invited');
      expect(user.displayName).toMatch(/\(demo\)$/);
    }
  });

  it('removes the set through the commands, and every list then shows none of it', async () => {
    const removed = await removeDemoData(deps);
    expect(removed.writes).toBeGreaterThan(0);

    // Catalogue and Price lists: no demo item, kit or price.
    const items = await read((ctx) => listItems(ctx, { q: set.codePrefix, limit: 200 }));
    expect(items.items.filter((i) => i.sku.startsWith(set.codePrefix))).toEqual([]);
    const kits = await read((ctx) => listKits(ctx, { q: set.codePrefix, limit: 200 }));
    expect(kits.items.filter((k) => k.sku.startsWith(set.codePrefix))).toEqual([]);
    expect(await pricedOn(await retailList())).toEqual([]);

    // Leads: every demo lead is closed, its tasks cancelled, the consent withdrawn.
    for (const c of set.customers) {
      for (const row of await customer(c.name)) {
        const view = await read(
          (ctx) => loadAccount360(ctx, { accountId: row.accountId, entityId: row.entityId }),
          [row.entityId],
        );
        expect(view.leads.map((l) => l.state)).toEqual(view.leads.map(() => 'lost'));
        expect(view.tasks.filter((t) => t.state === 'open')).toEqual([]);
        expect(view.consents.filter((k) => k.withdrawnAt === null)).toEqual([]);
      }
    }

    // Team members: every demo account is switched off and its cached access dropped.
    const users = await demoUsers();
    expect(users.map((u) => u.status)).toEqual(users.map(() => 'suspended'));
    expect(new Set(forgotten)).toEqual(new Set(users.map((u) => u.id)));
  });

  it('keeps the customers, marked as demo data: no command archives a customer', async () => {
    for (const c of set.customers) {
      const rows = await customer(c.name);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row.name).toMatch(/\(demo\)$/);
    }
  });

  it('removes nothing more a second time, and refuses to load a removed set again', async () => {
    expect((await removeDemoData(deps)).writes).toBe(0);
    await expect(loadDemoData(deps)).rejects.toBeInstanceOf(DemoAlreadyRemoved);
  });
});
