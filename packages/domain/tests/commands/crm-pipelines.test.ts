import { newId, WORKSHOP_DISPOSITIONS, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  PIPELINE_SEED,
  prepareDatabase,
  principalFor,
  stageId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { failureOf, runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { moveOpportunityStage } from '../../src/commands/crm/move-opportunity-stage';
import {
  archiveStage,
  createStage,
  reorderStages,
  updatePipeline,
  updateStage,
} from '../../src/commands/crm/pipeline-settings';
import { setDispositions } from '../../src/commands/crm/set-dispositions';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// Pipelines and call outcomes are shared set-up the other suites read, so every test works on
// pipelines and outcome scopes it makes itself and removes afterwards; the seed tests change the
// seeded rows and put them back.

const RUN = newId().slice(-8);
const made = { pipelines: [] as string[] };

let exec: Principal;
let execOne: Principal;
let execTwo: Principal;
let gm: Principal;
let caller: Principal;

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  execOne = await createTestPrincipal('executive', [1]);
  execTwo = await createTestPrincipal('executive', [2]);
  gm = await createTestPrincipal('general_manager', [1]);
  caller = await createTestPrincipal('tele_caller_cc', [1]);
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from call_dispositions where created_by = any(${[exec.id, execOne.id, execTwo.id]}::uuid[])`;
    await m`update call_dispositions set archived_at = null where entity_id is null and segment is null and created_by is null`;
    const ids = made.pipelines;
    await m`delete from opportunities where pipeline_id = any(${ids}::uuid[])`;
    await m`delete from pipeline_stages where pipeline_id = any(${ids}::uuid[])`;
    await m`delete from pipelines where id = any(${ids}::uuid[])`;
  });
  await closeDb();
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

/** A pipeline of this run with the six standard stages; `entityId` null for a group pipeline. */
async function testPipeline(entityId: number | null = null): Promise<{
  id: string;
  key: string;
  stages: Record<'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost', string>;
}> {
  const id = newId();
  const key = `c3-${RUN}-${made.pipelines.length.toString()}`;
  made.pipelines.push(id);
  const keys = ['new', 'contacted', 'qualified', 'quoted', 'won', 'lost'] as const;
  const stages = Object.fromEntries(keys.map((k) => [k, newId()])) as Record<
    (typeof keys)[number],
    string
  >;
  await asMigrator(async (m) => {
    await m`insert into pipelines (id, entity_id, key, name, segment)
            values (${id}, ${entityId}, ${key}, 'Test pipeline', 'farmer_pumps')`;
    for (const [i, k] of keys.entries()) {
      const kind = k === 'won' || k === 'lost' ? k : 'open';
      await m`insert into pipeline_stages (id, pipeline_id, entity_id, key, name, position, kind)
              values (${stages[k]}, ${id}, ${entityId}, ${k}, ${k.charAt(0).toUpperCase() + k.slice(1)},
                      ${i + 1}, ${kind})`;
    }
  });
  return { id, key, stages };
}

async function stagesOf(pipelineId: string) {
  return asMigrator(
    (m) => m<
      {
        id: string;
        key: string;
        name: string;
        position: number;
        kind: string;
        archived: boolean;
        rules: unknown;
      }[]
    >`
      select id, key, name, position, kind, archived_at is not null as archived,
             stage_exit_rules_json as rules
        from pipeline_stages where pipeline_id = ${pipelineId} order by position`,
  );
}

describe('crm.pipeline.update', () => {
  it('is refused to a role without crm.config.write and to an agent', async () => {
    const p = await testPipeline();
    for (const principal of [gm, caller, principalFor('agent:triage', [1])]) {
      const error = await refusal(
        run(principal, updatePipeline, { pipelineId: p.id, lockHours: 24 }),
      );
      expect(error).toMatchObject({ code: 'forbidden' });
      expect(failureOf(error)?.stage).toBe('guard');
    }
  });

  it('changes a group pipeline only for a request acting for every company, in the command and the database', async () => {
    const p = await testPipeline();
    const error = await refusal(run(execOne, updatePipeline, { pipelineId: p.id, lockHours: 24 }));
    expect(error).toMatchObject({ code: 'forbidden', details: { reason: 'config_group_scope' } });
    const direct = await asPrincipal(
      execOne,
      async ({ tx }) =>
        (await tx.execute(
          sql`update pipelines set lock_hours = 24 where id = ${p.id} returning id`,
        )) as unknown as unknown[],
    );
    expect(direct).toHaveLength(0);
  });

  it("does not reach another company's pipeline", async () => {
    const p = await testPipeline(2);
    expect(
      await refusal(run(execOne, updatePipeline, { pipelineId: p.id, lockHours: 24 })),
    ).toMatchObject({ code: 'not_found', details: { reason: 'pipeline_missing' } });
    const done = await run(execTwo, updatePipeline, { pipelineId: p.id, lockHours: 24 });
    expect(done).toMatchObject({ id: p.id, entityId: 2, lockHours: 24 });
  });

  it('sets the name, lock hours and first-contact limit, and records only what changed', async () => {
    const p = await testPipeline();
    const recorded = memoryAuditSink();
    const done = await asPrincipal(exec, (context) =>
      runCommand(
        updatePipeline,
        { context, audit: recorded, outbox },
        { pipelineId: p.id, name: 'Pumps north', lockHours: 72, firstContactSlaMinutes: 30 },
      ),
    );
    expect(done).toMatchObject({ name: 'Pumps north', lockHours: 72, firstContactSlaMinutes: 30 });
    expect(recorded.records).toHaveLength(1);
    expect(recorded.records[0]).toMatchObject({
      aggregateType: 'pipeline',
      aggregateId: p.id,
      entityId: null,
      before: { name: 'Test pipeline', lockHours: 48, firstContactSlaMinutes: null },
      after: { name: 'Pumps north', lockHours: 72, firstContactSlaMinutes: 30 },
    });
    const cleared = await run(exec, updatePipeline, {
      pipelineId: p.id,
      firstContactSlaMinutes: null,
    });
    expect(cleared).toMatchObject({ firstContactSlaMinutes: null, lockHours: 72 });
  });

  it('refuses lock hours or a limit outside their ranges at validation', async () => {
    const p = await testPipeline();
    for (const input of [{ lockHours: 0 }, { lockHours: 721 }, { firstContactSlaMinutes: 0 }]) {
      expect(
        await refusal(run(exec, updatePipeline, { pipelineId: p.id, ...input })),
      ).toMatchObject({ code: 'validation_failed' });
    }
  });
});

describe('stages', () => {
  it('adds a stage as the last open stage, before Won and Lost, and refuses a name in use', async () => {
    const p = await testPipeline();
    const stage = (await run(exec, createStage, { pipelineId: p.id, name: 'Site survey' })) as {
      id: string;
      position: number;
      kind: string;
    };
    expect(stage).toMatchObject({ position: 5, kind: 'open', requiredFields: [], archived: false });
    expect(
      (await stagesOf(p.id)).map((s) => [
        s.key.startsWith('custom_') ? 'new stage' : s.key,
        s.position,
      ]),
    ).toEqual([
      ['new', 1],
      ['contacted', 2],
      ['qualified', 3],
      ['quoted', 4],
      ['new stage', 5],
      ['won', 6],
      ['lost', 7],
    ]);
    expect(
      await refusal(run(exec, createStage, { pipelineId: p.id, name: 'site SURVEY' })),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'stage_name_taken' } });
  });

  it('is refused to a GM, and to an Executive acting for one company on a group pipeline', async () => {
    const p = await testPipeline();
    expect(await refusal(run(gm, createStage, { pipelineId: p.id, name: 'Visit' }))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await refusal(run(execOne, createStage, { pipelineId: p.id, name: 'Visit' })),
    ).toMatchObject({ code: 'forbidden', details: { reason: 'config_group_scope' } });
    expect(
      await refusal(run(execOne, updateStage, { stageId: p.stages.contacted, name: 'Rung' })),
    ).toMatchObject({ code: 'forbidden', details: { reason: 'config_group_scope' } });
  });

  it('sets exit rules from the details a lead carries, and a lead cannot leave the stage without them', async () => {
    const p = await testPipeline();
    const updated = await run(exec, updateStage, {
      stageId: p.stages.new,
      name: 'Fresh',
      requiredFields: ['village', 'pin'],
    });
    expect(updated).toMatchObject({ name: 'Fresh', requiredFields: ['village', 'pin'] });

    const lead = (await run(caller, createLead, {
      entityId: 1,
      pipelineKey: p.key,
      contact: {
        name: 'Stage rule customer',
        phone: `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      },
      account: { type: 'farm' },
    })) as { id: string };
    expect(
      await refusal(
        run(caller, moveOpportunityStage, {
          entityId: 1,
          opportunityId: lead.id,
          stageId: p.stages.contacted,
        }),
      ),
    ).toMatchObject({ code: 'validation_failed', details: { reason: 'stage_fields_missing' } });

    expect(
      await refusal(
        run(exec, updateStage, { stageId: p.stages.new, requiredFields: ['pumpDepthFt'] }),
      ),
    ).toMatchObject({ details: { reason: 'stage_field_not_recorded' } });
    expect(
      await refusal(run(exec, updateStage, { stageId: p.stages.won, requiredFields: ['village'] })),
    ).toMatchObject({ details: { reason: 'stage_closing' } });

    await run(exec, updateStage, { stageId: p.stages.new, requiredFields: [] });
    expect(
      await run(caller, moveOpportunityStage, {
        entityId: 1,
        opportunityId: lead.id,
        stageId: p.stages.contacted,
      }),
    ).toMatchObject({ stageId: p.stages.contacted });
  });

  it('reorders the open stages, keeping Won and Lost last, and refuses a list that is not every open stage', async () => {
    const p = await testPipeline();
    const s = p.stages;
    expect(
      await refusal(
        run(exec, reorderStages, { pipelineId: p.id, stageIds: [s.quoted, s.new, s.contacted] }),
      ),
    ).toMatchObject({ details: { reason: 'stage_order_mismatch' } });
    expect(
      await refusal(
        run(exec, reorderStages, {
          pipelineId: p.id,
          stageIds: [s.quoted, s.new, s.contacted, s.won],
        }),
      ),
    ).toMatchObject({ details: { reason: 'stage_order_mismatch' } });

    const recorded = memoryAuditSink();
    const done = await asPrincipal(exec, (context) =>
      runCommand(
        reorderStages,
        { context, audit: recorded, outbox },
        { pipelineId: p.id, stageIds: [s.new, s.qualified, s.contacted, s.quoted] },
      ),
    );
    expect(done.stages.map((x) => [x.key, x.position])).toEqual([
      ['new', 1],
      ['qualified', 2],
      ['contacted', 3],
      ['quoted', 4],
      ['won', 5],
      ['lost', 6],
    ]);
    // Two stages moved, one audit row each.
    expect(recorded.records.map((r) => r.aggregateId).sort()).toEqual(
      [s.contacted, s.qualified].sort(),
    );
  });

  it('archives an empty open stage, but never the first open stage, Won or Lost, or a stage holding open leads', async () => {
    const p = await testPipeline();
    const s = p.stages;
    expect(await refusal(run(exec, archiveStage, { stageId: s.new }))).toMatchObject({
      details: { reason: 'stage_first_open' },
    });
    expect(await refusal(run(exec, archiveStage, { stageId: s.lost }))).toMatchObject({
      details: { reason: 'stage_closing' },
    });
    // A lead of company 2 the Executive's own read does not reach still holds the stage.
    const account = newId();
    const lead = newId();
    await asMigrator(async (m) => {
      await m`insert into accounts (id, type, name, created_by) values (${account}, 'farm', 'Held stage', ${exec.id})`;
      await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
              values (${newId()}, ${account}, 2, ${exec.id}, ${exec.id})`;
      await m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, created_by)
              values (${lead}, 2, ${account}, ${p.id}, ${s.contacted}, ${exec.id}, ${exec.id})`;
    });
    expect(await refusal(run(exec, archiveStage, { stageId: s.contacted }))).toMatchObject({
      details: { reason: 'stage_has_open_leads' },
    });
    await asMigrator((m) => m`update opportunities set state = 'lost' where id = ${lead}`);

    const archived = await run(exec, archiveStage, { stageId: s.contacted });
    expect(archived).toMatchObject({ archived: true, position: 6 });
    expect((await stagesOf(p.id)).map((x) => [x.key, x.position, x.archived])).toEqual([
      ['new', 1, false],
      ['qualified', 2, false],
      ['quoted', 3, false],
      ['won', 4, false],
      ['lost', 5, false],
      ['contacted', 6, true],
    ]);
    expect(await refusal(run(exec, archiveStage, { stageId: s.contacted }))).toMatchObject({
      details: { reason: 'stage_missing' },
    });
    // The archived stage takes no more leads.
    expect(
      await refusal(run(exec, updateStage, { stageId: s.contacted, name: 'Back again' })),
    ).toMatchObject({ details: { reason: 'stage_missing' } });
  });

  it('answers whether a stage holds open leads only to a caller holding crm.config.write:all', async () => {
    const p = await testPipeline();
    const ask = (principal: Principal) =>
      refusal(
        asPrincipal(principal, ({ tx }) =>
          tx.execute(sql`select app.stage_has_open_leads(${p.stages.new}::uuid)`),
        ),
      );
    expect(await ask(gm)).toBeInstanceOf(Error);
    expect(await ask(exec)).toBeUndefined();
  });
});

