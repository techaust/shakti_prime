import {
  AGENT_ROLE_KEYS,
  newId,
  STAFF_ROLE_KEYS,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

/**
 * H2 (docs/03-roadmap-appendix/phase3.md §7.1): reservation needs and reservations are read by
 * company with inventory.stock.read (the role × company matrix covers their rows) and written by no
 * request role; only the definers keep them and `stock_balances.qty_reserved`. Each definer a
 * request may call checks its grant in its body; the ones beneath them are not callable at all;
 * the platform's fill, lapse and reminder are the worker principal's alone
 * (`inventory.reservations.process`); availability answers a holder of only `sales.quote.create`
 * with every quantity null.
 */

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

function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const workers = (entityIds: number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

const id = newId();
const later = new Date(Date.now() + 86_400_000).toISOString();
/** A date already passed, so the worker's own calls here change nothing of another suite's. */
const earlier = new Date(Date.now() - 86_400_000).toISOString();

describe('the reservation tables', () => {
  it('take no insert, update or delete from a request role, even with every grant', async () => {
    const exec = principalFor('executive', [1]);
    for (const statement of [
      sql`insert into reservation_needs (id, entity_id, sales_order_id, sales_order_line_id, item_id,
            qty_needed, qty_backordered, queued_at)
          values (${id}, 1, ${id}, ${id}, ${id}, 1, 1, now())`,
      sql`update reservations set qty = qty + 1`,
      sql`delete from reservations`,
      sql`update stock_balances set qty_reserved = qty_reserved + 1`,
      sql`update sales_order_lines set qty_backordered = 0`,
    ]) {
      expect((await failure(rows(exec, statement))).code).toBe('42501');
    }
  });

  it('hold a bin’s reserved quantity within what it has, for the table owner too', async () => {
    const [balance] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from stock_balances order by id limit 1`,
    );
    if (!balance) return;
    await expect(
      asMigrator(
        (m) => m`update stock_balances set qty_reserved = qty_on_hand + 1 where id = ${balance.id}`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'stock_balances_reserved_on_hand_check' });
  });

  it('keep order lines append-only but for the backorder, which only the definers write', async () => {
    const [line] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from sales_order_lines order by id limit 1`,
    );
    if (!line) return;
    await expect(
      asMigrator(
        (m) => m`update sales_order_lines set description = 'changed' where id = ${line.id}`,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asMigrator((m) => m`delete from sales_order_lines where id = ${line.id}`),
    ).rejects.toMatchObject({
      code: '42501',
    });
    // A backorder past the line's quantity is refused by the line's check.
    await expect(
      asMigrator(
        (m) => m`update sales_order_lines set qty_backordered = qty + 1 where id = ${line.id}`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'sales_order_lines_backordered_check' });
  });
});

describe('the definers beneath the reservation paths', () => {
  it.each([
    [
      'app.stock_reserve',
      sql`select app.stock_reserve(${id}::uuid, 1, '{}'::uuid[], false, ${later}::timestamptz, false)`,
    ],
    [
      'app.stock_unreserve',
      sql`select * from app.stock_unreserve('{}'::uuid[], 'lapsed', null, null)`,
    ],
    [
      'app.stock_lock_free',
      sql`select app.stock_lock_free(1::smallint, '{}'::uuid[], '{}'::uuid[])`,
    ],
    [
      'app.stock_free_rows',
      sql`select app.stock_free_rows(1::smallint, '{}'::uuid[], '{}'::uuid[])`,
    ],
    ['app.sync_line_backorders', sql`select app.sync_line_backorders('{}'::uuid[])`],
    ['app.backfill_order_needs', sql`select app.backfill_order_needs('{}'::uuid[])`],
    ['app.order_hubs', sql`select app.order_hubs(${id}::uuid)`],
    ['app.reservation_for_change', sql`select * from app.reservation_for_change(${id}::uuid)`],
    [
      'app.free_availability',
      sql`select * from app.free_availability(1::smallint, '[]'::jsonb, false)`,
    ],
  ])('%s is not callable by a request role', async (_name, statement) => {
    const failed = await failure(rows(principalFor('executive', [1]), statement));
    expect(failed.code).toBe('42501');
    expect(failed.message).toMatch(/permission denied/);
  });
});

describe('a person’s reservation definers check the grant in their body', () => {
  it('confirmation’s reservations need sales.order.confirm on the order', async () => {
    for (const roleKey of ['inventory_manager', 'accounts', 'field_engineer'] as const) {
      const failed = await failure(
        rows(
          principalFor(roleKey, [1]),
          sql`select * from app.reserve_order(${id}::uuid, ${later}::timestamptz)`,
        ),
      );
      expect(failed.message, roleKey).toMatch(/sales.order.confirm on the order is required/);
    }
  });

  it('a cancellation’s release needs sales.order.cancel', async () => {
    for (const roleKey of ['tele_caller_lc', 'inventory_manager', 'sales_team_lead'] as const) {
      const failed = await failure(
        rows(
          principalFor(roleKey, [1]),
          sql`select app.release_order_reservations(${id}::uuid, 'why')`,
        ),
      );
      expect(failed.message, roleKey).toMatch(/sales.order.cancel for the company is required/);
    }
  });

  it('release and move need inventory.stock.adjust; extend it or sales.order.cancel', async () => {
    for (const roleKey of ['tele_caller_lc', 'general_manager', 'store_manager'] as const) {
      const who = principalFor(roleKey, [1]);
      expect(
        (await failure(rows(who, sql`select app.reservation_release(${id}::uuid, 'why')`))).message,
      ).toMatch(/inventory.stock.adjust is required/);
      expect(
        (await failure(rows(who, sql`select app.reservation_move(${id}::uuid, ${id}::uuid)`)))
          .message,
      ).toMatch(/inventory.stock.adjust is required/);
    }
    for (const roleKey of ['tele_caller_lc', 'store_manager', 'accounts'] as const) {
      const who = principalFor(roleKey, [1]);
      expect(
        (await failure(rows(who, sql`select app.reservation_extend(${id}::uuid, 15, 'why')`)))
          .message,
      ).toMatch(/inventory.stock.adjust or sales.order.cancel is required/);
    }
    // The General Manager reaches the extension, and finds no reservation of that id.
    expect(
      (
        await failure(
          rows(
            principalFor('general_manager', [1]),
            sql`select app.reservation_extend(${id}::uuid, 15, 'why')`,
          ),
        )
      ).message,
    ).toMatch(/reservation_missing/);
  });
});

describe('inventory.reservations.process is the platform’s alone', () => {
  it('is platform-only, held by the worker principal and no other role', async () => {
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('inventory.reservations.process');
    // The keys before it stay platform-only.
    expect(list?.keys).toEqual(
      expect.arrayContaining([
        'messaging.media.expire',
        'voice.session.record',
        'sales.quote.expire',
      ]),
    );
    const holders = await asMigrator(
      (m) => m<{ key: string }[]>`
        select r.key from role_permissions rp join roles r on r.id = rp.role_id
         where rp.permission_key = 'inventory.reservations.process'`,
    );
    expect(holders.map((h) => h.key)).toEqual(['system:workers']);
  });

  it('refuses the fill, the lapse and the reminder to every person and agent, and another company', async () => {
    const calls = [
      sql`select * from app.fill_backorders(1::smallint, ${id}::uuid, ${later}::timestamptz, 10)`,
      sql`select * from app.lapse_reservations(1::smallint, 0)`,
      sql`select * from app.reservation_reminders(1::smallint, ${earlier}::timestamptz, 10)`,
    ];
    for (const roleKey of [...STAFF_ROLE_KEYS, ...AGENT_ROLE_KEYS]) {
      for (const call of calls) {
        expect((await failure(rows(principalFor(roleKey, [1]), call))).message, roleKey).toMatch(
          /inventory.reservations.process is required/,
        );
      }
    }
    for (const call of calls) {
      expect((await failure(rows(workers([2]), call))).message).toMatch(/outside the request/);
      // The worker in its company finds nothing to do here.
      expect(await rows(workers([1]), call)).toEqual([]);
    }
  });
});

describe('availability on a document', () => {
  it('is refused to a caller who reads neither stock nor quotes, and for an unknown kind', async () => {
    for (const roleKey of ['field_engineer', 'hr_admin', 'tele_caller_cc'] as const) {
      const failed = await failure(
        rows(
          principalFor(roleKey, [1]),
          sql`select * from app.line_availability('quote', ${id}::uuid)`,
        ),
      );
      expect(failed.code, roleKey).toBe('42501');
    }
    expect(
      (
        await failure(
          rows(
            principalFor('executive', [1]),
            sql`select * from app.line_availability('invoice', ${id}::uuid)`,
          ),
        )
      ).code,
    ).toBe('22023');
  });
});
