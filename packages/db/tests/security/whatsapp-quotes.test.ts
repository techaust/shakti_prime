import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  ENTITY_TABLES,
  PLATFORM_TABLES,
  principalFor,
  tierId,
  whatsappChannel,
  whatsappCustomer,
  withoutContext,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '../../src/testing/index';

// S3 WhatsApp quotes, milestones and STATUS (docs/03-roadmap-appendix/phase2.md §7.1, migrations
// 0189, 0190 and 0192): the milestone map is read in its company and set only by the Executive's
// messaging.templates.write; the once-per-subject record is the platform's alone; only the
// platform's sales.quote.accept.remote reaches the acceptance definers, which accept only a sent,
// unexpired quote of the chat's own customer; STATUS lists only the chat's customer's records.
// The role × company read of the map is in role-entity-matrix.test.ts. The suites never clean
// these tables, so every row here is found by this run's own ids.

afterAll(closeDb);

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

async function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const workers = (entityIds: number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

// A test item and its rate, written once and kept: no price or rate here is a client figure.
const ITEM = '01990000-0000-7000-8000-000000530001';
const RATE = '01990000-0000-7000-8000-000000530002';
const PRICE_LIST = '01990000-0000-7000-8000-000000530003';

let channel1: WhatsAppChannelFixture;
let exec1: Principal;
let gm1: Principal;
let concierge: Principal;

/** The chat of a customer, opened by an inbound message as the platform records it. */
async function openThread(customer: WhatsAppCustomerFixture): Promise<string> {
  const [row] = await rows<{ thread_id: string }>(
    workers([customer.entityId]),
    sql`select thread_id from app.whatsapp_record_inbound(
          ${channel1.phoneNumberId}, ${customer.waId}, ${`wamid.${newId()}`}, 'text', 'hello', null,
          ${new Date().toISOString()}::timestamptz, 'people')`,
  );
  if (!row) throw new Error('no thread opened');
  return row.thread_id;
}

/** A quote of the customer's lead, written as the owner would have it, with one line. */
async function quoteOf(
  customer: WhatsAppCustomerFixture,
  options: { state?: string; validUntil?: string; total?: string } = {},
): Promise<string> {
  const id = newId();
  const total = options.total ?? '1180.00';
  await asMigrator(async (m) => {
    await m`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                               price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, state,
                               subtotal, cgst, sgst, igst, tax_total, round_off, grand_total,
                               created_by)
            values (${id}, ${customer.entityId}, ${`S3T/Q/${id}`}, '2026-27', ${customer.opportunityId},
                    ${customer.accountId}, ${tierId('retail')}, ${PRICE_LIST}, 'none', '27', 'intra',
                    ${options.validUntil ?? new Date(Date.now() + 86_400_000).toISOString()},
                    ${options.state ?? 'sent'}, 1000.00, 90.00, 90.00, 0, 180.00, 0, ${total},
                    ${customer.owner.id})`;
    await m`insert into quote_lines (id, entity_id, quote_id, position, item_id, sku, description,
                                     unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct,
                                     taxable_value, cgst, sgst, igst, line_total)
            values (${newId()}, ${customer.entityId}, ${id}, 1, ${ITEM}, 'S3T-ITEM', 's3 test item',
                    'nos', 1, 1000.00, '8413', ${RATE}, 18.00, 1000.00, 90.00, 90.00, 0, 1180.00)`;
  });
  return id;
}

async function stateOf(quoteId: string): Promise<string | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ state: string }[]>`select state from quotes where id = ${quoteId}`,
  );
  return row?.state;
}

function accept(principal: Principal, entityId: number, quoteId: string, threadId: string) {
  return rows<{ result: { lineCount: number; withdrawn: { id: string; state: string }[] } }>(
    principal,
    sql`select app.accept_quote_remote(${entityId}::smallint, ${quoteId}::uuid, ${threadId}::uuid,
                                      'whatsapp_reply', ${newId()}::uuid, ${`S3T/SO/${newId()}`},
                                      '2026-27') as result`,
  );
}

