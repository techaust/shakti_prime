import { newId, type IngestKeyDto, type IngestSourceDto, type Principal } from '@shakti/contracts';
import { closeWebhookDb } from '@shakti/db/webhooks';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  PIPELINE_SEED,
  testPhone,
} from '@shakti/db/testing';
import {
  createIngestKey,
  executeCommand,
  memoryKeyValue,
  newIngestKey,
  revokeIngestKey,
  setIngestSource,
} from '@shakti/domain';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fieldCipher, resetFieldCipher } from '../src/crypto/kms-cipher';
import leadFixture from '../src/integrations/meta-leadgen/fixtures/lead.json';

// I1 on real Postgres (docs/03-roadmap-appendix/phase2.md §6.2 and §14): each provider's recorded
// lead, delivered through its signed route with no queue configured (as locally and in CI), is a
// lead within 10 seconds, with its source, company, attribution and consent; a repeated event makes
// nothing; a form no company connected is set aside and reported, then processed once connected;
// Google's test lead makes none; and the website route refuses a revoked key, another company's
// key and a failed Turnstile check before it writes anything.

const fetched = vi.hoisted(() => ({ calls: [] as { leadgenId: string; token: string }[] }));
vi.mock('../src/integrations/meta-leadgen/client', async (original) => {
  const real = await original<typeof import('../src/integrations/meta-leadgen/client')>();
  const lead = (await import('../src/integrations/meta-leadgen/fixtures/lead.json')).default;
  return {
    ...real,
    // Meta's Graph API answers the recorded lead, under the id asked for.
    metaLeadClient: () => ({
      fetchLead: (leadgenId: string, token: string) => {
        fetched.calls.push({ leadgenId, token });
        return Promise.resolve({ ...lead, id: leadgenId });
      },
    }),
  };
});

const { TEST_ORIGIN, TEST_WEBHOOK_ENV } = await import('../src/webhooks/signed-deliveries');
const { POST: LEADGEN } = await import('../src/app/api/v1/webhooks/meta/leadgen/route');
const { POST: GOOGLE } = await import('../src/app/api/v1/webhooks/google/leadform/route');
const { processAgain } = await import('../src/webhooks/replay');
const { ingestHealthRoute, ingestLeadRoute, INGEST_PER_MINUTE } =
  await import('../src/ingest/routes');

const ENTITY = 3;
const PUMPS = PIPELINE_SEED.find((p) => p.key === 'farmer_pumps');
if (!PUMPS) throw new Error('the seeded pipelines are missing');
const QUEUE = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'] as const;
const saved = new Map<string, string | undefined>();
let exec: Principal;
let caller: Principal;

/** A Meta form id and lead id no other run has: digits, as Meta's are. */
let serial = Date.now() * 1000;
const metaId = (): string => String((serial += 1));

beforeAll(async () => {
  for (const name of [...QUEUE, ...Object.keys(TEST_WEBHOOK_ENV), 'FIELD_ENCRYPTION_KEY'])
    saved.set(name, process.env[name]);
  for (const name of QUEUE) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, TEST_WEBHOOK_ENV);
  process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  resetFieldCipher();
  exec = await createTestPrincipal('executive', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'lead ingest web team');
  const user = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team },
  ]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: user.id, teamId: team });
  await asMigrator(async (m) => {
    await m`update caller_profiles set presence = 'away' where entity_id = ${ENTITY}`;
    await m`insert into caller_profiles (id, user_id, entity_id, presence)
            values (${newId()}, ${caller.id}, ${ENTITY}, 'present')`;
  });
});

afterAll(async () => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  resetFieldCipher();
  await closeWebhookDb();
  await closeDb();
});

