// Warranty claim plans (R3, docs/03-roadmap-appendix/phase3.md §7.5; AGENTS §10, EXPLAIN evidence
// for every list): `pnpm --filter @shakti/domain exec tsx tests/spike/warranty-explain.ts`.
// Fills the local database up to 20,000 made-up claims of company 4, one made-up customer each,
// each claim's serial of a made-up pump (codes under `WTX-`), and one customer with 200 delivered
// serials, written as the table owner, set-based, kept between runs; then prints
// `EXPLAIN (ANALYZE, BUFFERS)` of every statement the claims list (all states and one state, its
// first page and a later one), the claim sheet and the customer's serials run, under the policies
// as an Inventory Manager of company 4. Local database only (prepareDatabase refuses any other
// host). Not part of CI; it lives under tests/ for the testing helpers.
import type { Principal } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  prepareDatabase,
} from '@shakti/db/testing';
import { sql, type SQL } from 'drizzle-orm';
import {
  getWarrantyClaim,
  listClaimSerials,
  listWarrantyClaims,
} from '../../src/queries/inventory/warranty';

const CLAIMS = 20_000;
const ENTITY = 4;
const PREFIX = 'WTX-';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** Runs `read`, printing the plan of every statement it executes under `label`. */
async function explained<T>(
  label: string,
  principal: Principal,
  read: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  return asPrincipal(principal, async (ctx) => {
    let n = 0;
    const tx = new Proxy(ctx.tx, {
      get(target, key, receiver) {
        if (key !== 'execute') return Reflect.get(target, key, receiver) as unknown;
        return async (query: SQL) => {
          n += 1;
          const rows = (await target.execute(
            sql`explain (analyze, buffers, costs off) ${query}`,
          )) as unknown as Record<string, string>[];
          process.stdout.write(
            `\n=== ${label} (statement ${String(n)}) ===\n${rows.map((r) => Object.values(r)[0]).join('\n')}\n`,
          );
          return target.execute(query);
        };
      },
    });
    return read({ ...ctx, tx });
  });
}

/** The made-up pump, the 20,000 claims and the customer of 200 serials; answers that customer. */
async function seed(createdBy: string): Promise<string> {
  return asMigrator(async (m) => {
    const [item] = await m<{ id: string }[]>`select id from items where sku = ${`${PREFIX}PUMP`}`;
    const itemId =
      item?.id ??
      (
        await m<{ id: string }[]>`
          insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, warranty_months)
          values (app.uuid_v7(), ${`${PREFIX}PUMP`}, 'Made-up plan pump', 'pump', '8413', 'nos', true, 24)
          returning id`
      )[0]?.id ??
      '';
    const [have] = await m<{ n: number }[]>`
      select count(*)::int as n from warranty_claims where claim_no like ${`${PREFIX}%`}`;
    if ((have?.n ?? 0) < CLAIMS) {
      await m.begin(async (tx) => {
        // One customer, one serial and one claim per g; the claims' states and times spread out, every one
        // older than what the suites raise, so their lists of company 4 keep theirs on the first page.
        await tx`
          create temporary table plan_rows on commit drop as
          select g, app.uuid_v7() as account, app.uuid_v7() as serial, app.uuid_v7() as claim
            from generate_series(1, ${CLAIMS}::int) g`;
        await tx`insert into accounts (id, type, name, created_by)
          select account, 'farm', 'Made-up plan farm ' || g, ${createdBy} from plan_rows`;
        await tx`insert into account_entities (id, account_id, entity_id, created_by)
          select app.uuid_v7(), account, ${ENTITY}, ${createdBy} from plan_rows`;
        await tx`insert into serials (id, entity_id, item_id, serial_no, state, account_id, warranty_until, created_by)
          select serial, ${ENTITY}, ${itemId}, ${PREFIX} || lpad(g::text, 6, '0'), 'with_customer', account,
                 date '2027-01-01' + (g % 700), ${createdBy}
            from plan_rows`;
        await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, item_id, serial_id,
                   reported_fault, state, rejected_reason, created_by, created_at)
          select claim, ${ENTITY}, ${PREFIX} || lpad(g::text, 6, '0'), account, ${itemId}, serial,
                 'Made-up plan fault', case when g % 3 = 0 then 'rejected' else 'serial_identified' end,
                 case when g % 3 = 0 then 'Made-up plan reason' end, ${createdBy},
                 timestamptz '2024-01-01 00:00+05:30' + (g || ' minutes')::interval
            from plan_rows`;
      });
    }
    const [one] = await m<{ id: string }[]>`
      select id from accounts where name = 'Made-up plan farm of many serials'`;
    if (one) return one.id;
    const [made] = await m<{ id: string }[]>`
      insert into accounts (id, type, name, created_by)
      values (app.uuid_v7(), 'farm', 'Made-up plan farm of many serials', ${createdBy}) returning id`;
    const account = made?.id ?? '';
    await m`insert into account_entities (id, account_id, entity_id, created_by)
            values (app.uuid_v7(), ${account}, ${ENTITY}, ${createdBy})`;
    await m`insert into serials (id, entity_id, item_id, serial_no, state, account_id, warranty_until, created_by)
      select app.uuid_v7(), ${ENTITY}, ${itemId}, ${`${PREFIX}M-`} || lpad(g::text, 4, '0'), 'with_customer',
             ${account}, date '2027-06-30', ${createdBy}
        from generate_series(1, 200) g`;
    await m`analyze warranty_claims`;
    await m`analyze serials`;
    return account;
  });
}

async function main(): Promise<void> {
  await prepareDatabase();
  const exec = await createTestPrincipal('executive');
  const manager = await createTestPrincipal('inventory_manager', [ENTITY]);
  const account = await seed(exec.id);

  const first = await explained('claims list, all states, first page', manager, (ctx) =>
    listWarrantyClaims(ctx, { entityId: ENTITY, limit: 50 }),
  );
  await explained('claims list, all states, second page', manager, (ctx) =>
    listWarrantyClaims(ctx, { entityId: ENTITY, limit: 50, cursor: first.nextCursor ?? '' }),
  );
  await explained('claims list, rejected, first page', manager, (ctx) =>
    listWarrantyClaims(ctx, { entityId: ENTITY, state: 'rejected', limit: 50 }),
  );
  const claim = first.items[0];
  if (claim !== undefined) {
    await explained('claim sheet', manager, (ctx) =>
      getWarrantyClaim(ctx, { entityId: ENTITY, claimId: claim.id }),
    );
  }
  await explained('the customer’s 200 delivered serials', manager, (ctx) =>
    listClaimSerials(ctx, { entityId: ENTITY, accountId: account }),
  );
  await closeDb();
}

await main();
