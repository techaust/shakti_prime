import { newId, type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { archiveTag, createTag, tagLead, untagLead } from '../../src/commands/crm/tags';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// crm.tag.create and .archive (crm.lead.assign) and crm.lead.tag and .untag (crm.lead.write):
// a company's tag never goes on another company's lead (DATABASE §6.2).

afterAll(closeDb);

let caller: Principal;
let colleague: Principal;
let teamLead: Principal;
let everywhere: Principal;

beforeAll(async () => {
  const teamId = await createTestTeam(1, 'tag team');
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId });
  everywhere = await createTestPrincipal('executive');
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const unique = (label: string): string => `${label} ${newId().slice(-6)}`;
const phone = (): string => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const reason = (r: string) => ({ details: { reason: r } });

async function leadOf(owner: Principal, entityId = 1): Promise<string> {
  const lead = (await run(owner, createLead, {
    entityId,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Tag customer', phone: phone() },
    account: { type: 'farm' },
  })) as { id: string };
  return lead.id;
}

async function tag(who: Principal, entityId: number | null, name = unique('Mela')) {
  return (await run(who, createTag, { entityId, name })) as { id: string; name: string };
}

describe('crm.tag.create and crm.tag.archive', () => {
  it('a team lead makes a tag for their company; a caller may not', async () => {
    const made = await tag(teamLead, 1);
    expect(made).toMatchObject({ entityId: 1, archivedAt: null });
    await expect(tag(caller, 1)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a name already used in the company, whatever its case', async () => {
    const name = unique('Kisan mela');
    await tag(teamLead, 1, name);
    await expect(tag(teamLead, 1, name.toUpperCase())).rejects.toMatchObject(
      reason('tag_name_taken'),
    );
    // Another company may use the name.
    await tag(everywhere, 2, name);
  });

  it('keeps group and company tag names apart, whatever their case', async () => {
    const name = unique('Surya mela');
    await tag(everywhere, null, name);
    await expect(tag(teamLead, 1, name.toLowerCase())).rejects.toMatchObject(
      reason('tag_name_taken'),
    );
    const companyName = unique('Village drive');
    await tag(teamLead, 1, companyName);
    await expect(tag(everywhere, null, companyName.toUpperCase())).rejects.toMatchObject(
      reason('tag_name_taken'),
    );
  });

  it('takes a name any person would type, and keeps only its id on the timeline', async () => {
    const made = await tag(teamLead, 1, unique('Mela @ Sikar'));
    const lead = await leadOf(caller);
    await expect(
      run(caller, tagLead, { entityId: 1, opportunityId: lead, tagId: made.id }),
    ).resolves.toMatchObject({ tagged: true });
  });

  it('is for people only: an agent never makes or archives a tag', async () => {
    const seed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    const triage = principalFor('agent:triage', [1], { id: seed?.id ?? newId() });
    await expect(tag(triage, 1)).rejects.toMatchObject({ code: 'forbidden' });
    const made = await tag(teamLead, 1);
    await expect(run(triage, archiveTag, { tagId: made.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('makes a group-wide tag only in a request for every company', async () => {
    await expect(tag(teamLead, null)).rejects.toMatchObject({ code: 'forbidden' });
    expect(await tag(everywhere, null)).toMatchObject({ entityId: null });
  });

  it('refuses a company outside the request', async () => {
    await expect(tag(teamLead, 2)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('archives a tag once; it can then not be put on a lead', async () => {
    const made = await tag(teamLead, 1);
    await run(teamLead, archiveTag, { tagId: made.id });
    await expect(run(teamLead, archiveTag, { tagId: made.id })).rejects.toMatchObject(
      reason('tag_missing'),
    );
    const lead = await leadOf(caller);
    await expect(
      run(caller, tagLead, { entityId: 1, opportunityId: lead, tagId: made.id }),
    ).rejects.toMatchObject(reason('tag_missing'));
  });
});

describe('crm.lead.tag and crm.lead.untag', () => {
  it('puts a tag of the company, or of the group, on a lead once, and takes it off', async () => {
    const lead = await leadOf(caller);
    const company = await tag(teamLead, 1);
    const group = await tag(everywhere, null);
    for (const t of [company, group]) {
      const input = { entityId: 1, opportunityId: lead, tagId: t.id };
      expect(await run(caller, tagLead, input)).toMatchObject({ tagged: true });
      expect(await run(caller, tagLead, input)).toMatchObject({ tagged: true });
    }
    await run(caller, untagLead, { entityId: 1, opportunityId: lead, tagId: company.id });
    await run(caller, untagLead, { entityId: 1, opportunityId: lead, tagId: company.id });
    const rows = await asMigrator(
      (m) => m<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from activities where opportunity_id = ${lead}
         order by created_at, id`,
    );
    expect(rows.map((r) => r.type)).toEqual(['lead_created', 'tagged', 'tagged', 'untagged']);
    // Ids only: a tag's name is read when the timeline is.
    expect(rows[1]?.payload_json).toEqual({ tagId: company.id });
    const left = await asMigrator(
      (m) =>
        m<{ tag_id: string }[]>`select tag_id from opportunity_tags where opportunity_id = ${lead}`,
    );
    expect(left.map((r) => r.tag_id)).toEqual([group.id]);
  });

  it('never puts another company’s tag on a lead', async () => {
    const lead = await leadOf(everywhere);
    const other = await tag(everywhere, 2);
    await expect(
      run(everywhere, tagLead, { entityId: 1, opportunityId: lead, tagId: other.id }),
    ).rejects.toMatchObject(reason('tag_missing'));
    // Nor does the table take it, even from a caller who reads both.
    await expect(
      asPrincipal(everywhere, ({ tx }) =>
        tx.execute(sql`insert into opportunity_tags (opportunity_id, account_id, tag_id, entity_id, created_by)
                       select o.id, o.account_id, ${other.id}, 1, ${everywhere.id}
                         from opportunities o where o.id = ${lead}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('is refused on a colleague’s lead, to a role that does not write leads, and in another company', async () => {
    const lead = await leadOf(colleague);
    const t = await tag(teamLead, 1);
    await expect(
      run(caller, tagLead, { entityId: 1, opportunityId: lead, tagId: t.id }),
    ).rejects.toMatchObject(reason('lead_missing'));
    const accounts = await createTestPrincipal('accounts', [1]);
    await expect(
      run(accounts, tagLead, { entityId: 1, opportunityId: lead, tagId: t.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(caller, untagLead, { entityId: 2, opportunityId: lead, tagId: t.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
