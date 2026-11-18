import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type Principal,
  type QuoteDto,
  type WhatsAppTemplateDto,
  type WhatsAppWebhook,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  testPhone,
  whatsappChannel,
  type WhatsAppChannelFixture,
} from '@shakti/db/testing';
import {
  attachQuotePdf,
  confirmSalesOrder,
  createLead,
  createQuote,
  executeCommand,
  memoryFileStore,
  memoryKeyValue,
  recordInboundWhatsApp,
  recordSizing,
  recordWhatsAppOptOut,
  registerWhatsAppTemplate,
  sendQuote,
  setAccountTier,
  setWhatsAppMilestone,
  quoteButtonTokens,
  verifyQuoteButtonToken,
  type KeyValue,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TemplateMessage, WhatsAppClient } from '../src/integrations/whatsapp/client';
import { systemWorkersPrincipal } from '../src/workers/events/system-principal';
import type { EventHandlerContext } from '../src/workers/events/registry';
import { handleOrderConfirmed, handleQuoteSent } from '../src/workers/messaging/milestones';
import { handleQuotePress, type PressOutcome } from '../src/workers/messaging/quote-press';
import { sendQueuedMessage } from '../src/workers/messaging/send';
import { whatsappHandler } from '../src/workers/webhooks/whatsapp';

// S3 on real Postgres (docs/03-roadmap-appendix/phase2.md §7.1, §14): a quote sent on WhatsApp as
// its milestone, with the PDF and the Accept and Talk to us payloads made as it is sent; presses
// checked against the secret, the chat and its number; the one-time code from ₹2,00,000; STATUS;
// the order's milestone; each once. The messaging worker sends through a fake client and nothing
// reaches WhatsApp. Quotes are made in company 2 on this file's own test tier, item and price,
// synthetic values, never a client figure; every customer is new on each run.

// A low-entropy phrase, so the secret scan never mistakes it for a key (CLAUDE.md).
const SECRET = 'whatsapp-quotes-web-test-phrase';
const E = 2;
const P = '01990000-0000-7000-8000-000000a7';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const ids = { tier: fixed(1), list: fixed(2), module: fixed(3), rate: fixed(4), priced: fixed(5) };
const RUN = newId().slice(-8);

let lc: Principal;
let exec: Principal;
let channel: WhatsAppChannelFixture;

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`update price_lists set archived_at = now() where id = ${ids.list}`;
    await m`update price_tiers set is_active = false, archived_at = now() where id = ${ids.tier}`;
  });
  await closeDb();
});

const workers = (): Principal => systemWorkersPrincipal(E);
const run = <T>(
  principal: Principal,
  command: Parameters<typeof executeCommand>[2],
  input: unknown,
) =>
  executeCommand(principal, { entityIds: [E], requestId: newId() }, command, input) as Promise<T>;

async function approved(name: string, params: string[], extra: object = {}) {
  const template = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
    entityId: E,
    name,
    label: 'S3 web test template',
    category: 'utility',
    params,
    ...extra,
  });
  // Approved as Meta's template event would, written directly: the event is W1's to test.
  await asMigrator(
    (m) => m`update whatsapp_templates set status = 'approved' where id = ${template.id}`,
  );
  return template;
}

/** The company's template of a platform purpose, approved, registered once for the suites. */
async function purposeTemplate(purpose: 'acceptance_code' | 'quote_expired'): Promise<string> {
  const [category, params] =
    purpose === 'acceptance_code' ? ['authentication', ['Code']] : ['utility', ['Quote']];
  await asMigrator(async (m) => {
    await m`insert into whatsapp_templates (id, entity_id, name, label, category, status, params, purpose, created_by)
      values (${newId()}, ${E}, ${`s3_${purpose}_${String(E)}`}, 'S3 test answer', ${category},
              'approved', ${m.json(params)}, ${purpose}, ${exec.id})
      on conflict do nothing`;
    await m`update whatsapp_templates set status = 'approved' where entity_id = ${E} and purpose = ${purpose}`;
  });
  const [row] = await asMigrator(
    (m) => m<{ name: string }[]>`select name from whatsapp_templates
                                   where entity_id = ${E} and purpose = ${purpose}`,
  );
  return row?.name ?? '';
}