async function connect(
  provider: 'meta_leadgen' | 'google_leadform' | 'website',
  externalId: string,
  fieldMap: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<IngestSourceDto> {
  const cipher = fieldCipher();
  return executeCommand(
    exec,
    { entityIds: [ENTITY] },
    setIngestSource,
    {
      entityId: ENTITY,
      provider,
      externalId,
      name: `Form ${externalId}`,
      pipelineId: PUMPS?.id,
      fieldMap,
      consent: {
        questionKey: provider === 'google_leadform' ? 'CONSENT' : 'call_consent',
        textVersion: 'v2',
        channels: ['call', 'whatsapp'],
        purpose: 'service',
      },
      ...extra,
    },
    cipher === undefined ? {} : { fieldCipher: cipher },
  );
}

function leadgenRequest(formId: string, leadgenId: string): Request {
  const body = JSON.stringify({
    object: 'page',
    entry: [
      {
        id: '104000000000001',
        time: 1790500000,
        changes: [
          {
            field: 'leadgen',
            value: {
              leadgen_id: leadgenId,
              form_id: formId,
              page_id: '104000000000001',
              ad_id: '666666666666',
              adgroup_id: '777777777777',
              created_time: 1790499990,
            },
          },
        ],
      },
    ],
  });
  const signature = `sha256=${createHmac('sha256', TEST_WEBHOOK_ENV.META_LEADGEN_APP_SECRET)
    .update(body)
    .digest('hex')}`;
  return new Request(`${TEST_ORIGIN}/api/v1/webhooks/meta/leadgen`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  });
}

