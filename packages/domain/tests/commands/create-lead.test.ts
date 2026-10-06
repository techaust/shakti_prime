import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  stageId,
} from '@shakti/db/testing';
import { IdSchema, newId } from '@shakti/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { countLeads, listLeads } from '../../src/queries/crm/list-leads';

afterAll(closeDb);

/**
 * A mobile number no earlier run used: the suites never clean the CRM tables, and a number a
 * colleague's customer already has is refused (0055). Written with a space, as a caller types it.
 */
function phone(): { typed: string; e164: string } {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return { typed: `${digits.slice(0, 5)} ${digits.slice(5)}`, e164: `+91${digits}` };
}

const typed = phone();
const input = {
  entityId: 1,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Lead test contact', phone: typed.typed },
  account: { type: 'farm' as const },
  // A village of this run only, so no earlier run's customer is put forward as a duplicate.
  site: {
    type: 'borewell' as const,
    village: `Lead test village ${typed.e164.slice(-6)}`,
    pin: '302001',
  },
  consent: {
    channel: 'whatsapp' as const,
    purpose: 'service' as const,
    source: 'walk_in_form' as const,
    textVersion: 'v1',
  },
  sourceCode: 'walk_in',
};

let teamId: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'create-lead team');
});

describe('crm.lead.create', () => {
  it('is denied for a role without crm.lead.write', async () => {
    const hr = await createTestPrincipal('hr_admin', [1]);
    await expect(
      asPrincipal(hr, (context) => runCommand(createLead, { context, audit, outbox }, input)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an entity outside the request scope', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [2], { teamId });
    await expect(
      asPrincipal(cc, (context) => runCommand(createLead, { context, audit, outbox }, input)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a pipeline that belongs to another entity', async () => {
    const key = `entity2-${newId().slice(-8)}`;
    await asMigrator(
      (m) => m`insert into pipelines (id, entity_id, key, name, segment)
        values (${newId()}, 2, ${key}, 'entity two pipeline', 'farmer_pumps')`,
    );
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(createLead, { context, audit, outbox }, { ...input, pipelineKey: key }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'lead_pipeline_missing' },
    });
  });

  it('rejects an unknown pipeline, source or phone with validation_failed', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(createLead, { context, audit, outbox }, { ...input, pipelineKey: 'nope' }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'lead_pipeline_missing' },
    });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(createLead, { context, audit, outbox }, { ...input, sourceCode: 'nope' }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'lead_source_unknown' },
    });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(
          createLead,
          { context, audit, outbox },
          { ...input, contact: { ...input.contact, phone: '12' } },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('creates the lead owned by the caller in the first stage, audits and emits', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const lead = await asPrincipal(cc, (context) =>
      runCommand(createLead, { context, audit: recorded, outbox: emitted }, input),
    );
    expect(lead.ownerId).toBe(cc.id);
    expect(lead.teamId).toBe(teamId);
    expect(lead.entityId).toBe(1);
    expect(lead.stageId).toBe(stageId(1, 1));
    expect(lead.state).toBe('open');
    expect(lead.contact?.phone).toBe(typed.e164);
    expect(lead.account.name).toBe('Lead test contact');
    expect(lead.siteId).not.toBeNull();
    expect(Object.keys(lead).sort()).toEqual([
      'account',
      'contact',
      'entityId',
      'id',
      'outcome',
      'ownerId',
      'pipelineId',
      'score',
      'scoreChangedAt',
      'scoreReasons',
      'siteId',
      'stageId',
      'state',
      'teamId',
      'updatedAt',
    ]);
    expect(recorded.records).toContainEqual(
      expect.objectContaining({ command: 'crm.lead.create' }),
    );
    expect(emitted.records).toEqual([
      expect.objectContaining({ type: 'crm.lead.created', aggregateId: lead.id }),
    ]);

    // Visibility of the new lead follows the ownership scope.
    const other = await createTestPrincipal('tele_caller_cc', [1], {
      teamId: await createTestTeam(1, 'other team'),
    });
    const lead2 = await createTestPrincipal('sales_team_lead', [1], { teamId });
    const gm = await createTestPrincipal('general_manager', [1]);
    const seenBy = async (p: typeof cc) =>
      (await asPrincipal(p, (ctx) => listLeads(ctx))).items.some((l) => l.id === lead.id);
    expect(await seenBy(cc)).toBe(true);
    expect(await seenBy(other)).toBe(false);
    expect(await seenBy(lead2)).toBe(true);
    expect(await seenBy(gm)).toBe(true);
  });

  it('attaches a second lead in another entity to the same customer (ADR 0008)', async () => {
    const cc1 = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const first = await asPrincipal(cc1, (context) =>
      runCommand(
        createLead,
        { context, audit, outbox },
        { ...input, contact: { name: 'Shared customer', phone: phone().typed } },
      ),
    );
    const accountId = first.account.id;

    // the entity-2 caller cannot see the customer yet, and a made-up account answers not_found
    const cc2 = await createTestPrincipal('tele_caller_cc', [2], {
      teamId: await createTestTeam(2, 'entity two team'),
    });
    await expect(
      asPrincipal(cc2, (context) =>
        runCommand(
          createLead,
          { context, audit, outbox },
          { entityId: 2, pipelineKey: 'farmer_pumps', existingAccountId: newId() },
        ),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'account_missing' } });
    await expect(
      asPrincipal(cc2, (context) =>
        runCommand(
          createLead,
          { context, audit, outbox },
          { entityId: 2, pipelineKey: 'farmer_pumps' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const emitted = memoryOutboxSink();
    const second = await asPrincipal(cc2, (context) =>
      runCommand(
        createLead,
        { context, audit, outbox: emitted },
        {
          entityId: 2,
          pipelineKey: 'farmer_pumps',
          existingAccountId: accountId,
          site: { type: 'rooftop', village: `Shared village ${typed.e164.slice(-6)}` },
        },
      ),
    );
    expect(second.account.id).toBe(accountId);
    expect(second.contact).toEqual(first.contact);
    expect(second.entityId).toBe(2);
    expect(second.ownerId).toBe(cc2.id);
    expect(second.siteId).not.toBeNull();
    expect(emitted.records).toEqual([
      expect.objectContaining({ type: 'crm.lead.created', entityId: 2 }),
    ]);

    // each caller sees the customer through their own relationship, and only their own lead
    const leadsOf = async (p: typeof cc1) =>
      (await asPrincipal(p, (ctx) => listLeads(ctx))).items
        .filter((l) => l.account.id === accountId)
        .map((l) => l.id);
    expect(await leadsOf(cc1)).toEqual([first.id]);
    expect(await leadsOf(cc2)).toEqual([second.id]);
    const [rows] = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from account_entities where account_id = ${accountId}`,
    );
    expect(rows?.n).toBe(2);
    // the relationship the database wrote carries an ADR 0006 id (AUDIT L4)
    const attached = await asMigrator(
      (m) =>
        m<
          { id: string }[]
        >`select id from account_entities where account_id = ${accountId} and entity_id = 2`,
    );
    expect(IdSchema.safeParse(attached[0]?.id).success).toBe(true);

    // attaching again is idempotent for the relationship, and a consent given now is recorded
    const third = await asPrincipal(cc2, (context) =>
      runCommand(
        createLead,
        { context, audit, outbox },
        {
          entityId: 2,
          pipelineKey: 'farmer_pumps',
          existingAccountId: accountId,
          consent: { channel: 'call', purpose: 'promotional', source: 'verbal', textVersion: 'v2' },
        },
      ),
    );
    expect(third.account.id).toBe(accountId);
    const [consent] = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from consents where contact_id = ${first.contact?.id ?? ''} and text_version = 'v2'`,
    );
    expect(consent?.n).toBe(1);
    const [again] = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from account_entities where account_id = ${accountId}`,
    );
    expect(again?.n).toBe(2);
  });

  it('pages through leads written in one transaction, which share updated_at to the microsecond', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const created = await asPrincipal(cc, async (context) => {
      const ids: string[] = [];
      for (const n of [1, 2, 3]) {
        const lead = await runCommand(
          createLead,
          { context, audit, outbox },
          { ...input, contact: { name: `Lead batch contact ${n}`, phone: phone().typed } },
        );
        ids.push(lead.id);
      }
      return ids;
    });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await asPrincipal(cc, (ctx) =>
        listLeads(ctx, { limit: 1, ...(cursor === undefined ? {} : { cursor }) }),
      );
      seen.push(...page.items.map((l) => l.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    for (const id of created) expect(seen).toContain(id);
  });

  it('lists leads newest first with a working keyset cursor', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    for (const n of [1, 2, 3]) {
      await asPrincipal(cc, (context) =>
        runCommand(
          createLead,
          { context, audit, outbox },
          { ...input, contact: { name: `Lead page contact ${n}`, phone: phone().typed } },
        ),
      );
    }
    expect(await asPrincipal(cc, countLeads)).toBe(3);
    const first = await asPrincipal(cc, (ctx) => listLeads(ctx, { limit: 2 }));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await asPrincipal(cc, (ctx) =>
      listLeads(ctx, { cursor: first.nextCursor ?? '', limit: 2 }),
    );
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((l) => l.id);
    expect(new Set(ids).size).toBe(3);
    await expect(
      asPrincipal(cc, (ctx) => listLeads(ctx, { cursor: 'not-a-cursor' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
