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
import { recordConsent } from '../../src/commands/crm/consent';
import { createLead } from '../../src/commands/crm/create-lead';
import { addNote } from '../../src/commands/crm/customer';
import { createTag, tagLead } from '../../src/commands/crm/tags';
import { createTask } from '../../src/commands/crm/tasks';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  listCustomers,
  listMyTasks,
  listTimeline,
  loadAccount360,
} from '../../src/queries/crm/customers';

// The customers list, Account 360, the timeline and the caller's tasks (docs/design/phase1.md
// §6.5), each read under the caller's own policies.

afterAll(closeDb);

/** A word no earlier run used, so each search here finds only this run's customers. */
const TAG = `Zq${newId()
  .slice(-6)
  .replace(/[^a-z]/g, 'x')}`;

let teamId: string;
let caller: Principal;
let colleague: Principal;
let lead: Principal;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'customers query team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  lead = await createTestPrincipal('sales_team_lead', [1], { teamId });
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const read = <T>(
  who: Principal,
  query: (ctx: never, input: unknown) => Promise<T>,
  input: unknown,
) => asPrincipal(who, (ctx) => query(ctx as never, input));

const digits = (): string => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

async function customer(owner: Principal, name: string, village: string, number = `91${digits()}`) {
  const made = (await run(owner, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name: `${name} contact`, phone: number },
    account: { type: 'farm', name },
    site: { type: 'borewell', village },
  })) as { id: string; account: { id: string }; contact: { id: string } };
  return { leadId: made.id, accountId: made.account.id, contactId: made.contact.id, number };
}

interface Page {
  items: { accountId: string; name: string; phoneLast4: string | null }[];
  nextCursor: string | null;
}

