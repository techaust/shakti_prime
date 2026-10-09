import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  stageId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { assignOpportunity } from '../../src/commands/crm/assign-opportunity';
import { createLead } from '../../src/commands/crm/create-lead';
import { loseOpportunity } from '../../src/commands/crm/lose-opportunity';
import { moveOpportunityStage } from '../../src/commands/crm/move-opportunity-stage';
import { nurtureOpportunity } from '../../src/commands/crm/nurture-opportunity';
import { reopenOpportunity } from '../../src/commands/crm/reopen-opportunity';
import { winOpportunity } from '../../src/commands/crm/win-opportunity';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';

afterAll(closeDb);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let teamId: string;
let otherTeamId: string;
let gm: Principal;
let caller: Principal;
let converter: string;
let converterOtherTeam: string;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'opportunity team');
  otherTeamId = await createTestTeam(1, 'opportunity other team');
  gm = await createTestPrincipal('general_manager', [1]);
  caller = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  converter = (await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId }])).id;
  converterOtherTeam = (
    await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId: otherTeamId }])
  ).id;
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

/** A lead of entity 1 owned by `caller`, in the first stage of `pipelineKey`. */
async function newLead(pipelineKey = 'farmer_pumps', owner: Principal = caller): Promise<string> {
  const lead = await run(owner, createLead, {
    entityId: 1,
    pipelineKey,
    // A number no earlier lead has: one a colleague's customer has is refused (0055).
    contact: {
      name: 'Opportunity test customer',
      phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Opportunity test village', pin: '422001' },
  });
  return (lead as { id: string }).id;
}

async function setState(id: string, state: string, changedAt = new Date()): Promise<void> {
  await asMigrator(
    (m) => m`update opportunities set state = ${state}, state_changed_at = ${changedAt}
              where id = ${id}`,
  );
}

async function row(id: string) {
  const [found] = await asMigrator(
    (m) => m<
      {
        state: string;
        stage_id: string;
        owner_id: string | null;
        team_id: string | null;
        locked_until: Date | null;
        state_changed_at: Date;
      }[]
    >`select state, stage_id, owner_id, team_id, locked_until, state_changed_at
        from opportunities where id = ${id}`,
  );
  if (!found) throw new Error(`no opportunity ${id}`);
  return found;
}

/** Each command with an input that passes everything but the machine. */
function commandsFor(id: string): { name: string; command: AnyCommand; input: unknown }[] {
  const lead = { entityId: 1, opportunityId: id };
  return [
    {
      name: 'stage.move',
      command: moveOpportunityStage,
      input: { ...lead, stageId: stageId(1, 2) },
    },
    { name: 'assign', command: assignOpportunity, input: { ...lead, ownerId: converter } },
    {
      name: 'nurture',
      command: nurtureOpportunity,
      input: { ...lead, reasonCode: 'not_ready_yet' },
    },
    { name: 'reopen', command: reopenOpportunity, input: lead },
    { name: 'win', command: winOpportunity, input: lead },
    { name: 'lose', command: loseOpportunity, input: { ...lead, reasonCode: 'not_interested' } },
  ];
}

describe('the opportunity commands (design §7.2)', () => {
  it('are denied to a role without the lead permissions', async () => {
    const hr = await createTestPrincipal('hr_admin', [1]);
    const id = await newLead();
    for (const { command, input } of commandsFor(id)) {
      await expect(run(hr, command, input)).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuse a company outside the request, and do not find a lead of another company', async () => {
    const id = await newLead();
    const elsewhere = await createTestPrincipal('general_manager', [2]);
    const both = await createTestPrincipal('general_manager', [1, 2]);
    for (const { command, input } of commandsFor(id)) {
      await expect(run(elsewhere, command, input)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(run(both, command, { ...(input as object), entityId: 2 })).rejects.toMatchObject(
        { code: 'not_found', details: { reason: 'lead_missing' } },
      );
    }
  });

  it('do not find a lead outside the caller own scope', async () => {
    const id = await newLead();
    const stranger = await createTestPrincipal('tele_caller_cc', [1], { teamId: otherTeamId });
    await expect(
      run(stranger, loseOpportunity, {
        entityId: 1,
        opportunityId: id,
        reasonCode: 'not_interested',
      }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'lead_missing' } });
  });

  describe('refuse every move the machine does not have', () => {
    const allowed: Record<string, readonly string[]> = {
      open: ['stage.move', 'assign', 'nurture', 'win', 'lose'],
      nurture: ['assign', 'reopen', 'lose'],
      lost: ['reopen'],
      won: [],
    };
    it.each(Object.keys(allowed))('from %s', async (state) => {
      const id = await newLead();
      await setState(id, state);
      for (const { name, command, input } of commandsFor(id)) {
        if (allowed[state]?.includes(name)) continue;
        await expect(run(gm, command, input), `${name} from ${state}`).rejects.toMatchObject({
          code: 'conflict',
          details: { reason: 'opportunity_transition_not_allowed' },
        });
      }
      expect((await row(id)).state).toBe(state);
    });
  });

  describe('crm.opportunity.stage.move', () => {
    it('moves an open lead to another open stage, audits and emits', async () => {
      const id = await newLead();
      const recorded = memoryAuditSink();
      const emitted = memoryOutboxSink();
      const moved = await asPrincipal(caller, (context) =>
        runCommand(
          moveOpportunityStage,
          { context, audit: recorded, outbox: emitted },
          { entityId: 1, opportunityId: id, stageId: stageId(1, 2) },
        ),
      );
      expect(moved).toMatchObject({ id, stageId: stageId(1, 2), state: 'open' });
      expect(recorded.records).toContainEqual(
        expect.objectContaining({
          command: 'crm.opportunity.stage.move',
          aggregateId: id,
          before: { stageId: stageId(1, 1) },
          after: { stageId: stageId(1, 2), handover: false },
        }),
      );
      expect(emitted.records).toEqual([
        expect.objectContaining({
          type: 'crm.opportunity.stage_moved',
          aggregateId: id,
          payload: expect.objectContaining({ toStageKey: 'contacted', handover: false }) as unknown,
        }),
      ]);
    });

    it('asks for the handover when the lead reaches qualified', async () => {
      const id = await newLead();
      const emitted = memoryOutboxSink();
      await asPrincipal(caller, (context) =>
        runCommand(
          moveOpportunityStage,
          { context, audit, outbox: emitted },
          { entityId: 1, opportunityId: id, stageId: stageId(1, 3) },
        ),
      );
      expect(emitted.records[0]?.payload).toMatchObject({
        toStageKey: 'qualified',
        handover: true,
      });
    });

    it('refuses a closing stage, a stage of another pipeline and an unknown stage', async () => {
      const id = await newLead();
      const move = (target: string) =>
        run(caller, moveOpportunityStage, { entityId: 1, opportunityId: id, stageId: target });
      await expect(move(stageId(1, 5))).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason: 'stage_not_open' },
      });
      await expect(move(stageId(2, 2))).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason: 'stage_other_pipeline' },
      });
      await expect(move(newId())).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason: 'stage_missing' },
      });
      expect((await row(id)).stage_id).toBe(stageId(1, 1));
    });

    it('holds a lead in a stage until its exit rules are met', async () => {
      const pipelineId = newId();
      const key = `rules-${pipelineId.slice(-8)}`;
      const first = newId();
      const second = newId();
      await asMigrator(async (m) => {
        await m`insert into pipelines (id, entity_id, key, name, segment)
                values (${pipelineId}, 1, ${key}, 'exit rules pipeline', 'farmer_pumps')`;
        await m`insert into pipeline_stages (id, pipeline_id, key, name, position, kind, stage_exit_rules_json)
                values (${first}, ${pipelineId}, 'new', 'New', 1, 'open',
                        ${m.json({ requiredFields: ['pin', 'stateCode'] })}),
                       (${second}, ${pipelineId}, 'contacted', 'Contacted', 2, 'open', '{}')`;
      });
      const id = await newLead(key);
      const move = () =>
        run(caller, moveOpportunityStage, { entityId: 1, opportunityId: id, stageId: second });
      await expect(move()).rejects.toMatchObject({
        code: 'validation_failed',
        details: { reason: 'stage_fields_missing', missing: ['stateCode'] },
      });
      await asMigrator(
        (m) => m`update customer_sites set state_code = '27'
                  where id = (select site_id from opportunities where id = ${id})`,
      );
      await expect(move()).resolves.toMatchObject({ stageId: second });
    });
  });

  describe('crm.opportunity.assign', () => {
    it('hands the lead to a converter with their team and locks it for the pipeline lock', async () => {
      const id = await newLead();
      const emitted = memoryOutboxSink();
      const before = Date.now();
      const assigned = await asPrincipal(gm, (context) =>
        runCommand(
          assignOpportunity,
          { context, audit, outbox: emitted },
          { entityId: 1, opportunityId: id, ownerId: converterOtherTeam },
        ),
      );
      expect(assigned.ownerId).toBe(converterOtherTeam);
      expect(assigned.teamId).toBe(otherTeamId);
      const locked = new Date(assigned.lockedUntil ?? '').getTime();
      expect(locked).toBeGreaterThanOrEqual(before + 48 * HOUR - 60_000);
      expect(locked).toBeLessThanOrEqual(Date.now() + 48 * HOUR + 60_000);
      expect(emitted.records).toEqual([
        expect.objectContaining({
          type: 'crm.opportunity.assigned',
          payload: {
            ownerId: converterOtherTeam,
            teamId: otherTeamId,
            lockHours: 48,
            assignedById: gm.id,
            v: 1,
          },
        }),
      ]);
    });

    it('uses the lock hours of the lead pipeline', async () => {
      const pipelineId = newId();
      const key = `lock-${pipelineId.slice(-8)}`;
      await asMigrator(async (m) => {
        await m`insert into pipelines (id, entity_id, key, name, segment, lock_hours)
                values (${pipelineId}, 1, ${key}, 'short lock pipeline', 'farmer_pumps', 6)`;
        await m`insert into pipeline_stages (id, pipeline_id, key, name, position, kind)
                values (${newId()}, ${pipelineId}, 'new', 'New', 1, 'open')`;
      });
      const id = await newLead(key);
      const assigned = await run(gm, assignOpportunity, {
        entityId: 1,
        opportunityId: id,
        ownerId: converter,
      });
      const locked = new Date((assigned as { lockedUntil: string }).lockedUntil).getTime();
      expect(Math.abs(locked - (Date.now() + 6 * HOUR))).toBeLessThan(60_000);
    });

    it('refuses someone who does not work on leads in that company', async () => {
      const id = await newLead();
      const hr = (await createTestUser([{ entityId: 1, roleKey: 'hr_admin' }])).id;
      const elsewhere = (await createTestUser([{ entityId: 2, roleKey: 'tele_caller_lc' }])).id;
      for (const ownerId of [hr, elsewhere, newId()]) {
        await expect(
          run(gm, assignOpportunity, { entityId: 1, opportunityId: id, ownerId }),
        ).rejects.toMatchObject({
          code: 'validation_failed',
          details: { reason: 'assignee_not_eligible' },
        });
      }
    });

    it('refuses a person who is not active: invited, suspended or offboarded (0059)', async () => {
      const id = await newLead();
      for (const status of ['invited', 'suspended', 'offboarded']) {
        const person = (
          await createTestUser([{ entityId: 1, roleKey: 'tele_caller_lc', teamId }], { status })
        ).id;
        await expect(
          run(gm, assignOpportunity, { entityId: 1, opportunityId: id, ownerId: person }),
          status,
        ).rejects.toMatchObject({
          code: 'validation_failed',
          details: { reason: 'assignee_not_eligible' },
        });
      }
      // The same lead goes to an active person.
      await expect(
        run(gm, assignOpportunity, { entityId: 1, opportunityId: id, ownerId: converter }),
      ).resolves.toMatchObject({ ownerId: converter });
    });

    it('lets a team lead assign only within their own team', async () => {
      const id = await newLead();
      const lead = await createTestPrincipal('sales_team_lead', [1], { teamId });
      await expect(
        run(lead, assignOpportunity, { entityId: 1, opportunityId: id, ownerId: converter }),
      ).resolves.toMatchObject({ ownerId: converter, teamId });
      await expect(
        run(lead, assignOpportunity, {
          entityId: 1,
          opportunityId: id,
          ownerId: converterOtherTeam,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      expect((await row(id)).owner_id).toBe(converter);
    });

    it('keeps a locked lead from someone who may assign only at own scope', async () => {
      const id = await newLead();
      await run(gm, assignOpportunity, { entityId: 1, opportunityId: id, ownerId: converter });
      const narrow = await createTestPrincipal('general_manager', [1], {
        permissions: [
          { key: 'crm.lead.read', scope: 'entity' },
          { key: 'crm.lead.write', scope: 'entity' },
          { key: 'crm.lead.assign', scope: 'own' },
        ],
      });
      await expect(
        run(narrow, assignOpportunity, {
          entityId: 1,
          opportunityId: id,
          ownerId: converterOtherTeam,
        }),
      ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'opportunity_locked' } });
      await asMigrator(
        (m) => m`update opportunities set locked_until = now() - interval '1 minute'
                  where id = ${id}`,
      );
      await expect(
        run(narrow, assignOpportunity, {
          entityId: 1,
          opportunityId: id,
          ownerId: converterOtherTeam,
        }),
      ).resolves.toMatchObject({ ownerId: converterOtherTeam });
    });
  });

  describe('crm.opportunity.nurture, reopen, win and lose', () => {
    it('parks an open lead with a reason code and reopens it at the first open stage', async () => {
      const id = await newLead();
      await run(caller, moveOpportunityStage, {
        entityId: 1,
        opportunityId: id,
        stageId: stageId(1, 2),
      });
      const recorded = memoryAuditSink();
      const emitted = memoryOutboxSink();
      const parked = await asPrincipal(caller, (context) =>
        runCommand(
          nurtureOpportunity,
          { context, audit: recorded, outbox: emitted },
          { entityId: 1, opportunityId: id, reasonCode: 'waiting_for_subsidy' },
        ),
      );
      expect(parked).toMatchObject({ state: 'nurture', stageId: stageId(1, 2) });
      expect(recorded.records.find((r) => r.aggregateType === 'opportunity')?.after).toEqual({
        state: 'nurture',
        nurtureReason: 'waiting_for_subsidy',
      });
      // Its nurture calls on day 7, 30 and 90 (the owner's default for CALL-5), as tasks.
      expect(
        recorded.records
          .filter((r) => r.command === 'crm.task.create')
          .map((r) => (r.after as { taskKind: string }).taskKind),
      ).toEqual(['nurture', 'nurture', 'nurture']);
      expect(emitted.records[0]).toMatchObject({
        type: 'crm.opportunity.nurtured',
        payload: { reasonCode: 'waiting_for_subsidy' },
      });

      const reopened = await run(caller, reopenOpportunity, { entityId: 1, opportunityId: id });
      expect(reopened).toMatchObject({ state: 'open', stageId: stageId(1, 1) });
    });

    it('refuses a win until an accepted quote or confirmed order exists (Phase 1)', async () => {
      const id = await newLead();
      await expect(
        run(gm, winOpportunity, { entityId: 1, opportunityId: id }),
      ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'win_needs_order' } });
      expect((await row(id)).state).toBe('open');
    });

    it('loses an open or nurtured lead at the lost stage, with the reason code', async () => {
      const open = await newLead();
      const emitted = memoryOutboxSink();
      const lost = await asPrincipal(caller, (context) =>
        runCommand(
          loseOpportunity,
          { context, audit, outbox: emitted },
          { entityId: 1, opportunityId: open, reasonCode: 'bought_elsewhere' },
        ),
      );
      expect(lost).toMatchObject({ state: 'lost', stageId: stageId(1, 6) });
      expect(emitted.records[0]).toMatchObject({
        type: 'crm.opportunity.lost',
        payload: { fromState: 'open', reasonCode: 'bought_elsewhere' },
      });

      const parked = await newLead();
      await setState(parked, 'nurture');
      await expect(
        run(caller, loseOpportunity, {
          entityId: 1,
          opportunityId: parked,
          reasonCode: 'not_reachable',
        }),
      ).resolves.toMatchObject({ state: 'lost' });
    });

    it('reopens a lost lead only within the reopen window', async () => {
      const recent = await newLead();
      await setState(recent, 'lost', new Date(Date.now() - 29 * DAY));
      await expect(
        run(caller, reopenOpportunity, { entityId: 1, opportunityId: recent }),
      ).resolves.toMatchObject({ state: 'open' });
      const stale = await newLead();
      await setState(stale, 'lost', new Date(Date.now() - 31 * DAY));
      await expect(
        run(caller, reopenOpportunity, { entityId: 1, opportunityId: stale }),
      ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'reopen_window_passed' } });
    });

    it('rejects an unknown reason code before anything runs', async () => {
      const id = await newLead();
      await expect(
        run(caller, loseOpportunity, { entityId: 1, opportunityId: id, reasonCode: 'weather' }),
      ).rejects.toMatchObject({ code: 'validation_failed' });
      await expect(
        run(caller, nurtureOpportunity, { entityId: 1, opportunityId: id }),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    });

    it('records state_changed_at with each change of state', async () => {
      const id = await newLead();
      await setState(id, 'open', new Date(Date.now() - 5 * DAY));
      await run(caller, nurtureOpportunity, {
        entityId: 1,
        opportunityId: id,
        reasonCode: 'other',
      });
      expect(Date.now() - (await row(id)).state_changed_at.getTime()).toBeLessThan(60_000);
    });
  });
});
