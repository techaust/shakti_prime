import { newId, type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  PIPELINE_SEED,
  principalFor,
  stageId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { addNote, updateAccount, updateContact, upsertSite } from '../../src/commands/crm/customer';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { defineCommand } from '../../src/command/define-command';
import { CreateLeadInput } from '@shakti/contracts';
import { z } from 'zod';

// crm.account.update, crm.contact.update, crm.site.upsert and crm.note.add (docs/03-roadmap-appendix/phase1.md
// §6.5): the write rules of the shared customer (ADR 0008), an audit row of what changed and a
// timeline row in the page's company.

afterAll(closeDb);

let teamId: string;
let caller: Principal;
let colleague: Principal;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'customer edit team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const phone = (): string => `94${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const reason = (r: string) => ({ details: { reason: r } });

interface Customer {
  leadId: string;
  accountId: string;
  contactId: string;
  phone: string;
}

async function customerOf(owner: Principal): Promise<Customer> {
  const number = phone();
  const lead = (await run(owner, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Edit customer', phone: number },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Edit village' },
  })) as { id: string; account: { id: string }; contact: { id: string } };
  return {
    leadId: lead.id,
    accountId: lead.account.id,
    contactId: lead.contact.id,
    phone: `+91${number}`,
  };
}

async function lastAudit(command: string, aggregateId: string) {
  const [row] = await asMigrator(
    (m) => m<{ before_json: Record<string, unknown>; after_json: Record<string, unknown> }[]>`
      select before_json, after_json from audit_logs
       where command = ${command} and aggregate_id = ${aggregateId}
       order by created_at desc limit 1`,
  );
  return row;
}

async function timeline(accountId: string) {
  return asMigrator(
    (m) => m<
      {
        type: string;
        opportunity_id: string | null;
        payload_json: Record<string, unknown>;
        body: string | null;
      }[]
    >`select type, opportunity_id, payload_json, body from activities
       where account_id = ${accountId} order by created_at, id`,
  );
}

async function phonesOf(contactId: string) {
  return asMigrator(
    (m) => m<{ id: string; e164: string; is_primary: boolean }[]>`
      select id, e164, is_primary from contact_phones where contact_id = ${contactId}
       order by created_at, id`,
  );
}

