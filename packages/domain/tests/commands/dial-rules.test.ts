import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DialPlanDto,
  type EntityChannelDto,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  testPhone,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { recordPhoneDnd } from '../../src/commands/crm/record-phone-dnd';
import { withdrawConsent } from '../../src/commands/crm/consent';
import { archiveEntityChannel, setEntityChannel } from '../../src/commands/org/channels';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { fixtureDndRegistry, unavailableDndRegistry, type DndRegistry } from '../../src/ports/dnd';
import { dialNumber, loadCallLead } from '../../src/queries/calls/call-queue';
import { loadAccount360 } from '../../src/queries/crm/customers';
import { dialFacts, dndRecordInput, toDialPlanDto } from '../../src/queries/calls/dial-plan';
import { listEntityChannels } from '../../src/queries/org/list-channels';
import { prepareDial } from '../../src/telecom/dial-plan';

// E1 Channels and dial rules (docs/03-roadmap-appendix/phase2.md §5.2; PRD TEL-04 and CRM-10):
// an Executive sets a company's numbers; the plan of a call, read through `app.dial_facts()` as
// the caller, picks the 160-series for a consented service call and the 140-series otherwise,
// refuses with every broken rule, refreshes a stale DND check through the platform, and never
// lets a customer who withdrew consent to calls be dialled. Company 3 holds the suite's numbers,
// which no other suite reads; the numbers are synthetic DLT ones.

const ENTITY = 3;
const PROMO = '+911400000301';
const SERVICE = '+911600000301';
const DAY = 86_400_000;

/** Yesterday at 11:00 IST: inside calling hours and always in the past. */
const NOW = ((): Date => {
  const yesterday = new Date(Date.now() - DAY).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  return new Date(`${yesterday}T11:00:00+05:30`);
})();
/** The same day at 21:30 IST, after calling hours. */
const LATE = new Date(NOW.getTime() + 10.5 * 60 * 60 * 1000);

let exec: Principal;
let execElsewhere: Principal;
let gm: Principal;
let caller: Principal;
let colleague: Principal;

const workers = (entityId: number): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
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

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [ENTITY]);
  execElsewhere = await createTestPrincipal('executive', [2]);
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'dial rules team');
  const a = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team }]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: a.id, teamId: team });
  const b = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team }]);
  colleague = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: b.id, teamId: team });
  // Earlier runs' numbers are taken out of use, so this run sets them afresh.
  await asMigrator(
    (m) =>
      m`update entity_channels set is_active = false where entity_id = ${ENTITY} and is_active`,
  );
});

afterAll(closeDb);