describe('the seed keeps what an Executive set (DATABASE §9)', () => {
  it('leaves pipeline names, lock hours, limits, stage names, exit rules, order and archiving alone', async () => {
    const seeded = PIPELINE_SEED[0];
    if (!seeded) throw new Error('pipeline seed missing');
    const before = await asMigrator(
      (m) => m<{ name: string; lock_hours: number }[]>`
        select name, lock_hours from pipelines where id = ${seeded.id}`,
    );
    const stagesBefore = await stagesOf(seeded.id);
    try {
      await run(exec, updatePipeline, {
        pipelineId: seeded.id,
        name: 'Pumps changed by the Executive',
        lockHours: 96,
        firstContactSlaMinutes: 45,
      });
      await run(exec, updateStage, {
        stageId: stageId(1, 2),
        name: 'Reached',
        requiredFields: ['village'],
      });
      await run(exec, reorderStages, {
        pipelineId: seeded.id,
        stageIds: [stageId(1, 1), stageId(1, 3), stageId(1, 2), stageId(1, 4)],
      });
      await prepareDatabase();
      const [pipeline] = await asMigrator(
        (m) => m<{ name: string; lock_hours: number; sla: number | null }[]>`
          select name, lock_hours, first_contact_sla_minutes as sla from pipelines where id = ${seeded.id}`,
      );
      expect(pipeline).toEqual({ name: 'Pumps changed by the Executive', lock_hours: 96, sla: 45 });
      const stages = await stagesOf(seeded.id);
      expect(stages.map((s) => [s.key, s.name, s.position])).toEqual([
        ['new', 'New', 1],
        ['qualified', 'Qualified', 2],
        ['contacted', 'Reached', 3],
        ['quoted', 'Quoted', 4],
        ['won', 'Won', 5],
        ['lost', 'Lost', 6],
      ]);
      expect(stages.find((s) => s.key === 'contacted')?.rules).toEqual({
        requiredFields: ['village'],
      });
    } finally {
      await asMigrator(async (m) => {
        await m`update pipelines set name = ${before[0]?.name ?? seeded.name},
                  lock_hours = ${before[0]?.lock_hours ?? 48}, first_contact_sla_minutes = null
                where id = ${seeded.id}`;
        await m`update pipeline_stages set position = -position where pipeline_id = ${seeded.id}`;
        for (const s of stagesBefore) {
          await m`update pipeline_stages set name = ${s.name}, position = ${s.position},
                    stage_exit_rules_json = ${m.json(s.rules as never)}
                  where id = ${s.id}`;
        }
      });
    }
  });

  it('writes the workshop call outcomes once and never over a list the Executive set', async () => {
    const seeded = await asMigrator(
      (m) => m<{ key: number; code: string; next_action: string }[]>`
        select key, code, next_action from call_dispositions
         where entity_id is null and segment is null and archived_at is null order by key`,
    );
    expect(seeded).toEqual(
      WORKSHOP_DISPOSITIONS.map((d) => ({ key: d.key, code: d.code, next_action: d.nextAction })),
    );
    await run(exec, setDispositions, {
      entityId: null,
      segment: null,
      dispositions: [
        { key: 1, label: 'Interested', nextAction: 'callback' },
        { key: 2, label: 'Busy, call later', nextAction: 'callback' },
      ],
    });
    await prepareDatabase();
    const after = await asMigrator(
      (m) => m<{ key: number; label: string }[]>`
        select key, label from call_dispositions
         where entity_id is null and segment is null and archived_at is null order by key`,
    );
    expect(after).toEqual([
      { key: 1, label: 'Interested' },
      { key: 2, label: 'Busy, call later' },
    ]);
    // Put the workshop list back for the other suites.
    await asMigrator(async (m) => {
      await m`update call_dispositions set archived_at = now()
               where entity_id is null and segment is null and created_by is not null`;
      await m`update call_dispositions set archived_at = null
               where entity_id is null and segment is null and created_by is null`;
    });
  });
});