describe('crm.account.update', () => {
  it('changes the name and GSTIN, records what changed and writes the timeline row', async () => {
    const k = await customerOf(caller);
    await run(caller, updateAccount, {
      entityId: 1,
      accountId: k.accountId,
      name: 'Ramesh Agro Farm',
      gstin: '08abcde1234f1z5',
      type: 'farm',
    });
    const [account] = await asMigrator(
      (m) => m<{ name: string; gstin: string }[]>`
        select name, gstin from accounts where id = ${k.accountId}`,
    );
    expect(account).toEqual({ name: 'Ramesh Agro Farm', gstin: '08ABCDE1234F1Z5' });
    const row = await lastAudit('crm.account.update', k.accountId);
    expect(row?.before_json).toEqual({ name: 'Edit customer', gstin: null });
    expect(Object.keys(row?.after_json ?? {}).sort()).toEqual(['gstin', 'name']);
    expect((await timeline(k.accountId)).at(-1)).toMatchObject({
      type: 'customer_updated',
      opportunity_id: null,
      payload_json: { changed: 'name,gstin' },
    });
  });

  it('refuses a GSTIN that is not one', async () => {
    const k = await customerOf(caller);
    await expect(
      run(caller, updateAccount, { entityId: 1, accountId: k.accountId, gstin: '08ABC' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('is refused without crm.account.write, and to an agent', async () => {
    const k = await customerOf(caller);
    const accounts = await createTestPrincipal('accounts', [1]);
    await expect(
      run(accounts, updateAccount, { entityId: 1, accountId: k.accountId, name: 'No access' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:chief');
    await expect(
      run(principalFor('agent:chief', [1], { id: seed?.id ?? '' }), updateAccount, {
        entityId: 1,
        accountId: k.accountId,
        name: 'No access',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is refused for a company outside the request', async () => {
    const k = await customerOf(caller);
    await expect(
      run(caller, updateAccount, { entityId: 2, accountId: k.accountId, name: 'Elsewhere' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a customer read only through a lead is not the reader’s to change (0057)', async () => {
    const k = await customerOf(caller);
    // A lead of the colleague on the caller's customer: the colleague reads the customer.
    await asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${newId()}, 1, ${k.accountId}, ${PIPELINE_SEED[0]?.id ?? ''}, ${stageId(1, 1)}, ${colleague.id}, ${teamId}, ${caller.id})`,
    );
    await expect(
      run(colleague, updateAccount, { entityId: 1, accountId: k.accountId, name: 'Not mine' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const stranger = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(
      run(stranger, updateAccount, { entityId: 1, accountId: k.accountId, name: 'Not mine' }),
    ).rejects.toMatchObject(reason('account_missing'));
  });
});

describe('crm.contact.update', () => {
  it('adds a number, makes it the main one and takes the old one off', async () => {
    const typed = phone();
    const k = await customerOf(caller);
    const [old] = await phonesOf(k.contactId);
    await run(caller, updateContact, {
      entityId: 1,
      accountId: k.accountId,
      contactId: k.contactId,
      preferredLanguage: 'en',
      // Typed as people type it: a trunk 0 and a space.
      addPhones: [{ phone: `0${typed.slice(0, 5)} ${typed.slice(5)}`, isWhatsapp: true }],
    });
    const two = await phonesOf(k.contactId);
    expect(two.map((p) => [p.e164, p.is_primary])).toEqual([
      [k.phone, true],
      [`+91${typed}`, false],
    ]);
    const added = two[1]?.id ?? '';
    await run(caller, updateContact, {
      entityId: 1,
      accountId: k.accountId,
      contactId: k.contactId,
      primaryPhoneId: added,
      removePhoneIds: [old?.id ?? ''],
    });
    expect((await phonesOf(k.contactId)).map((p) => [p.e164, p.is_primary])).toEqual([
      [`+91${typed}`, true],
    ]);
    const row = await lastAudit('crm.contact.update', k.contactId);
    // Numbers keep only their last four digits in the audit trail.
    expect(JSON.stringify(row)).not.toContain(typed);
    expect(Object.keys(row?.after_json ?? {}).sort()).toEqual(['phones', 'primaryPhone']);
  });

  it('keeps at least one number, and refuses a number already on the contact', async () => {
    const k = await customerOf(caller);
    const [only] = await phonesOf(k.contactId);
    await expect(
      run(caller, updateContact, {
        entityId: 1,
        accountId: k.accountId,
        contactId: k.contactId,
        removePhoneIds: [only?.id ?? ''],
      }),
    ).rejects.toMatchObject(reason('phone_last_one'));
    await expect(
      run(caller, updateContact, {
        entityId: 1,
        accountId: k.accountId,
        contactId: k.contactId,
        addPhones: [{ phone: k.phone }],
      }),
    ).rejects.toMatchObject(reason('phone_already_on_contact'));
  });

  it('when the main number goes, the oldest number left becomes the main one', async () => {
    const k = await customerOf(caller);
    const [first] = await phonesOf(k.contactId);
    const second = `+91${phone()}`;
    await run(caller, updateContact, {
      entityId: 1,
      accountId: k.accountId,
      contactId: k.contactId,
      addPhones: [{ phone: second }],
      removePhoneIds: [first?.id ?? ''],
    });
    expect((await phonesOf(k.contactId)).map((p) => [p.e164, p.is_primary])).toEqual([
      [second, true],
    ]);
  });

  it('refuses a number or a contact of another customer', async () => {
    const k = await customerOf(caller);
    const other = await customerOf(caller);
    const [foreign] = await phonesOf(other.contactId);
    await expect(
      run(caller, updateContact, {
        entityId: 1,
        accountId: k.accountId,
        contactId: k.contactId,
        removePhoneIds: [foreign?.id ?? ''],
      }),
    ).rejects.toMatchObject(reason('phone_missing'));
    await expect(
      run(caller, updateContact, {
        entityId: 1,
        accountId: k.accountId,
        contactId: other.contactId,
        name: 'Wrong customer',
      }),
    ).rejects.toMatchObject(reason('contact_missing'));
  });
});

describe('crm.site.upsert', () => {
  it('adds a site and changes it, with its map point', async () => {
    const k = await customerOf(caller);
    const made = (await run(caller, upsertSite, {
      entityId: 1,
      accountId: k.accountId,
      type: 'rooftop',
      village: 'Sikar',
      district: 'Sikar',
      pin: '332001',
      stateCode: '08',
    })) as { siteId: string };
    await run(caller, upsertSite, {
      entityId: 1,
      accountId: k.accountId,
      siteId: made.siteId,
      type: 'rooftop',
      tehsil: 'Danta Ramgarh',
      location: { lat: 27.6094, lng: 75.1399 },
    });
    const [site] = await asMigrator(
      (m) => m<{ village: string; tehsil: string; lat: string; lng: string }[]>`
        select village, tehsil, lat, lng from customer_sites where id = ${made.siteId}`,
    );
    expect(site).toEqual({
      village: 'Sikar',
      tehsil: 'Danta Ramgarh',
      lat: '27.609400',
      lng: '75.139900',
    });
    const types = (await timeline(k.accountId)).map((r) => [r.type, r.payload_json.created]);
    expect(types.slice(-2)).toEqual([
      ['site_updated', true],
      ['site_updated', false],
    ]);
  });

  it('refuses a site of another customer', async () => {
    const k = await customerOf(caller);
    const other = await customerOf(caller);
    const otherSite = (await run(caller, upsertSite, {
      entityId: 1,
      accountId: other.accountId,
      type: 'borewell',
    })) as { siteId: string };
    await expect(
      run(caller, upsertSite, {
        entityId: 1,
        accountId: k.accountId,
        siteId: otherSite.siteId,
        type: 'borewell',
      }),
    ).rejects.toMatchObject(reason('site_missing'));
  });
});

describe('crm.contact.update: a number of a colleague’s customer', () => {
  const add = (k: Customer, number: string) =>
    run(caller, updateContact, {
      entityId: 1,
      accountId: k.accountId,
      contactId: k.contactId,
      addPhones: [{ phone: number }],
    });

  it('refuses a number that belongs to a customer a colleague looks after', async () => {
    const k = await customerOf(caller);
    const theirs = await customerOf(colleague);
    await expect(add(k, theirs.phone)).rejects.toMatchObject(reason('customer_held_by_colleague'));
    expect((await phonesOf(k.contactId)).map((p) => p.e164)).toEqual([k.phone]);
  });

  it('takes a number of another contact of the same customer', async () => {
    const k = await customerOf(caller);
    const family = newId();
    const number = `+91${phone()}`;
    await asMigrator(async (m) => {
      await m`insert into contacts (id, name, created_by) values (${family}, 'Family member', ${caller.id})`;
      await m`insert into account_contacts (account_id, contact_id, role, created_by)
        values (${k.accountId}, ${family}, 'family', ${caller.id})`;
      await m`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
        values (${newId()}, ${family}, ${number}, true, ${caller.id})`;
    });
    await add(k, number);
    expect((await phonesOf(k.contactId)).map((p) => p.e164)).toContain(number);
  });

  it('takes a number of another customer the caller may change', async () => {
    const k = await customerOf(caller);
    const mine = await customerOf(caller);
    await add(k, mine.phone);
    expect((await phonesOf(k.contactId)).map((p) => p.e164)).toContain(mine.phone);
  });

  it('waits for a lead typed at the same moment with the number, then refuses it', async () => {
    const k = await customerOf(caller);
    const number = phone();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      started = resolve;
    });
    // The colleague's lead form, held open after it has taken the number lock.
    const holdLead = defineCommand({
      name: 'test.lead.hold',
      permission: 'crm.lead.write',
      alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
      auditFields: [],
      input: z.object({ lead: CreateLeadInput }).strict(),
      output: z.object({ id: z.string() }).strict(),
      async handler(ctx, input) {
        const lead = await ctx.run(createLead, input.lead);
        started();
        await gate;
        return { id: lead.id };
      },
    });
    const colleagueLead = run(colleague, holdLead, {
      lead: {
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        contact: { name: 'Racing customer', phone: number },
        account: { type: 'farm' },
      },
    });
    await holding;
    let settled = false;
    const change = add(k, number).finally(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(settled).toBe(false);
    release();
    await colleagueLead;
    await expect(change).rejects.toMatchObject(reason('customer_held_by_colleague'));
  });
});

describe('crm.note.add', () => {
  it('adds a note to the customer or to one of their leads', async () => {
    const k = await customerOf(caller);
    await run(caller, addNote, { entityId: 1, accountId: k.accountId, body: 'Wants a quote' });
    await run(caller, addNote, {
      entityId: 1,
      accountId: k.accountId,
      opportunityId: k.leadId,
      body: 'Call after the harvest',
    });
    const notes = (await timeline(k.accountId)).filter((r) => r.type === 'note');
    expect(notes.map((n) => [n.opportunity_id, n.body])).toEqual([
      [null, 'Wants a quote'],
      [k.leadId, 'Call after the harvest'],
    ]);
  });

  it('refuses a note on an archived lead, and on a customer read only through a lead', async () => {
    const k = await customerOf(caller);
    await asMigrator((m) => m`update opportunities set archived_at = now() where id = ${k.leadId}`);
    await expect(
      run(caller, addNote, {
        entityId: 1,
        accountId: k.accountId,
        opportunityId: k.leadId,
        body: 'Too late',
      }),
    ).rejects.toMatchObject(reason('lead_missing'));
    const other = await customerOf(caller);
    await asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${newId()}, 1, ${other.accountId}, ${PIPELINE_SEED[0]?.id ?? ''}, ${stageId(1, 1)}, ${colleague.id}, ${teamId}, ${caller.id})`,
    );
    await expect(
      run(colleague, addNote, { entityId: 1, accountId: other.accountId, body: 'Not mine' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a note on a lead of another customer, or by someone who cannot see it', async () => {
    const k = await customerOf(caller);
    const other = await customerOf(caller);
    await expect(
      run(caller, addNote, {
        entityId: 1,
        accountId: k.accountId,
        opportunityId: other.leadId,
        body: 'Wrong lead',
      }),
    ).rejects.toMatchObject(reason('lead_missing'));
    await expect(
      run(colleague, addNote, { entityId: 1, accountId: k.accountId, body: 'Not mine' }),
    ).rejects.toMatchObject(reason('account_missing'));
  });
});