beforeAll(async () => {
  await asMigrator(async (m) => {
    await m`insert into items (id, sku, name, category, hsn, unit)
            values (${ITEM}, 'S3T-ITEM', 's3 test item', 'pump', '8413', 'nos')
            on conflict (id) do nothing`;
    await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
            values (${PRICE_LIST}, ${tierId('retail')}, 1, 9531, '2090-01-01', now())
            on conflict (id) do nothing`;
    await m`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
            values (${RATE}, ${ITEM}, 18.00, '2026-04-01', 's3 test')
            on conflict (id) do nothing`;
  });
  channel1 = await whatsappChannel(1);
  exec1 = await createTestPrincipal('executive', [1]);
  gm1 = await createTestPrincipal('general_manager', [1]);
  concierge = principalFor('agent:concierge', [1]);
});

describe('the milestone tables', () => {
  it('keep the map in its company and the record of each send where no request reads it', async () => {
    expect(ENTITY_TABLES).toContain('whatsapp_milestones');
    expect(PLATFORM_TABLES).toContain('whatsapp_milestone_sends');
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'whatsapp_milestone_sends', 'SELECT') as sends_select,
             has_table_privilege('app_user', 'whatsapp_milestone_sends', 'INSERT') as sends_insert,
             has_table_privilege('app_reader', 'whatsapp_milestone_sends', 'SELECT') as sends_reader,
             has_table_privilege('app_user', 'whatsapp_milestones', 'DELETE') as map_delete,
             has_table_privilege('readonly_reporter', 'whatsapp_milestones', 'SELECT') as map_reporter`);
    expect(grants).toEqual({
      sends_select: false,
      sends_insert: false,
      sends_reader: false,
      map_delete: false,
      map_reporter: false,
    });
  });

  it('lets only the Executive map a milestone, to a template of the same company', async () => {
    const template = newId();
    const other = newId();
    await asMigrator(async (m) => {
      await m`insert into whatsapp_templates (id, entity_id, name, label, category, params, status, created_by)
              values (${template}, 1, ${`s3_quote_${template.slice(-8)}`}, 'Quote', 'utility',
                      '["Quote", "Total", "Valid until"]'::jsonb, 'approved', ${exec1.id}),
                     (${other}, 2, ${`s3_other_${other.slice(-8)}`}, 'Quote', 'utility',
                      '["Quote", "Total", "Valid until"]'::jsonb, 'approved', ${exec1.id})`;
    });
    const insert = (who: Principal, templateId: string, milestone = 'visit_booked') =>
      rows(
        who,
        sql`insert into whatsapp_milestones (id, entity_id, milestone, template_id, created_by)
            values (${newId()}, 1, ${milestone}, ${templateId}, ${who.id})`,
      );
    expect(await failure(insert(gm1, template))).toMatch(/row-level security/);
    expect(await failure(insert(concierge, template))).toMatch(/row-level security|permission/);
    expect(await failure(insert(workers([1]), template))).toMatch(/row-level security/);
    // The template of another company is refused by the key, whoever asks.
    expect(await failure(insert(exec1, other, 'installed'))).toMatch(
      /whatsapp_milestones_template_fk/,
    );
  });
});

describe('sales.quote.accept.remote is the platform’s alone', () => {
  it('is platform-only, held by the worker principal and no other role', async () => {
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('sales.quote.accept.remote');
    expect(list?.keys).toContain('messaging.process');
    const holders = await asMigrator(
      (m) => m<{ key: string }[]>`
        select r.key from role_permissions rp join roles r on r.id = rp.role_id
         where rp.permission_key = 'sales.quote.accept.remote'`,
    );
    expect(holders.map((h) => h.key)).toEqual(['system:workers']);
  });

  it('refuses every caller without it, and a company outside the request', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const quote = await quoteOf(customer);
    for (const who of [exec1, gm1, customer.owner, concierge]) {
      expect(
        await failure(
          rows(
            who,
            sql`select * from app.remote_quote_facts(1::smallint, ${quote}::uuid, ${thread}::uuid)`,
          ),
        ),
      ).toMatch(/sales.quote.accept.remote is required/);
      expect(await failure(accept(who, 1, quote, thread))).toMatch(
        /sales.quote.accept.remote is required/,
      );
    }
    expect(await failure(accept(workers([2]), 1, quote, thread))).toMatch(
      /the company is outside the request/,
    );
    expect(await stateOf(quote)).toBe('sent');
  });

  it('numbers a sales order for the platform, and nothing else', async () => {
    const [order] = await rows<{ no: number }>(
      workers([1]),
      sql`select app.next_document_no(1::smallint, 'sales_order', '2098-99', 'S3T/SO') as no`,
    );
    expect(order?.no).toBeGreaterThan(0);
    expect(
      await failure(
        rows(
          workers([1]),
          sql`select app.next_document_no(1::smallint, 'quote', '2098-99', 'S3T/Q') as no`,
        ),
      ),
    ).toMatch(/permission sales.quote.create:own required/);
  });
});