describe('crm.disposition.set', () => {
  // Each test uses a segment list of one company, so it never meets the group list.
  it('is refused to a GM and an agent, and outside the request', async () => {
    const input = {
      entityId: 1,
      segment: 'commercial_epc',
      dispositions: [{ key: 1, label: 'Interested', nextAction: 'callback' }],
    };
    for (const principal of [gm, principalFor('agent:copilot', [1])]) {
      expect(await refusal(run(principal, setDispositions, input))).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(await refusal(run(execTwo, setDispositions, input))).toMatchObject({
      code: 'forbidden',
      details: { reason: 'config_company_scope' },
    });
    expect(
      await refusal(run(execOne, setDispositions, { ...input, entityId: null })),
    ).toMatchObject({ details: { reason: 'config_group_scope' } });
    expect(
      await refusal(
        run(exec, setDispositions, { entityId: null, segment: null, dispositions: [] }),
      ),
    ).toMatchObject({ details: { reason: 'dispositions_group_empty' } });
  });

  it('replaces a list as a set: unchanged outcomes keep their row, others are archived', async () => {
    const scope = { entityId: 1, segment: 'dealer_wholesale' as const };
    const first = (await run(execOne, setDispositions, {
      ...scope,
      dispositions: [
        { key: 1, label: 'Interested', nextAction: 'callback' },
        { key: 2, label: 'Sample order', nextAction: 'qualified' },
        { key: 3, label: 'No stock needed', nextAction: 'not_interested' },
      ],
    })) as { dispositions: { id: string; key: number; code: string }[] };
    expect(first.dispositions.map((d) => [d.key, d.code])).toEqual([
      [1, 'interested'],
      [2, 'sample_order'],
      [3, 'no_stock_needed'],
    ]);

    const recorded = memoryAuditSink();
    const second = await asPrincipal(execOne, (context) =>
      runCommand(
        setDispositions,
        { context, audit: recorded, outbox },
        {
          ...scope,
          dispositions: [
            { key: 1, label: 'Interested', nextAction: 'callback' },
            { key: 2, label: 'Sample order', nextAction: 'nurture' },
          ],
        },
      ),
    );
    expect(second.dispositions[0]?.id).toBe(first.dispositions[0]?.id);
    expect(second.dispositions[1]?.id).not.toBe(first.dispositions[1]?.id);
    // The code stays with the label, so reports count the outcome as one.
    expect(second.dispositions[1]?.code).toBe('sample_order');
    expect(recorded.records).toHaveLength(3);

    const archived = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from call_dispositions
         where entity_id = 1 and segment = 'dealer_wholesale' and archived_at is not null
           and id = any(${first.dispositions.map((d) => d.id)}::uuid[])`,
    );
    expect(archived[0]?.n).toBe(2);

    const cleared = await run(execOne, setDispositions, { ...scope, dispositions: [] });
    expect(cleared).toMatchObject({ dispositions: [] });
  });

  it('is read by staff of the company: the group list and their own company list, never another company', async () => {
    await run(execTwo, setDispositions, {
      entityId: 2,
      segment: 'residential_rooftop',
      dispositions: [{ key: 4, label: 'Roof too small', nextAction: 'not_interested' }],
    });
    const seen = async (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select entity_id from call_dispositions where archived_at is null`,
        )) as unknown as { entity_id: number | null }[];
        return [...new Set(rows.map((r) => r.entity_id))].sort();
      });
    expect(await seen(caller)).toEqual([null]);
    expect(await seen(principalFor('tele_caller_cc', [2]))).toEqual([2, null]);
    await run(execTwo, setDispositions, {
      entityId: 2,
      segment: 'residential_rooftop',
      dispositions: [],
    });
  });
});