beforeAll(async () => {
  const teamId = await createTestTeam(E, 's3 web team');
  // A person with a user row, so the notices of their leads reach them.
  const user = await createTestUser([{ entityId: E, roleKey: 'tele_caller_lc', teamId }]);
  lc = principalFor('tele_caller_lc', [E], { id: user.id, teamId });
  exec = await createTestPrincipal('executive');
  channel = await whatsappChannel(E);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${ids.tier}, 't_s3_web', 'S3 web test tier')
        on conflict (id) do update set is_active = true, archived_at = null`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
        (${ids.module}, 'S3W-MODULE', 's3 web test module', 'solar_module', '8541', 'nos', true,
         ${tx.json({ wp: 540 })})
        on conflict (id) do nothing`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
        values (${ids.list}, ${ids.tier}, ${E}, 1, '2026-04-01', ${exec.id}, now())
        on conflict (id) do update set entity_id = ${E}, archived_at = null, approved_by = ${exec.id}, approved_at = now()`;
      // The price log's trigger needs a person; the price is a test row, written with the
      // triggers off for this statement only, as the domain suites write theirs.
      await tx`set local session_replication_role = replica`;
      await tx`insert into price_list_items (id, price_list_id, item_id, price)
        values (${ids.priced}, ${ids.list}, ${ids.module}, 12000.00)
        on conflict (id) do nothing`;
      await tx`set local session_replication_role = origin`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
        values (${ids.rate}, ${ids.module}, 12.00, '2026-04-01', 's3 web test')
        on conflict (id) do nothing`;
    }),
  );
  const quoteTemplate = await approved(`s3w_quote_${RUN}`, ['Quote', 'Total', 'Valid until'], {
    header: 'document',
    buttons: [
      { kind: 'quick_reply', text: 'Accept' },
      { kind: 'quick_reply', text: 'Talk to us' },
    ],
  });
  const orderTemplate = await approved(`s3w_order_${RUN}`, ['Order', 'Total']);
  for (const [milestone, template] of [
    ['quote_sent', quoteTemplate],
    ['order_confirmed', orderTemplate],
  ] as const) {
    await run(exec, setWhatsAppMilestone, { entityId: E, milestone, templateId: template.id });
  }
  await purposeTemplate('acceptance_code');
  await purposeTemplate('quote_expired');
});

interface Customer {
  leadId: string;
  accountId: string;
  contactId: string;
  waId: string;
  threadId: string;
}

const seconds = () => String(Math.floor(Date.now() / 1000));
const context = () => ({ inboxId: newId(), requestId: newId(), attempts: 1 });

function delivery(messages: unknown[]): WhatsAppWebhook {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '919000000001',
                phone_number_id: channel.phoneNumberId,
              },
              messages,
            },
          },
        ],
      },
    ],
  };
}

/** The WhatsApp handler of this file: one key-value store, the test secret, a clock to move. */
function handlerOf(kv: KeyValue, now: () => Date = () => new Date()) {
  return whatsappHandler({
    keyValue: kv,
    now,
    ingestLead: () => Promise.resolve(null),
    downloadMedia: undefined,
    store: undefined,
    buttonSecret: SECRET,
  });
}

/**
 * A sized rooftop lead of the LC on the test tier, with a WhatsApp chat and consent; a `large` one
 * is sized for 20 modules, so its quote passes the code's value.
 */