describe('org.channel.set and org.channel.archive', () => {
  const set = (who: Principal, input: Record<string, unknown>) =>
    run(who, setEntityChannel, { entityId: ENTITY, verified: false, ...input });

  it('is denied to a General Manager, an agent and a caller', async () => {
    for (const who of [gm, caller, principalFor('agent:triage', [ENTITY])]) {
      expect(await refusal(set(who, { channel: 'call_promo_140', number: PROMO }))).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(
      await refusal(run(gm, archiveEntityChannel, { entityId: ENTITY, channelId: newId() })),
    ).toMatchObject({ code: 'forbidden' });
  });

  it("refuses another company's Executive", async () => {
    expect(
      await refusal(set(execElsewhere, { channel: 'call_promo_140', number: PROMO })),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(
        run(execElsewhere, archiveEntityChannel, { entityId: ENTITY, channelId: newId() }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('sets, verifies, replaces and takes a number out of use, auditing each change', async () => {
    const recorded = memoryAuditSink();
    const setAudited = (input: Record<string, unknown>): Promise<EntityChannelDto> =>
      asPrincipal(exec, (context) =>
        runCommand(
          setEntityChannel,
          { context, audit: recorded, outbox },
          { entityId: ENTITY, verified: false, ...input },
        ),
      );

    const first = await setAudited({ channel: 'ivr', number: '080 4711 2233' });
    expect(first).toMatchObject({
      entityId: ENTITY,
      channel: 'ivr',
      numberE164: '+918047112233',
      isActive: true,
      verifiedAt: null,
    });
    const verified = await setAudited({
      channel: 'ivr',
      number: '+918047112233',
      verified: true,
      providerRef: 'exophone_301',
      dltHeader: 'SHAKTI',
    });
    expect(verified.id).toBe(first.id);
    expect(verified.verifiedAt).not.toBeNull();
    expect(verified).toMatchObject({ providerRef: 'exophone_301', dltHeader: 'SHAKTI' });
    // Nothing changed: no write, and no change of the number in the audit trail.
    const changes = () => recorded.records.filter((r) => r.aggregateType === 'entity_channel');
    const before = changes().length;
    await setAudited({ channel: 'ivr', number: '+918047112233', verified: true });
    expect(changes().length).toBe(before);

    const replaced = await setAudited({ channel: 'ivr', number: '+918047112244' });
    expect(replaced.id).not.toBe(first.id);
    const listed = await asPrincipal(caller, (ctx) =>
      listEntityChannels(ctx, { entityId: ENTITY }),
    );
    expect(listed.filter((c) => c.channel === 'ivr').map((c) => c.id)).toEqual([replaced.id]);

    const archived = (await run(exec, archiveEntityChannel, {
      entityId: ENTITY,
      channelId: replaced.id,
    })) as EntityChannelDto;
    expect(archived.isActive).toBe(false);
    expect(
      await refusal(run(exec, archiveEntityChannel, { entityId: ENTITY, channelId: replaced.id })),
    ).toEqual({ code: 'conflict', reason: 'channel_already_archived' });
    expect(
      await refusal(run(exec, archiveEntityChannel, { entityId: ENTITY, channelId: newId() })),
    ).toEqual({ code: 'not_found', reason: 'channel_missing' });

    const [created, verifiedRow, taken] = changes().map((r) => ({ b: r.before, a: r.after }));
    expect(created?.a).toMatchObject({ channelKind: 'ivr', isActive: true, verified: false });
    expect(verifiedRow).toMatchObject({ b: { verified: false }, a: { verified: true } });
    // The replaced number is kept, out of use.
    expect(taken).toMatchObject({ b: { isActive: true }, a: { isActive: false } });
  });

  it('refuses a provider reference another number in use already has', async () => {
    const ref = `wa_${newId().slice(-12)}`;
    await set(exec, { channel: 'whatsapp', number: '+919800030001', providerRef: ref });
    expect(
      await refusal(
        set(exec, { channel: 'missed_call', number: '+918047112255', providerRef: ref }),
      ),
    ).toEqual({ code: 'conflict', reason: 'channel_provider_ref_taken' });
  });
});

describe('the dial rules through app.dial_facts() (PRD TEL-04, CRM-10)', () => {
  let leadNo = 0;

  beforeAll(async () => {
    await run(exec, setEntityChannel, {
      entityId: ENTITY,
      channel: 'call_promo_140',
      number: PROMO,
      verified: true,
    });
    await run(exec, setEntityChannel, {
      entityId: ENTITY,
      channel: 'call_service_160',
      number: SERVICE,
      verified: true,
    });
  });

  interface Lead {
    id: string;
    accountId: string;
    contactId: string;
    phoneId: string;
    e164: string;
  }

  /** A lead of the caller's; `consent` records a service consent for calls on the form. */
  async function leadOf(options: { source?: string; consent?: boolean } = {}): Promise<Lead> {
    leadNo += 1;
    const created = (await run(caller, createLead, {
      entityId: ENTITY,
      pipelineKey: 'farmer_pumps',
      contact: { name: `Dial rules customer ${leadNo}`, phone: testPhone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Phulera', pin: '303338' },
      ...(options.source === undefined ? {} : { sourceCode: options.source }),
      ...(options.consent === true
        ? {
            consent: {
              channel: 'call',
              purpose: 'service',
              source: 'web_form',
              textVersion: 'v1',
            },
          }
        : {}),
    })) as { id: string; account: { id: string } };
    const accountId = created.account.id;
    const [phone] = await asMigrator(
      (m) => m<{ id: string; e164: string; contact_id: string }[]>`
        select cp.id, cp.e164, cp.contact_id from contact_phones cp
          join account_contacts ac on ac.contact_id = cp.contact_id
         where ac.account_id = ${accountId} order by cp.id limit 1`,
    );
    if (!phone) throw new Error('the lead has no phone');
    return {
      id: created.id,
      accountId,
      contactId: phone.contact_id,
      phoneId: phone.id,
      e164: phone.e164,
    };
  }

  /** The DND state of a phone as the platform last recorded it, set directly for a case. */
  function checked(lead: Lead, onDnd: boolean, at: Date | null) {
    return asMigrator(
      (m) => m`update contact_phones set is_dnd = ${onDnd}, dnd_checked_at = ${at}
                where id = ${lead.phoneId}`,
    );
  }

  /** The plan, as the workspaces read it: facts as the caller, the DND record as the platform. */
  async function plan(
    lead: Lead,
    at: Date = NOW,
    registry: DndRegistry = fixtureDndRegistry({ now: () => at }),
    who: Principal = caller,
  ): Promise<DialPlanDto> {
    const input = { entityId: ENTITY, opportunityId: lead.id, contactPhoneId: lead.phoneId };
    const facts = await asPrincipal(who, (ctx) => dialFacts(ctx, input));
    const result = await prepareDial(facts, at, {
      registry,
      record: async (answer) => {
        await run(workers(ENTITY), recordPhoneDnd, dndRecordInput(facts, lead.phoneId, answer));
      },
    });
    return toDialPlanDto(lead.phoneId, result);
  }

  it('sends a consented enquiry out as a service call on the 160 number', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    // Without a phone, the plan is of the customer's main number, as the workspaces dial it.
    const facts = await asPrincipal(caller, (ctx) =>
      dialFacts(ctx, { entityId: ENTITY, opportunityId: lead.id }),
    );
    expect(facts.contactPhoneId).toBe(lead.phoneId);
    expect(await plan(lead)).toMatchObject({
      purpose: 'service',
      purposeReason: 'service_enquiry',
      callerId: SERVICE,
      series: '160',
      allowed: true,
      refusals: [],
    });
  });

  it('sends a call with no consent out as promotional on the 140 number, never the 160', async () => {
    const lead = await leadOf({ source: 'website' });
    await checked(lead, false, new Date(NOW.getTime() - DAY));
    expect(await plan(lead)).toMatchObject({
      purpose: 'promotional',
      purposeReason: 'promotional_no_consent',
      callerId: PROMO,
      series: '140',
      allowed: true,
    });
  });

  it('keeps a consented call promotional when the company reached out first', async () => {
    const lead = await leadOf({ source: 'import', consent: true });
    await checked(lead, false, new Date(NOW.getTime() - DAY));
    expect(await plan(lead)).toMatchObject({
      purpose: 'promotional',
      purposeReason: 'promotional_not_requested',
      callerId: PROMO,
    });
  });

  it('refuses a dial outside 9 AM to 9 PM IST, and to a DND number without consent, with every reason', async () => {
    const lead = await leadOf({ source: 'import' });
    await checked(lead, true, new Date(NOW.getTime() - DAY));
    expect(await plan(lead, LATE)).toMatchObject({
      allowed: false,
      refusals: ['outside_calling_hours', 'recipient_on_dnd'],
    });
    expect(await plan(lead)).toMatchObject({ allowed: false, refusals: ['recipient_on_dnd'] });
  });

  it('lets a consented service call reach a number on DND', async () => {
    const lead = await leadOf({ source: 'walk_in', consent: true });
    await checked(lead, true, new Date(NOW.getTime() - DAY));
    expect(await plan(lead)).toMatchObject({ purpose: 'service', allowed: true });
  });

  it('refuses a call when the company has no number for its purpose', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const [service] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from entity_channels
              where entity_id = ${ENTITY} and channel = 'call_service_160' and is_active`,
    );
    await run(exec, archiveEntityChannel, { entityId: ENTITY, channelId: service?.id });
    try {
      expect(await plan(lead)).toMatchObject({
        purpose: 'service',
        callerId: null,
        allowed: false,
        refusals: ['company_number_missing'],
      });
    } finally {
      await run(exec, setEntityChannel, {
        entityId: ENTITY,
        channel: 'call_service_160',
        number: SERVICE,
        verified: true,
      });
    }
  });

  it('never dials a customer who withdrew consent to calls, on either series', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const [consent] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from consents
              where contact_id = ${lead.contactId} and channel = 'call'`,
    );
    await run(caller, withdrawConsent, {
      entityId: ENTITY,
      accountId: lead.accountId,
      consentId: consent?.id,
    });
    const after = await plan(lead);
    expect(after).toMatchObject({ purpose: 'promotional', allowed: false });
    expect(after.refusals).toContain('call_consent_withdrawn');
  });

  it('never dials a number whose holder on another customer withdrew consent to calls', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    // The same number on another customer's contact (a family's shared phone), whose consent to
    // calls was withdrawn and not given again.
    await asMigrator(async (m) => {
      const contact = newId();
      const account = newId();
      await m`insert into contacts (id, name, created_by) values (${contact}, 'Dial rules family', ${caller.id})`;
      await m`insert into contact_phones (id, contact_id, e164, created_by)
               values (${newId()}, ${contact}, ${lead.e164}, ${caller.id})`;
      await m`insert into accounts (id, type, name, created_by) values (${account}, 'farm', 'Dial rules family', ${caller.id})`;
      await m`insert into account_contacts (account_id, contact_id, role, created_by)
               values (${account}, ${contact}, 'owner', ${caller.id})`;
      await m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, withdrawn_at, created_by)
               values (${newId()}, ${contact}, 'call', 'promotional', 'verbal', 'v1', now() - interval '2 days', now() - interval '1 day', ${caller.id})`;
    });
    expect((await plan(lead)).refusals).toContain('call_consent_withdrawn');
  });

  /** The Show number key (`D`) and the queue's flag, as the workspace reads them. */
  const showNumber = (lead: Lead) =>
    asPrincipal(caller, (ctx) =>
      dialNumber(ctx, { entityId: ENTITY, opportunityId: lead.id }, NOW),
    );
  const queueFlag = async (lead: Lead) =>
    (
      await asPrincipal(caller, (ctx) =>
        loadCallLead(ctx, { entityId: ENTITY, opportunityId: lead.id }),
      )
    ).consentWithdrawn;

  /** Customer X, of a colleague's: a contact holding `e164` who withdrew consent to calls. */
  async function optedOutHolder(e164: string): Promise<void> {
    await asMigrator(async (m) => {
      const contact = newId();
      const account = newId();
      await m`insert into contacts (id, name, created_by) values (${contact}, 'Dial rules customer X', ${colleague.id})`;
      await m`insert into contact_phones (id, contact_id, e164, created_by)
               values (${newId()}, ${contact}, ${e164}, ${colleague.id})`;
      await m`insert into accounts (id, type, name, created_by) values (${account}, 'farm', 'Dial rules customer X', ${colleague.id})`;
      await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
               values (${newId()}, ${account}, ${ENTITY}, ${colleague.id}, ${colleague.id})`;
      await m`insert into account_contacts (account_id, contact_id, role, created_by)
               values (${account}, ${contact}, 'owner', ${colleague.id})`;
      await m`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, withdrawn_at, created_by)
               values (${newId()}, ${contact}, 'call', 'service', 'verbal', 'v1', now() - interval '2 days', now() - interval '1 day', ${colleague.id})`;
    });
  }

  it("refuses Show number, and flags the queue, for customer Y on a number customer X's contact opted out of (review 1)", async () => {
    // Customer Y is the caller's; the number is also held by customer X, a colleague's, whose
    // contact withdrew consent to calls. The caller reads nothing of X.
    const y = await leadOf({ source: 'website', consent: true });
    expect((await showNumber(y)).e164).toBe(y.e164);
    expect(await queueFlag(y)).toBe(false);
    await optedOutHolder(y.e164);
    expect(await refusal(showNumber(y))).toEqual({
      code: 'conflict',
      reason: 'call_consent_withdrawn',
    });
    expect(await queueFlag(y)).toBe(true);
    expect((await plan(y)).refusals).toContain('call_consent_withdrawn');
    // Account 360 offers no call link to the number (review 8); its consent panel keeps the
    // customer's own rule, and Y's own contacts withdrew nothing.
    const view = await asPrincipal(caller, (ctx) =>
      loadAccount360(ctx, { entityId: ENTITY, accountId: y.accountId }),
    );
    expect(view).toMatchObject({ callOptOut: true, callConsentWithdrawn: false });
  });

  it('refuses Show number for a sales call to a number recorded on DND, never for a consented service call or an unchecked number (review 1)', async () => {
    const sales = await leadOf({ source: 'import' });
    // Never checked, as on production with no register: the number is shown.
    expect((await showNumber(sales)).e164).toBe(sales.e164);
    await checked(sales, true, new Date(NOW.getTime() - 30 * DAY));
    expect(await refusal(showNumber(sales))).toEqual({
      code: 'conflict',
      reason: 'recipient_on_dnd',
    });
    const service = await leadOf({ source: 'website', consent: true });
    await checked(service, true, new Date(NOW.getTime() - DAY));
    expect((await showNumber(service)).e164).toBe(service.e164);
  });

  it('says a sales call cannot be checked where no DND register is set up, not to try again (review 2)', async () => {
    const lead = await leadOf({ source: 'import' });
    expect(await plan(lead, NOW, unavailableDndRegistry())).toMatchObject({
      dnd: 'not_set_up',
      allowed: false,
      refusals: ['dnd_not_set_up'],
    });
  });

  it('looks a stale DND check up again through the platform, and refuses when the register does not answer', async () => {
    const lead = await leadOf({ source: 'import' });
    const stale = new Date(NOW.getTime() - 8 * DAY);
    await checked(lead, false, stale);

    const down = await plan(lead, NOW, fixtureDndRegistry({ unreachable: true }));
    expect(down).toMatchObject({ dnd: 'unknown', allowed: false, refusals: ['dnd_unknown'] });

    const registry = fixtureDndRegistry({ numbers: [lead.e164], now: () => NOW });
    const refreshed = await plan(lead, NOW, registry);
    expect(registry.asked).toEqual([lead.e164]);
    expect(refreshed).toMatchObject({
      dnd: 'refreshed',
      onDnd: true,
      allowed: false,
      refusals: ['recipient_on_dnd'],
    });
    const [row] = await asMigrator(
      (m) => m<{ is_dnd: boolean; dnd_checked_at: Date }[]>`
        select is_dnd, dnd_checked_at from contact_phones where id = ${lead.phoneId}`,
    );
    expect(row?.is_dnd).toBe(true);
    expect(row?.dnd_checked_at.getTime()).toBe(NOW.getTime());

    // Now fresh: the next plan asks the register nothing.
    const quiet = fixtureDndRegistry({ unreachable: true });
    expect(await plan(lead, NOW, quiet)).toMatchObject({ dnd: 'recorded', onDnd: true });
    expect(quiet.asked).toEqual([]);
  });

  it('never holds up a consented service call for a DND register that does not answer', async () => {
    const lead = await leadOf({ source: 'ivr', consent: true });
    expect(await plan(lead, NOW, fixtureDndRegistry({ unreachable: true }))).toMatchObject({
      purpose: 'service',
      allowed: true,
    });
  });

  it('answers no plan for a lead the caller does not read, or of another company', async () => {
    const lead = await leadOf({ source: 'website' });
    expect(await refusal(plan(lead, NOW, undefined, colleague))).toEqual({
      code: 'not_found',
      reason: 'lead_missing',
    });
    const elsewhere = await createTestPrincipal('tele_caller_cc', [2]);
    expect(
      await refusal(
        asPrincipal(elsewhere, (ctx) =>
          dialFacts(ctx, {
            entityId: ENTITY,
            opportunityId: lead.id,
            contactPhoneId: lead.phoneId,
          }),
        ),
      ),
    ).toMatchObject({ code: 'forbidden' });
    const accounts = await createTestPrincipal('accounts', [ENTITY]);
    expect(
      await refusal(
        asPrincipal(accounts, (ctx) =>
          dialFacts(ctx, {
            entityId: ENTITY,
            opportunityId: lead.id,
            contactPhoneId: lead.phoneId,
          }),
        ),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('crm.phone.dnd_record', () => {
  it('is denied to every person and agent: only the platform records a DND answer', async () => {
    const input = {
      entityId: ENTITY,
      contactPhoneId: newId(),
      e164: '+919812345678',
      onDnd: false,
      checkedAt: new Date().toISOString(),
    };
    for (const who of [exec, gm, caller, principalFor('agent:triage', [ENTITY])]) {
      expect(await refusal(run(who, recordPhoneDnd, input))).toMatchObject({ code: 'forbidden' });
    }
  });

  it("refuses another company's request, and answers not found for a phone it does not know", async () => {
    expect(
      await refusal(
        run(workers(2), recordPhoneDnd, {
          entityId: ENTITY,
          contactPhoneId: newId(),
          e164: '+919812345678',
          onDnd: false,
          checkedAt: new Date().toISOString(),
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await refusal(
        run(workers(ENTITY), recordPhoneDnd, {
          entityId: ENTITY,
          contactPhoneId: newId(),
          e164: '+919812345678',
          onDnd: false,
          checkedAt: new Date().toISOString(),
        }),
      ),
    ).toEqual({ code: 'not_found', reason: 'contact_missing' });
  });
});
