import { randomBytes } from 'node:crypto';
import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type IngestKeyDto,
  type IngestSourceDto,
  type LeadIngestResultDto,
  type LeadQualificationDto,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  PIPELINE_SEED,
  principalFor,
  testPhone,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { ingestLead } from '../../src/commands/crm/ingest-lead';
import {
  archiveIngestSource,
  createIngestKey,
  revokeIngestKey,
  setIngestSource,
} from '../../src/commands/crm/ingest-sources';
import { setLeadQualification } from '../../src/commands/crm/lead-qualification';
import { moveOpportunityStage } from '../../src/commands/crm/move-opportunity-stage';
import { updateStage } from '../../src/commands/crm/pipeline-settings';
import { newIngestKey } from '../../src/crm/ingest-key';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { envelopeCipher, localKeyProvider } from '../../src/privacy/field-cipher';

// I1 Lead Ads, lead forms and website ingest (docs/03-roadmap-appendix/phase2.md §6.2, PRD CRM-01
// and CRM-02): the platform makes or attaches a lead from an integration through the
// `crm.ingest.run` definers, with its source, company, attribution, consent and owner; an Executive
// connects forms and makes website keys; whoever may write a lead records its qualification facts.
// Company 2 holds the suite's callers; every other caller profile of the company is set away first,
// so the round-robin reads only this run's callers.

const ENTITY = 2;
const PUMPS = PIPELINE_SEED.find((p) => p.key === 'farmer_pumps');
const ROOFTOP = PIPELINE_SEED.find((p) => p.key === 'residential_rooftop');
if (!PUMPS || !ROOFTOP) throw new Error('the seeded pipelines are missing');

const cipher = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));

let exec: Principal;
let execElsewhere: Principal;
let gm: Principal;
let callerA: Principal;
let callerB: Principal;
let colleague: Principal;
let teamLeadId: string;

const workers = (entityIds: readonly number[] = [ENTITY]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run<T>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  idempotencyKey?: string,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(
      command,
      {
        context,
        audit,
        outbox,
        fieldCipher: cipher,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      },
      input,
    ),
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

/** Every caller profile of the company but these people's is away; these are present. */
async function onlyPresent(...userIds: string[]): Promise<void> {
  await asMigrator(async (m) => {
    await m`update caller_profiles set presence = 'away' where entity_id = ${ENTITY}`;
    for (const id of userIds) {
      await m`insert into caller_profiles (id, user_id, entity_id, presence)
                values (${newId()}, ${id}, ${ENTITY}, 'present')
              on conflict (user_id, entity_id) do update set presence = 'present'`;
    }
  });
}

function lead(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entityId: ENTITY,
    channel: 'meta_ads',
    pipelineKey: 'farmer_pumps',
    externalId: newId(),
    contact: { name: 'Ramesh Kumar', phone: testPhone() },
    ...overrides,
  };
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [ENTITY]);
  execElsewhere = await createTestPrincipal('executive', [1]);
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'ingest team');
  const a = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team }]);
  callerA = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: a.id, teamId: team });
  const b = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team }]);
  callerB = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: b.id, teamId: team });
  const c = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_lc', teamId: team }]);
  colleague = await createTestPrincipal('tele_caller_lc', [ENTITY], { id: c.id, teamId: team });
  const lead = await createTestUser([
    { entityId: ENTITY, roleKey: 'sales_team_lead', teamId: team },
  ]);
  teamLeadId = lead.id;
});

afterAll(closeDb);