async function customerOnWhatsApp(large = false): Promise<Customer> {
  const phone = testPhone();
  const lead = await run<{ id: string; account: { id: string }; contact: { id: string } | null }>(
    lc,
    createLead,
    {
      entityId: E,
      pipelineKey: 'residential_rooftop',
      contact: { name: 'S3 web test customer', phone },
      account: { type: 'household' },
      site: { type: 'rooftop', village: 'S3 web test village' },
    },
  );
  await run(exec, setAccountTier, { entityId: E, accountId: lead.account.id, tierId: ids.tier });
  await run(lc, recordSizing, {
    entityId: E,
    opportunityId: lead.id,
    sizing: {
      kind: 'rooftop',
      inputs: large
        ? { monthlyUnitsKwh: 1500, roofAreaSqm: 160, sanctionedLoadKw: 15 }
        : { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 },
    },
  });
  const waId = `91${phone.replace(/^\+?91/, '')}`;
  const recorded = await run<{ threadId: string }>(workers(), recordInboundWhatsApp, {
    phoneNumberId: channel.phoneNumberId,
    waId,
    providerMessageId: `wamid.${newId()}`,
    kind: 'text',
    body: 'Please send the quote',
    buttonPayload: null,
    sentAt: new Date().toISOString(),
    handledBy: 'people',
  });
  const contactId = lead.contact?.id ?? '';
  await asMigrator(
    (
      m,
    ) => m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
             values (${newId()}, ${contactId}, 'whatsapp', 'service', 'whatsapp_opt_in', 's3-web-test',
                     now(), ${lc.id})`,
  );
  return {
    leadId: lead.id,
    accountId: lead.account.id,
    contactId,
    waId,
    threadId: recorded.threadId,
  };
}

/** A quote of the customer, with its PDF, sent by WhatsApp. `modules` sets its size. */
async function sentQuote(customer: Customer, modules = 5): Promise<QuoteDto> {
  const quote = await run<QuoteDto>(lc, createQuote, {
    entityId: E,
    opportunityId: customer.leadId,
    lines: [{ itemId: ids.module, qty: String(modules) }],
  });
  const pdf = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
             values (${pdf}, ${E}, 'quote_pdf', 'memory', ${`${String(E)}/quote_pdf/${pdf}`}, 'quote.pdf',
                     'application/pdf', 10, ${'d'.repeat(64)}, 'ready', ${SYSTEM_WORKERS_PRINCIPAL_ID})`,
  );
  await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId: pdf });
  return run<QuoteDto>(lc, sendQuote, { entityId: E, quoteId: quote.id, channel: 'whatsapp' });
}

/** The last event of a type on an aggregate, as the outbox delivers it. */
async function lastEvent(
  type: string,
  aggregateId: string,
  messageId?: string,
): Promise<DeliveredEvent> {
  const [row] = await asOutboxPublisher(
    (p) => p<
      {
        id: string;
        sequence: string;
        entity_id: number;
        aggregate_type: string;
        payload_json: Record<string, unknown>;
      }[]
    >`select id, sequence::text, entity_id, aggregate_type, payload_json from outbox_events
       where type = ${type} and aggregate_id = ${aggregateId}
         and (${messageId ?? null}::text is null or payload_json->>'messageId' = ${messageId ?? null})
       order by sequence desc limit 1`,
  );
  if (!row) throw new Error(`no ${type} event`);
  return {
    id: row.id,
    sequence: row.sequence,
    type: type as DeliveredEvent['type'],
    entityId: row.entity_id,
    aggregateType: row.aggregate_type,
    aggregateId,
    payload: row.payload_json as DeliveredEvent['payload'],
  };
}

const eventContext = (): EventHandlerContext => ({
  principal: workers(),
  keyValue: memoryKeyValue(),
  requestId: newId(),
  now: new Date(),
  startedAt: 0,
});

