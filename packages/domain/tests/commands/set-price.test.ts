import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { runCommand } from '../../src/command/run-command';
import { setPrice } from '../../src/commands/pricing/set-price';

afterAll(closeDb);

const ids = {
  sharedList: newId(),
  entity2List: newId(),
  archivedList: newId(),
  item: newId(),
  inactiveItem: newId(),
  kit: newId(),
};
const version = () => Math.floor(Math.random() * 1_000_000_000);
const tag = newId().slice(-12);

beforeAll(async () => {
  // The two open lists are approved, so they are live and the one-live-list rule covers them.
  const approver = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn) values
        (${ids.item}, ${`T-${tag}-A`}, 'set-price item', 'pump', '8413'),
        (${ids.inactiveItem}, ${`T-${tag}-B`}, 'set-price inactive', 'pump', '8413')`;
      await tx`update items set is_active = false where id = ${ids.inactiveItem}`;
      await tx`insert into kits (id, sku, name) values (${ids.kit}, ${`T-${tag}-K`}, 'set-price kit')`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at, approved_by, approved_at) values
        (${ids.sharedList}, ${tierId('commercial')}, null, ${version()}, '2026-04-01', null, ${approver.id}, now()),
        (${ids.entity2List}, ${tierId('commercial')}, 2, ${version()}, '2026-04-01', null, ${approver.id}, now()),
        (${ids.archivedList}, ${tierId('commercial')}, null, ${version()}, '2026-04-01', now(), null, null)`;
    }),
  );
});

// Close this run's lists, so the next run may open its own for the same tier (AUDIT M19).
afterAll(async () => {
  await asMigrator(
    (m) =>
      m`update price_lists set archived_at = now() where id in (${ids.sharedList}, ${ids.entity2List}) and archived_at is null`,
  );
});

const input = { priceListId: ids.sharedList, itemId: ids.item, price: '1500.00' };