describe('listCustomers', () => {
  it('lists the caller’s customers by name, a page at a time, and finds them by name, village or phone', async () => {
    const one = await customer(caller, `${TAG} Anil`, `${TAG}pur`);
    const two = await customer(caller, `${TAG} Bina`, 'Churu');
    const three = await customer(caller, `${TAG} Chetan`, 'Sikar', `91${digits()}`);
    const hidden = await customer(colleague, `${TAG} Dev`, 'Sikar');

    const first = (await read(caller, listCustomers, { q: TAG, limit: 2 })) as Page;
    expect(first.items.map((r) => r.name)).toEqual([`${TAG} Anil`, `${TAG} Bina`]);
    expect(first.items[0]?.phoneLast4).toBe(one.number.slice(-4));
    const second = (await read(caller, listCustomers, {
      q: TAG,
      limit: 2,
      cursor: first.nextCursor,
    })) as Page;
    expect(second.items.map((r) => r.name)).toEqual([`${TAG} Chetan`]);
    expect(second.nextCursor).toBeNull();

    const byVillage = (await read(caller, listCustomers, { q: `${TAG}pur` })) as Page;
    expect(byVillage.items.map((r) => r.accountId)).toEqual([one.accountId]);
    const byPhone = (await read(caller, listCustomers, { q: three.number.slice(-6) })) as Page;
    expect(byPhone.items.map((r) => r.accountId)).toContain(three.accountId);
    const byContact = (await read(caller, listCustomers, { q: `${TAG} Bina contact` })) as Page;
    expect(byContact.items.map((r) => r.accountId)).toEqual([two.accountId]);

    // A colleague's customer is not the caller's; their team lead sees both.
    expect(first.items.concat(second.items).map((r) => r.accountId)).not.toContain(
      hidden.accountId,
    );
    const team = (await read(lead, listCustomers, { q: TAG, limit: 10 })) as Page;
    expect(team.items.map((r) => r.accountId)).toContain(hidden.accountId);
  });

  it('shows a customer read through a lead of the caller (0057), never to an agent', async () => {
    const k = await customer(colleague, `${TAG} Through`, 'Nagaur');
    await asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${newId()}, 1, ${k.accountId}, ${PIPELINE_SEED[0]?.id ?? ''}, ${stageId(1, 1)}, ${caller.id}, ${teamId}, ${colleague.id})`,
    );
    const mine = (await read(caller, listCustomers, { q: `${TAG} Through` })) as Page;
    expect(mine.items.map((r) => r.accountId)).toEqual([k.accountId]);
    const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    const triage = principalFor('agent:triage', [1], { id: seed?.id ?? '' });
    const agent = (await read(triage, listCustomers, { q: `${TAG} Through` })) as Page;
    expect(agent.items).toEqual([]);
  });

  it('is refused to a role that reads neither customers nor leads', async () => {
    await expect(read(principalFor('agent:sizing', [1]), listCustomers, {})).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('loadAccount360 and listTimeline', () => {
  it('brings the customer, contacts, sites, leads with tags, open tasks, consents and the timeline', async () => {
    const k = await customer(caller, `${TAG} Full`, 'Jhunjhunu');
    const tag = (await run(lead, createTag, { entityId: 1, name: `${TAG} mela` })) as {
      id: string;
    };
    await run(caller, tagLead, { entityId: 1, opportunityId: k.leadId, tagId: tag.id });
    await run(caller, createTask, {
      entityId: 1,
      opportunityId: k.leadId,
      kind: 'callback',
      dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await run(caller, recordConsent, {
      entityId: 1,
      accountId: k.accountId,
      contactId: k.contactId,
      channel: 'call',
      purpose: 'service',
      source: 'verbal',
      textVersion: 'v1',
      givenAt: new Date().toISOString(),
    });
    const view = (await read(caller, loadAccount360, { accountId: k.accountId })) as {
      entityId: number;
      canEdit: boolean;
      contacts: { phones: { e164: string; isPrimary: boolean }[] }[];
      sites: { village: string }[];
      leads: { id: string; tags: { name: string }[] }[];
      tasks: { kind: string }[];
      consents: { channel: string }[];
      tags: { id: string }[];
      timeline: { items: { type: string }[] };
    };
    expect(view.entityId).toBe(1);
    expect(view.canEdit).toBe(true);
    expect(view.contacts[0]?.phones).toEqual([
      expect.objectContaining({ e164: `+91${k.number}`, isPrimary: true }),
    ]);
    expect(view.sites.map((s) => s.village)).toEqual(['Jhunjhunu']);
    expect(view.leads.map((l) => [l.id, l.tags.map((t) => t.name)])).toEqual([
      [k.leadId, [`${TAG} mela`]],
    ]);
    expect(view.tasks.map((t) => t.kind)).toEqual(['callback']);
    expect(view.consents.map((c) => c.channel)).toEqual(['call']);
    expect(view.tags.map((t) => t.id)).toContain(tag.id);
    expect(view.timeline.items.map((i) => i.type)).toEqual([
      'consent_recorded',
      'task_created',
      'tagged',
      'lead_created',
    ]);
  });

  it('is not found for a customer the caller cannot read, or in another company', async () => {
    const k = await customer(colleague, `${TAG} Hidden`, 'Churu');
    await expect(read(caller, loadAccount360, { accountId: k.accountId })).rejects.toMatchObject({
      details: { reason: 'account_missing' },
    });
    const everywhere = await createTestPrincipal('general_manager', [1, 2]);
    await expect(
      read(everywhere, loadAccount360, { accountId: k.accountId, entityId: 2 }),
    ).rejects.toMatchObject({ details: { reason: 'account_missing' } });
  });

  it('pages the timeline newest first without losing rows written in one moment', async () => {
    const k = await customer(caller, `${TAG} Notes`, 'Churu');
    for (let i = 0; i < 5; i++) {
      await run(caller, addNote, {
        entityId: 1,
        accountId: k.accountId,
        body: `note ${String(i)}`,
      });
    }
    const seen: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = (await read(caller, listTimeline, {
        entityId: 1,
        accountId: k.accountId,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      })) as { items: { id: string; body: string | null }[]; nextCursor: string | null };
      seen.push(...page.items.map((i) => i.body ?? 'lead'));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['note 4', 'note 3', 'note 2', 'note 1', 'note 0', 'lead']);

    const ofLead = (await read(caller, listTimeline, {
      entityId: 1,
      opportunityId: k.leadId,
    })) as { items: { type: string }[] };
    expect(ofLead.items.map((i) => i.type)).toEqual(['lead_created']);
    await expect(
      read(caller, listTimeline, { entityId: 1, accountId: k.accountId, cursor: 'nonsense' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('listMyTasks', () => {
  it('lists the caller’s open tasks, soonest first', async () => {
    const owner = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const k = await customer(owner, `${TAG} Tasks`, 'Churu');
    const due = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
    for (const [kind, h] of [
      ['review', 30],
      ['callback', 2],
      ['follow_up', 10],
    ] as const) {
      await run(owner, createTask, { entityId: 1, opportunityId: k.leadId, kind, dueAt: due(h) });
    }
    const first = (await read(owner, listMyTasks, { limit: 2 })) as {
      items: { kind: string; accountName: string }[];
      nextCursor: string | null;
    };
    expect(first.items.map((t) => t.kind)).toEqual(['callback', 'follow_up']);
    expect(first.items[0]?.accountName).toBe(`${TAG} Tasks`);
    const rest = (await read(owner, listMyTasks, { limit: 2, cursor: first.nextCursor })) as {
      items: { kind: string }[];
    };
    expect(rest.items.map((t) => t.kind)).toEqual(['review']);
  });
});