/** The messaging worker with a fake client that keeps what it was asked to send. */
function fakeSender() {
  const sent: (TemplateMessage | { to: string; body: string })[] = [];
  const client: WhatsAppClient = {
    sendTemplate: (message) => {
      sent.push(message);
      return Promise.resolve({ messageId: `wamid.${newId()}`, waId: undefined });
    },
    sendText: (message) => {
      sent.push(message);
      return Promise.resolve({ messageId: `wamid.${newId()}`, waId: undefined });
    },
  };
  const send = (messageId: string) =>
    sendQueuedMessage(
      { eventId: newId(), entityId: E, messageId },
      {
        principal: workers(),
        keyValue: memoryKeyValue(),
        requestId: newId(),
        now: () => new Date(),
        client: () => client,
        hosted: false,
        buttonSecret: SECRET,
        store: memoryFileStore('memory'),
      },
    );
  return { sent, send };
}

/** The quote's milestone queued by `sales.quote.sent`, then sent; the buttons' payloads. */
async function quoteOnChat(customer: Customer, modules = 5) {
  const quote = await sentQuote(customer, modules);
  expect(await handleQuoteSent(await lastEvent('sales.quote.sent', quote.id), eventContext())).toBe(
    'queued',
  );
  const [message] = await asMigrator(
    (m) => m<{ id: string }[]>`select message_id as id from whatsapp_milestone_sends
                                 where milestone = 'quote_sent' and subject_id = ${quote.id}`,
  );
  const sender = fakeSender();
  expect(await sender.send(message?.id ?? '')).toMatchObject({ status: 'sent' });
  const template = sender.sent[0] as TemplateMessage;
  const [accept, talk] = (template.buttons ?? []).map((b) => b.value);
  return { quote, template, accept: accept ?? '', talk: talk ?? '' };
}

/** A quote's Accept payload on the customer's chat, as the messaging worker made it. */
function acceptOf(customer: Customer, quoteId: string) {
  const [accept] = quoteButtonTokens(SECRET, quoteId, {
    threadId: customer.threadId,
    waId: customer.waId,
  });
  return { accept: accept ?? '' };
}

/** A button press delivered from `waId` and handled as the platform. */
async function press(
  kv: KeyValue,
  waId: string,
  payload: string,
  now: () => Date = () => new Date(),
): Promise<PressOutcome> {
  const wamid = `wamid.${newId()}`;
  await handlerOf(kv, now)(
    delivery([
      {
        from: waId,
        id: wamid,
        timestamp: seconds(),
        type: 'button',
        button: { text: 'Accept', payload },
      },
    ]),
    context(),
  );
  const [row] = await asMigrator(
    (m) => m<{ thread_id: string; message_id: string }[]>`
      select thread_id, message_id from whatsapp_message_keys where provider_message_id = ${wamid}`,
  );
  const event = await lastEvent('messaging.button.pressed', row?.thread_id ?? '', row?.message_id);
  return handleQuotePress(event, {
    principal: workers(),
    keyValue: kv,
    requestId: newId(),
    now,
    buttonSecret: SECRET,
  });
}

/** A text the customer sends, through the WhatsApp handler; the message's received event. */
async function write(kv: KeyValue, customer: Customer, body: string, now?: () => Date) {
  const wamid = `wamid.${newId()}`;
  await handlerOf(kv, now)(
    delivery([
      { from: customer.waId, id: wamid, timestamp: seconds(), type: 'text', text: { body } },
    ]),
    context(),
  );
  const [row] = await asMigrator(
    (m) => m<{ message_id: string }[]>`select message_id from whatsapp_message_keys
                                         where provider_message_id = ${wamid}`,
  );
  const [event] = await asOutboxPublisher(
    (p) => p<{ payload_json: { messageId: string; platform: boolean } }[]>`
      select payload_json from outbox_events where type = 'messaging.message.received'
         and payload_json->>'messageId' = ${row?.message_id ?? ''}`,
  );
  return event?.payload_json;
}

async function ordersOf(quoteId: string): Promise<number> {
  const [row] = await asMigrator(
    (m) =>
      m<{ n: number }[]>`select count(*)::int as n from sales_orders where quote_id = ${quoteId}`,
  );
  return row?.n ?? 0;
}