describe('crm.lead.ingest', () => {
  it("is 'forbidden' to every person and agent: it is the platform's alone", async () => {
    for (const who of [exec, gm, callerA, principalFor('agent:concierge', [ENTITY])]) {
      expect(await refusal(run(who, ingestLead, lead()))).toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a company outside the request', async () => {
    expect(await refusal(run(workers([1]), ingestLead, lead()))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('makes a lead for a new customer with its source, attribution, consent and qualification, owned by a present caller', async () => {
    await onlyPresent(callerA.id);
    const phone = testPhone();
    const out = await run<LeadIngestResultDto>(
      workers(),
      ingestLead,
      lead({
        contact: { name: 'Sunita Devi', phone },
        site: { village: 'Kishangarh', pin: '305801' },
        attribution: { campaignId: '23851234567890123', adId: '23851234567890124', formId: '991' },
        consent: {
          channels: ['call', 'whatsapp'],
          purpose: 'service',
          textVersion: 'meta-form-v1',
          givenAt: new Date().toISOString(),
        },
        qualification: { pumpDepthFt: 180, requiredHp: 7.5 },
        message: 'Need a pump before the season',
      }),
    );
    expect(out).toMatchObject({
      outcome: 'created',
      entityId: ENTITY,
      ownerId: callerA.id,
      assignedTo: 'caller',
    });

    const [row] = await asMigrator(
      (m) => m<
        { source: string; campaign: Record<string, string>; team: string | null; owner: string }[]
      >`
        select ls.code as source, o.campaign_json as campaign, o.team_id as team, o.owner_id as owner
          from opportunities o join lead_sources ls on ls.id = o.source_id
         where o.id = ${out.leadId}`,
    );
    expect(row).toMatchObject({
      source: 'meta_ads',
      campaign: { campaignId: '23851234567890123', adId: '23851234567890124', formId: '991' },
      owner: callerA.id,
      team: callerA.teamId,
    });
    const consents = await asMigrator(
      (m) => m<{ channel: string; source: string; text_version: string }[]>`
        select channel, source, text_version from consents where contact_id = ${out.contactId}
         order by channel`,
    );
    expect(consents).toEqual([
      { channel: 'call', source: 'web_form', text_version: 'meta-form-v1' },
      { channel: 'whatsapp', source: 'web_form', text_version: 'meta-form-v1' },
    ]);
    const [facts] = await asMigrator(
      (m) => m<{ depth: number; hp: string }[]>`
        select pump_depth_ft as depth, required_hp as hp from lead_qualifications
         where opportunity_id = ${out.leadId}`,
    );
    expect(facts).toEqual({ depth: 180, hp: '7.50' });
    const timeline = await asMigrator(
      (m) => m<{ type: string; body: string | null }[]>`
        select type, body from activities where account_id = ${out.accountId} order by type`,
    );
    expect(timeline.map((t) => t.type)).toEqual([
      'consent_recorded',
      'consent_recorded',
      'lead_created',
      'note',
    ]);
    const events = await asOutboxPublisher(
      (p) => p<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from outbox_events where aggregate_id = ${out.leadId}`,
    );
    expect(events).toEqual([
      {
        type: 'crm.lead.created',
        payload_json: {
          v: 1,
          pipelineKey: 'farmer_pumps',
          sourceCode: 'meta_ads',
          existingAccount: false,
        },
      },
    ]);
    // The caller reads the lead and its customer under their own rules.
    const [seen] = (await asPrincipal(callerA, (ctx) =>
      ctx.tx.execute(sql`select count(*)::int as n from opportunities where id = ${out.leadId}`),
    )) as unknown as { n: number }[];
    expect(seen?.n).toBe(1);
  });

  it('records no consent when the form had none ticked, and none for a WhatsApp message', async () => {
    await onlyPresent(callerA.id);
    const web = await run<LeadIngestResultDto>(workers(), ingestLead, lead({ channel: 'website' }));
    const whatsapp = await run<LeadIngestResultDto>(
      workers(),
      ingestLead,
      lead({
        channel: 'whatsapp',
        attribution: { ctwaClid: 'ARAkLkA8rmlFeiCktEJQ', referralSourceType: 'ad' },
      }),
    );
    const [count] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from consents
         where contact_id in (${web.contactId}, ${whatsapp.contactId})`,
    );
    expect(count?.n).toBe(0);
    const [source] = await asMigrator(
      (m) => m<{ code: string; campaign: Record<string, string> }[]>`
        select ls.code, o.campaign_json as campaign from opportunities o
          join lead_sources ls on ls.id = o.source_id where o.id = ${whatsapp.leadId}`,
    );
    expect(source).toEqual({
      code: 'whatsapp',
      campaign: { ctwaClid: 'ARAkLkA8rmlFeiCktEJQ', referralSourceType: 'ad' },
    });
  });

  it('goes round the present callers by the fewest open leads, in turn', async () => {
    await onlyPresent(callerA.id, callerB.id);
    // Both start level: each gets one, whichever goes first.
    await asMigrator(
      (m) => m`update opportunities set state = 'lost'
                where owner_id in (${callerA.id}, ${callerB.id}) and state = 'open'`,
    );
    const first = await run<LeadIngestResultDto>(workers(), ingestLead, lead());
    const second = await run<LeadIngestResultDto>(workers(), ingestLead, lead());
    expect(new Set([first.ownerId, second.ownerId])).toEqual(new Set([callerA.id, callerB.id]));
    expect(first.assignedTo).toBe('caller');
  });

  it('makes nothing more for a repeated event with the same key', async () => {
    await onlyPresent(callerA.id);
    const input = lead();
    const key = `meta_leadgen:${String(input.externalId)}`;
    const once = await run<LeadIngestResultDto>(workers(), ingestLead, input, key);
    const again = await run<LeadIngestResultDto>(workers(), ingestLead, input, key);
    expect(again).toEqual(once);
    const [count] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from opportunities where account_id = ${once.accountId}`,
    );
    expect(count?.n).toBe(1);
  });

  it("adds a repeat enquiry to the customer's open lead of the business line", async () => {
    await onlyPresent(callerA.id);
    const phone = testPhone();
    const first = await run<LeadIngestResultDto>(
      workers(),
      ingestLead,
      lead({ contact: { name: 'Mohan Lal', phone } }),
    );
    const repeat = await run<LeadIngestResultDto>(
      workers(),
      ingestLead,
      lead({
        channel: 'google_ads',
        contact: { name: 'Mohan Lal', phone },
        qualification: { pumpDepthFt: 240, sanctionedLoadKw: 5 },
        consent: {
          channels: ['call'],
          purpose: 'service',
          textVersion: 'google-form-v2',
          givenAt: new Date().toISOString(),
        },
      }),
    );
    expect(repeat).toMatchObject({
      outcome: 'attached',
      leadId: first.leadId,
      accountId: first.accountId,
      ownerId: first.ownerId,
      assignedTo: 'lead_owner',
    });
    const [facts] = await asMigrator(
      (m) => m<{ depth: number | null; load: string | null }[]>`
        select pump_depth_ft as depth, sanctioned_load_kw as load from lead_qualifications
         where opportunity_id = ${first.leadId}`,
    );
    // The lead had no facts: the repeat fills them.
    expect(facts).toEqual({ depth: 240, load: '5.00' });
    const events = await asOutboxPublisher(
      (p) => p<{ type: string }[]>`
        select type from outbox_events where aggregate_id = ${first.leadId} order by sequence`,
    );
    expect(events.map((e) => e.type)).toEqual(['crm.lead.created', 'crm.lead.attached']);
  });

  it('gives a new enquiry of a customer a colleague looks after to that colleague, as routed work', async () => {
    await onlyPresent(callerA.id);
    const phone = testPhone();
    const made = await run<{ account: { id: string } }>(colleague, createLead, {
      entityId: ENTITY,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Kailash Choudhary', phone },
      account: { type: 'farm' },
    });
    const out = await run<LeadIngestResultDto>(
      workers(),
      ingestLead,
      lead({ pipelineKey: 'residential_rooftop', contact: { name: 'Kailash', phone } }),
    );
    expect(out).toMatchObject({
      outcome: 'created',
      accountId: made.account.id,
      ownerId: colleague.id,
      assignedTo: 'customer_owner',
    });
    const [item] = await asMigrator(
      (m) => m<{ kind: string; assignee: string; subject: string }[]>`
        select kind, assignee_id as assignee, subject_id as subject from inbox_items
         where subject_id = ${out.leadId}`,
    );
    expect(item).toEqual({ kind: 'routed_work', assignee: colleague.id, subject: out.leadId });
  });

  it('gives the lead to the Sales Team Lead as routed work when no caller is present', async () => {
    await onlyPresent();
    const out = await run<LeadIngestResultDto>(workers(), ingestLead, lead());
    expect(out.assignedTo).toBe('team_lead');
    const [owner] = await asMigrator(
      (m) => m<{ role: string }[]>`
        select r.key as role from user_entity_roles uer join roles r on r.id = uer.role_id
         where uer.user_id = ${out.ownerId} and uer.entity_id = ${ENTITY}`,
    );
    expect(owner?.role).toBe('sales_team_lead');
    expect(teamLeadId).toBeTruthy();
    const events = await asOutboxPublisher(
      (p) => p<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from outbox_events
         where type = 'crm.enquiry.routed' and payload_json ->> 'accountId' = ${out.accountId}`,
    );
    expect(events).toEqual([
      {
        type: 'crm.enquiry.routed',
        payload_json: { v: 1, assigneeId: out.ownerId, accountId: out.accountId },
      },
    ]);
  });

  it('lands a lead on its connected source, and refuses a source of another company', async () => {
    await onlyPresent(callerA.id);
    const source = await run<IngestSourceDto>(exec, setIngestSource, {
      entityId: ENTITY,
      provider: 'google_leadform',
      externalId: `form-${newId()}`,
      name: 'Rooftop form',
      pipelineId: ROOFTOP.id,
      fieldMap: { FULL_NAME: 'fullName', PHONE_NUMBER: 'phone' },
      consent: null,
    });
    const out = await run<LeadIngestResultDto>(
      workers(),
      ingestLead,
      lead({ channel: 'google_ads', pipelineKey: undefined, sourceId: source.id }),
    );
    const [row] = await asMigrator(
      (m) => m<{ pipeline: string }[]>`
        select pipeline_id as pipeline from opportunities where id = ${out.leadId}`,
    );
    expect(row?.pipeline).toBe(ROOFTOP.id);
    expect(
      await refusal(
        run(
          workers([1]),
          ingestLead,
          lead({ entityId: 1, pipelineKey: undefined, sourceId: source.id }),
        ),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'lead_source_missing' });
  });
});

describe('crm.lead.qualification.set', () => {
  it("is 'forbidden' without crm.lead.write, and to another company's caller", async () => {
    const accounts = await createTestPrincipal('accounts', [ENTITY]);
    const input = { entityId: ENTITY, opportunityId: newId(), facts: { pumpDepthFt: 90 } };
    expect(await refusal(run(accounts, setLeadQualification, input))).toMatchObject({
      code: 'forbidden',
    });
    const elsewhere = await createTestPrincipal('tele_caller_cc', [1]);
    expect(await refusal(run(elsewhere, setLeadQualification, input))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('records, changes and clears the facts, and a stage may then require them', async () => {
    const made = await run<{ id: string; stageId: string }>(callerA, createLead, {
      entityId: ENTITY,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Bhanwar Singh', phone: testPhone() },
      account: { type: 'farm' },
    });
    const set = (facts: Record<string, unknown>) =>
      run<LeadQualificationDto>(callerA, setLeadQualification, {
        entityId: ENTITY,
        opportunityId: made.id,
        facts,
      });
    expect(await set({ pumpDepthFt: 150, monthlyBillRupees: 2400 })).toMatchObject({
      pumpDepthFt: 150,
      monthlyBillRupees: 2400,
      requiredHp: null,
    });
    expect(await set({ pumpDepthFt: null, requiredHp: 5 })).toMatchObject({
      pumpDepthFt: null,
      requiredHp: 5,
      monthlyBillRupees: 2400,
    });
    // Another caller of the company may not write the lead.
    expect(
      await refusal(
        run(callerB, setLeadQualification, {
          entityId: ENTITY,
          opportunityId: made.id,
          facts: { pumpDepthFt: 10 },
        }),
      ),
    ).toMatchObject({ code: 'not_found' });

    // A stage that requires the pump depth holds the lead until it is recorded.
    const stages = await asMigrator(
      (m) => m<{ id: string; key: string }[]>`
        select id, key from pipeline_stages where pipeline_id = ${PUMPS.id} and archived_at is null
         order by position`,
    );
    const first = stages[0];
    const next = stages[1];
    if (!first || !next) throw new Error('the seeded stages are missing');
    expect(first.id).toBe(made.stageId);
    const groupExec = await createTestPrincipal('executive');
    await run(groupExec, updateStage, { stageId: first.id, requiredFields: ['pumpDepthFt'] });
    try {
      expect(
        await refusal(
          run(callerA, moveOpportunityStage, {
            entityId: ENTITY,
            opportunityId: made.id,
            stageId: next.id,
          }),
        ),
      ).toMatchObject({ reason: 'stage_fields_missing' });
      await set({ pumpDepthFt: 130 });
      expect(
        await run(callerA, moveOpportunityStage, {
          entityId: ENTITY,
          opportunityId: made.id,
          stageId: next.id,
        }),
      ).toMatchObject({ stageId: next.id });
    } finally {
      await run(groupExec, updateStage, { stageId: first.id, requiredFields: [] });
    }
  });
});

describe('crm.source.set and crm.source.archive', () => {
  const source = (overrides: Record<string, unknown> = {}) => ({
    entityId: ENTITY,
    provider: 'meta_leadgen',
    externalId: `${String(Date.now())}${String(Math.floor(Math.random() * 1000))}`,
    name: 'Pumps form',
    pipelineId: PUMPS.id,
    fieldMap: { full_name: 'fullName', phone_number: 'phone', borewell_depth: 'pumpDepthFt' },
    consent: {
      questionKey: 'agree_to_calls',
      textVersion: 'v3',
      channels: ['call'],
      purpose: 'service',
    },
    ...overrides,
  });

  it("is 'forbidden' to a General Manager and a caller, and refused to every agent", async () => {
    for (const who of [gm, callerA]) {
      expect(await refusal(run(who, setIngestSource, source()))).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(
      await refusal(run(principalFor('agent:triage', [ENTITY]), setIngestSource, source())),
    ).toMatchObject({ code: 'forbidden', reason: 'people_only' });
  });

  it("refuses another company's Executive", async () => {
    expect(await refusal(run(execElsewhere, setIngestSource, source()))).toMatchObject({
      code: 'forbidden',
    });
  });

  it('connects a form with its sealed Page token, changes it, refuses a second company, and archives it', async () => {
    const token = `EAAG${randomBytes(24).toString('base64url')}`;
    const made = await run<IngestSourceDto>(exec, setIngestSource, source({ pageToken: token }));
    expect(made).toMatchObject({ provider: 'meta_leadgen', pageTokenSet: true, archivedAt: null });

    // The platform finds the form and opens its token; nobody else reads it.
    const [found] = (await asPrincipal(workers(), (ctx) =>
      ctx.tx.execute(sql`select source_id, entity_id, pipeline_key, has_page_token
                           from app.ingest_source('meta_leadgen', ${made.externalId})`),
    )) as unknown as Record<string, unknown>[];
    expect(found).toEqual({
      source_id: made.id,
      entity_id: ENTITY,
      pipeline_key: 'farmer_pumps',
      has_page_token: true,
    });
    const [sealed] = (await asPrincipal(workers(), (ctx) =>
      ctx.tx.execute(sql`select app.ingest_source_token(${made.id}::uuid) as token`),
    )) as unknown as { token: Parameters<typeof cipher.decrypt>[0] }[];
    if (!sealed) throw new Error('no token');
    expect(
      await cipher.decrypt(sealed.token, {
        table: 'ingest_sources',
        column: 'page_token_sealed',
        entityId: ENTITY,
        rowId: made.id,
      }),
    ).toBe(token);
    const audited = await asMigrator(
      (m) => m<{ text: string }[]>`
        select coalesce(input_json::text, '') || coalesce(after_json::text, '') as text
          from audit_logs where aggregate_id = ${made.id}`,
    );
    expect(audited.length).toBeGreaterThan(0);
    for (const row of audited) expect(row.text).not.toContain(token.slice(4, 20));

    const changed = await run<IngestSourceDto>(
      exec,
      setIngestSource,
      source({ sourceId: made.id, externalId: made.externalId, name: 'Pumps form, Rabi' }),
    );
    expect(changed).toMatchObject({ name: 'Pumps form, Rabi', pageTokenSet: true });
    expect(
      await refusal(
        run(exec, setIngestSource, source({ sourceId: made.id, externalId: '123456789' })),
      ),
    ).toMatchObject({ reason: 'lead_source_fixed' });
    const otherExec = await createTestPrincipal('executive', [3]);
    expect(
      await refusal(
        run(otherExec, setIngestSource, source({ entityId: 3, externalId: made.externalId })),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'lead_source_taken' });

    const archived = await run<IngestSourceDto>(exec, archiveIngestSource, {
      entityId: ENTITY,
      sourceId: made.id,
    });
    expect(archived.archivedAt).not.toBeNull();
    const after = (await asPrincipal(workers(), (ctx) =>
      ctx.tx.execute(
        sql`select source_id from app.ingest_source('meta_leadgen', ${made.externalId})`,
      ),
    )) as unknown as unknown[];
    expect(after).toEqual([]);
    expect(
      await refusal(run(exec, archiveIngestSource, { entityId: ENTITY, sourceId: made.id })),
    ).toMatchObject({ reason: 'lead_source_missing' });
  });

  it('refuses a pipeline the company is not offered', async () => {
    expect(
      await refusal(
        run(
          exec,
          setIngestSource,
          source({ provider: 'website', pipelineId: newId(), consent: null }),
        ),
      ),
    ).toMatchObject({ reason: 'lead_pipeline_missing' });
  });
});

describe('crm.ingest_key.create and crm.ingest_key.revoke', () => {
  it("is 'forbidden' to a General Manager, and to another company's Executive", async () => {
    const made = newIngestKey();
    const input = {
      entityId: ENTITY,
      label: 'Website',
      keyHash: made.keyHash,
      keyHint: made.keyHint,
    };
    expect(await refusal(run(gm, createIngestKey, input))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(execElsewhere, createIngestKey, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await refusal(run(execElsewhere, revokeIngestKey, { entityId: ENTITY, keyId: newId() })),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('stores only the hash, lets the platform find the key, and refuses it once revoked', async () => {
    const made = newIngestKey();
    const key = await run<IngestKeyDto>(exec, createIngestKey, {
      entityId: ENTITY,
      label: 'Company website',
      keyHash: made.keyHash,
      keyHint: made.keyHint,
    });
    expect(key).toMatchObject({ label: 'Company website', keyHint: made.keyHint, revokedAt: null });
    const use = () =>
      asPrincipal(workers([1, 2, 3, 4]), (ctx) =>
        ctx.tx.execute(sql`select key_id, entity_id from app.ingest_key_use(${made.keyHash})`),
      ) as unknown as Promise<{ key_id: string; entity_id: number }[]>;
    expect(await use()).toEqual([{ key_id: key.id, entity_id: ENTITY }]);
    const audited = await asMigrator(
      (m) => m<{ text: string }[]>`
        select coalesce(input_json::text, '') || coalesce(after_json::text, '') as text
          from audit_logs where aggregate_id = ${key.id}`,
    );
    for (const row of audited) {
      expect(row.text).not.toContain(made.keyHash);
      expect(row.text).not.toContain(made.key);
    }

    const revoked = await run<IngestKeyDto>(exec, revokeIngestKey, {
      entityId: ENTITY,
      keyId: key.id,
    });
    expect(revoked.revokedAt).not.toBeNull();
    expect(await use()).toEqual([]);
    expect(
      await refusal(run(exec, revokeIngestKey, { entityId: ENTITY, keyId: key.id })),
    ).toMatchObject({ code: 'not_found', reason: 'ingest_key_missing' });
  });
});
