import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type InboundWhatsAppRecorded,
  type Principal,
  type WhatsAppMessageDto,
  type WhatsAppMessageQueued,
  type WhatsAppTemplateDto,
  type WhatsAppThreadDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  whatsappChannel,
  whatsappCustomer,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  attachWhatsAppMedia,
  claimWhatsAppMessage,
  matchWhatsAppThread,
  queueWhatsAppMessage,
  recordInboundWhatsApp,
  recordWhatsAppHandOff,
  recordWhatsAppOptOut,
  recordWhatsAppSend,
  recordWhatsAppStatus,
  recordWhatsAppTemplateStatus,
} from '../../src/commands/messaging/platform';
import { sendWhatsAppMessage } from '../../src/commands/messaging/send-message';
import { registerWhatsAppTemplate } from '../../src/commands/messaging/templates';
import { handOffWhatsAppThread, returnWhatsAppThread } from '../../src/commands/messaging/threads';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// W1 WhatsApp threads and messaging (docs/03-roadmap-appendix/phase2.md §6.1; PRD WA-04 and
// CRM-10): a person queues a message on a thread they may message, inside the window or as an
// approved template, never to a number that opted out; a person takes a thread over and gives it
// back; an Executive registers templates; and the platform (`system:workers`, `messaging.process`)
// records inbound messages, statuses, template states, a STOP and a hand-off, queues the welcome
// and the STOP's confirmation, and takes and records a send. Company 1's WhatsApp number holds the
// suite's threads; every customer is new on each run, the company's templates are registered
// again under the same names.

/** A valid Aadhaar number (its Verhoeff check digit is 4). */
const AADHAAR = '234567890124';
const WELCOME = 'w1_suite_welcome';
const STOP_NOTE = 'w1_suite_stop_note';
const UPDATE = 'w1_suite_visit_update';

const workers = (entityIds: number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; reason: string | undefined }> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: string } };
    return { code: err.code, reason: err.details?.reason };
  }
  throw new Error('expected a refusal');
}

async function eventsOf(threadId: string) {
  return asOutboxPublisher(
    (p) => p<{ type: string; entity_id: number; payload_json: Record<string, unknown> }[]>`
      select type, entity_id, payload_json from outbox_events
       where aggregate_id = ${threadId} order by sequence`,
  );
}

async function auditOf(aggregateId: string) {
  return asMigrator(
    (m) => m<{ command: string; outcome: string; input_json: unknown; after_json: unknown }[]>`
      select command, outcome, input_json, after_json from audit_logs
       where aggregate_id = ${aggregateId} order by created_at`,
  );
}

let channel: WhatsAppChannelFixture;
let exec: Principal;
let execElsewhere: Principal;
let gm: Principal;
let accounts: Principal;

/** A customer message from `waId` to company 1's number, as the platform records it. */
function receive(
  waId: string,
  extra: { kind?: 'text' | 'button'; body?: string | null; id?: string; at?: string } = {},
) {
  return run<InboundWhatsAppRecorded>(workers([1, 2]), recordInboundWhatsApp, {
    phoneNumberId: channel.phoneNumberId,
    waId,
    providerMessageId: extra.id ?? `wamid.${newId()}`,
    kind: extra.kind ?? 'text',
    body: extra.body === undefined ? 'Is the pump in stock?' : extra.body,
    buttonPayload: extra.kind === 'button' ? 'Talk to a person' : null,
    sentAt: extra.at ?? new Date().toISOString(),
  });
}

/** A new customer of company 1 who has written once: the thread is open and its window too. */
async function customerWithThread(): Promise<
  WhatsAppCustomerFixture & { threadId: string }
> {
  const customer = await whatsappCustomer(1);
  const recorded = await receive(customer.waId);
  return { ...customer, threadId: recorded.threadId };
}

