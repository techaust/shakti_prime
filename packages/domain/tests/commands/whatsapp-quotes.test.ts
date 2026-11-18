import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type InboundWhatsAppRecorded,
  type Principal,
  type QuoteAcceptedRemotely,
  type QuoteDto,
  type SalesOrderDto,
  type WhatsAppMilestoneDto,
  type WhatsAppMilestoneSent,
  type NoticeBatchDto,
  type WhatsAppAnswerQueued,
  type WhatsAppTemplateDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  testPhone,
  whatsappChannel,
  type WhatsAppChannelFixture,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { failureOf, runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { recordSizing } from '../../src/commands/crm/record-sizing';
import { setAccountTier } from '../../src/commands/crm/set-account-tier';
import { queueWhatsAppAnswer } from '../../src/commands/messaging/answers';
import {
  sendWhatsAppMilestone,
  setWhatsAppMilestone,
} from '../../src/commands/messaging/milestones';
import { notifyEvent } from '../../src/commands/notifications/notify';
import {
  recordInboundWhatsApp,
  recordWhatsAppOptOut,
  recordWhatsAppTemplateStatus,
} from '../../src/commands/messaging/platform';
import { registerWhatsAppTemplate } from '../../src/commands/messaging/templates';
import { acceptQuote } from '../../src/commands/sales/accept-quote';
import {
  acceptQuoteRemote,
  readRemoteQuoteFacts,
} from '../../src/commands/sales/accept-quote-remote';
import { quoteRecordOf } from '../../src/commands/sales/quote-shared';
import { attachQuotePdf } from '../../src/commands/sales/attach-quote-pdf';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { createQuote } from '../../src/commands/sales/create-quote';
import { sendQuote } from '../../src/commands/sales/send-quote';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { readInboundFacts, readSendExtras } from '../../src/queries/messaging/answers';
import { readMilestoneSubject, readStatusSummary } from '../../src/queries/messaging/milestones';
import { getSalesOrder } from '../../src/queries/sales/list-orders';

// S3 WhatsApp quotes, milestones and STATUS (docs/03-roadmap-appendix/phase2.md §7.1, PRD SAL-05,
// WA-01, WA-03): a quote sent by WhatsApp and the reasons it is refused, the milestone map, a
// milestone sent once per subject or held, and the platform's acceptance of a quote from WhatsApp,
// which makes the order a person's acceptance makes, once, under concurrent presses too. Quotes are
// made in company 2, as quotes.test.ts makes them (its series check runs on its own, the files run
// one at a time). Every price, rate and template here is a synthetic test value made for this
// file, never a client figure; its rows are found by this run's own ids.

const E = 2;
const P = '01990000-0000-7000-8000-000000a6';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const ids = {
  tier: fixed(0x0001),
  list: fixed(0x0002),
  module: fixed(0x0003),
  rateModule: fixed(0x0004),
  priced: fixed(0x0005),
};
const RUN = newId().slice(-8);
/** What a quote's template carries: its PDF as the header and the Accept and Talk to us buttons. */
const QUOTE_TEMPLATE_SHAPE = {
  header: 'document',
  buttons: [
    { kind: 'quick_reply', text: 'Accept' },
    { kind: 'quick_reply', text: 'Talk to us' },
  ],
};

let lc: Principal;
let exec: Principal;
let gm: Principal;
let execOther: Principal;
let channel: WhatsAppChannelFixture;
let quoteTemplate: WhatsAppTemplateDto;
let orderTemplate: WhatsAppTemplateDto;

const workers = (entityIds: number[] = [E]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function failure(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<{ code?: string | undefined; reason?: unknown; stage?: string | undefined }> {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason, stage: failureOf(error)?.stage };
}

async function eventsOf(aggregateId: string): Promise<{ type: string; payload: unknown }[]> {
  const rows = await asOutboxPublisher(
    (p) => p<{ type: string; payload_json: unknown }[]>`
      select type, payload_json from outbox_events where aggregate_id = ${aggregateId}
       order by created_at, type`,
  );
  return rows.map((r) => ({ type: r.type, payload: r.payload_json }));
}

/** A template of company 2 registered by the Executive and approved by Meta's event. */
async function approvedTemplate(
  name: string,
  params: string[],
  extra: object = {},
): Promise<WhatsAppTemplateDto> {
  const template = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
    entityId: E,
    name,
    label: 'S3 test template',
    category: 'utility',
    params,
    ...extra,
  });
  await run(workers([1, 2, 3, 4]), recordWhatsAppTemplateStatus, {
    name,
    language: 'en',
    status: 'approved',
  });
  return { ...template, status: 'approved' };
}

interface Customer {
  leadId: string;
  accountId: string;
  contactId: string;
  waId: string;
}

/**
 * A sized rooftop lead of the LC on the test tier, with a WhatsApp number; a `large` one is sized
 * for 20 modules, so its quote can pass the code's value.
 */