async function quoteRow(quoteId: string) {
  const [row] = await asMigrator(
    (m) => m<{ state: string; accepted_via: string | null }[]>`
      select state, accepted_via from quotes where id = ${quoteId}`,
  );
  return row;
}

/** The platform's latest answers on a chat: their kind, template and words. */
async function answersOn(threadId: string) {
  return asMigrator(
    (m) => m<
      {
        id: string;
        kind: string;
        template_name: string | null;
        template_params: unknown;
        body_masked: string | null;
      }[]
    >`select id, kind, template_name, template_params, body_masked from whatsapp_messages
       where thread_id = ${threadId} and direction = 'outbound' order by created_at desc, id desc`,
  );
}

describe('a quote sent on WhatsApp (§7.1)', () => {
  it('goes once as its milestone, with the PDF and two payloads bound to the quote, chat and number', async () => {
    const customer = await customerOnWhatsApp();
    const { quote, template, accept, talk } = await quoteOnChat(customer);
    expect(template.bodyParameters[0]).toBe(quote.quoteNo);
    expect(template.headerDocument?.filename).toBe('quote.pdf');
    const to = { threadId: customer.threadId, waId: customer.waId };
    expect(verifyQuoteButtonToken(SECRET, accept, to)).toEqual({
      action: 'accept',
      quoteId: quote.id,
    });
    expect(verifyQuoteButtonToken(SECRET, talk, to)).toEqual({ action: 'talk', quoteId: quote.id });
    // No payload is stored with the message: they are made as it is sent.
    const [stored] = await answersOn(customer.threadId);
    expect(JSON.stringify(stored)).not.toContain(accept);
    expect(
      await handleQuoteSent(await lastEvent('sales.quote.sent', quote.id), eventContext()),
    ).toBe('already');
  });
});

describe('a quote that did not go on WhatsApp (review 8)', () => {
  it('tells the person who sent it, once, when its milestone is not queued', async () => {
    const customer = await customerOnWhatsApp();
    const quote = await sentQuote(customer);
    // The number stopped WhatsApp messages between the send and the worker.
    await run(workers(), recordWhatsAppOptOut, {
      entityId: E,
      threadId: customer.threadId,
      at: new Date().toISOString(),
    });
    const event = await lastEvent('sales.quote.sent', quote.id);
    expect(await handleQuoteSent(event, eventContext())).toBe('opted_out');
    expect(await handleQuoteSent(event, eventContext())).toBe('opted_out');
    const notices = await asMigrator(
      (m) => m<{ user_id: string }[]>`select user_id from notifications
                                        where type = 'whatsapp_quote_not_sent' and subject_id = ${quote.id}`,
    );
    expect(notices).toEqual([{ user_id: lc.id }]);
  });

  it('tells nobody when the quote went', async () => {
    const customer = await customerOnWhatsApp();
    const { quote } = await quoteOnChat(customer);
    const notices = await asMigrator(
      (m) => m`select id from notifications where type = 'whatsapp_quote_not_sent'
                 and subject_id = ${quote.id}`,
    );
    expect(notices).toEqual([]);
  });
});