beforeAll(async () => {
  channel = await whatsappChannel(1);
  exec = await createTestPrincipal('executive', [1]);
  execElsewhere = await createTestPrincipal('executive', [2]);
  gm = await createTestPrincipal('general_manager', [1]);
  accounts = await createTestPrincipal('accounts', [1]);
  // The company's templates, registered again on every run under the same names.
  for (const input of [
    { name: WELCOME, category: 'utility', purpose: 'welcome' },
    { name: STOP_NOTE, category: 'utility', purpose: 'opt_out_confirmation' },
    { name: UPDATE, category: 'utility', params: ['Visit date'] },
  ]) {
    await run(exec, registerWhatsAppTemplate, { entityId: 1, ...input });
  }
  await run(workers([1]), recordWhatsAppTemplateStatus, {
    name: UPDATE,
    language: 'en',
    status: 'approved',
  });
});

afterAll(closeDb);

describe('messaging.message.send', () => {
  const text = (who: Principal, threadId: string, body = 'Your engineer visits tomorrow.') =>
    run<WhatsAppMessageDto>(who, sendWhatsAppMessage, {
      entityId: 1,
      threadId,
      kind: 'text',
      body,
    });

  it('is forbidden without messaging.send, and to an agent that holds none', async () => {
    const customer = await customerWithThread();
    for (const who of [accounts, principalFor('agent:concierge', [1]), principalFor('hr_admin', [1])]) {
      expect(await refusal(text(who, customer.threadId))).toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a company outside the request, and a thread of another company', async () => {
    const customer = await customerWithThread();
    const elsewhere = { ...customer.owner, entityIds: [2] };
    expect(await refusal(text(elsewhere, customer.threadId))).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(
        run(execElsewhere, sendWhatsAppMessage, {
          entityId: 2,
          threadId: customer.threadId,
          kind: 'text',
          body: 'Hello',
        }),
      ),
    ).toMatchObject({ code: 'not_found', reason: 'whatsapp_thread_missing' });
  });

  it('queues a masked message in the window, emits it for the worker and keeps the text off the audit row', async () => {
    const customer = await customerWithThread();
    const sent = await text(
      customer.owner,
      customer.threadId,
      `Aadhaar ${AADHAAR} and bank account number 123456789012 noted.`,
    );
    expect(sent).toMatchObject({
      direction: 'outbound',
      kind: 'text',
      status: 'queued',
      sentBy: customer.owner.id,
    });
    expect(sent.body).not.toContain(AADHAAR);
    expect(sent.body).not.toContain('123456789012');
    expect(sent.body).toContain('0124');
    const [stored] = await asMigrator(
      (m) => m<{ body_masked: string; status: string }[]>`
        select body_masked, status from whatsapp_messages where id = ${sent.id}`,
    );
    expect(stored).toEqual({ body_masked: sent.body, status: 'queued' });
    const events = await eventsOf(customer.threadId);
    expect(events.at(-1)).toMatchObject({
      type: 'messaging.message.requested',
      entity_id: 1,
      payload_json: { messageId: sent.id, threadId: customer.threadId, kind: 'text' },
    });
    const [row] = await auditOf(sent.id);
    expect(row).toMatchObject({ command: 'messaging.message.send', outcome: 'ok' });
    expect(JSON.stringify(row?.input_json)).not.toContain('noted');
    const [thread] = await asMigrator(
      (m) => m<{ needs_reply: boolean }[]>`select needs_reply from whatsapp_threads
                                             where id = ${customer.threadId}`,
    );
    expect(thread?.needs_reply).toBe(false);
  });

  it('refuses free text once the window has closed, and a caller of another team', async () => {
    const customer = await whatsappCustomer(1);
    const old = await receive(customer.waId, {
      at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    });
    expect(await refusal(text(customer.owner, old.threadId))).toMatchObject({
      reason: 'whatsapp_window_closed',
    });
    const stranger = await createTestPrincipal('tele_caller_cc', [1]);
    expect(await refusal(text(stranger, old.threadId))).toMatchObject({
      reason: 'whatsapp_thread_missing',
    });
  });

  it('sends an approved template with its values, and refuses one unknown, unapproved or short of values', async () => {
    const customer = await customerWithThread();
    const template = (name: string, params: string[]) =>
      run<WhatsAppMessageDto>(customer.owner, sendWhatsAppMessage, {
        entityId: 1,
        threadId: customer.threadId,
        kind: 'template',
        templateName: name,
        params,
      });
    expect(await refusal(template('w1_suite_unknown', []))).toMatchObject({
      reason: 'whatsapp_template_missing',
    });
    // A template the platform sends for a purpose is not offered to people.
    expect(await refusal(template(WELCOME, []))).toMatchObject({
      reason: 'whatsapp_template_missing',
    });
    expect(await refusal(template(UPDATE, []))).toMatchObject({
      reason: 'whatsapp_template_values',
    });
    const sent = await template(UPDATE, ['28-11-2026']);
    expect(sent).toMatchObject({ kind: 'template', templateName: UPDATE, templateParams: ['28-11-2026'] });
    const pending = `w1_suite_pending_${newId().slice(-6).replaceAll('-', '')}`;
    await run(exec, registerWhatsAppTemplate, { entityId: 1, name: pending, category: 'marketing' });
    expect(await refusal(template(pending, []))).toMatchObject({
      reason: 'whatsapp_template_not_approved',
    });
  });

  it('refuses a customer who opted out', async () => {
    const customer = await customerWithThread();
    await run(workers([1]), recordWhatsAppOptOut, {
      entityId: 1,
      threadId: customer.threadId,
      at: new Date().toISOString(),
    });
    expect(await refusal(text(customer.owner, customer.threadId))).toMatchObject({
      code: 'conflict',
      reason: 'whatsapp_opted_out',
    });
  });
});

