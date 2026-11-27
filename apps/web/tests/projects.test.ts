import { newId, type DeliveredEvent } from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  closeDb,
  createTestTeam,
  createTestUser,
  PIPELINE_SEED,
  stageId,
  tierId,
} from '@shakti/db/testing';
import { memoryKeyValue } from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EventHandlerContext } from '../src/workers/events/registry';
import { workerFor } from '../src/workers/events/registry';
import { systemWorkersPrincipal } from '../src/workers/events/system-principal';

// J1's drafting worker end to end (docs/03-roadmap-appendix/phase4.md §6.1): the
// `sales.order.confirmed` worker drafts the project of an order that needs installing before it
// sends the customer's milestone, once however often the event is delivered, and drafts nothing
// for a dealer's sale. The orders are written as the migrator; the worker, its command and the
// database are real. Company 2; synthetic values only.

const E = 2;
const P = '01990000-0000-7000-8000-000000b9';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const PRICE_LIST = fixed(0x0001);
let serial = 0x0100;
const next = () => fixed((serial += 1));
let owner = '';
let teamId = '';

async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const orders = tx`select id from sales_orders where price_list_id = ${PRICE_LIST}`;
      const projects = tx`select id from projects where sales_order_id in (${orders})`;
      await tx`delete from project_milestones where project_id in (${projects})`;
      await tx`delete from projects where sales_order_id in (${orders})`;
      await tx`delete from sales_orders where price_list_id = ${PRICE_LIST}`;
      await tx`delete from quotes where price_list_id = ${PRICE_LIST}`;
      await tx`delete from opportunities where id::text like ${`${P}%`}`;
      await tx`delete from customer_sites where id::text like ${`${P}%`}`;
      await tx`delete from account_entities where account_id::text like ${`${P}%`}`;
      await tx`delete from accounts where id::text like ${`${P}%`}`;
      await tx`delete from price_lists where id = ${PRICE_LIST}`;
    }),
  );
}

beforeAll(async () => {
  await removeRows();
  owner = (await createTestUser([{ entityId: E, roleKey: 'project_manager' }])).id;
  teamId = await createTestTeam(E, 'projects worker team');
  await asMigrator(
    (m) => m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
      values (${PRICE_LIST}, ${tierId('dealer')}, ${E}, 9300, '2090-01-01', now())`,
  );
});

afterAll(async () => {
  await removeRows();
  await closeOutboxDb();
  await closeDb();
});

/** A confirmed order of a lead of the given segment, with a site, written as the migrator. */
async function confirmedOrder(segment: 'farmer_pumps' | 'dealer_wholesale'): Promise<string> {
  const account = next();
  const site = next();
  const lead = next();
  const quote = next();
  const order = next();
  const index = PIPELINE_SEED.findIndex((p) => p.segment === segment);
  const pipeline = PIPELINE_SEED[index];
  if (!pipeline) throw new Error('no pipeline');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'farm', 'projects worker customer', ${owner})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${next()}, ${account}, ${E}, ${owner}, ${teamId}, ${owner})`;
      await tx`insert into customer_sites (id, account_id, type, village, created_by)
        values (${site}, ${account}, 'borewell', 'projects worker village', ${owner})`;
      await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${lead}, ${E}, ${account}, ${site}, ${pipeline.id}, ${stageId(index + 1, 1)}, ${owner}, ${teamId}, ${owner})`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal, cgst,
                 sgst, igst, tax_total, round_off, grand_total, created_by)
        values (${quote}, ${E}, ${`PW/Q/2098-99/${quote.slice(-4)}`}, '2098-99', ${lead}, ${account}, ${site},
                ${tierId('dealer')}, ${PRICE_LIST}, 'none', '08', 'intra', now() + interval '15 days',
                0, 0, 0, 0, 0, 0, 0, ${owner})`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, account_type,
                 site_id, tier_id, price_list_id, place_of_supply_state, supply_kind, state, subtotal, cgst, sgst,
                 igst, tax_total, round_off, grand_total, confirmed_at, confirmed_by, created_by)
        values (${order}, ${E}, ${`PW/SO/2098-99/${order.slice(-4)}`}, '2098-99', ${quote}, ${lead}, ${account},
                'farm', ${site}, ${tierId('dealer')}, ${PRICE_LIST}, '08', 'intra', 'confirmed',
                0, 0, 0, 0, 0, 0, 0, now(), ${owner}, ${owner})`;
    }),
  );
  return order;
}

function confirmedEvent(orderId: string): DeliveredEvent {
  return {
    id: newId(),
    sequence: '1',
    type: 'sales.order.confirmed',
    entityId: E,
    aggregateType: 'sales_order',
    aggregateId: orderId,
    payload: { v: 1, accountId: newId(), opportunityId: null, released: false },
  };
}

function context(): EventHandlerContext {
  return {
    principal: systemWorkersPrincipal(E),
    keyValue: memoryKeyValue(),
    requestId: newId(),
    now: new Date(),
    startedAt: performance.now(),
  };
}

async function projectsOf(orderId: string) {
  return asMigrator(
    (m) => m<{ id: string; steps: number }[]>`
      select p.id::text as id,
             (select count(*)::int from project_milestones m where m.project_id = p.id) as steps
        from projects p where p.sales_order_id = ${orderId}`,
  );
}

describe('the sales.order.confirmed worker drafts the project (J1)', () => {
  const worker = workerFor('sales.order.confirmed');

  it('drafts the project of a farmer pumps order once, however often the event arrives', async () => {
    if (worker === undefined) throw new Error('no worker for sales.order.confirmed');
    const order = await confirmedOrder('farmer_pumps');
    const event = confirmedEvent(order);
    await worker.handle(event, context());
    await worker.handle(event, context());
    await worker.handle(confirmedEvent(order), context());
    const made = await projectsOf(order);
    expect(made).toHaveLength(1);
    expect(made[0]?.steps).toBe(5);
  });

  it("drafts nothing for a dealer's sale", async () => {
    if (worker === undefined) throw new Error('no worker for sales.order.confirmed');
    const order = await confirmedOrder('dealer_wholesale');
    await worker.handle(confirmedEvent(order), context());
    expect(await projectsOf(order)).toEqual([]);
  });
});