describe('Accept pressed on WhatsApp (SAL-05)', () => {
  it('accepts a quote under ₹2,00,000 from its own chat and number, and a replay accepts nothing more', async () => {
    const kv = memoryKeyValue();
    const customer = await customerOnWhatsApp();
    const { quote, accept } = await quoteOnChat(customer);
    expect(await press(kv, customer.waId, accept)).toBe('accepted');
    expect(await quoteRow(quote.id)).toEqual({ state: 'accepted', accepted_via: 'whatsapp_reply' });
    const [answer] = await answersOn(customer.threadId);
    expect(answer?.body_masked).toContain(quote.quoteNo);
    expect(await press(kv, customer.waId, accept)).toBe('already_accepted');
    expect(await ordersOf(quote.id)).toBe(1);
  });

  it('accepts nothing for a forged or swapped payload, or one pressed from another number', async () => {
    const kv = memoryKeyValue();
    const customer = await customerOnWhatsApp();
    const other = await customerOnWhatsApp();
    const { quote, accept, talk } = await quoteOnChat(customer);
    const [version, , quoteId, mac] = accept.split('.');
    const forged = `${version ?? ''}.a.${quoteId ?? ''}.${'A'.repeat(mac?.length ?? 43)}`;
    // Talk to us's own MAC under the Accept code: the action is bound, so it verifies to nothing.
    const swapped = `${version ?? ''}.a.${quoteId ?? ''}.${talk.split('.')[3] ?? ''}`;
    expect(await press(kv, customer.waId, forged)).toBe('unverified');
    expect(await press(kv, customer.waId, swapped)).toBe('unverified');
    expect(await press(kv, other.waId, accept)).toBe('unverified');
    expect(await ordersOf(quote.id)).toBe(0);
    expect((await quoteRow(quote.id))?.state).toBe('sent');
  });

  it('makes one order of two presses at once', async () => {
    const kv = memoryKeyValue();
    const customer = await customerOnWhatsApp();
    const { quote, accept } = await quoteOnChat(customer);
    const outcomes = await Promise.all([
      press(kv, customer.waId, accept),
      press(kv, customer.waId, accept),
    ]);
    expect(outcomes.sort()).toEqual(['accepted', 'already_accepted']);
    expect(await ordersOf(quote.id)).toBe(1);
  });

  it('hands the chat to people for Talk to us', async () => {
    const customer = await customerOnWhatsApp();
    const { talk, quote } = await quoteOnChat(customer);
    // The chat is with the assistant, as a chat the Concierge answers is (A3).
    await asMigrator(
      (m) => m`update whatsapp_threads set handled_by = 'assistant', handoff_reason = null,
                      handed_off_at = null where id = ${customer.threadId}`,
    );
    expect(await press(memoryKeyValue(), customer.waId, talk)).toBe('handed_to_people');
    const [thread] = await asMigrator(
      (m) => m<{ handled_by: string; handoff_reason: string | null }[]>`
        select handled_by, handoff_reason from whatsapp_threads where id = ${customer.threadId}`,
    );
    expect(thread).toEqual({ handled_by: 'people', handoff_reason: 'request' });
    expect(await ordersOf(quote.id)).toBe(0);
  });

  it('answers a press on a quote withdrawn for another accepted one with that order (review 6)', async () => {
    const kv = memoryKeyValue();
    const customer = await customerOnWhatsApp();
    const older = await quoteOnChat(customer, 4);
    const newer = await quoteOnChat(customer, 5);
    expect(await press(kv, customer.waId, newer.accept)).toBe('accepted');
    expect((await quoteRow(older.quote.id))?.state).toBe('withdrawn');
    expect(await press(kv, customer.waId, older.accept)).toBe('already_accepted');
    const [answer] = await answersOn(customer.threadId);
    expect(answer?.kind).toBe('text');
    expect(answer?.body_masked).toContain(newer.quote.quoteNo);
    const [order] = await asMigrator(
      (m) =>
        m<{ so_no: string }[]>`select so_no from sales_orders where quote_id = ${newer.quote.id}`,
    );
    expect(answer?.body_masked).toContain(order?.so_no ?? 'no order');
    const notices = await asMigrator(
      (m) => m`select id from notifications where type = 'whatsapp_quote_expired'
                 and subject_id = ${older.quote.id}`,
    );
    expect(notices).toEqual([]);
    expect(await ordersOf(older.quote.id)).toBe(0);
  });

  it('answers a lapsed quote with quote_expired and tells the lead’s owner, once', async () => {
    const customer = await customerOnWhatsApp();
    const { quote, accept } = await quoteOnChat(customer);
    await asMigrator(
      (m) => m`update quotes set valid_until = now() - interval '1 minute' where id = ${quote.id}`,
    );
    const kv = memoryKeyValue();
    expect(await press(kv, customer.waId, accept)).toBe('quote_expired');
    expect(await press(kv, customer.waId, accept)).toBe('quote_expired');
    const [answer] = await answersOn(customer.threadId);
    expect(answer).toMatchObject({ kind: 'template', template_params: [quote.quoteNo] });
    const notices = await asMigrator(
      (m) => m<{ user_id: string }[]>`select user_id from notifications
                                        where type = 'whatsapp_quote_expired' and subject_id = ${quote.id}`,
    );
    expect(notices).toEqual([{ user_id: lc.id }]);
    expect(await ordersOf(quote.id)).toBe(0);
  });
});

