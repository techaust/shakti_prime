import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { approvePriceList, createPriceList } from '../../src/commands/pricing/price-lists';
import { setPrice } from '../../src/commands/pricing/set-price';
import { istCalendarDate } from '../../src/numbering/financial-year';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { listPriceLists } from '../../src/queries/pricing/list-prices';

// Approved lists are never cleaned and one live list per tier and company is allowed on any day,
// so this file works on a tier of its own, made for the run and archived afterwards.
const tag = newId().slice(-8);
const tier = { id: newId(), code: `t_${tag}` };
const ids = { item: newId(), kit: newId(), archivedItem: newId() };
const today = istCalendarDate(new Date());
const day = (n: number) =>
  new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let exec: Principal;

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${tier.id}, ${tier.code}, ${`Test tier ${tag}`})`;
      await tx`insert into items (id, sku, name, category, hsn) values
        (${ids.item}, ${`PL-${tag}-A`}, 'price list item', 'pump', '8413'),
        (${ids.archivedItem}, ${`PL-${tag}-B`}, 'price list archived item', 'cable', '8544')`;
      await tx`insert into kits (id, sku, name) values (${ids.kit}, ${`PL-${tag}-K`}, 'price list kit')`;
    }),
  );
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`update price_lists set archived_at = now() where tier_id = ${tier.id} and archived_at is null`;
    await m`update price_tiers set is_active = false, archived_at = now() where id = ${tier.id}`;
  });
  await closeDb();
});

interface ListOut {
  id: string;
  state: string;
  version: number;
  entityId: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedAt: string | null;
}

function run<T = ListOut>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  now?: Date,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, ...(now ? { now } : {}) }, input),
  ) as Promise<T>;
}

async function listRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ effective_to: string | null; approved_by: string | null }[]>`
      select effective_to::text, approved_by from price_lists where id = ${id}`,
  );
  return row;
}

async function pricesOf(listId: string) {
  return asMigrator(
    (m) => m<{ item_id: string | null; kit_id: string | null; price: string }[]>`
      select item_id, kit_id, price::text from price_list_items where price_list_id = ${listId}
       order by item_id nulls last`,
  );
}

describe('pricing.list.create', () => {
  it('is denied to a role without pricing.write, and to an agent', async () => {
    for (const roleKey of ['general_manager', 'accounts', 'agent:sizing'] as const) {
      await expect(
        run(principalFor(roleKey), createPriceList, { tierCode: tier.code, effectiveFrom: today }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a company outside the request, and a group list unless the request covers every company', async () => {
    const narrow = await createTestPrincipal('executive', [1]);
    await expect(
      run(narrow, createPriceList, { tierCode: tier.code, entityId: 2, effectiveFrom: today }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(narrow, createPriceList, { tierCode: tier.code, effectiveFrom: today }),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'price_list_group_scope' } });
  });

  it('refuses a start date in the past and an unknown tier', async () => {
    await expect(
      run(exec, createPriceList, { tierCode: tier.code, effectiveFrom: day(-1) }),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'price_list_start_past' } });
    await expect(
      run(exec, createPriceList, { tierCode: `none_${tag}`, effectiveFrom: today }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'price_tier_missing' } });
  });
});

describe('a tier from its first list to a scheduled second one', () => {
  it('drafts, prices, approves, copies and schedules, each change audited', async () => {
    // 1. The first group list: a draft with nothing to copy.
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const first = await asPrincipal(exec, (context) =>
      runCommand(
        createPriceList,
        { context, audit: recorded, outbox: emitted },
        { tierCode: tier.code, effectiveFrom: today },
      ),
    );
    expect(first).toMatchObject({
      version: 1,
      entityId: null,
      state: 'draft',
      approvedAt: null,
      open: true,
    });
    expect(recorded.records).toEqual([
      expect.objectContaining({ command: 'pricing.list.create', entityId: null }),
    ]);
    expect(emitted.records).toEqual([
      expect.objectContaining({
        type: 'pricing.list.created',
        payload: { tierCode: tier.code, copiedFromId: null, prices: 0, v: 1 },
      }),
    ]);

    // 2. Prices go on the draft, for an item, a kit and an item later archived.
    for (const target of [
      { itemId: ids.item, price: '1000.00' },
      { kitId: ids.kit, price: '5000.00' },
      { itemId: ids.archivedItem, price: '10.00' },
    ]) {
      await run(exec, setPrice, { priceListId: first.id, ...target });
    }
    await asMigrator(
      (m) =>
        m`update items set is_active = false, archived_at = now() where id = ${ids.archivedItem}`,
    );

    // 3. Approval makes it live from today and records who approved it.
    const live = await run(exec, approvePriceList, { priceListId: first.id });
    expect(live).toMatchObject({ state: 'live', effectiveTo: null });
    expect(live.approvedAt).not.toBeNull();
    expect((await listRow(first.id))?.approved_by).toBe(exec.id);
    await expect(run(exec, approvePriceList, { priceListId: first.id })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'price_list_approved' },
    });

    // 4. The next version copies the live prices of items and kits still sold.
    const second = await run(exec, createPriceList, {
      tierCode: tier.code,
      effectiveFrom: day(10),
    });
    expect(second).toMatchObject({ version: 2, state: 'draft' });
    expect(await pricesOf(second.id)).toEqual([
      { item_id: ids.item, kit_id: null, price: '1000.00' },
      { item_id: null, kit_id: ids.kit, price: '5000.00' },
    ]);
    await run(exec, setPrice, {
      priceListId: second.id,
      itemId: ids.item,
      price: '1100.00',
      reason: 'new season',
    });
    // The draft prices nothing yet: the live list keeps its price.
    expect((await pricesOf(first.id))[0]?.price).toBe('1000.00');

    // 5. Approving the second ends the first where it starts; it is scheduled until then.
    const approvals = memoryOutboxSink();
    const scheduled = await asPrincipal(exec, (context) =>
      runCommand(
        approvePriceList,
        { context, audit, outbox: approvals },
        { priceListId: second.id },
      ),
    );
    expect(scheduled).toMatchObject({ state: 'scheduled', effectiveTo: null });
    expect((await listRow(first.id))?.effective_to).toBe(day(10));
    expect(approvals.records).toEqual([
      expect.objectContaining({
        type: 'pricing.list.approved',
        payload: { tierCode: tier.code, closedListIds: [first.id], v: 1 },
      }),
    ]);

    // 6. A draft approved for a date before the scheduled one ends where the scheduled one starts.
    const between = await run(exec, createPriceList, {
      tierCode: tier.code,
      effectiveFrom: day(5),
    });
    const approvedBetween = await run(exec, approvePriceList, { priceListId: between.id });
    expect(approvedBetween).toMatchObject({ state: 'scheduled', effectiveTo: day(10) });
    expect((await listRow(first.id))?.effective_to).toBe(day(5));

    // 7. A draft for the same start as an approved list cannot be approved.
    const clash = await run(exec, createPriceList, {
      tierCode: tier.code,
      effectiveFrom: day(10),
    });
    expect(clash.version).toBe(4);
    await expect(run(exec, approvePriceList, { priceListId: clash.id })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'price_list_overlap' },
    });

    // 8. Price Master reads each list with its state.
    const lists = await asPrincipal(exec, (ctx) => listPriceLists(ctx));
    const mine = lists.filter((l) => l.tierCode === tier.code);
    expect(mine.map((l) => [l.version, l.state])).toEqual([
      [4, 'draft'],
      [3, 'scheduled'],
      [2, 'scheduled'],
      [1, 'live'],
    ]);
  });

  it('a company list copies the group list when the company has none, and may be approved alongside it', async () => {
    const company = await run(exec, createPriceList, {
      tierCode: tier.code,
      entityId: 3,
      effectiveFrom: today,
    });
    expect(company).toMatchObject({ entityId: 3, version: 1, state: 'draft' });
    expect((await pricesOf(company.id)).map((p) => p.price)).toEqual(['1000.00', '5000.00']);
    const live = await run(exec, approvePriceList, { priceListId: company.id });
    expect(live.state).toBe('live');
    // A company Executive acting for that company alone approves its own lists.
    const own = await createTestPrincipal('executive', [3]);
    const next = await run(own, createPriceList, {
      tierCode: tier.code,
      entityId: 3,
      effectiveFrom: day(3),
    });
    await expect(run(own, approvePriceList, { priceListId: next.id })).resolves.toMatchObject({
      state: 'scheduled',
    });
    // ...and cannot reach another company's list.
    const other = await run(exec, createPriceList, {
      tierCode: tier.code,
      entityId: 4,
      effectiveFrom: today,
    });
    await expect(run(own, approvePriceList, { priceListId: other.id })).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'price_list_missing' },
    });
  });

  it('refuses to approve a draft whose start date has passed', async () => {
    const draft = await run(exec, createPriceList, {
      tierCode: tier.code,
      entityId: 2,
      effectiveFrom: day(1),
    });
    const later = new Date(Date.parse(`${day(2)}T06:00:00Z`));
    await expect(
      run(exec, approvePriceList, { priceListId: draft.id }, later),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'price_list_start_past' } });
  });
});