function googleRequest(formId: number, leadId: string, isTest: boolean, phone: string): Request {
  const body = JSON.stringify({
    lead_id: leadId,
    api_version: '1.0',
    form_id: formId,
    campaign_id: 20000000001,
    adgroup_id: 30000000001,
    creative_id: 50000000001,
    gcl_id: 'Cj0KCQiA-gclid',
    google_key: TEST_WEBHOOK_ENV.GOOGLE_LEADFORM_KEY,
    is_test: isTest,
    user_column_data: [
      { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Suresh Jakhar' },
      { column_id: 'PHONE_NUMBER', column_name: 'User Phone', string_value: phone },
      { column_id: 'POSTAL_CODE', column_name: 'Postal Code', string_value: '331001' },
      { column_id: 'CONSENT', column_name: 'May we call you', string_value: 'Yes' },
    ],
  });
  return new Request(`${TEST_ORIGIN}/api/v1/webhooks/google/leadform`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

interface InboxRow {
  id: string;
  processed: boolean;
  failed: boolean;
  error_code: string | null;
}

/** The delivery stored for an event id, once its in-process handling has finished. */
async function settledRow(eventId: string): Promise<InboxRow> {
  for (let i = 0; i < 100; i += 1) {
    const [row] = await asMigrator(
      (m) => m<InboxRow[]>`
        select id, processed_at is not null as processed, failed_at is not null as failed,
               error_code
          from webhook_inbox where provider_event_id = ${eventId}`,
    );
    if (row !== undefined && (row.processed || row.failed)) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`delivery ${eventId} was not handled`);
}

async function leadsOf(phone: string) {
  return asMigrator(
    (m) => m<
      {
        id: string;
        entity_id: number;
        owner_id: string | null;
        source: string;
        campaign: Record<string, string>;
        created_at: Date;
        consents: number;
        depth: number | null;
      }[]
    >`
      select o.id, o.entity_id, o.owner_id, ls.code as source, o.campaign_json as campaign,
             o.created_at,
             (select count(*)::int from consents c join account_contacts ac on ac.contact_id = c.contact_id
               where ac.account_id = o.account_id) as consents,
             (select q.pump_depth_ft from lead_qualifications q where q.opportunity_id = o.id) as depth
        from opportunities o
        join lead_sources ls on ls.id = o.source_id
        join account_contacts ac on ac.account_id = o.account_id
        join contact_phones cp on cp.contact_id = ac.contact_id
       where cp.e164 = ${phone}`,
  );
}

describe('Lead Ads', () => {
  it('makes a lead of a recorded lead within 10 seconds, with its source, company, attribution and consent, and nothing more when the event comes again', async () => {
    const formId = metaId();
    const leadgenId = metaId();
    const token = `EAAG${newId().replaceAll('-', '')}`;
    await connect(
      'meta_leadgen',
      formId,
      {
        full_name: 'fullName',
        phone_number: 'phone',
        zip_code: 'pin',
        city: 'village',
        borewell_depth_in_feet: 'pumpDepthFt',
        monthly_electricity_bill: 'monthlyBillRupees',
      },
      { pageToken: token },
    );
    // A new number for this run, as the recorded lead's.
    const phone = `+91${testPhone()}`;
    leadFixture.field_data[1] = { name: 'phone_number', values: [phone] };
    const started = Date.now();
    const answer = await LEADGEN(leadgenRequest(formId, leadgenId));
    expect(answer.status).toBe(200);
    expect(await settledRow(leadgenId)).toMatchObject({ processed: true, error_code: null });
    const [lead] = await leadsOf(phone);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(lead).toMatchObject({
      entity_id: ENTITY,
      owner_id: caller.id,
      source: 'meta_ads',
      campaign: {
        campaignId: '888888888888',
        adsetId: '777777777777',
        adId: '666666666666',
        formId,
        pageId: '104000000000001',
      },
      consents: 2,
      depth: 350,
    });
    // The Page token went to Meta, and nowhere else the test can see.
    expect(fetched.calls.at(-1)).toEqual({ leadgenId, token });

    // The same event delivered again: one lead still.
    await LEADGEN(leadgenRequest(formId, leadgenId));
    await settledRow(leadgenId);
    expect(await leadsOf(phone)).toHaveLength(1);
  });

  it('sets aside a form no company connected, and makes its lead once the form is connected', async () => {
    const formId = metaId();
    const leadgenId = metaId();
    const phone = `+91${testPhone()}`;
    leadFixture.field_data[1] = { name: 'phone_number', values: [phone] };
    await LEADGEN(leadgenRequest(formId, leadgenId));
    const row = await settledRow(leadgenId);
    expect(row).toMatchObject({ failed: true, error_code: 'form_unmapped' });
    expect(await leadsOf(phone)).toEqual([]);

    await connect(
      'meta_leadgen',
      formId,
      { full_name: 'fullName', phone_number: 'phone' },
      { pageToken: `EAAG${newId().replaceAll('-', '')}` },
    );
    // Process again, by an Executive acting for the group, as Integration health offers it.
    const groupExec = await createTestPrincipal('executive');
    await processAgain(groupExec, newId(), { inboxId: row.id }, {});
    expect(await settledRow(leadgenId)).toMatchObject({ processed: true });
    expect(await leadsOf(phone)).toHaveLength(1);
  });
});

describe('Google lead forms', () => {
  it("records a test lead's questions and makes no lead; makes a real one with its consent", async () => {
    const formId = Number(metaId().slice(-11));
    const source = await connect('google_leadform', String(formId), {
      FULL_NAME: 'fullName',
      PHONE_NUMBER: 'phone',
      POSTAL_CODE: 'pin',
    });
    const testPhoneNo = `+91${testPhone()}`;
    const testId = `test-${newId()}`;
    expect((await GOOGLE(googleRequest(formId, testId, true, testPhoneNo))).status).toBe(200);
    expect(await settledRow(testId)).toMatchObject({ processed: true, error_code: 'test_lead' });
    expect(await leadsOf(testPhoneNo)).toEqual([]);
    const [questions] = await asMigrator(
      (m) => m<{ q: { key: string; label: string | null }[] }[]>`
        select last_questions_json as q from ingest_sources where id = ${source.id}`,
    );
    expect(questions?.q.map((q) => q.key)).toEqual([
      'FULL_NAME',
      'PHONE_NUMBER',
      'POSTAL_CODE',
      'CONSENT',
    ]);

    const phone = `+91${testPhone()}`;
    const leadId = `lead-${newId()}`;
    await GOOGLE(googleRequest(formId, leadId, false, phone));
    expect(await settledRow(leadId)).toMatchObject({ processed: true, error_code: null });
    expect(await leadsOf(phone)).toMatchObject([
      {
        source: 'google_ads',
        entity_id: ENTITY,
        consents: 2,
        campaign: { gclid: 'Cj0KCQiA-gclid' },
      },
    ]);
  });
});

describe('the website route', () => {
  const keyValue = memoryKeyValue();
  const verdicts: ('human' | 'bot' | 'unavailable')[] = [];
  const deps = {
    keyValue,
    enabled: true,
    verifyTurnstile: () => Promise.resolve(verdicts.shift() ?? 'human'),
    options: () => ({}),
    now: () => new Date(),
  };
  let key: { secret: string; dto: IngestKeyDto };
  let CODE = '';

  beforeAll(async () => {
    const [entity] = await asMigrator(
      (m) => m<{ code: string }[]>`select code from entities where id = ${ENTITY}`,
    );
    CODE = entity?.code ?? '';
    const made = newIngestKey();
    const dto = await executeCommand(exec, { entityIds: [ENTITY] }, createIngestKey, {
      entityId: ENTITY,
      label: 'Website',
      keyHash: made.keyHash,
      keyHint: made.keyHint,
    });
    key = { secret: made.key, dto };
    await connect('website', 'shakti-website.example', {}, {});
  });

  function post(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
    return new Request(`${TEST_ORIGIN}/api/v1/ingest/leads`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin: 'https://shakti-website.example',
        'x-ingest-key': key.secret,
        ...headers,
      },
    });
  }

  const enquiry = (phone: string) => ({
    entityCode: CODE,
    name: 'Mohan Lal',
    phone,
    pin: '331001',
    message: 'Please call about a solar pump',
    utm: { source: 'google', campaign: 'rabi' },
    consent: {
      purpose: 'service',
      text: 'I agree to be called about my enquiry.',
      givenAt: new Date().toISOString(),
    },
    turnstileToken: 'answer',
  });

  it('makes the lead with its consent and stamps the key as used', async () => {
    const phone = `+91${testPhone()}`;
    const answer = await ingestLeadRoute(post(enquiry(phone)), deps);
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as { leadId: string; outcome: string };
    expect(body.outcome).toBe('created');
    expect(await leadsOf(phone)).toMatchObject([
      { id: body.leadId, source: 'website', entity_id: ENTITY, consents: 2 },
    ]);
    const [used] = await asMigrator(
      (m) => m<{ used: boolean }[]>`
        select last_used_at is not null as used from ingest_keys where id = ${key.dto.id}`,
    );
    expect(used?.used).toBe(true);
    const health = await ingestHealthRoute(
      new Request(`${TEST_ORIGIN}/api/v1/ingest/health`, {
        headers: { 'x-ingest-key': key.secret },
      }),
      deps,
    );
    expect(await health.json()).toMatchObject({
      keyValid: true,
      entityCode: CODE,
      rateLimit: { limit: INGEST_PER_MINUTE, remaining: INGEST_PER_MINUTE - 1 },
    });
  });

  it('refuses a failed Turnstile check, another company, an unknown key and a revoked key, writing nothing', async () => {
    const phone = `+91${testPhone()}`;
    verdicts.push('bot');
    const bot = await ingestLeadRoute(post(enquiry(phone)), deps);
    expect(bot.status).toBe(403);
    expect(await bot.json()).toMatchObject({ error: { details: { reason: 'turnstile_failed' } } });
    verdicts.push('unavailable');
    expect((await ingestLeadRoute(post(enquiry(phone)), deps)).status).toBe(503);
    const other = await ingestLeadRoute(post({ ...enquiry(phone), entityCode: 'ZZ' }), deps);
    expect(await other.json()).toMatchObject({
      error: { code: 'forbidden', details: { reason: 'ingest_key_other_company' } },
    });
    const unknown = await ingestLeadRoute(
      post(enquiry(phone), { 'x-ingest-key': newIngestKey().key }),
      deps,
    );
    expect(unknown.status).toBe(401);
    expect(await leadsOf(phone)).toEqual([]);

    const made = newIngestKey();
    const revoked = await executeCommand(exec, { entityIds: [ENTITY] }, createIngestKey, {
      entityId: ENTITY,
      label: 'Old website',
      keyHash: made.keyHash,
      keyHint: made.keyHint,
    });
    await executeCommand(exec, { entityIds: [ENTITY] }, revokeIngestKey, {
      entityId: ENTITY,
      keyId: revoked.id,
    });
    const refused = await ingestLeadRoute(post(enquiry(phone), { 'x-ingest-key': made.key }), deps);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({
      error: { code: 'unauthorized', details: { reason: 'ingest_key_refused' } },
    });
    expect(await leadsOf(phone)).toEqual([]);
  });

  it('allows 60 a minute per key', async () => {
    const made = newIngestKey();
    await executeCommand(exec, { entityIds: [ENTITY] }, createIngestKey, {
      entityId: ENTITY,
      label: 'Busy website',
      keyHash: made.keyHash,
      keyHint: made.keyHint,
    });
    const statuses: number[] = [];
    for (let i = 0; i <= INGEST_PER_MINUTE; i += 1) {
      // A body the contract refuses: counted, but no lead, so the run stays quick.
      const answer = await ingestLeadRoute(post({}, { 'x-ingest-key': made.key }), deps);
      statuses.push(answer.status);
    }
    expect(statuses.slice(0, INGEST_PER_MINUTE).every((s) => s === 400)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