describe('the one-time code from ₹2,00,000 (question 5)', () => {
  /** A large quote pressed, its code sent; the code as the worker sends it. */
  async function codeSent(kv: KeyValue) {
    const customer = await customerOnWhatsApp(true);
    // 20 test modules at the test price and rate: over the code's value.
    const { quote, accept } = await quoteOnChat(customer, 20);
    expect(await press(kv, customer.waId, accept)).toBe('code_sent');
    const [message] = await answersOn(customer.threadId);
    // The code's message keeps no value: the code is made only as it is sent.
    expect(message).toMatchObject({ kind: 'template', template_params: [] });
    const sender = fakeSender();
    await sender.send(message?.id ?? '');
    const sent = sender.sent[0] as TemplateMessage;
    const code = sent.bodyParameters[0] ?? '';
    expect(code).toMatch(/^\d{6}$/);
    expect(sent.buttons).toEqual([{ index: 0, kind: 'url', value: code }]);
    expect(await ordersOf(quote.id)).toBe(0);
    return { customer, quote, code };
  }

  it('accepts with whatsapp_otp when the same chat sends the code back, marked for the platform', async () => {
    const kv = memoryKeyValue();
    const { customer, quote, code } = await codeSent(kv);
    expect(await write(kv, customer, code)).toMatchObject({ platform: true });
    expect(await quoteRow(quote.id)).toEqual({ state: 'accepted', accepted_via: 'whatsapp_otp' });
    expect(await ordersOf(quote.id)).toBe(1);
    // The code is kept nowhere: not with the code's message, nor with the customer's reply.
    const kept = await asMigrator(
      (m) => m`select id from whatsapp_messages where thread_id = ${customer.threadId}
                 and (body_masked like ${`%${code}%`} or template_params::text like ${`%${code}%`})`,
    );
    expect(kept).toEqual([]);
  });

  it('sends no second code for a press while the first one waits (review 5)', async () => {
    const kv = memoryKeyValue();
    const { customer, quote, code } = await codeSent(kv);
    const { accept } = acceptOf(customer, quote.id);
    expect(await press(kv, customer.waId, accept)).toBe('code_waiting');
    const codes = (await answersOn(customer.threadId)).filter((a) => a.kind === 'template');
    // The quote's own milestone and one code.
    expect(codes.filter((a) => JSON.stringify(a.template_params) === '[]')).toHaveLength(1);
    // The code sent first still accepts.
    expect(await write(kv, customer, code)).toMatchObject({ platform: true });
    expect(await quoteRow(quote.id)).toEqual({ state: 'accepted', accepted_via: 'whatsapp_otp' });
  });

  it('accepts nothing after a wrong code three times, the right one included', async () => {
    const kv = memoryKeyValue();
    const { customer, quote, code } = await codeSent(kv);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i += 1) {
      expect(await write(kv, customer, wrong)).toMatchObject({ platform: true });
    }
    // A wrong guess is no secret: staff read it as the customer wrote it (review 4).
    const guesses = await asMigrator(
      (m) => m`select id from whatsapp_messages where thread_id = ${customer.threadId}
                 and direction = 'inbound' and body_masked = ${wrong}`,
    );
    expect(guesses).toHaveLength(3);
    const [answer] = await answersOn(customer.threadId);
    expect(answer?.body_masked).toContain('3 times');
    // No code waits any more: six digits are the customer's own message, for people.
    expect(await write(kv, customer, code)).toMatchObject({ platform: false });
    expect(await ordersOf(quote.id)).toBe(0);
  });

  it('accepts nothing for a code after 5 minutes', async () => {
    const kv = memoryKeyValue();
    const { customer, quote, code } = await codeSent(kv);
    const later = () => new Date(Date.now() + 6 * 60_000);
    const before = (await answersOn(customer.threadId)).length;
    // Past its minutes six digits are the customer's own message, for people (review 4).
    expect(await write(kv, customer, code, later)).toMatchObject({ platform: false });
    expect(await answersOn(customer.threadId)).toHaveLength(before);
    expect(await ordersOf(quote.id)).toBe(0);
  });

  it('passes a PIN code sent after the code lapsed to people, as written (review 4)', async () => {
    const kv = memoryKeyValue();
    const { customer, quote } = await codeSent(kv);
    const later = () => new Date(Date.now() + 6 * 60_000);
    const before = (await answersOn(customer.threadId)).length;
    expect(await write(kv, customer, '302019', later)).toMatchObject({ platform: false });
    const kept = await asMigrator(
      (m) => m<{ body_masked: string }[]>`select body_masked from whatsapp_messages
                where thread_id = ${customer.threadId} and direction = 'inbound'
                  and body_masked in ('302019', '••••••')`,
    );
    expect(kept).toEqual([{ body_masked: '302019' }]);
    expect(await answersOn(customer.threadId)).toHaveLength(before);
    expect(await ordersOf(quote.id)).toBe(0);
  });
});