describe('app.accept_quote_remote()', () => {
  it('accepts only a quote of the chat’s own customer', async () => {
    const a = await whatsappCustomer(1);
    const b = await whatsappCustomer(1);
    const threadA = await openThread(a);
    const quoteB = await quoteOf(b);
    const [facts] = await rows<{ thread_matches: boolean }>(
      workers([1]),
      sql`select thread_matches from app.remote_quote_facts(1::smallint, ${quoteB}::uuid, ${threadA}::uuid)`,
    );
    expect(facts?.thread_matches).toBe(false);
    expect(await failure(accept(workers([1]), 1, quoteB, threadA))).toMatch(
      /the chat is not the quote's customer's/,
    );
    expect(await stateOf(quoteB)).toBe('sent');
  });

  it('accepts only a sent quote within its validity', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const draft = await quoteOf(customer, { state: 'draft' });
    const lapsed = await quoteOf(customer, {
      validUntil: new Date(Date.now() - 60_000).toISOString(),
    });
    for (const quote of [draft, lapsed]) {
      expect(await failure(accept(workers([1]), 1, quote, thread))).toMatch(
        /only a sent quote within its validity is accepted/,
      );
    }
    expect([await stateOf(draft), await stateOf(lapsed)]).toEqual(['draft', 'sent']);
  });

  it('accepts the quote into one draft order with its lines and withdraws the lead’s others', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const quote = await quoteOf(customer);
    const other = await quoteOf(customer, { state: 'draft' });
    const [done] = await accept(workers([1]), 1, quote, thread);
    expect(done?.result).toEqual({ lineCount: 1, withdrawn: [{ id: other, state: 'draft' }] });
    const [row] = await asMigrator(
      (m) => m<
        { state: string; accepted_via: string; orders: number; lines: number; other: string }[]
      >`
        select q.state, q.accepted_via,
               (select count(*)::int from sales_orders so where so.quote_id = q.id) as orders,
               (select count(*)::int from sales_order_lines l
                  join sales_orders so on so.id = l.sales_order_id where so.quote_id = q.id) as lines,
               (select o.state from quotes o where o.id = ${other}) as other
          from quotes q where q.id = ${quote}`,
    );
    expect(row).toEqual({
      state: 'accepted',
      accepted_via: 'whatsapp_reply',
      orders: 1,
      lines: 1,
      other: 'withdrawn',
    });
    // A second press finds the quote accepted: nothing more is accepted.
    expect(await failure(accept(workers([1]), 1, quote, thread))).toMatch(
      /only a sent quote within its validity is accepted/,
    );
  });
});

describe('app.status_summary() (STATUS, WA-03)', () => {
  it('lists the chat’s own customer’s quotes and orders, never another customer’s', async () => {
    const a = await whatsappCustomer(1);
    const b = await whatsappCustomer(1);
    const threadA = await openThread(a);
    const threadB = await openThread(b);
    const quoteA = await quoteOf(a);
    const quoteB = await quoteOf(b);
    await accept(workers([1]), 1, quoteA, threadA);
    const refs = async (thread: string) =>
      (
        await rows<{ kind: string; ref: string }>(
          workers([1]),
          sql`select kind, ref from app.status_summary(${thread}::uuid)`,
        )
      ).map((r) => `${r.kind}:${r.ref.startsWith('S3T/SO/') ? 'order' : r.ref}`);
    expect(await refs(threadA)).toEqual([`quote:S3T/Q/${quoteA}`, 'order:order']);
    expect(await refs(threadB)).toEqual([`quote:S3T/Q/${quoteB}`]);
    // Another company's request reads no chat of company 1.
    expect(
      await rows(workers([2]), sql`select * from app.status_summary(${threadA}::uuid)`),
    ).toEqual([]);
  });

  it('refuses a caller without messaging.process', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    for (const who of [exec1, gm1, customer.owner, concierge]) {
      expect(
        await failure(rows(who, sql`select * from app.status_summary(${thread}::uuid)`)),
      ).toMatch(/messaging.process is required/);
      expect(
        await failure(
          rows(
            who,
            sql`select * from app.whatsapp_milestone_subject(1::smallint, 'quote_sent', 'quote',
                                                             ${newId()}::uuid, null)`,
          ),
        ),
      ).toMatch(/messaging.process is required/);
      expect(
        await failure(
          rows(
            who,
            sql`select * from app.whatsapp_queue_milestone(1::smallint, 'quote_sent', 'quote',
                                                           ${newId()}::uuid, null, '[]'::jsonb)`,
          ),
        ),
      ).toMatch(/messaging.process is required/);
    }
  });
});