async function sizedLead(large = false): Promise<Customer> {
  const phone = testPhone();
  const lead = await run<{ id: string; account: { id: string }; contact: { id: string } | null }>(
    lc,
    createLead,
    {
      entityId: E,
      pipelineKey: 'residential_rooftop',
      contact: { name: 'S3 test customer', phone },
      account: { type: 'household' },
      site: { type: 'rooftop', village: 'S3 test village' },
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
  return {
    leadId: lead.id,
    accountId: lead.account.id,
    contactId: lead.contact?.id ?? '',
    waId: `91${phone.replace(/^\+?91/, '')}`,
  };
}

/** The customer's chat with company 2's number, opened by their message. */
async function chatOf(customer: Customer): Promise<string> {
  const row = await run<InboundWhatsAppRecorded>(workers(), recordInboundWhatsApp, {
    phoneNumberId: channel.phoneNumberId,
    waId: customer.waId,
    providerMessageId: `wamid.${newId()}`,
    kind: 'text',
    body: 'Please send the quote',
    buttonPayload: null,
    sentAt: new Date().toISOString(),
    handledBy: 'people',
  });
  expect(row.accountId).toBe(customer.accountId);
  return row.threadId;
}

/** The customer's WhatsApp consent, as a recorded opt-in. */
async function consentOf(customer: Customer): Promise<void> {
  await asMigrator(
    (
      m,
    ) => m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
             values (${newId()}, ${customer.contactId}, 'whatsapp', 'service', 'whatsapp_opt_in',
                     's3-test', now(), ${lc.id})`,
  );
}

/** A draft quote of the customer's lead with its PDF attached. */
async function draftQuote(customer: Customer, modules = 5): Promise<QuoteDto> {
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
             values (${pdf}, ${E}, 'quote_pdf', 'local', ${`${String(E)}/quote_pdf/${pdf}`}, 'file',
                     'application/pdf', 10, ${'c'.repeat(64)}, 'ready', ${SYSTEM_WORKERS_PRINCIPAL_ID})`,
  );
  await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId: pdf });
  return { ...quote, pdfFileId: pdf };
}

/** A customer ready for WhatsApp (chat and consent) and a quote of theirs sent by WhatsApp. */
async function whatsappQuote(): Promise<{ customer: Customer; threadId: string; quote: QuoteDto }> {
  const customer = await sizedLead();
  const threadId = await chatOf(customer);
  await consentOf(customer);
  const draft = await draftQuote(customer);
  const quote = await run<QuoteDto>(lc, sendQuote, {
    entityId: E,
    quoteId: draft.id,
    channel: 'whatsapp',
  });
  return { customer, threadId, quote };
}

function acceptRemote(quoteId: string, threadId: string, who: Principal = workers()) {
  return run<QuoteAcceptedRemotely>(who, acceptQuoteRemote, {
    entityId: E,
    quoteId,
    threadId,
    acceptedVia: 'whatsapp_reply',
  });
}

async function ordersOf(quoteId: string): Promise<number> {
  const [row] = await asMigrator(
    (m) =>
      m<{ n: number }[]>`select count(*)::int as n from sales_orders where quote_id = ${quoteId}`,
  );
  return row?.n ?? 0;
}

beforeAll(async () => {
  const teamId = await createTestTeam(E, 's3 team');
  // A person with a user row, so the notices of their leads reach them.
  const user = await createTestUser([{ entityId: E, roleKey: 'tele_caller_lc', teamId }]);
  lc = principalFor('tele_caller_lc', [E], { id: user.id, teamId });
  exec = await createTestPrincipal('executive');
  execOther = await createTestPrincipal('executive', [1]);
  gm = await createTestPrincipal('general_manager', [E]);
  channel = await whatsappChannel(E);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${ids.tier}, 't_s3_test', 'S3 test tier')
        on conflict (id) do update set is_active = true, archived_at = null`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
        (${ids.module}, 'S3-MODULE', 's3 test module', 'solar_module', '8541', 'nos', true,
         ${tx.json({ wp: 540 })})
        on conflict (id) do nothing`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
        values (${ids.list}, ${ids.tier}, ${E}, 1, '2026-04-01', ${exec.id}, now())
        on conflict (id) do update set entity_id = ${E}, archived_at = null, approved_by = ${exec.id}, approved_at = now()`;
      // The price log's trigger needs a person; the price itself is a test row, so it is written
      // with the triggers off for this statement only, as orders.test.ts writes its prices.
      await tx`set local session_replication_role = replica`;
      await tx`insert into price_list_items (id, price_list_id, item_id, price)
        values (${ids.priced}, ${ids.list}, ${ids.module}, 12000.00)
        on conflict (id) do nothing`;
      await tx`set local session_replication_role = origin`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
        values (${ids.rateModule}, ${ids.module}, 12.00, '2026-04-01', 's3 test')
        on conflict (id) do nothing`;
    }),
  );
  quoteTemplate = await approvedTemplate(
    `s3_quote_${RUN}`,
    ['Quote', 'Total', 'Valid until'],
    QUOTE_TEMPLATE_SHAPE,
  );
  orderTemplate = await approvedTemplate(`s3_order_${RUN}`, ['Order', 'Total']);
  await run(exec, setWhatsAppMilestone, {
    entityId: E,
    milestone: 'quote_sent',
    templateId: quoteTemplate.id,
  });
  await run(exec, setWhatsAppMilestone, {
    entityId: E,
    milestone: 'order_confirmed',
    templateId: orderTemplate.id,
  });
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`update price_lists set archived_at = now() where id = ${ids.list}`;
    await m`update price_tiers set is_active = false, archived_at = now() where id = ${ids.tier}`;
  });
  await closeDb();
});

