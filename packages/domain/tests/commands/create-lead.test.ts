import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  stageId,
} from '@shakti/db/testing';
import { newId } from '@shakti/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { countLeads, listLeads } from '../../src/queries/crm/list-leads';

afterAll(closeDb);

const input = {
  entityId: 1,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Lead test contact', phone: '98765 43210' },
  account: { type: 'farm' as const },
  site: { type: 'borewell' as const, village: 'Lead test village', pin: '302001' },
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
      asPrincipal(hr, (context) => runCommand(createLead, { context }, input)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an entity outside the request scope', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [2], { teamId });
    await expect(
      asPrincipal(cc, (context) => runCommand(createLead, { context }, input)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a pipeline that belongs to another entity', async () => {
    const key = `entity2-${newId().slice(-8)}`;
    await asMigrator(
      (m) => m`insert into pipelines (id, entity_id, key, name, name_hi, segment)
        values (${newId()}, 2, ${key}, 'entity two pipeline', 'entity two pipeline hi', 'farmer_pumps')`,
    );
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(createLead, { context }, { ...input, pipelineKey: key }),
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
        runCommand(createLead, { context }, { ...input, pipelineKey: 'nope' }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'lead_pipeline_missing' },
    });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(createLead, { context }, { ...input, sourceCode: 'nope' }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'lead_source_unknown' },
    });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(
          createLead,
          { context },
          { ...input, contact: { ...input.contact, phone: '12' } },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('creates the lead owned by the caller in the first stage, audits and emits', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const onAudit = vi.fn();
    const onEmit = vi.fn();
    const lead = await asPrincipal(cc, (context) =>
      runCommand(createLead, { context, onAudit, onEmit }, input),
    );
    expect(lead.ownerId).toBe(cc.id);
    expect(lead.teamId).toBe(teamId);
    expect(lead.entityId).toBe(1);
    expect(lead.stageId).toBe(stageId(1, 1));
    expect(lead.state).toBe('open');
    expect(lead.contact.phone).toBe('+919876543210');
    expect(lead.account.name).toBe('Lead test contact');
    expect(lead.siteId).not.toBeNull();
    expect(Object.keys(lead).sort()).toEqual([
      'account',
      'contact',
      'entityId',
      'id',
      'ownerId',
      'pipelineId',
      'score',
      'siteId',
      'stageId',
      'state',
      'teamId',
      'updatedAt',
    ]);
    expect(onAudit).toHaveBeenCalledWith(expect.objectContaining({ command: 'crm.lead.create' }));
    expect(onEmit).toHaveBeenCalledWith([
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

  it('pages through leads written in one transaction, which share updated_at to the microsecond', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const created = await asPrincipal(cc, async (context) => {
      const ids: string[] = [];
      for (const n of [1, 2, 3]) {
        const lead = await runCommand(
          createLead,
          { context },
          { ...input, contact: { name: `Lead batch contact ${n}`, phone: `9876600${n}00` } },
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
          { context },
          { ...input, contact: { name: `Lead page contact ${n}`, phone: `9876500${n}00` } },
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