describe('messaging.thread.hand_off and messaging.thread.return_to_assistant', () => {
  it('is forbidden without messaging.send, and to every agent (people only)', async () => {
    const customer = await customerWithThread();
    const input = { entityId: 1, threadId: customer.threadId };
    expect(
      await refusal(run(accounts, handOffWhatsAppThread, { ...input, reason: 'request' })),
    ).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(accounts, returnWhatsAppThread, input))).toMatchObject({
      code: 'forbidden',
    });
    const agent = principalFor('agent:concierge', [1]);
    expect(
      await refusal(run(agent, handOffWhatsAppThread, { ...input, reason: 'request' })),
    ).toMatchObject({ code: 'forbidden', reason: 'people_only' });
    expect(await refusal(run(agent, returnWhatsAppThread, input))).toMatchObject({
      code: 'forbidden',
      reason: 'people_only',
    });
  });

  it('refuses a company outside the request', async () => {
    const customer = await customerWithThread();
    const input = { entityId: 1, threadId: customer.threadId };
    const elsewhere = { ...customer.owner, entityIds: [2] };
    expect(
      await refusal(run(elsewhere, handOffWhatsAppThread, { ...input, reason: 'request' })),
    ).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(elsewhere, returnWhatsAppThread, input))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('hands the thread to people with the reason, then back, each audited once', async () => {
    const customer = await customerWithThread();
    const input = { entityId: 1, threadId: customer.threadId };
    const taken = await run<WhatsAppThreadDto>(customer.owner, handOffWhatsAppThread, {
      ...input,
      reason: 'complaint',
    });
    expect(taken).toMatchObject({
      handledBy: 'people',
      handoffReason: 'complaint',
      accountId: customer.accountId,
      number: customer.e164,
      optedOut: false,
    });
    // Again changes nothing; the team lead of another team may not.
    await run(customer.owner, handOffWhatsAppThread, { ...input, reason: 'request' });
    const back = await run<WhatsAppThreadDto>(customer.owner, returnWhatsAppThread, input);
    expect(back).toMatchObject({ handledBy: 'assistant', handoffReason: null, handedOffAt: null });
    const rows = await auditOf(customer.threadId);
    expect(rows.map((r) => r.command)).toEqual([
      'messaging.thread.hand_off',
      'messaging.thread.return_to_assistant',
    ]);
    const lead = await createTestPrincipal('sales_team_lead', [1]);
    expect(
      await refusal(run(lead, handOffWhatsAppThread, { ...input, reason: 'request' })),
    ).toMatchObject({ code: 'not_found' });
    // A General Manager messages every customer of the company.
    expect(
      await run<WhatsAppThreadDto>(gm, handOffWhatsAppThread, { ...input, reason: 'request' }),
    ).toMatchObject({ handledBy: 'people' });
  });
});