describe('STATUS (WA-03)', () => {
  it('answers from the sender’s own quotes and orders, deterministically, marked for the platform', async () => {
    const kv = memoryKeyValue();
    const mine = await customerOnWhatsApp();
    const theirs = await customerOnWhatsApp();
    const own = await sentQuote(mine);
    const other = await sentQuote(theirs);
    expect(await write(kv, mine, 'Status')).toMatchObject({ platform: true });
    const [answer] = await answersOn(mine.threadId);
    expect(answer?.kind).toBe('text');
    expect(answer?.body_masked).toContain(own.quoteNo);
    expect(answer?.body_masked).not.toContain(other.quoteNo);
    // An ordinary message is the Concierge's or people's to answer.
    expect(await write(kv, mine, 'When will you visit?')).toMatchObject({ platform: false });
  });
});

describe('STATUS after a question (review 1)', () => {
  it('leaves the question waiting for people', async () => {
    const kv = memoryKeyValue();
    // The chat opened with the customer's question, handed to people.
    const customer = await customerOnWhatsApp();
    expect(await write(kv, customer, 'Status')).toMatchObject({ platform: true });
    const [answer] = await answersOn(customer.threadId);
    expect(answer?.kind).toBe('text');
    const [thread] = await asMigrator(
      (m) => m<{ needs_reply: boolean }[]>`select needs_reply from whatsapp_threads
                                             where id = ${customer.threadId}`,
    );
    expect(thread?.needs_reply).toBe(true);
  });
});

describe('the order’s milestone (WA-01)', () => {
  it('goes once the order is confirmed, once', async () => {
    const kv = memoryKeyValue();
    const customer = await customerOnWhatsApp();
    const { quote, accept } = await quoteOnChat(customer);
    expect(await press(kv, customer.waId, accept)).toBe('accepted');
    const [order] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from sales_orders where quote_id = ${quote.id}`,
    );
    const orderId = order?.id ?? '';
    await run(lc, confirmSalesOrder, { entityId: E, orderId });
    const event = await lastEvent('sales.order.confirmed', orderId);
    expect(await handleOrderConfirmed(event, eventContext())).toBe('queued');
    expect(await handleOrderConfirmed(event, eventContext())).toBe('already');
  });
});
