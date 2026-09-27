import type { Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  catalogueFixture,
  closeDb,
  createTestPrincipal,
  principalFor,
  type CatalogueFixture,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { setCompositeRule } from '../../src/commands/tax/set-composite-rule';
import { setTaxRate } from '../../src/commands/tax/set-tax-rate';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// Tax rows are shared by every company and the suites never clean shared tables, so each test
// uses its own HSN code or its own dates on a segment the catalogue fixture leaves alone, and
// everything it writes is removed afterwards: the catalogue scope test reads these tables whole.
const SEGMENT = 'dealer_wholesale';
const created = { rates: new Set<string>(), rules: new Set<string>() };

let accounts: Principal;
let fx: CatalogueFixture;

beforeAll(async () => {
  fx = await catalogueFixture();
  accounts = await createTestPrincipal('accounts', [1]);
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from tax_rates where id = any(${[...created.rates]}::uuid[])`;
    await m`delete from composite_supply_rules where id = any(${[...created.rules]}::uuid[])`;
  });
  await closeDb();
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

async function rate(principal: Principal, input: Record<string, unknown>) {
  const row = (await run(principal, setTaxRate, input)) as { id: string };
  created.rates.add(row.id);
  return row;
}

async function rule(principal: Principal, input: Record<string, unknown>) {
  const row = (await run(principal, setCompositeRule, input)) as { id: string };
  created.rules.add(row.id);
  return row;
}

/** An HSN code no earlier run used. */
function hsn(): string {
  return String(10_000_000 + Math.floor(Math.random() * 89_999_999));
}

/** `YYYY-MM-DD`, `days` after a random day far from any real or fixture period. */
function dates(): (days: number) => string {
  const start = Date.UTC(3000 + Math.floor(Math.random() * 5000), 0, 1);
  return (days) => new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

async function effectiveTo(table: 'tax_rates' | 'composite_supply_rules', id: string) {
  const rows = await asMigrator((m) =>
    table === 'tax_rates'
      ? m<{ to: string | null }[]>`select effective_to::text as to from tax_rates where id = ${id}`
      : m<{ to: string | null }[]>`
          select effective_to::text as to from composite_supply_rules where id = ${id}`,
  );
  return rows[0]?.to;
}

describe('tax.rate.set', () => {
  it('is denied to a role without tax.rates.write, and to an agent', async () => {
    const day = dates();
    for (const role of ['tele_caller_cc', 'agent:sizing'] as const) {
      // No principals row: an agent row would change the agent count fail-closed.test.ts checks.
      const principal = principalFor(role, [1]);
      await expect(
        run(principal, setTaxRate, { hsn: hsn(), ratePct: '18.00', effectiveFrom: day(0) }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('records a rate from a date and ends the open rate before it, audited for no one company', async () => {
    const code = hsn();
    const day = dates();
    const first = await rate(accounts, { hsn: code, ratePct: '12.00', effectiveFrom: day(0) });
    const recorded = memoryAuditSink();
    const second = await asPrincipal(accounts, (context) =>
      runCommand(
        setTaxRate,
        { context, audit: recorded, outbox },
        { hsn: code, ratePct: '5.00', effectiveFrom: day(30), sourceRef: 'notification 9/2025' },
      ),
    );
    created.rates.add(second.id);
    expect(second).toEqual({
      id: second.id,
      hsn: code,
      itemId: null,
      ratePct: '5.00',
      effectiveFrom: day(30),
      effectiveTo: null,
    });
    expect(await effectiveTo('tax_rates', first.id)).toBe(day(30));
    expect(recorded.records.map((r) => [r.aggregateId, r.entityId])).toEqual([
      [first.id, null],
      [second.id, null],
    ]);
  });

  it('a rate set by Accounts of one company applies to every company', async () => {
    const other = await createTestPrincipal('accounts', [2]);
    const row = await rate(other, { hsn: hsn(), ratePct: '18.00', effectiveFrom: dates()(0) });
    const seen = await asPrincipal(
      await createTestPrincipal('tele_caller_cc', [1]),
      async ({ tx }) =>
        (await tx.execute(sql`select id from tax_rates where id = ${row.id}`)) as unknown as {
          id: string;
        }[],
    );
    expect(seen.map((r) => r.id)).toEqual([row.id]);
  });

  it('refuses an overlapping period with tax_rate_overlap and changes nothing', async () => {
    const code = hsn();
    const day = dates();
    const open = await rate(accounts, { hsn: code, ratePct: '12.00', effectiveFrom: day(10) });
    await expect(
      run(accounts, setTaxRate, { hsn: code, ratePct: '18.00', effectiveFrom: day(10) }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'tax_rate_overlap' } });
    await expect(
      run(accounts, setTaxRate, {
        hsn: code,
        ratePct: '18.00',
        effectiveFrom: day(0),
        effectiveTo: day(20),
      }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'tax_rate_overlap' } });
    expect(await effectiveTo('tax_rates', open.id)).toBeNull();
  });

  it('sets the rate of one item, and refuses an item that does not exist', async () => {
    const day = dates();
    await expect(
      rate(accounts, { itemId: fx.items.cable, ratePct: '18.00', effectiveFrom: day(0) }),
    ).resolves.toMatchObject({ itemId: fx.items.cable, hsn: null });
    await expect(
      run(accounts, setTaxRate, {
        itemId: '01990000-0000-7000-8000-00000000dead',
        ratePct: '18.00',
        effectiveFrom: day(0),
      }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'tax_item_missing' } });
  });

  it('rejects both or neither target, a rate above 100, a date that does not exist and an end before the start', async () => {
    const day = dates();
    for (const input of [
      { ratePct: '18.00', effectiveFrom: day(0) },
      { hsn: hsn(), itemId: fx.items.cable, ratePct: '18.00', effectiveFrom: day(0) },
      { hsn: hsn(), ratePct: '118.00', effectiveFrom: day(0) },
      { hsn: hsn(), ratePct: '18.00', effectiveFrom: '2026-02-30' },
      { hsn: hsn(), ratePct: '18.00', effectiveFrom: day(5), effectiveTo: day(5) },
    ]) {
      await expect(run(accounts, setTaxRate, input)).rejects.toMatchObject({
        code: 'validation_failed',
      });
    }
  });
});

describe('tax.composite.set', () => {
  it('is denied to a role without tax.rates.write', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      run(gm, setCompositeRule, {
        segment: SEGMENT,
        goodsSharePct: '70.00',
        servicesSharePct: '30.00',
        goodsRatePct: '5.00',
        servicesRatePct: '18.00',
        effectiveFrom: dates()(0),
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('records a split from a date, ends the open one before it and refuses an overlap', async () => {
    const day = dates();
    const split = {
      segment: SEGMENT,
      goodsSharePct: '70.00',
      servicesSharePct: '30.00',
      goodsRatePct: '5.00',
      servicesRatePct: '18.00',
    };
    const first = await rule(accounts, { ...split, effectiveFrom: day(0) });
    const second = await rule(accounts, {
      ...split,
      goodsSharePct: '60.00',
      servicesSharePct: '40.00',
      effectiveFrom: day(10),
    });
    expect(second).toMatchObject({ goodsSharePct: '60.00', effectiveTo: null });
    expect(await effectiveTo('composite_supply_rules', first.id)).toBe(day(10));
    await expect(
      run(accounts, setCompositeRule, { ...split, effectiveFrom: day(10) }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'composite_rule_overlap' },
    });
    // Close the open split so no later run or suite meets an open period on this segment.
    await rule(accounts, { ...split, effectiveFrom: day(20), effectiveTo: day(30) });
    expect(await effectiveTo('composite_supply_rules', second.id)).toBe(day(20));
  });

  it('rejects shares that do not add up to 100', async () => {
    await expect(
      run(accounts, setCompositeRule, {
        segment: SEGMENT,
        goodsSharePct: '70.00',
        servicesSharePct: '20.00',
        goodsRatePct: '5.00',
        servicesRatePct: '18.00',
        effectiveFrom: dates()(0),
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