describe('the platform’s answers on a chat (migration 0192)', () => {
  /** A template of company 1 with a purpose, or none, registered once for these tests. */
  async function templateOf(purpose: string | null, params: string[]): Promise<string> {
    const name = `s3t_${purpose ?? 'plain'}_${String(params.length)}`;
    await asMigrator(
      (m) => m`insert into whatsapp_templates (id, entity_id, name, label, category, status, params,
                                               purpose, created_by)
               values (${newId()}, 1, ${name}, 's3 test answer',
                       ${purpose === 'acceptance_code' ? 'authentication' : 'utility'}, 'approved',
                       ${m.json(params)}, ${purpose}, ${exec1.id})
               on conflict do nothing`,
    );
    const [row] = await asMigrator(
      (m) => m<{ name: string }[]>`select name from whatsapp_templates where entity_id = 1
                                     and (name = ${name} or (${purpose}::text is not null and purpose = ${purpose}))
                                   order by (name = ${name}) desc limit 1`,
    );
    return row?.name ?? name;
  }

  const answer = (
    who: Principal,
    thread: string,
    kind: string,
    template: string | null,
    params: string | null,
    body: string | null,
  ) =>
    rows<{ outcome: string; message_id: string | null }>(
      who,
      sql`select * from app.whatsapp_queue_answer(${thread}::uuid, ${newId()}::uuid, ${kind},
                                                  ${template}, ${params}::jsonb, ${body})`,
    );

  it('queues a text or an answering template, never another template, and never the code', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const code = await templateOf('acceptance_code', ['Code']);
    const plain = await templateOf(null, []);
    const [text] = await answer(workers([1]), thread, 'text', null, null, 'Your quotes');
    expect(text?.outcome).toBe('queued');
    const [queued] = await answer(workers([1]), thread, 'template', code, '[]', null);
    expect(queued?.outcome).toBe('queued');
    // The code is never stored with its message.
    expect(await failure(answer(workers([1]), thread, 'template', code, '["123456"]', null))).toMatch(
      /the values of its purpose/,
    );
    // The platform's answers never send a template people or the milestones send.
    expect(await failure(answer(workers([1]), thread, 'template', plain, '[]', null))).toMatch(
      /not one the platform answers with/,
    );
    // Another company's request finds no chat of company 1.
    expect(await answer(workers([2]), thread, 'text', null, null, 'Your quotes')).toEqual([]);
  });

  it('reads an inbound message and a queued message only for the platform, in their company', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const [inbound] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from whatsapp_messages
                                   where thread_id = ${thread} and direction = 'inbound' limit 1`,
    );
    const id = inbound?.id ?? '';
    expect(
      await rows<{ wa_id: string }>(
        workers([1]),
        sql`select wa_id from app.whatsapp_inbound_facts(${id}::uuid)`,
      ),
    ).toEqual([{ wa_id: customer.waId }]);
    expect(
      await rows(workers([2]), sql`select * from app.whatsapp_inbound_facts(${id}::uuid)`),
    ).toEqual([]);
    // An inbound message has no send extras: only an outbound one does.
    expect(
      await rows(workers([1]), sql`select * from app.whatsapp_send_extras(${id}::uuid)`),
    ).toEqual([]);
  });

  it('refuses people and agents every answering definer, and the quote notice to all but the notifier', async () => {
    const customer = await whatsappCustomer(1);
    const thread = await openThread(customer);
    const quote = await quoteOf(customer);
    for (const who of [exec1, gm1, customer.owner, concierge]) {
      for (const query of [
        sql`select * from app.whatsapp_inbound_facts(${newId()}::uuid)`,
        sql`select * from app.whatsapp_send_extras(${newId()}::uuid)`,
        sql`select * from app.whatsapp_queue_answer(${thread}::uuid, ${newId()}::uuid, 'text',
                                                    null, null, 'Hello')`,
      ]) {
        expect(await failure(rows(who, query))).toMatch(/messaging.process is required/);
      }
      expect(
        await failure(
          rows(who, sql`select * from app.notice_quote_lead(1::smallint, ${quote}::uuid)`),
        ),
      ).toMatch(/notifications.send is required/);
    }
    expect(
      await rows<{ owner_id: string; quote_open: boolean }>(
        workers([1]),
        sql`select owner_id, quote_open from app.notice_quote_lead(1::smallint, ${quote}::uuid)`,
      ),
    ).toEqual([{ owner_id: customer.owner.id, quote_open: true }]);
  });
});
