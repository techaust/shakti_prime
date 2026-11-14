import { newId, type Principal, type WhatsAppWebhook } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  whatsappChannel,
  whatsappCustomer,
  type WhatsAppChannelFixture,
} from '@shakti/db/testing';
import {
  claimWhatsAppMessage,
  executeCommand,
  memoryFileStore,
  memoryKeyValue,
  recordWhatsAppOptOut,
  recordWhatsAppSend,
  sendWhatsAppMessage,
  type KeyValue,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from '../src/integrations/http';
import type { WhatsAppClient } from '../src/integrations/whatsapp/client';
import { systemWorkersPrincipal } from '../src/workers/events/system-principal';
import { sendQueuedMessage } from '../src/workers/messaging/send';
import {
  whatsappHandler,
  type WhatsAppHandlerDeps,
  type WhatsAppIngestCall,
} from '../src/workers/webhooks/whatsapp';

// W1 on real Postgres (docs/03-roadmap-appendix/phase2.md §6.1): the `meta_whatsapp` handler
// given recorded-shape deliveries, and the messaging worker with a fake WhatsApp client. Company 1
// and company 2 each have their WhatsApp number; every customer is new on each run.

afterAll(closeDb);

let one: WhatsAppChannelFixture;
let two: WhatsAppChannelFixture;
let welcome: string;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

beforeAll(async () => {
  one = await whatsappChannel(1);
  two = await whatsappChannel(2);
  const exec = await createTestPrincipal('executive', [1]);
  // Company 1's welcome and STOP confirmation, approved, unless a suite registered them already.
  await asMigrator(async (m) => {
    for (const [name, purpose] of [
      ['w1_web_welcome', 'welcome'],
      ['w1_web_stop_note', 'opt_out_confirmation'],
    ] as const) {
      await m`insert into whatsapp_templates (id, entity_id, name, category, status, purpose, created_by)
        values (${newId()}, 1, ${name}, 'utility', 'approved', ${purpose}, ${exec.id})
        on conflict do nothing`;
    }
    await m`update whatsapp_templates set status = 'approved' where entity_id = 1 and purpose is not null`;
  });
  const [row] = await asMigrator(
    (m) => m<{ name: string }[]>`select name from whatsapp_templates
                                   where entity_id = 1 and purpose = 'welcome'`,
  );
  welcome = row?.name ?? '';
});

function deps(over: Partial<WhatsAppHandlerDeps> = {}): WhatsAppHandlerDeps & {
  calls: WhatsAppIngestCall[];
} {
  const calls: WhatsAppIngestCall[] = [];
  return {
    keyValue: memoryKeyValue(),
    now: () => new Date(),
    ingestLead: (call) => {
      calls.push(call);
      return Promise.resolve(null);
    },
    downloadMedia: undefined,
    store: undefined,
    calls,
    ...over,
  };
}

const context = () => ({ inboxId: newId(), requestId: newId(), attempts: 1 });
const seconds = (at = Date.now()) => String(Math.floor(at / 1000));

/** A delivery of one change to a company number: messages and statuses as Meta sends them. */
function delivery(
  phoneNumberId: string,
  value: { messages?: unknown[]; statuses?: unknown[]; contacts?: unknown[] },
): WhatsAppWebhook {
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
              metadata: { display_phone_number: '919000000001', phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  } as WhatsAppWebhook;
}

const text = (from: string, body: string, id = `wamid.${newId()}`) => ({
  from,
  id,
  timestamp: seconds(),
  type: 'text',
  text: { body },
});

async function threadsOf(waId: string) {
  return asMigrator(
    (m) => m<{
      id: string;
      entity_id: number;
      account_id: string | null;
      handled_by: string;
      opted_out_at: Date | null;
    }[]>`select id, entity_id, account_id, handled_by, opted_out_at from whatsapp_threads
          where wa_id = ${waId} order by entity_id`,
  );
}

async function messagesOf(threadId: string) {
  return asMigrator(
    (m) => m<{
      id: string;
      direction: string;
      kind: string;
      template_name: string | null;
      file_id: string | null;
      status: string | null;
    }[]>`select id, direction, kind, template_name, file_id, status from whatsapp_messages
          where thread_id = ${threadId} order by created_at, id`,
  );
}

describe('the meta_whatsapp handler', () => {
  it('records a message in the company of the number it was sent to, and never in another', async () => {
    const customer = await whatsappCustomer(1);
    const d = deps();
    const handle = whatsappHandler(d);
    expect(await handle(delivery(one.phoneNumberId, { messages: [text(customer.waId, 'Hi')] }), context())).toEqual({
      entityId: 1,
    });
    // The same customer writes to company 2's number: company 2 has no such customer, so its own
    // chat opens unmatched there and goes to the intake; company 1's chat is untouched.
    expect(await handle(delivery(two.phoneNumberId, { messages: [text(customer.waId, 'Hi')] }), context())).toEqual({
      entityId: 2,
    });
    const threads = await threadsOf(customer.waId);
    expect(threads.map((t) => [t.entity_id, t.account_id])).toEqual([
      [1, customer.accountId],
      [2, null],
    ]);
    expect((await messagesOf(threads[0]?.id ?? '')).filter((m) => m.direction === 'inbound')).toHaveLength(1);
    expect(d.calls.map((c) => c.input.entityId)).toEqual([2]);
  });

  it('records nothing for a number of no company, with a code on the delivery', async () => {
    const waId = `91${String(9_000_000_000 + Math.floor(Math.random() * 99_999_999))}`;
    expect(
      await whatsappHandler(deps())(
        delivery('no-such-number', { messages: [text(waId, 'Hi')] }),
        context(),
      ),
    ).toEqual({ entityId: null, code: 'whatsapp_number_unknown' });
    expect(await threadsOf(waId)).toEqual([]);
  });

  it('stores a repeated message once, and sends the welcome once on the first message', async () => {
    const customer = await whatsappCustomer(1);
    const handle = whatsappHandler(deps());
    const first = text(customer.waId, 'Is the 5 HP pump in stock?');
    await handle(delivery(one.phoneNumberId, { messages: [first] }), context());
    await handle(delivery(one.phoneNumberId, { messages: [first] }), context());
    await handle(delivery(one.phoneNumberId, { messages: [text(customer.waId, 'And the price?')] }), context());
    const [thread] = await threadsOf(customer.waId);
    const messages = await messagesOf(thread?.id ?? '');
    expect(messages.filter((m) => m.direction === 'inbound')).toHaveLength(2);
    expect(messages.filter((m) => m.direction === 'outbound').map((m) => m.template_name)).toEqual([
      welcome,
    ]);
  });

  it('opts a number out on STOP and queues the one confirmation; HUMAN hands the chat to people', async () => {
    const customer = await whatsappCustomer(1);
    const handle = whatsappHandler(deps());
    await handle(delivery(one.phoneNumberId, { messages: [text(customer.waId, 'HUMAN')] }), context());
    let [thread] = await threadsOf(customer.waId);
    expect(thread?.handled_by).toBe('people');
    // HUMAN as the first word: people answer, so no welcome.
    expect((await messagesOf(thread?.id ?? '')).filter((m) => m.direction === 'outbound')).toEqual([]);
    await handle(delivery(one.phoneNumberId, { messages: [text(customer.waId, 'Band karo')] }), context());
    await handle(delivery(one.phoneNumberId, { messages: [text(customer.waId, 'stop')] }), context());
    [thread] = await threadsOf(customer.waId);
    expect(thread?.opted_out_at).not.toBeNull();
    expect(
      (await messagesOf(thread?.id ?? '')).filter((m) => m.direction === 'outbound').map((m) => m.kind),
    ).toEqual(['system']);
  });

  it('gives a number no customer holds to the intake with I1’s input, and matches the chat to the customer it made', async () => {
    const waId = `91${String(7_000_000_000 + Math.floor(Math.random() * 999_999_999))}`;
    let made: string | undefined;
    const d = deps({
      ingestLead: async (call) => {
        const customer = await whatsappCustomer(1, { e164: call.input.contact.phone });
        made = customer.accountId;
        return { accountId: customer.accountId };
      },
    });
    const message = {
      ...text(waId, 'I saw your ad'),
      referral: { ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ', source_type: 'ad', source_id: '120000000001' },
    };
    const calls: WhatsAppIngestCall[] = [];
    const recording: WhatsAppHandlerDeps = {
      ...d,
      ingestLead: (call) => {
        calls.push(call);
        return d.ingestLead(call);
      },
    };
    await whatsappHandler(recording)(
      delivery(one.phoneNumberId, {
        messages: [message],
        contacts: [{ wa_id: waId, profile: { name: 'Ramesh' } }],
      }),
      context(),
    );
    expect(calls).toEqual([
      {
        input: {
          entityId: 1,
          channel: 'whatsapp',
          pipelineKey: 'farmer_pumps',
          externalId: message.id,
          contact: { name: 'Ramesh', phone: `+${waId}` },
          attribution: {
            ctwaClid: 'ARAkLkA8rmlFeiCktEJQ',
            referralSourceId: '120000000001',
            referralSourceType: 'ad',
          },
        },
        idempotencyKey: `whatsapp:${message.id}`,
      },
    ]);
    const [thread] = await threadsOf(waId);
    expect(thread?.account_id).toBe(made);
  });

  it('keeps a customer’s photo as a file of their own chat, waiting for its checks, once', async () => {
    const customer = await whatsappCustomer(1);
    const store = memoryFileStore();
    const downloads: string[] = [];
    const handle = whatsappHandler(
      deps({
        store,
        downloadMedia: (mediaId) => {
          downloads.push(mediaId);
          return Promise.resolve({ bytes: PNG, contentType: 'image/png' });
        },
      }),
    );
    const photo = {
      from: customer.waId,
      id: `wamid.${newId()}`,
      timestamp: seconds(),
      type: 'image',
      image: { id: 'media-1', mime_type: 'image/png', caption: 'My bill' },
    };
    await handle(delivery(one.phoneNumberId, { messages: [photo] }), context());
    await handle(delivery(one.phoneNumberId, { messages: [photo] }), context());
    const [thread] = await threadsOf(customer.waId);
    const inbound = (await messagesOf(thread?.id ?? '')).filter((m) => m.direction === 'inbound');
    expect(inbound).toHaveLength(1);
    const fileId = inbound[0]?.file_id ?? '';
    expect(fileId).toBe(inbound[0]?.id);
    const [file] = await asMigrator(
      (m) => m<{ purpose: string; status: string; entity_id: number }[]>`
        select purpose, status, entity_id from files where id = ${fileId}`,
    );
    expect(file).toEqual({ purpose: 'whatsapp_media', status: 'scanning', entity_id: 1 });
    expect(store.objects.size).toBe(1);
    expect(downloads).toEqual(['media-1', 'media-1']);
    // Read with its chat: the customer's owner reads it, a caller of another team does not.
    const sees = (who: Principal) =>
      asPrincipal(who, async ({ tx }) =>
        (await tx.execute(sql`select id from files where id = ${fileId}`)).length,
      );
    expect(await sees(customer.owner)).toBe(1);
    expect(await sees(await createTestPrincipal('tele_caller_cc', [1]))).toBe(0);
  });

  it('moves a sent message’s status only forward, whatever order the statuses come in', async () => {
    const customer = await whatsappCustomer(1);
    const handle = whatsappHandler(deps());
    await handle(delivery(one.phoneNumberId, { messages: [text(customer.waId, 'Hello')] }), context());
    const [thread] = await threadsOf(customer.waId);
    const [queued] = (await messagesOf(thread?.id ?? '')).filter((m) => m.direction === 'outbound');
    const wamid = `wamid.${newId()}`;
    const workers = systemWorkersPrincipal(1);
    await executeCommand(workers, { entityIds: [1] }, claimWhatsAppMessage, {
      entityId: 1,
      messageId: queued?.id,
    });
    await executeCommand(workers, { entityIds: [1] }, recordWhatsAppSend, {
      entityId: 1,
      messageId: queued?.id,
      status: 'sent',
      providerMessageId: wamid,
    });
    const status = (s: string) => ({ id: wamid, status: s, timestamp: seconds(), recipient_id: customer.waId });
    await handle(delivery(one.phoneNumberId, { statuses: [status('read'), status('delivered'), status('sent')] }), context());
    expect((await messagesOf(thread?.id ?? '')).find((m) => m.id === queued?.id)?.status).toBe('read');
  });

  it('records a template’s status in each company that registered it, and a number’s quality', async () => {
    const exec = await createTestPrincipal('executive', [1, 2]);
    const name = `w1_web_${newId().slice(-12).replaceAll('-', '')}`;
    await asMigrator(
      (m) => m`insert into whatsapp_templates (id, entity_id, name, category, created_by) values
        (${newId()}, 1, ${name}, 'utility', ${exec.id}), (${newId()}, 2, ${name}, 'utility', ${exec.id})`,
    );
    const kv: KeyValue = memoryKeyValue();
    const handle = whatsappHandler(deps({ keyValue: kv }));
    const result = await handle(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-test',
            changes: [
              {
                field: 'message_template_status_update',
                value: {
                  event: 'APPROVED',
                  message_template_id: 1,
                  message_template_name: name,
                  message_template_language: 'en_US',
                },
              },
            ],
          },
        ],
      } as WhatsAppWebhook,
      context(),
    );
    expect(result).toEqual({ entityId: null });
    const statuses = await asMigrator(
      (m) => m<{ status: string }[]>`select status from whatsapp_templates where name = ${name}`,
    );
    expect(statuses.map((s) => s.status)).toEqual(['approved', 'approved']);
    const [channel] = await asMigrator(
      (m) => m<{ number_e164: string }[]>`select number_e164 from entity_channels where id = ${one.channelId}`,
    );
    await handle(
      {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'waba-test',
            changes: [
              {
                field: 'phone_number_quality_update',
                value: {
                  display_phone_number: (channel?.number_e164 ?? '').slice(1),
                  event: 'FLAGGED',
                  current_limit: 'TIER_1K',
                },
              },
            ],
          },
        ],
      } as WhatsAppWebhook,
      context(),
    );
    expect(await kv.get('whatsapp:limit')).toBe('1000');
    expect(JSON.parse((await kv.get('whatsapp:quality:1')) ?? '{}')).toMatchObject({ event: 'FLAGGED' });
  });
});