describe('sales.quote.send by WhatsApp (SAL-05)', () => {
  it('keeps the recorded way as the default, naming no chat', async () => {
    const customer = await sizedLead();
    const draft = await draftQuote(customer);
    const sent = await run<QuoteDto>(lc, sendQuote, { entityId: E, quoteId: draft.id });
    expect(sent.state).toBe('sent');
    expect(await eventsOf(draft.id)).toContainEqual({
      type: 'sales.quote.sent',
      payload: {
        v: 1,
        opportunityId: customer.leadId,
        pdfFileId: draft.pdfFileId,
        channel: 'recorded',
        threadId: null,
        sentBy: lc.id,
      },
    });
  });

  it('sends by WhatsApp on the customer’s chat, which the event names for the platform', async () => {
    const { customer, threadId, quote } = await whatsappQuote();
    expect(quote.state).toBe('sent');
    expect(await eventsOf(quote.id)).toContainEqual({
      type: 'sales.quote.sent',
      payload: {
        v: 1,
        opportunityId: customer.leadId,
        pdfFileId: quote.pdfFileId,
        channel: 'whatsapp',
        threadId,
        sentBy: lc.id,
      },
    });
  });

  it('refuses WhatsApp with a reason, and changes nothing, when it cannot be used', async () => {
    const customer = await sizedLead();
    const draft = await draftQuote(customer);
    const send = () =>
      failure(lc, sendQuote, { entityId: E, quoteId: draft.id, channel: 'whatsapp' });
    expect(await send()).toMatchObject({ code: 'conflict', reason: 'whatsapp_quote_no_chat' });
    const threadId = await chatOf(customer);
    expect(await send()).toMatchObject({ reason: 'whatsapp_quote_no_consent' });
    await consentOf(customer);
    await run(exec, setWhatsAppMilestone, {
      entityId: E,
      milestone: 'quote_sent',
      templateId: quoteTemplate.id,
      isActive: false,
    });
    expect(await send()).toMatchObject({ reason: 'whatsapp_quote_template_missing' });
    await run(exec, setWhatsAppMilestone, {
      entityId: E,
      milestone: 'quote_sent',
      templateId: quoteTemplate.id,
    });
    await run(workers(), recordWhatsAppOptOut, {
      entityId: E,
      threadId,
      at: new Date().toISOString(),
    });
    expect(await send()).toMatchObject({ reason: 'whatsapp_opted_out' });
    const [row] = await asMigrator(
      (m) => m<{ state: string }[]>`select state from quotes where id = ${draft.id}`,
    );
    expect(row?.state).toBe('draft');
  });

  it('is refused to a caller without the grant and outside the request’s companies', async () => {
    const customer = await sizedLead();
    const draft = await draftQuote(customer);
    const input = { entityId: E, quoteId: draft.id, channel: 'whatsapp' };
    const cc = await createTestPrincipal('tele_caller_cc', [E]);
    expect(await failure(cc, sendQuote, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(execOther, sendQuote, input)).toMatchObject({ code: 'forbidden' });
  });
});

describe('messaging.milestone.set (WA-01)', () => {
  it('maps a milestone to a template of the company, in place', async () => {
    const first = await run<WhatsAppMilestoneDto>(exec, setWhatsAppMilestone, {
      entityId: E,
      milestone: 'order_confirmed',
      templateId: orderTemplate.id,
    });
    const again = await run<WhatsAppMilestoneDto>(exec, setWhatsAppMilestone, {
      entityId: E,
      milestone: 'order_confirmed',
      templateId: orderTemplate.id,
      isActive: true,
    });
    expect(again).toEqual({ ...first, isActive: true });
    expect(first).toMatchObject({
      entityId: E,
      milestone: 'order_confirmed',
      templateId: orderTemplate.id,
    });
  });

  it('refuses a template that does not fit the milestone', async () => {
    const code = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
      entityId: E,
      name: `s3_code_${RUN}`,
      label: 'S3 test code',
      category: 'authentication',
      params: ['Quote', 'Total', 'Valid until'],
    });
    const set = (templateId: string, milestone = 'quote_sent') =>
      failure(exec, setWhatsAppMilestone, { entityId: E, milestone, templateId });
    expect(await set(code.id)).toMatchObject({ reason: 'whatsapp_milestone_template_unfit' });
    expect(await set(orderTemplate.id)).toMatchObject({ reason: 'whatsapp_milestone_values' });
    expect(await set(newId())).toMatchObject({ reason: 'whatsapp_template_missing' });
    // A milestone with no event before later phases cannot be mapped yet.
    expect(await set(quoteTemplate.id, 'dispatched')).toMatchObject({ code: 'validation_failed' });
  });

  it('maps only a template with the buttons and header its update sends (review 2)', async () => {
    const set = (templateId: string, milestone = 'quote_sent') =>
      failure(exec, setWhatsAppMilestone, { entityId: E, milestone, templateId });
    const values = ['Quote', 'Total', 'Valid until'];
    const bare = await approvedTemplate(`s3_bare_${RUN}`, values);
    const noHeader = await approvedTemplate(`s3_noheader_${RUN}`, values, {
      buttons: QUOTE_TEMPLATE_SHAPE.buttons,
    });
    const oneButton = await approvedTemplate(`s3_onebutton_${RUN}`, values, {
      header: 'document',
      buttons: [{ kind: 'quick_reply', text: 'Accept' }],
    });
    const urlButtons = await approvedTemplate(`s3_urlbuttons_${RUN}`, values, {
      header: 'document',
      buttons: [
        { kind: 'url', text: 'Accept' },
        { kind: 'quick_reply', text: 'Talk to us' },
      ],
    });
    for (const unfit of [bare, noHeader, oneButton, urlButtons]) {
      expect(await set(unfit.id)).toMatchObject({ reason: 'whatsapp_milestone_template_shape' });
    }
    const orderWithButton = await approvedTemplate(`s3_orderbutton_${RUN}`, ['Order', 'Total'], {
      buttons: [{ kind: 'quick_reply', text: 'Thanks' }],
    });
    const orderWithDocument = await approvedTemplate(`s3_orderdoc_${RUN}`, ['Order', 'Total'], {
      header: 'document',
    });
    for (const unfit of [orderWithButton, orderWithDocument]) {
      expect(await set(unfit.id, 'order_confirmed')).toMatchObject({
        reason: 'whatsapp_milestone_template_shape',
      });
    }
    const fit = await approvedTemplate(`s3_fit_${RUN}`, values, QUOTE_TEMPLATE_SHAPE);
    expect(
      await run<WhatsAppMilestoneDto>(exec, setWhatsAppMilestone, {
        entityId: E,
        milestone: 'quote_sent',
        templateId: fit.id,
      }),
    ).toMatchObject({ templateId: fit.id });
    await run(exec, setWhatsAppMilestone, {
      entityId: E,
      milestone: 'quote_sent',
      templateId: quoteTemplate.id,
    });
  });

  it('keeps a mapped template as it is, but for its label (review 2)', async () => {
    const register = (input: object) =>
      failure(exec, registerWhatsAppTemplate, {
        entityId: E,
        name: quoteTemplate.name,
        label: 'S3 test template',
        category: 'utility',
        params: ['Quote', 'Total', 'Valid until'],
        ...QUOTE_TEMPLATE_SHAPE,
        ...input,
      });
    for (const change of [
      { params: ['Quote', 'Total'] },
      { buttons: [{ kind: 'quick_reply', text: 'Accept' }] },
      { header: 'none' },
      { purpose: 'quote_expired', params: ['Quote'] },
      { category: 'marketing' },
    ]) {
      expect(await register(change)).toMatchObject({ reason: 'whatsapp_template_mapped' });
    }
    const relabelled = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
      entityId: E,
      name: quoteTemplate.name,
      label: 'S3 test quote template',
      category: 'utility',
      params: ['Quote', 'Total', 'Valid until'],
      ...QUOTE_TEMPLATE_SHAPE,
    });
    expect(relabelled).toMatchObject({
      id: quoteTemplate.id,
      label: 'S3 test quote template',
      header: 'document',
      params: ['Quote', 'Total', 'Valid until'],
    });
  });

  it('registers the one-time code only as an authentication template with its copy-code button (review 2)', async () => {
    const register = (name: string, input: object) =>
      run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
        entityId: 3,
        name,
        label: 'S3 test code',
        params: ['Code'],
        purpose: 'acceptance_code',
        ...input,
      });
    const refused = (name: string, input: object) =>
      register(name, input).then(
        () => undefined,
        (e: unknown) => (e as { details?: { reason?: unknown } }).details?.reason,
      );
    const urlButton = [{ kind: 'url', text: 'Copy code' }];
    expect(await refused(`s3_code_util_${RUN}`, { category: 'utility', buttons: urlButton })).toBe(
      'whatsapp_template_purpose_shape',
    );
    expect(await refused(`s3_code_nobutton_${RUN}`, { category: 'authentication' })).toBe(
      'whatsapp_template_purpose_shape',
    );
    expect(
      await refused(`s3_code_reply_${RUN}`, {
        category: 'authentication',
        buttons: [{ kind: 'quick_reply', text: 'Copy code' }],
      }),
    ).toBe('whatsapp_template_purpose_shape');
    // One code template a company: a fixed name, updated in place on a later run.
    expect(
      await register('s3_code_ok', { category: 'authentication', buttons: urlButton }),
    ).toMatchObject({ purpose: 'acceptance_code', category: 'authentication' });
  });

  it('is the Executive’s alone, and refused for a company outside the request', async () => {
    const input = { entityId: E, milestone: 'quote_sent', templateId: quoteTemplate.id };
    expect(await failure(gm, setWhatsAppMilestone, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(execOther, setWhatsAppMilestone, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(workers(), setWhatsAppMilestone, input)).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('messaging.milestone.send (WA-01)', () => {
  it('queues the quote’s template once, with its PDF, on the chat the send named', async () => {
    const { threadId, quote } = await whatsappQuote();
    const subject = await asPrincipal(workers(), (context) =>
      readMilestoneSubject(context, {
        entityId: E,
        milestone: 'quote_sent',
        subjectKind: 'quote',
        subjectId: quote.id,
        threadId,
      }),
    );
    expect(subject).toMatchObject({
      ref: quote.quoteNo,
      grandTotal: quote.totals.grandTotal,
      state: 'sent',
      threadId,
      alreadySent: false,
    });
    const input = {
      entityId: E,
      milestone: 'quote_sent',
      subjectKind: 'quote',
      subjectId: quote.id,
      threadId,
      values: [quote.quoteNo, 'Rs 67,200.00', '01-12-2026'],
    };
    const sent = await run<WhatsAppMilestoneSent>(workers(), sendWhatsAppMilestone, input);
    expect(sent).toMatchObject({ outcome: 'queued', threadId });
    const [message] = await asMigrator(
      (m) => m<
        { template_name: string; template_params: string[]; file_id: string; status: string }[]
      >`
        select template_name, template_params, file_id, status from whatsapp_messages
         where id = ${sent.messageId ?? ''}`,
    );
    expect(message).toEqual({
      template_name: quoteTemplate.name,
      template_params: input.values,
      file_id: quote.pdfFileId,
      status: 'queued',
    });
    expect((await eventsOf(threadId)).map((e) => e.type)).toContain('messaging.message.requested');
    expect(await run(workers(), sendWhatsAppMilestone, input)).toEqual({
      outcome: 'already',
      messageId: null,
      threadId: null,
    });
  });

  it('holds a milestone whose template is not approved, once, and sends nothing for it', async () => {
    const pending = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
      entityId: E,
      name: `s3_pending_${RUN}`,
      label: 'S3 test pending',
      category: 'utility',
      params: ['Order', 'Total'],
    });
    await run(exec, setWhatsAppMilestone, {
      entityId: E,
      milestone: 'order_confirmed',
      templateId: pending.id,
    });
    try {
      const { threadId, quote } = await whatsappQuote();
      const accepted = await acceptRemote(quote.id, threadId);
      await run(lc, confirmSalesOrder, { entityId: E, orderId: accepted.orderId });
      const input = {
        entityId: E,
        milestone: 'order_confirmed',
        subjectKind: 'sales_order',
        subjectId: accepted.orderId,
        threadId: null,
        values: [accepted.soNo, 'Rs 67,200.00'],
      };
      expect(await run(workers(), sendWhatsAppMilestone, input)).toEqual({
        outcome: 'held',
        messageId: null,
        threadId: null,
      });
      expect(await run(workers(), sendWhatsAppMilestone, input)).toMatchObject({
        outcome: 'already',
      });
    } finally {
      await run(exec, setWhatsAppMilestone, {
        entityId: E,
        milestone: 'order_confirmed',
        templateId: orderTemplate.id,
      });
    }
  });

  it('sends the order’s milestone only once it is confirmed, to a customer who may get it', async () => {
    const { threadId, quote, customer } = await whatsappQuote();
    const accepted = await acceptRemote(quote.id, threadId);
    const input = {
      entityId: E,
      milestone: 'order_confirmed',
      subjectKind: 'sales_order',
      subjectId: accepted.orderId,
      threadId: null,
      values: [accepted.soNo, 'Rs 67,200.00'],
    };
    expect(await run(workers(), sendWhatsAppMilestone, input)).toMatchObject({
      outcome: 'not_due',
    });
    await run(lc, confirmSalesOrder, { entityId: E, orderId: accepted.orderId });
    await asMigrator(
      (m) => m`update consents set withdrawn_at = now() where contact_id = ${customer.contactId}`,
    );
    expect(await run(workers(), sendWhatsAppMilestone, input)).toMatchObject({
      outcome: 'opted_out',
      threadId,
    });
    await consentOf(customer);
    expect(await run(workers(), sendWhatsAppMilestone, input)).toMatchObject({
      outcome: 'queued',
      threadId,
    });
  });

  it('is the platform’s alone, refused outside the request, for the subject its milestone names', async () => {
    const input = {
      entityId: E,
      milestone: 'quote_sent',
      subjectKind: 'quote',
      subjectId: newId(),
      values: [],
    };
    expect(await failure(lc, sendWhatsAppMilestone, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(exec, sendWhatsAppMilestone, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(workers([1]), sendWhatsAppMilestone, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await failure(workers(), sendWhatsAppMilestone, { ...input, subjectKind: 'sales_order' }),
    ).toMatchObject({ code: 'validation_failed' });
  });
});

describe('sales.quote.accept_remote (SAL-05)', () => {
  it('accepts into the order a signed copy would make, and withdraws the lead’s other quotes', async () => {
    const { customer, threadId, quote } = await whatsappQuote();
    const other = await draftQuote(customer, 2);
    const accepted = await acceptRemote(quote.id, threadId);
    expect(accepted).toMatchObject({ quoteId: quote.id, accepted: true, ownerId: lc.id });
    expect(accepted.soNo).toMatch(/\/SO\/\d{4}-\d{2}\/\d{4,}$/);
    const order = await asPrincipal(lc, (context) =>
      getSalesOrder(context, { entityId: E, orderId: accepted.orderId }),
    );
    expect(order).toMatchObject({
      soNo: accepted.soNo,
      state: 'draft',
      quoteId: quote.id,
      accountId: customer.accountId,
      tierId: ids.tier,
      priceListId: ids.list,
    });
    expect(order.lines).toEqual(quote.lines);
    expect(order.totals).toEqual(quote.totals);
    const [rows] = await asMigrator(
      (m) => m<{ via: string; other: string; withdrawn_for: string }[]>`
        select q.accepted_via as via, o.state as other, o.withdrawn_for_id as withdrawn_for
          from quotes q, quotes o where q.id = ${quote.id} and o.id = ${other.id}`,
    );
    expect(rows).toEqual({ via: 'whatsapp_reply', other: 'withdrawn', withdrawn_for: quote.id });
    expect(await eventsOf(quote.id)).toContainEqual({
      type: 'sales.quote.accepted',
      payload: {
        v: 1,
        opportunityId: customer.leadId,
        orderId: accepted.orderId,
        acceptedVia: 'whatsapp_reply',
        acceptedBy: SYSTEM_WORKERS_PRINCIPAL_ID,
      },
    });
    expect((await eventsOf(other.id)).map((e) => e.type)).toContain('sales.quote.withdrawn');
    expect((await eventsOf(accepted.orderId)).map((e) => e.type)).toEqual(['sales.order.created']);
  });

  it('makes the same order as a person’s acceptance of the same quote', async () => {
    const remote = await whatsappQuote();
    const byWhatsApp = await acceptRemote(remote.quote.id, remote.threadId);
    const person = await whatsappQuote();
    const signed = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
               values (${signed}, ${E}, 'signed_quote', 'local', ${`${String(E)}/signed_quote/${signed}`},
                       'file', 'image/jpeg', 10, ${'c'.repeat(64)}, 'ready', ${lc.id})`,
    );
    const bySignedCopy = await run<QuoteDto>(lc, acceptQuote, {
      entityId: E,
      quoteId: person.quote.id,
      signedFileId: signed,
    });
    const read = (orderId: string) =>
      asPrincipal(lc, (context) => getSalesOrder(context, { entityId: E, orderId }));
    const a: SalesOrderDto = await read(byWhatsApp.orderId);
    const b: SalesOrderDto = await read(bySignedCopy.orderId ?? '');
    const shape = (o: SalesOrderDto) => ({
      state: o.state,
      tierId: o.tierId,
      priceListId: o.priceListId,
      placeOfSupplyState: o.placeOfSupplyState,
      supplyKind: o.supplyKind,
      lines: o.lines,
      totals: o.totals,
    });
    expect(shape(a)).toEqual(shape(b));
  });

  it('answers the same order to a second press, and makes one order under two at once', async () => {
    const first = await whatsappQuote();
    const accepted = await acceptRemote(first.quote.id, first.threadId);
    expect(await acceptRemote(first.quote.id, first.threadId)).toEqual({
      ...accepted,
      accepted: false,
    });
    expect(await ordersOf(first.quote.id)).toBe(1);

    const second = await whatsappQuote();
    const both = await Promise.allSettled([
      acceptRemote(second.quote.id, second.threadId),
      acceptRemote(second.quote.id, second.threadId),
    ]);
    const answers = both.map((r) => (r.status === 'fulfilled' ? r.value : null));
    expect(answers.filter((a) => a?.accepted === true)).toHaveLength(1);
    expect(new Set(answers.map((a) => a?.orderId))).toHaveProperty('size', 1);
    expect(await ordersOf(second.quote.id)).toBe(1);
  });

  it('accepts nothing for a lapsed quote or a chat of another customer', async () => {
    const lapsed = await whatsappQuote();
    await asMigrator(
      (m) =>
        m`update quotes set valid_until = now() - interval '1 minute' where id = ${lapsed.quote.id}`,
    );
    expect(
      await failure(workers(), acceptQuoteRemote, {
        entityId: E,
        quoteId: lapsed.quote.id,
        threadId: lapsed.threadId,
        acceptedVia: 'whatsapp_otp',
      }),
    ).toMatchObject({ code: 'conflict', reason: 'quote_expired' });

    const mine = await whatsappQuote();
    const theirs = await whatsappQuote();
    expect(
      await failure(workers(), acceptQuoteRemote, {
        entityId: E,
        quoteId: mine.quote.id,
        threadId: theirs.threadId,
        acceptedVia: 'whatsapp_reply',
      }),
    ).toMatchObject({ code: 'forbidden', reason: 'whatsapp_quote_not_customer' });
    expect([await ordersOf(lapsed.quote.id), await ordersOf(mine.quote.id)]).toEqual([0, 0]);
  });

  it('refuses a bare press from ₹2,00,000, which needs the code (review 3)', async () => {
    const customer = await sizedLead(true);
    const threadId = await chatOf(customer);
    await consentOf(customer);
    // 20 test modules at the test price and rate: ₹2,68,800, over the code's value.
    const draft = await draftQuote(customer, 20);
    const quote = await run<QuoteDto>(lc, sendQuote, {
      entityId: E,
      quoteId: draft.id,
      channel: 'whatsapp',
    });
    expect(
      await failure(workers(), acceptQuoteRemote, {
        entityId: E,
        quoteId: quote.id,
        threadId,
        acceptedVia: 'whatsapp_reply',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'whatsapp_code_required' });
    expect(await ordersOf(quote.id)).toBe(0);
    const byCode = await run<QuoteAcceptedRemotely>(workers(), acceptQuoteRemote, {
      entityId: E,
      quoteId: quote.id,
      threadId,
      acceptedVia: 'whatsapp_otp',
    });
    expect(byCode.accepted).toBe(true);
    // Pressed again after the code accepted it: the order it made, still without a code.
    expect(await acceptRemote(quote.id, threadId)).toEqual({ ...byCode, accepted: false });
  });

  it('answers a press on a quote withdrawn for another accepted quote with that order (review 6)', async () => {
    const customer = await sizedLead();
    const threadId = await chatOf(customer);
    await consentOf(customer);
    const send = async (modules: number) =>
      run<QuoteDto>(lc, sendQuote, {
        entityId: E,
        quoteId: (await draftQuote(customer, modules)).id,
        channel: 'whatsapp',
      });
    const older = await send(4);
    const newer = await send(5);
    const accepted = await acceptRemote(newer.id, threadId);
    expect(await acceptRemote(older.id, threadId)).toEqual({
      quoteId: newer.id,
      quoteNo: newer.quoteNo,
      orderId: accepted.orderId,
      soNo: accepted.soNo,
      accepted: false,
      ownerId: lc.id,
    });
    expect(await ordersOf(older.id)).toBe(0);
  });

  it('reads the quote for the machine as every other quote command does (review 7)', async () => {
    const { threadId, quote } = await whatsappQuote();
    const facts = await asPrincipal(workers(), (context) =>
      readRemoteQuoteFacts(context, { entityId: E, quoteId: quote.id, threadId }),
    );
    const [row] = await asMigrator(
      (m) =>
        m<
          {
            state: string;
            tier_id: string;
            price_list_id: string;
            pdf_file_id: string | null;
            valid_until: Date;
          }[]
        >`select state, tier_id, price_list_id, pdf_file_id, valid_until from quotes where id = ${quote.id}`,
    );
    expect(facts?.record).toEqual(
      quoteRecordOf({
        state: row?.state ?? '',
        tierId: row?.tier_id ?? '',
        priceListId: row?.price_list_id ?? '',
        pdfFileId: row?.pdf_file_id ?? null,
        validUntil: row?.valid_until ?? new Date(0),
      }),
    );
  });

  it('is the platform’s alone, and refused for a company outside the request', async () => {
    const { threadId, quote } = await whatsappQuote();
    const input = { entityId: E, quoteId: quote.id, threadId, acceptedVia: 'whatsapp_reply' };
    for (const who of [lc, exec, gm]) {
      expect(await failure(who, acceptQuoteRemote, input)).toMatchObject({ code: 'forbidden' });
    }
    expect(await failure(workers([1]), acceptQuoteRemote, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(await ordersOf(quote.id)).toBe(0);
  });
});

describe('STATUS (WA-03)', () => {
  it('reads the chat’s own customer’s quotes and orders', async () => {
    const mine = await whatsappQuote();
    const theirs = await whatsappQuote();
    const accepted = await acceptRemote(mine.quote.id, mine.threadId);
    const lines = await asPrincipal(workers(), (context) =>
      readStatusSummary(context, mine.threadId),
    );
    expect(lines.map((l) => `${l.kind}:${l.ref}:${l.state}`)).toEqual([
      `quote:${mine.quote.quoteNo}:accepted`,
      `order:${accepted.soNo}:draft`,
    ]);
    expect(lines.some((l) => l.ref === theirs.quote.quoteNo)).toBe(false);
  });
});

/** The company's template of a platform purpose, registered and approved once for the suites. */
async function purposeTemplate(
  entityId: number,
  purpose: 'acceptance_code' | 'quote_expired',
): Promise<string> {
  const [category, params] =
    purpose === 'acceptance_code' ? ['authentication', ['Code']] : ['utility', ['Quote']];
  await asMigrator(async (m) => {
    await m`insert into whatsapp_templates (id, entity_id, name, label, category, status, params, purpose, created_by)
      values (${newId()}, ${entityId}, ${`s3_${purpose}_${String(entityId)}`}, 'S3 test answer',
              ${category}, 'approved', ${m.json(params)}, ${purpose}, ${exec.id})
      on conflict do nothing`;
    await m`update whatsapp_templates set status = 'approved'
             where entity_id = ${entityId} and purpose = ${purpose}`;
  });
  const [row] = await asMigrator(
    (m) => m<{ name: string }[]>`select name from whatsapp_templates
                                   where entity_id = ${entityId} and purpose = ${purpose}`,
  );
  return row?.name ?? '';
}

async function messageRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        kind: string;
        template_name: string | null;
        template_params: unknown;
        body_masked: string | null;
        status: string;
      }[]
    >`select kind, template_name, template_params, body_masked, status
        from whatsapp_messages where id = ${id}`,
  );
  return row;
}

describe('messaging.answer.queue (docs/03-roadmap-appendix/phase2.md §7.1)', () => {
  it('queues a text, the code with no value kept, and the lapsed-quote answer, each with its event', async () => {
    const { threadId, quote } = await whatsappQuote();
    const codeTemplate = await purposeTemplate(E, 'acceptance_code');
    const expiredTemplate = await purposeTemplate(E, 'quote_expired');
    const answer = (body: object, messageId = newId()) =>
      run<WhatsAppAnswerQueued>(workers(), queueWhatsAppAnswer, {
        entityId: E,
        threadId,
        messageId,
        answer: body,
      });

    const text = await answer({ kind: 'text', body: 'Your quotes and orders with us:' });
    expect(text.outcome).toBe('queued');
    expect(await messageRow(text.messageId ?? '')).toEqual({
      kind: 'text',
      template_name: null,
      template_params: null,
      body_masked: 'Your quotes and orders with us:',
      status: 'queued',
    });
    const codeId = newId();
    expect(await answer({ kind: 'acceptance_code' }, codeId)).toEqual({
      outcome: 'queued',
      messageId: codeId,
    });
    // The code is never kept: its message holds no value, and the worker makes it as it sends.
    expect(await messageRow(codeId)).toMatchObject({
      kind: 'template',
      template_name: codeTemplate,
      template_params: [],
    });
    const extras = await asPrincipal(workers(), (context) => readSendExtras(context, codeId));
    expect(extras).toEqual({ milestone: null, templatePurpose: 'acceptance_code', file: null });
    const expired = await answer({ kind: 'quote_expired', quoteNo: quote.quoteNo });
    expect(await messageRow(expired.messageId ?? '')).toMatchObject({
      template_name: expiredTemplate,
      template_params: [quote.quoteNo],
    });
    const requested = (await eventsOf(threadId)).filter(
      (e) => e.type === 'messaging.message.requested',
    );
    expect(requested.map((e) => (e.payload as { messageId: string }).messageId)).toEqual(
      expect.arrayContaining([text.messageId, codeId, expired.messageId]),
    );

    await run(workers(), recordWhatsAppOptOut, {
      entityId: E,
      threadId,
      at: new Date().toISOString(),
    });
    expect(await answer({ kind: 'text', body: 'Anything' })).toEqual({
      outcome: 'opted_out',
      messageId: null,
    });
  });

  it('leaves a question the customer wrote waiting for people, and their notice due (review 1)', async () => {
    // The chat opened with the customer's question, handed to people, on the LC's lead.
    const { threadId } = await whatsappQuote();
    const answered = await run<WhatsAppAnswerQueued>(workers(), queueWhatsAppAnswer, {
      entityId: E,
      threadId,
      messageId: newId(),
      answer: { kind: 'text', body: 'Your quotes and orders with us:' },
    });
    expect(answered.outcome).toBe('queued');
    const [thread] = await asMigrator(
      (m) => m<{ needs_reply: boolean }[]>`select needs_reply from whatsapp_threads
                                             where id = ${threadId}`,
    );
    expect(thread?.needs_reply).toBe(true);
    // The reply-waiting scan finds it once the wait has passed (a minute from now here).
    const waitedBefore = new Date(Date.now() + 60_000).toISOString();
    const waiting = await asPrincipal(
      workers(),
      async (context) =>
        (await context.tx.execute(
          sql`select thread_id, user_id from app.notice_whatsapp_waiting(${E}::smallint, ${waitedBefore}::timestamptz, 1000)`,
        )) as unknown as { thread_id: string; user_id: string }[],
    );
    expect(waiting).toContainEqual({ thread_id: threadId, user_id: lc.id });
  });

  it('answers that a company without the code template has none to send', async () => {
    const four = await whatsappChannel(4);
    const recorded = await run<InboundWhatsAppRecorded>(workers([4]), recordInboundWhatsApp, {
      phoneNumberId: four.phoneNumberId,
      waId: `91${testPhone().replace(/^\+?91/, '')}`,
      providerMessageId: `wamid.${newId()}`,
      kind: 'text',
      body: 'Hello',
      buttonPayload: null,
      sentAt: new Date().toISOString(),
      handledBy: 'people',
    });
    // No suite registers a code template for company 4.
    expect(
      await run(workers([4]), queueWhatsAppAnswer, {
        entityId: 4,
        threadId: recorded.threadId,
        messageId: newId(),
        answer: { kind: 'acceptance_code' },
      }),
    ).toEqual({ outcome: 'no_template', messageId: null });
  });

  it('is the platform’s alone, and refused for a company outside the request', async () => {
    const { threadId } = await whatsappQuote();
    const input = {
      entityId: E,
      threadId,
      messageId: newId(),
      answer: { kind: 'text', body: 'Hello' },
    };
    for (const who of [lc, exec, gm]) {
      expect(await failure(who, queueWhatsAppAnswer, input)).toMatchObject({ code: 'forbidden' });
    }
    expect(await failure(workers([1]), queueWhatsAppAnswer, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(await messageRow(input.messageId)).toBeUndefined();
  });
});

describe('the platform’s reads of a press and a send (§7.1)', () => {
  it('reads an inbound message’s chat, number and button, never another company’s', async () => {
    const customer = await sizedLead();
    const recorded = await run<InboundWhatsAppRecorded>(workers(), recordInboundWhatsApp, {
      phoneNumberId: channel.phoneNumberId,
      waId: customer.waId,
      providerMessageId: `wamid.${newId()}`,
      kind: 'button',
      body: 'Accept',
      buttonPayload: 'q1.a.button',
      sentAt: new Date().toISOString(),
      handledBy: 'people',
    });
    expect(
      await asPrincipal(workers(), (context) => readInboundFacts(context, recorded.messageId)),
    ).toEqual({
      messageId: recorded.messageId,
      entityId: E,
      threadId: recorded.threadId,
      kind: 'button',
      buttonPayload: 'q1.a.button',
      waId: customer.waId,
      accountId: customer.accountId,
    });
    expect(
      await asPrincipal(workers([1]), (context) => readInboundFacts(context, recorded.messageId)),
    ).toBeNull();
    expect(await eventsOf(recorded.threadId)).toContainEqual({
      type: 'messaging.button.pressed',
      payload: {
        v: 1,
        messageId: recorded.messageId,
        accountId: customer.accountId,
        firstMessage: true,
      },
    });
  });

  it('marks a message the platform answers, so no agent drafts a reply to it', async () => {
    const customer = await sizedLead();
    const recorded = await run<InboundWhatsAppRecorded>(workers(), recordInboundWhatsApp, {
      phoneNumberId: channel.phoneNumberId,
      waId: customer.waId,
      providerMessageId: `wamid.${newId()}`,
      kind: 'text',
      body: 'STATUS',
      buttonPayload: null,
      sentAt: new Date().toISOString(),
      handledBy: 'people',
      platform: true,
    });
    expect(await eventsOf(recorded.threadId)).toContainEqual({
      type: 'messaging.message.received',
      payload: {
        v: 1,
        messageId: recorded.messageId,
        kind: 'text',
        accountId: customer.accountId,
        firstMessage: true,
        platform: true,
      },
    });
  });

  it('reads a milestone message’s quote and PDF for the worker', async () => {
    const { threadId, quote } = await whatsappQuote();
    const sent = await run<WhatsAppMilestoneSent>(workers(), sendWhatsAppMilestone, {
      entityId: E,
      milestone: 'quote_sent',
      subjectKind: 'quote',
      subjectId: quote.id,
      threadId,
      values: [quote.quoteNo, 'Rs 67,200.00', '01-12-2026'],
    });
    expect(
      await asPrincipal(workers(), (context) => readSendExtras(context, sent.messageId ?? '')),
    ).toEqual({
      milestone: { name: 'quote_sent', subjectKind: 'quote', subjectId: quote.id },
      templatePurpose: null,
      file: {
        bucket: 'local',
        key: `${String(E)}/quote_pdf/${quote.pdfFileId ?? ''}`,
        name: 'file',
        status: 'ready',
      },
    });
  });
});

describe('the notices of a quote (§7.1)', () => {
  const notify = (input: object) =>
    run<NoticeBatchDto>(workers(), notifyEvent, { entityId: E, eventId: newId(), ...input });

  it('tells the lead’s owner once when a quote is accepted, unless they recorded it', async () => {
    const { quote, threadId } = await whatsappQuote();
    await acceptRemote(quote.id, threadId);
    const accepted = { event: 'sales.quote.accepted', quoteId: quote.id };
    expect(await notify({ ...accepted, acceptedBy: lc.id }).then((b) => b.notices)).toEqual([]);
    const batch = await notify({ ...accepted, acceptedBy: SYSTEM_WORKERS_PRINCIPAL_ID });
    expect(batch.notices).toMatchObject([
      {
        userId: lc.id,
        type: 'quote_accepted',
        subjectId: quote.id,
        payload: { quoteId: quote.id },
      },
    ]);
    expect(
      (await notify({ ...accepted, acceptedBy: SYSTEM_WORKERS_PRINCIPAL_ID })).notices,
    ).toEqual([]);
  });

  it('tells the person who sent a quote on WhatsApp, once, when it did not go (review 8)', async () => {
    const { quote } = await whatsappQuote();
    const notSent = { event: 'sales.quote.sent', quoteId: quote.id, sentBy: lc.id };
    expect((await notify(notSent)).notices).toMatchObject([
      {
        userId: lc.id,
        type: 'whatsapp_quote_not_sent',
        subjectId: quote.id,
        payload: { quoteId: quote.id },
      },
    ]);
    expect((await notify(notSent)).notices).toEqual([]);
  });

  it('tells the owner once when Accept is pressed on a lapsed quote, never on an open one', async () => {
    const open = await whatsappQuote();
    const pressed = { event: 'messaging.button.pressed' };
    expect((await notify({ ...pressed, quoteId: open.quote.id })).notices).toEqual([]);
    await asMigrator(
      (m) =>
        m`update quotes set valid_until = now() - interval '1 minute' where id = ${open.quote.id}`,
    );
    expect((await notify({ ...pressed, quoteId: open.quote.id })).notices).toMatchObject([
      { userId: lc.id, type: 'whatsapp_quote_expired', subjectId: open.quote.id },
    ]);
    expect((await notify({ ...pressed, quoteId: open.quote.id })).notices).toEqual([]);
  });
});