describe('messaging.template.register', () => {
  const name = () => `w1_suite_${newId().slice(-12).replaceAll('-', '')}`;

  it('is forbidden to a General Manager and to every agent', async () => {
    for (const who of [gm, principalFor('agent:concierge', [1])]) {
      expect(
        await refusal(
          run(who, registerWhatsAppTemplate, { entityId: 1, name: name(), category: 'utility' }),
        ),
      ).toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a company outside the request', async () => {
    expect(
      await refusal(
        run(execElsewhere, registerWhatsAppTemplate, {
          entityId: 1,
          name: name(),
          category: 'utility',
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('registers a template as pending, updates it in place keeping its status, and audits each', async () => {
    const n = name();
    const first = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
      entityId: 1,
      name: n,
      category: 'utility',
      params: ['Customer name'],
      buttons: [{ kind: 'quick_reply', text: 'Call me' }],
    });
    expect(first).toMatchObject({ status: 'pending', language: 'en', purpose: null });
    await run(workers([1]), recordWhatsAppTemplateStatus, {
      name: n,
      language: 'en',
      status: 'approved',
    });
    const again = await run<WhatsAppTemplateDto>(exec, registerWhatsAppTemplate, {
      entityId: 1,
      name: n,
      category: 'marketing',
      params: [],
    });
    expect(again).toMatchObject({ id: first.id, category: 'marketing', status: 'approved' });
    expect((await auditOf(first.id)).map((r) => r.command)).toEqual([
      'messaging.template.register',
      'messaging.template.record_status',
      'messaging.template.register',
    ]);
  });

  it('keeps one template for each purpose, with no values to fill', async () => {
    expect(
      await refusal(
        run(exec, registerWhatsAppTemplate, {
          entityId: 1,
          name: name(),
          category: 'utility',
          purpose: 'welcome',
          params: ['Customer name'],
        }),
      ),
    ).toMatchObject({ reason: 'whatsapp_template_purpose_values' });
    expect(
      await refusal(
        run(exec, registerWhatsAppTemplate, {
          entityId: 1,
          name: name(),
          category: 'utility',
          purpose: 'welcome',
        }),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'whatsapp_template_purpose_taken' });
  });
});

describe('messaging.inbound.record', () => {
  it('is forbidden to people and agents: the platform records inbound messages', async () => {
    const customer = await whatsappCustomer(1);
    for (const who of [exec, customer.owner, principalFor('agent:concierge', [1])]) {
      expect(
        await refusal(
          run(who, recordInboundWhatsApp, {
            phoneNumberId: channel.phoneNumberId,
            waId: customer.waId,
            providerMessageId: `wamid.${newId()}`,
            kind: 'text',
            body: 'Hello',
            buttonPayload: null,
            sentAt: new Date().toISOString(),
          }),
        ),
      ).toMatchObject({ code: 'forbidden' });
    }
  });

  it("finds no company for another company's number when acting for company 2 alone", async () => {
    const customer = await whatsappCustomer(1);
    expect(
      await refusal(
        run(workers([2]), recordInboundWhatsApp, {
          phoneNumberId: channel.phoneNumberId,
          waId: customer.waId,
          providerMessageId: `wamid.${newId()}`,
          kind: 'text',
          body: 'Hello',
          buttonPayload: null,
          sentAt: new Date().toISOString(),
        }),
      ),
    ).toMatchObject({ code: 'not_found', reason: 'whatsapp_number_unknown' });
  });

  it('stores a message once, masked, and emits it once with ids only', async () => {
    const customer = await whatsappCustomer(1);
    const id = `wamid.${newId()}`;
    const first = await receive(customer.waId, { id, body: `My Aadhaar is ${AADHAAR}` });
    expect(first).toMatchObject({
      entityId: 1,
      duplicate: false,
      firstMessage: true,
      accountId: customer.accountId,
      opportunityId: customer.opportunityId,
      holders: 1,
      optedOut: false,
      handledBy: 'assistant',
    });
    const again = await receive(customer.waId, { id, body: `My Aadhaar is ${AADHAAR}` });
    expect(again).toMatchObject({ duplicate: true, messageId: first.messageId });
    const [stored] = await asMigrator(
      (m) => m<{ body_masked: string }[]>`select body_masked from whatsapp_messages
                                           where id = ${first.messageId}`,
    );
    expect(stored?.body_masked).not.toContain(AADHAAR);
    expect(stored?.body_masked).toContain('0124');
    const button = await receive(customer.waId, { kind: 'button', body: 'Talk to a person' });
    const events = await eventsOf(first.threadId);
    expect(events.map((e) => [e.type, e.payload_json.messageId])).toEqual([
      ['messaging.message.received', first.messageId],
      ['messaging.button.pressed', button.messageId],
    ]);
    expect(JSON.stringify(events)).not.toContain('Aadhaar');
    expect(events[0]?.payload_json).toMatchObject({ firstMessage: true, kind: 'text' });
    // Bookkeeping: no audit row for a stored message.
    expect(await auditOf(first.threadId)).toEqual([]);
  });
});

describe('messaging.thread.match', () => {
  it('is forbidden to people, and refuses a company outside the request', async () => {
    const one = await whatsappCustomer(1);
    await whatsappCustomer(1, { e164: one.e164 });
    const thread = await receive(one.waId);
    const input = { entityId: 1, threadId: thread.threadId, accountId: one.accountId };
    expect(await refusal(run(exec, matchWhatsAppThread, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(run(workers([2]), matchWhatsAppThread, input))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('matches a thread several customers hold to the one the intake names, audited', async () => {
    const one = await whatsappCustomer(1);
    const two = await whatsappCustomer(1, { e164: one.e164 });
    const thread = await receive(one.waId);
    expect(thread).toMatchObject({ accountId: null, holders: 2 });
    const matched = await run(workers([1]), matchWhatsAppThread, {
      entityId: 1,
      threadId: thread.threadId,
      accountId: two.accountId,
    });
    expect(matched).toMatchObject({
      accountId: two.accountId,
      opportunityId: two.opportunityId,
      matched: true,
    });
    expect((await auditOf(thread.threadId)).map((r) => r.command)).toEqual([
      'messaging.thread.match',
    ]);
  });
});

/** A template queued by the platform on a thread, taken and sent, with Meta's id. */
async function sentByPlatform(threadId: string): Promise<{ messageId: string; wamid: string }> {
  const queued = await run<WhatsAppMessageQueued>(workers([1]), queueWhatsAppMessage, {
    entityId: 1,
    threadId,
    purpose: 'welcome',
  });
  const messageId = queued.messageId ?? '';
  await run(workers([1]), claimWhatsAppMessage, { entityId: 1, messageId });
  const wamid = `wamid.${newId()}`;
  await run(workers([1]), recordWhatsAppSend, {
    entityId: 1,
    messageId,
    status: 'sent',
    providerMessageId: wamid,
  });
  return { messageId, wamid };
}

describe('messaging.status.record', () => {
  it('is forbidden to people; another company’s request knows no such message', async () => {
    const customer = await customerWithThread();
    const { wamid } = await sentByPlatform(customer.threadId);
    const input = { providerMessageId: wamid, status: 'read', at: new Date().toISOString(), errorCode: null };
    expect(await refusal(run(exec, recordWhatsAppStatus, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(await run(workers([2]), recordWhatsAppStatus, input)).toMatchObject({
      known: false,
      changed: false,
    });
  });

  it('moves a status forward only: out of order and repeated statuses change nothing', async () => {
    const customer = await customerWithThread();
    const { messageId, wamid } = await sentByPlatform(customer.threadId);
    const status = (s: string) =>
      run(workers([1]), recordWhatsAppStatus, {
        providerMessageId: wamid,
        status: s,
        at: new Date().toISOString(),
        errorCode: null,
      });
    expect(await status('delivered')).toMatchObject({ messageId, status: 'delivered', changed: true });
    expect(await status('sent')).toMatchObject({ status: 'delivered', changed: false });
    expect(await status('read')).toMatchObject({ status: 'read', changed: true });
    expect(await status('delivered')).toMatchObject({ status: 'read', changed: false });
    expect(await status('read')).toMatchObject({ status: 'read', changed: false });
  });
});

describe('messaging.template.record_status', () => {
  it('is forbidden to people; another company’s request changes nothing', async () => {
    const input = { name: UPDATE, language: 'en', status: 'paused' };
    expect(await refusal(run(exec, recordWhatsAppTemplateStatus, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(await run(workers([4]), recordWhatsAppTemplateStatus, input)).toEqual({ changed: 0 });
  });

  it('records the status of the company’s template, once', async () => {
    const n = `w1_suite_${newId().slice(-12).replaceAll('-', '')}`;
    await run(exec, registerWhatsAppTemplate, { entityId: 1, name: n, category: 'utility' });
    const input = { name: n, language: 'en', status: 'rejected' };
    expect(await run(workers([1]), recordWhatsAppTemplateStatus, input)).toEqual({ changed: 1 });
    expect(await run(workers([1]), recordWhatsAppTemplateStatus, input)).toEqual({ changed: 0 });
  });
});

describe('messaging.opt_out.record and messaging.thread.record_hand_off', () => {
  it('are forbidden to people', async () => {
    const customer = await customerWithThread();
    expect(
      await refusal(
        run(customer.owner, recordWhatsAppOptOut, {
          entityId: 1,
          threadId: customer.threadId,
          at: new Date().toISOString(),
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(
        run(exec, recordWhatsAppHandOff, {
          entityId: 1,
          threadId: customer.threadId,
          reason: 'keyword',
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('refuse a company outside the request', async () => {
    const customer = await customerWithThread();
    expect(
      await refusal(
        run(workers([2]), recordWhatsAppOptOut, {
          entityId: 1,
          threadId: customer.threadId,
          at: new Date().toISOString(),
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(
        run(workers([2]), recordWhatsAppHandOff, {
          entityId: 1,
          threadId: customer.threadId,
          reason: 'keyword',
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    // Named for its own company, another company's thread is not found.
    expect(
      await refusal(
        run(workers([2]), recordWhatsAppHandOff, {
          entityId: 2,
          threadId: customer.threadId,
          reason: 'keyword',
        }),
      ),
    ).toMatchObject({ code: 'not_found', reason: 'whatsapp_thread_missing' });
  });

  it('record a STOP once, withdrawing the number’s consent, and a hand-off once, each audited', async () => {
    const customer = await customerWithThread();
    await asMigrator(
      (m) => m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
        values (${newId()}, ${customer.contactId}, 'whatsapp', 'service', 'whatsapp_opt_in', 'v1',
                now() - interval '1 hour', ${customer.owner.id})`,
    );
    const stop = () =>
      run(workers([1]), recordWhatsAppOptOut, {
        entityId: 1,
        threadId: customer.threadId,
        at: new Date().toISOString(),
      });
    expect(await stop()).toMatchObject({ newly: true, consentsWithdrawn: 1 });
    expect(await stop()).toMatchObject({ newly: false, consentsWithdrawn: 0 });
    const handOff = () =>
      run(workers([1]), recordWhatsAppHandOff, {
        entityId: 1,
        threadId: customer.threadId,
        reason: 'keyword',
      });
    expect(await handOff()).toMatchObject({ handledBy: 'people', handoffReason: 'keyword', changed: true });
    expect(await handOff()).toMatchObject({ changed: false });
    expect((await auditOf(customer.threadId)).map((r) => r.command)).toEqual([
      'messaging.opt_out.record',
      'messaging.thread.record_hand_off',
    ]);
  });
});

describe('messaging.message.queue', () => {
  it('is forbidden to people, and refuses a company outside the request', async () => {
    const customer = await customerWithThread();
    const input = { entityId: 1, threadId: customer.threadId, purpose: 'welcome' };
    expect(await refusal(run(exec, queueWhatsAppMessage, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(run(workers([2]), queueWhatsAppMessage, input))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('queues the welcome and emits it; after a STOP, no welcome and one confirmation only', async () => {
    const customer = await customerWithThread();
    const queue = (purpose: string) =>
      run<WhatsAppMessageQueued>(workers([1]), queueWhatsAppMessage, {
        entityId: 1,
        threadId: customer.threadId,
        purpose,
      });
    const welcome = await queue('welcome');
    expect(welcome.queued).toBe(true);
    const events = await eventsOf(customer.threadId);
    expect(events.at(-1)).toMatchObject({
      type: 'messaging.message.requested',
      payload_json: { messageId: welcome.messageId, kind: 'template' },
    });
    await run(workers([1]), recordWhatsAppOptOut, {
      entityId: 1,
      threadId: customer.threadId,
      at: new Date().toISOString(),
    });
    expect(await queue('welcome')).toMatchObject({ queued: false, messageId: null });
    const confirmation = await queue('opt_out_confirmation');
    expect(confirmation.queued).toBe(true);
    expect(await refusal(queue('opt_out_confirmation'))).toMatchObject({
      code: 'validation_failed',
    });
    // Company 2 registered no welcome, so nothing is queued there.
    const elsewhere = await whatsappCustomer(2);
    const channel2 = await whatsappChannel(2);
    const other = await run<InboundWhatsAppRecorded>(workers([2]), recordInboundWhatsApp, {
      phoneNumberId: channel2.phoneNumberId,
      waId: elsewhere.waId,
      providerMessageId: `wamid.${newId()}`,
      kind: 'text',
      body: 'Hello',
      buttonPayload: null,
      sentAt: new Date().toISOString(),
    });
    expect(
      await run(workers([2]), queueWhatsAppMessage, {
        entityId: 2,
        threadId: other.threadId,
        purpose: 'welcome',
      }),
    ).toMatchObject({ queued: false });
  });
});

describe('messaging.message.claim and messaging.message.record_send', () => {
  it('are forbidden to people, and refuse a company outside the request', async () => {
    const customer = await customerWithThread();
    const queued = await run<WhatsAppMessageQueued>(workers([1]), queueWhatsAppMessage, {
      entityId: 1,
      threadId: customer.threadId,
      purpose: 'welcome',
    });
    const messageId = queued.messageId ?? '';
    for (const who of [exec, customer.owner]) {
      expect(
        await refusal(run(who, claimWhatsAppMessage, { entityId: 1, messageId })),
      ).toMatchObject({ code: 'forbidden' });
      expect(
        await refusal(
          run(who, recordWhatsAppSend, { entityId: 1, messageId, status: 'failed', errorCode: null }),
        ),
      ).toMatchObject({ code: 'forbidden' });
    }
    expect(
      await refusal(run(workers([2]), claimWhatsAppMessage, { entityId: 1, messageId })),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(
        run(workers([2]), recordWhatsAppSend, {
          entityId: 1,
          messageId,
          status: 'refused',
          refusal: 'window_closed',
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await run(workers([2]), claimWhatsAppMessage, { entityId: 2, messageId }),
    ).toEqual({ messageId, claimed: false });
  });

  it('takes a message once, never twice, and records a refusal only for one not taken', async () => {
    const customer = await customerWithThread();
    const queue = () =>
      run<WhatsAppMessageQueued>(workers([1]), queueWhatsAppMessage, {
        entityId: 1,
        threadId: customer.threadId,
        purpose: 'welcome',
      });
    const refused = (await queue()).messageId ?? '';
    expect(
      await run(workers([1]), recordWhatsAppSend, {
        entityId: 1,
        messageId: refused,
        status: 'refused',
        refusal: 'template_not_approved',
      }),
    ).toMatchObject({ status: 'refused', changed: true });
    const taken = (await queue()).messageId ?? '';
    const claim = () => run(workers([1]), claimWhatsAppMessage, { entityId: 1, messageId: taken });
    expect(await claim()).toEqual({ messageId: taken, claimed: true });
    expect(await claim()).toEqual({ messageId: taken, claimed: false });
    const wamid = `wamid.${newId()}`;
    expect(
      await run(workers([1]), recordWhatsAppSend, {
        entityId: 1,
        messageId: taken,
        status: 'sent',
        providerMessageId: wamid,
      }),
    ).toMatchObject({ status: 'sent', changed: true });
    expect(
      await run(workers([1]), recordWhatsAppSend, {
        entityId: 1,
        messageId: taken,
        status: 'failed',
        errorCode: 131000,
      }),
    ).toMatchObject({ status: 'sent', changed: false });
    expect(
      await refusal(
        run(workers([1]), recordWhatsAppSend, {
          entityId: 1,
          messageId: newId(),
          status: 'failed',
          errorCode: null,
        }),
      ),
    ).toMatchObject({ code: 'not_found', reason: 'whatsapp_message_missing' });
  });
});

describe('messaging.media.attach', () => {
  async function mediaMessage(waId: string): Promise<string> {
    const recorded = await run<InboundWhatsAppRecorded>(workers([1]), recordInboundWhatsApp, {
      phoneNumberId: channel.phoneNumberId,
      waId,
      providerMessageId: `wamid.${newId()}`,
      kind: 'media',
      body: null,
      buttonPayload: null,
      sentAt: new Date().toISOString(),
    });
    return recorded.messageId;
  }
  const input = (messageId: string, entityId = 1) => ({
    entityId,
    messageId,
    fileId: messageId,
    bucket: 'memory',
    key: `${String(entityId)}/whatsapp_media/${messageId}.png`,
    contentType: 'image/png',
    size: 12,
    sha256: 'b'.repeat(64),
  });

  it('is forbidden to people and agents: the platform keeps a customer’s files', async () => {
    const customer = await whatsappCustomer(1);
    const messageId = await mediaMessage(customer.waId);
    for (const who of [exec, customer.owner, principalFor('agent:concierge', [1])]) {
      expect(await refusal(run(who, attachWhatsAppMedia, input(messageId)))).toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('refuses a company outside the request', async () => {
    const customer = await whatsappCustomer(1);
    const messageId = await mediaMessage(customer.waId);
    expect(await refusal(run(workers([2]), attachWhatsAppMedia, input(messageId)))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('records the file waiting for its checks, attaches it once and starts the checks once', async () => {
    const customer = await whatsappCustomer(1);
    const messageId = await mediaMessage(customer.waId);
    expect(await run(workers([1]), attachWhatsAppMedia, input(messageId))).toEqual({
      messageId,
      fileId: messageId,
      attached: true,
    });
    expect(await run(workers([1]), attachWhatsAppMedia, input(messageId))).toMatchObject({
      attached: true,
    });
    const [file] = await asMigrator(
      (m) => m<{ status: string; purpose: string }[]>`select status, purpose from files where id = ${messageId}`,
    );
    expect(file).toEqual({ status: 'scanning', purpose: 'whatsapp_media' });
    const events = await asOutboxPublisher(
      (p) => p<{ type: string }[]>`select type from outbox_events where aggregate_id = ${messageId}`,
    );
    expect(events.map((e) => e.type)).toEqual(['files.file.uploaded']);
    expect(
      await refusal(
        run(workers([1]), attachWhatsAppMedia, { ...input(messageId), key: 'elsewhere.png' }),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'file_upload_mismatch' });
  });
});