describe('the messaging worker', () => {
  function client(answer: () => Promise<{ messageId: string; waId: undefined }>) {
    const sent: string[] = [];
    const fake: WhatsAppClient = {
      sendText: async (m) => {
        sent.push(m.to);
        return answer();
      },
      sendTemplate: async (m) => {
        sent.push(m.to);
        return answer();
      },
    };
    return { fake, sent };
  }

  async function queuedText(): Promise<{ owner: Principal; threadId: string; messageId: string }> {
    const customer = await whatsappCustomer(1);
    await whatsappHandler(deps())(
      delivery(one.phoneNumberId, { messages: [text(customer.waId, 'HUMAN')] }),
      context(),
    );
    const [thread] = await threadsOf(customer.waId);
    const queued = await executeCommand(
      customer.owner,
      { entityIds: [1] },
      sendWhatsAppMessage,
      { entityId: 1, threadId: thread?.id, kind: 'text', body: 'Your engineer visits tomorrow.' },
    );
    return { owner: customer.owner, threadId: thread?.id ?? '', messageId: queued.id };
  }

  const job = (messageId: string) => ({ eventId: newId(), entityId: 1, messageId });
  const workerDeps = (fake: WhatsAppClient | undefined, keyValue: KeyValue = memoryKeyValue()) => ({
    principal: systemWorkersPrincipal(1),
    keyValue,
    requestId: newId(),
    now: () => new Date(),
    client: () => fake,
    hosted: false,
  });

  it('sends a queued message once and records Meta’s id; a repeat sends nothing', async () => {
    const { messageId, threadId } = await queuedText();
    const wamid = `wamid.${newId()}`;
    const { fake, sent } = client(() => Promise.resolve({ messageId: wamid, waId: undefined }));
    expect(await sendQueuedMessage(job(messageId), workerDeps(fake))).toMatchObject({
      status: 'sent',
      providerMessageId: wamid,
    });
    expect(await sendQueuedMessage(job(messageId), workerDeps(fake))).toMatchObject({
      status: 'skipped',
    });
    expect(sent).toHaveLength(1);
    expect((await messagesOf(threadId)).find((m) => m.id === messageId)?.status).toBe('sent');
  });

  it('refuses a message to a number that opted out after it was queued, and never calls WhatsApp', async () => {
    const { messageId, threadId } = await queuedText();
    await executeCommand(systemWorkersPrincipal(1), { entityIds: [1] }, recordWhatsAppOptOut, {
      entityId: 1,
      threadId,
      at: new Date().toISOString(),
    });
    const { fake, sent } = client(() => Promise.resolve({ messageId: 'wamid.x', waId: undefined }));
    expect(await sendQueuedMessage(job(messageId), workerDeps(fake))).toMatchObject({
      status: 'refused',
      refusal: 'opted_out',
    });
    expect(sent).toEqual([]);
  });

  it('records a timeout as failed and never sends the message again', async () => {
    const { messageId } = await queuedText();
    const { fake, sent } = client(() => Promise.reject(new ProviderError('whatsapp', 'timeout')));
    expect(await sendQueuedMessage(job(messageId), workerDeps(fake))).toMatchObject({
      status: 'failed',
    });
    expect(await sendQueuedMessage(job(messageId), workerDeps(fake))).toMatchObject({
      status: 'skipped',
    });
    expect(sent).toHaveLength(1);
  });

  it('waits when WhatsApp is not set up here, and when the chat is over 20 messages an hour', async () => {
    const { messageId, threadId } = await queuedText();
    await expect(sendQueuedMessage(job(messageId), workerDeps(undefined))).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
    const owner = await createTestPrincipal('tele_caller_cc', [1]);
    await asMigrator(async (m) => {
      for (let i = 0; i < 20; i += 1) {
        await m`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, body_masked, status, sent_by, created_at)
          values (${newId()}, 1, ${threadId}, 'outbound', 'text', 'x', 'queued', ${owner.id}, now())`;
      }
      await m`update whatsapp_messages set send_attempted_at = now()
                where thread_id = ${threadId} and id <> ${messageId} and status = 'queued'`;
    });
    const { fake, sent } = client(() => Promise.resolve({ messageId: 'wamid.y', waId: undefined }));
    await expect(sendQueuedMessage(job(messageId), workerDeps(fake))).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(sent).toEqual([]);
  });
});