describe('pricing.price.set', () => {
  it('is denied for a General Manager', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) => runCommand(setPrice, { context, audit, outbox }, input)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reports a list it cannot see, including one outside the entity scope', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context, audit, outbox }, { ...input, priceListId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'price_list_missing' } });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          setPrice,
          { context, audit, outbox },
          { ...input, priceListId: ids.entity2List },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'price_list_missing' } });
  });

  it('refuses a closed list, an inactive item and an ambiguous target', async () => {
    const exec = await createTestPrincipal('executive');
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(
          setPrice,
          { context, audit, outbox },
          { ...input, priceListId: ids.archivedList },
        ),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'price_list_closed' } });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context, audit, outbox }, { ...input, itemId: ids.inactiveItem }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'price_item_missing' },
    });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context, audit, outbox }, { ...input, kitId: ids.kit }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context, audit, outbox }, { ...input, price: '0.00' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('sets a price, logs every change with the previous value, audits and emits', async () => {
    const exec = await createTestPrincipal('executive');
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const first = await asPrincipal(exec, (context) =>
      runCommand(setPrice, { context, audit: recorded, outbox: emitted }, input),
    );
    expect(first).toMatchObject({
      priceListId: ids.sharedList,
      entityId: null,
      tierCode: 'commercial',
      itemId: ids.item,
      kitId: null,
      price: '1500.00',
    });
    expect(Object.keys(first).sort()).toEqual([
      'entityId',
      'id',
      'itemId',
      'kitId',
      'price',
      'priceListId',
      'tierCode',
      'updatedAt',
    ]);
    expect(recorded.records).toContainEqual(
      expect.objectContaining({ command: 'pricing.price.set' }),
    );
    expect(emitted.records).toEqual([
      expect.objectContaining({ type: 'pricing.price.changed', aggregateId: first.id }),
    ]);

    const second = await asPrincipal(exec, (context) =>
      runCommand(
        setPrice,
        { context, audit, outbox },
        { ...input, price: '1550.00', reason: 'season change' },
      ),
    );
    expect(second.id).toBe(first.id);
    expect(second.price).toBe('1550.00');

    const kitPrice = await asPrincipal(exec, (context) =>
      runCommand(
        setPrice,
        { context, audit, outbox },
        { priceListId: ids.sharedList, kitId: ids.kit, price: '9000.00' },
      ),
    );
    expect(kitPrice.kitId).toBe(ids.kit);
    expect(kitPrice.itemId).toBeNull();

    const log = await asPrincipal(exec, async ({ tx }) => {
      const rows = (await tx.execute(sql`
        select old_price, new_price, reason, changed_by from price_change_log
        where price_list_item_id = ${first.id} order by created_at, new_price
      `)) as unknown as {
        old_price: string | null;
        new_price: string;
        reason: string | null;
        changed_by: string;
      }[];
      return rows;
    });
    expect(log).toEqual([
      { old_price: null, new_price: '1500.00', reason: null, changed_by: exec.id },
      { old_price: '1500.00', new_price: '1550.00', reason: 'season change', changed_by: exec.id },
    ]);
  });

  it('two changes of one price at once each log the price they replaced (AUDIT M18)', async () => {
    const exec = await createTestPrincipal('executive');
    await Promise.all(
      ['1601.00', '1602.00'].map((price) =>
        asPrincipal(exec, (context) =>
          runCommand(setPrice, { context, audit, outbox }, { ...input, price }),
        ),
      ),
    );
    const log = await asMigrator(
      (m) => m<{ old_price: string; new_price: string }[]>`
        select l.old_price, l.new_price from price_change_log l
          join price_list_items i on i.id = l.price_list_item_id
         where i.price_list_id = ${ids.sharedList} and i.item_id = ${ids.item}
           and l.new_price in (1601.00, 1602.00)`,
    );
    expect(log).toHaveLength(2);
    // one change replaced the other: the second logged the first's price, not the same old one
    const [a, b] = log;
    expect(a?.old_price === b?.new_price || b?.old_price === a?.new_price).toBe(true);
  });

  it('refuses a second live list for the same tier and company on the same days (AUDIT M19)', async () => {
    const [approver] = await asMigrator(
      (m) => m<{ id: string }[]>`select approved_by as id from price_lists where id = ${ids.sharedList}`,
    );
    await expect(
      asMigrator(
        (m) =>
          m`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
            values (${newId()}, ${tierId('commercial')}, null, ${version()}, '2026-06-01', ${approver?.id ?? ''}, now())`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'price_lists_no_overlap' });
    // A draft prices nothing, so it may sit beside the live list until it is approved.
    const draft = newId();
    await asMigrator(
      (m) =>
        m`insert into price_lists (id, tier_id, entity_id, version, effective_from)
          values (${draft}, ${tierId('commercial')}, null, ${version()}, '2026-06-01')`,
    );
    await asMigrator((m) => m`update price_lists set archived_at = now() where id = ${draft}`);
  });

  it('changes a shared list only for a request acting for every company (AUDIT H2)', async () => {
    const exec1 = await createTestPrincipal('executive', [1]);
    const exec12 = await createTestPrincipal('executive', [1, 2]);
    for (const exec of [exec1, exec12]) {
      await expect(
        asPrincipal(exec, (context) => runCommand(setPrice, { context, audit, outbox }, input)),
      ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'price_list_group_scope' } });
    }
    // the database refuses the same write made directly, so the rule does not rest on the command
    const direct = await asPrincipal(exec1, async ({ tx }) => {
      const updated = (await tx.execute(sql`
        update price_list_items set price = 1.00
        where price_list_id = ${ids.sharedList} returning id
      `)) as unknown as { id: string }[];
      return updated.length;
    });
    expect(direct).toBe(0);
    await expect(
      asPrincipal(exec1, ({ tx }) =>
        tx.execute(sql`
          insert into price_list_items (id, price_list_id, item_id, price)
          values (${newId()}, ${ids.sharedList}, ${ids.inactiveItem}, 1.00)
        `),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('row-level security'),
    );

    // a list of one company stays editable by an Executive acting for that company
    const exec2 = await createTestPrincipal('executive', [2]);
    const own = await asPrincipal(exec2, (context) =>
      runCommand(setPrice, { context, audit, outbox }, { ...input, priceListId: ids.entity2List }),
    );
    expect(own.entityId).toBe(2);
  });

  it('is visible to price readers and hidden from roles without pricing.read', async () => {
    const seen = (p: Parameters<typeof asPrincipal>[0]) =>
      asPrincipal(p, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select id from price_list_items where price_list_id = ${ids.sharedList}`,
        )) as unknown as { id: string }[];
        return rows.length;
      });
    expect(await seen(principalFor('tele_caller_cc', [2]))).toBe(2);
    expect(await seen(principalFor('field_engineer', [1]))).toBe(0);
  });
});
