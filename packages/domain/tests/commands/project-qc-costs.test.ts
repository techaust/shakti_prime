import {
  newId,
  type ChecklistDto,
  type CostLineDto,
  type Principal,
  type QcInspectionDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { withRequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { voiceSessionPrincipal } from '../../src/auth/voice-principal';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { addCostLine, reverseCostLine } from '../../src/commands/projects/cost-lines';
import { completeMilestone } from '../../src/commands/projects/move-project';
import { publishChecklist } from '../../src/commands/projects/qc-checklist';
import { rejectQc, signoffQc, submitQc } from '../../src/commands/projects/qc-inspections';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listContractors, projectCosts } from '../../src/queries/projects/cost-queries';
import { listChecklists, projectQc } from '../../src/queries/projects/qc-queries';

// J6 QC checklists, inspections and project cost lines (docs/03-roadmap-appendix/phase4.md §7.3,
// PRD PRJ-05 and PRJ-02's QC step). Projects are made in company 2, with step keys no other suite
// uses; company 1 is the wrong one. Orders, customers and files are written with the migrator
// connection, with synthetic values.
const E = 2;
const OTHER = 1;
const P = '01990000-0000-7000-8000-000000c6';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const PRICE_LIST = fixed(0x0001);
let serial = 0x0100;
const nextId = () => fixed((serial += 1));
const SEGMENT = 'commercial_epc';
/** The steps of this suite's projects; the first has the checklist. */
const STEP = 'jsix_check';
const AFTER = 'jsix_after';
const SHA = 'a'.repeat(64);

let manager: Principal;
let signer: Principal;
let engineer: Principal;
let stranger: Principal;
let executive: Principal;
let accounts: Principal;
let otherManager: Principal;
let teamId: string;
let checklist: ChecklistDto;
let contractor: string;
let supplier: string;

async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const projects = tx`select id from projects where id::text like ${`${P}%`}`;
      await tx`delete from project_cost_lines where project_id in (${projects})`;
      await tx`delete from qc_inspections where project_id in (${projects})`;
      await tx`delete from project_assignments where project_id in (${projects})`;
      await tx`delete from project_milestones where project_id in (${projects})`;
      await tx`delete from projects where id::text like ${`${P}%`}`;
      await tx`delete from checklists where step_key like 'jsix_%'`;
      await tx`delete from files where id::text like ${`${P}%`}`;
      await tx`delete from sales_orders where price_list_id = ${PRICE_LIST}`;
      await tx`delete from customer_sites where id::text like ${`${P}%`}`;
      await tx`delete from account_entities where account_id::text like ${`${P}%`}`;
      await tx`delete from accounts where id::text like ${`${P}%`}`;
      await tx`delete from vendors where id::text like ${`${P}%`}`;
      await tx`delete from price_lists where id = ${PRICE_LIST}`;
    }),
  );
}

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function failure(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<{ code?: string | undefined; reason?: unknown }> {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason };
}

/** A project of company `entityId` on a dealer's confirmed order, its two steps open. */
async function makeProject(entityId = E): Promise<string> {
  const account = nextId();
  const order = nextId();
  const project = nextId();
  const owner = manager.id;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'farm', 'qc suite customer', ${owner})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${nextId()}, ${account}, ${entityId}, ${owner}, ${teamId}, ${owner})`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, tier_id, price_list_id,
                 place_of_supply_state, supply_kind, state, subtotal, cgst, sgst, igst, tax_total, round_off,
                 grand_total, confirmed_at, confirmed_by, created_by)
        values (${order}, ${entityId}, ${`QC/SO/2098-99/${order.slice(-4)}`}, '2098-99', ${account}, 'farm',
                ${tierId('dealer')}, ${PRICE_LIST}, '08', 'intra', 'confirmed', 0, 0, 0, 0, 0, 0, 0, now(),
                ${owner}, ${owner})`;
      await tx`insert into projects (id, entity_id, project_no, fy, sales_order_id, account_id, segment, scheme,
                 flow, owner_id, created_by)
        values (${project}, ${entityId}, ${`QC${entityId.toString()}/PRJ/2098-99/${project.slice(-4)}`}, '2098-99',
                ${order}, ${account}, ${SEGMENT}, 'none', 'standard', ${entityId === E ? owner : otherManager.id},
                ${owner})`;
      await tx`insert into project_milestones (id, entity_id, project_id, position, key) values
        (${nextId()}, ${entityId}, ${project}, 1, ${STEP}),
        (${nextId()}, ${entityId}, ${project}, 2, ${AFTER})`;
      if (entityId === E) {
        await tx`insert into project_assignments (id, entity_id, project_id, person_id, created_by)
          values (${nextId()}, ${entityId}, ${project}, ${engineer.id}, ${owner})`;
      }
    }),
  );
  return project;
}

/** A ready QC photo of company `entityId` uploaded by `who`, outside the upload flow. */
async function photo(who: Principal, entityId = E): Promise<string> {
  const id = nextId();
  await asMigrator(
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                                status, created_by)
             values (${id}, ${entityId}, 'qc_photo', 'test', ${`qc/${id}`}, 'panels.jpg', 'image/jpeg', 1,
                     ${SHA}, 'ready', ${who.id})`,
  );
  return id;
}

/** The answers that fill the suite's checklist, with the given photo. */
const answers = (photoId: string) => [
  { key: 'earthing', value: true },
  { key: 'voltage', value: 231.5 },
  { key: 'panels', value: [photoId] },
];

const submit = async (who: Principal, projectId: string, by: Principal = who) =>
  run<QcInspectionDto>(who, submitQc, {
    entityId: E,
    projectId,
    milestoneKey: STEP,
    checklistId: checklist.id,
    answers: answers(await photo(by)),
  });

async function eventsOf(aggregateId: string): Promise<{ type: string; payload: unknown }[]> {
  return asOutboxPublisher(
    (p) => p<{ type: string; payload: unknown }[]>`
      select type, payload from outbox_events where aggregate_id = ${aggregateId} order by sequence`,
  );
}

async function auditOf(
  aggregateId: string,
): Promise<{ command: string; input: unknown; before: unknown; after: unknown }[]> {
  return asMigrator(
    (m) => m<{ command: string; input: unknown; before: unknown; after: unknown }[]>`
      select command, input_json as input, before_json as before, after_json as after
        from audit_logs where aggregate_id = ${aggregateId} order by created_at`,
  );
}

beforeAll(async () => {
  await removeRows();
  teamId = await createTestTeam(E, 'qc suite team');
  const person = async (
    role: 'project_manager' | 'field_engineer' | 'executive' | 'accounts',
    entityId = E,
  ) => {
    const user = await createTestUser([{ entityId, roleKey: role }], { name: `qc ${role}` });
    return principalFor(role, [entityId], { id: user.id });
  };
  manager = await person('project_manager');
  signer = await person('project_manager');
  engineer = await person('field_engineer');
  stranger = await person('field_engineer');
  executive = await person('executive');
  accounts = await person('accounts');
  otherManager = await person('project_manager', OTHER);
  contractor = fixed(0x0002);
  supplier = fixed(0x0003);
  await asMigrator(async (m) => {
    await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
      values (${PRICE_LIST}, ${tierId('dealer')}, ${E}, 9300, '2090-01-01', now())`;
    await m`insert into vendors (id, name, kind, created_by) values
      (${contractor}, 'qc suite crew', 'contractor', ${executive.id}),
      (${supplier}, 'qc suite supplier', 'supplier', ${executive.id})`;
  });
  checklist = await run<ChecklistDto>(executive, publishChecklist, {
    entityId: E,
    segment: SEGMENT,
    stepKey: STEP,
    items: [
      { key: 'earthing', label: 'Earthing done', kind: 'yes_no' },
      { key: 'voltage', label: 'Output voltage', kind: 'number', min: 200, max: 250 },
      { key: 'panels', label: 'Panels from the front', kind: 'photo_required' },
    ],
  });
});

afterAll(async () => {
  await removeRows();
  await closeDb();
});

describe('projects.checklist.publish: versioned checklists per company, segment and step', () => {
  it('numbers each version after the newest and is for the Executive alone', async () => {
    expect(checklist).toMatchObject({ segment: SEGMENT, stepKey: STEP, entityId: E });
    const second = await run<ChecklistDto>(executive, publishChecklist, {
      entityId: E,
      segment: SEGMENT,
      stepKey: AFTER,
      items: [{ key: 'tidy', label: 'Site left tidy', kind: 'yes_no' }],
    });
    const third = await run<ChecklistDto>(executive, publishChecklist, {
      entityId: E,
      segment: SEGMENT,
      stepKey: AFTER,
      items: [],
    });
    expect(third.version).toBe(second.version + 1);
    expect(await auditOf(third.id)).toEqual([
      expect.objectContaining({
        command: 'projects.checklist.publish',
        after: { segment: SEGMENT, stepKey: AFTER, version: third.version, items: [] },
      }),
    ]);
    for (const who of [manager, accounts, engineer]) {
      expect(
        await failure(who, publishChecklist, {
          entityId: E,
          segment: SEGMENT,
          stepKey: AFTER,
          items: [],
        }),
      ).toMatchObject({ code: 'forbidden' });
    }
    expect(
      await failure(executive, publishChecklist, {
        entityId: OTHER,
        segment: SEGMENT,
        stepKey: AFTER,
        items: [],
      }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('refuses bounds on an item that is not a number', async () => {
    expect(
      await failure(executive, publishChecklist, {
        entityId: E,
        segment: SEGMENT,
        stepKey: STEP,
        items: [{ key: 'earthing', label: 'Earthing done', kind: 'yes_no', min: 1 }],
      }),
    ).toMatchObject({ code: 'validation_failed' });
  });

  it('lists each segment’s steps with their current checklist', async () => {
    const list = await asPrincipal(manager, (ctx) => listChecklists(ctx, { entityId: E }));
    const steps = list.segments.find((s) => s.segment === SEGMENT)?.steps ?? [];
    expect(steps.find((s) => s.key === STEP)?.current?.id).toBe(checklist.id);
    // The checklist taken off the step shows none.
    expect(steps.find((s) => s.key === AFTER)).toMatchObject({ current: null });
  });
});

describe('projects.qc.submit: a project’s filled checklist for its open step', () => {
  it('the engineer on the project submits it; the step waits for a sign-off', async () => {
    const projectId = await makeProject();
    const inspection = await submit(engineer, projectId);
    expect(inspection).toMatchObject({
      state: 'submitted',
      submittedBy: engineer.id,
      checklistId: checklist.id,
      checklistVersion: checklist.version,
      decidedBy: null,
    });
    expect(await eventsOf(inspection.id)).toEqual([
      {
        type: 'projects.qc.submitted',
        payload: expect.objectContaining({ projectId, milestoneId: inspection.milestoneId }),
      },
    ]);
    const [row] = await auditOf(inspection.id);
    expect(row?.after).toEqual({
      milestoneKey: STEP,
      inspectionState: 'submitted',
      checklistVersion: checklist.version,
    });
    // One waits already.
    expect(await failure(engineer, submitQc, {
      entityId: E,
      projectId,
      milestoneKey: STEP,
      checklistId: checklist.id,
      answers: answers(await photo(engineer)),
    })).toMatchObject({ code: 'conflict', reason: 'qc_already_submitted' });
    // The step is not done until the check is signed off.
    expect(
      await failure(engineer, completeMilestone, { entityId: E, projectId, milestoneKey: STEP }),
    ).toMatchObject({ code: 'validation_failed', reason: 'qc_not_signed_off' });
  });

  it('refuses missing or out-of-bounds answers, an old checklist and someone else’s photo', async () => {
    const projectId = await makeProject();
    const base = { entityId: E, projectId, milestoneKey: STEP, checklistId: checklist.id };
    const mine = await photo(engineer);
    expect(
      await failure(engineer, submitQc, { ...base, answers: answers(mine).slice(0, 2) }),
    ).toMatchObject({ code: 'validation_failed', reason: 'qc_answers_missing' });
    expect(
      await failure(engineer, submitQc, {
        ...base,
        answers: answers(mine).map((a) => (a.key === 'voltage' ? { key: 'voltage', value: 300 } : a)),
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'qc_answers_missing' });
    expect(
      await failure(engineer, submitQc, { ...base, answers: answers(await photo(manager)) }),
    ).toMatchObject({ code: 'validation_failed', reason: 'qc_photo_missing' });
    expect(
      await failure(engineer, submitQc, { ...base, checklistId: newId(), answers: answers(mine) }),
    ).toMatchObject({ code: 'conflict', reason: 'qc_checklist_changed' });
    // A step with no checklist has nothing to submit.
    expect(
      await failure(engineer, submitQc, { ...base, milestoneKey: AFTER, answers: answers(mine) }),
    ).toMatchObject({ code: 'conflict', reason: 'qc_no_checklist' });
  });

  it('is refused to an engineer not on the project, an Accounts person and another company', async () => {
    const projectId = await makeProject();
    expect(await failure(stranger, submitQc, {
      entityId: E,
      projectId,
      milestoneKey: STEP,
      checklistId: checklist.id,
      answers: answers(await photo(stranger)),
    })).toMatchObject({ code: 'not_found', reason: 'project_missing' });
    expect(await failure(accounts, submitQc, {
      entityId: E,
      projectId,
      milestoneKey: STEP,
      checklistId: checklist.id,
      answers: answers(await photo(accounts)),
    })).toMatchObject({ code: 'forbidden' });
    expect(await failure(otherManager, submitQc, {
      entityId: E,
      projectId,
      milestoneKey: STEP,
      checklistId: checklist.id,
      answers: answers(await photo(otherManager, OTHER)),
    })).toMatchObject({ code: 'forbidden' });
    const agent = principalFor('agent:orchestrator', [E]);
    expect(await failure(agent, submitQc, {
      entityId: E,
      projectId,
      milestoneKey: STEP,
      checklistId: checklist.id,
      answers: answers(newId()),
    })).toMatchObject({ code: 'forbidden' });
  });
});

describe('projects.qc.signoff and .reject: decided by someone other than the submitter', () => {
  it('the submitter may not decide; another manager signs off, and the step can then be done', async () => {
    const projectId = await makeProject();
    const inspection = await submit(manager, projectId);
    const ref = { entityId: E, inspectionId: inspection.id };
    expect(await failure(manager, signoffQc, ref)).toMatchObject({
      code: 'forbidden',
      reason: 'qc_signer_is_submitter',
    });
    expect(await failure(manager, rejectQc, { ...ref, reason: 'Retake' })).toMatchObject({
      code: 'forbidden',
      reason: 'qc_signer_is_submitter',
    });
    // A Field Engineer holds no sign-off.
    expect(await failure(engineer, signoffQc, ref)).toMatchObject({ code: 'forbidden' });
    const signed = await run<QcInspectionDto>(signer, signoffQc, ref);
    expect(signed).toMatchObject({ state: 'signed_off', decidedBy: signer.id, rejectReason: null });
    expect((await eventsOf(inspection.id)).map((e) => e.type)).toEqual([
      'projects.qc.submitted',
      'projects.qc.signed_off',
    ]);
    // Decided once.
    expect(await failure(signer, rejectQc, { ...ref, reason: 'Too late' })).toMatchObject({
      code: 'conflict',
      reason: 'qc_inspection_transition_not_allowed',
    });
    await run(engineer, completeMilestone, { entityId: E, projectId, milestoneKey: STEP });
  });

  it('a turned-down check keeps its reason, and a new one is submitted for the step', async () => {
    const projectId = await makeProject();
    const first = await submit(engineer, projectId);
    const rejected = await run<QcInspectionDto>(manager, rejectQc, {
      entityId: E,
      inspectionId: first.id,
      reason: 'The earthing photo is blurred',
    });
    expect(rejected).toMatchObject({
      state: 'rejected',
      rejectReason: 'The earthing photo is blurred',
    });
    const [, row] = await auditOf(first.id);
    expect(row?.after).toEqual({
      milestoneKey: STEP,
      inspectionState: 'rejected',
      rejectReason: 'The earthing photo is blurred',
    });
    const second = await submit(engineer, projectId);
    expect(second.state).toBe('submitted');
    const qc = await asPrincipal(engineer, (ctx) => projectQc(ctx, { entityId: E, projectId }));
    expect(qc.steps.map((s) => [s.key, s.inspections.map((i) => i.state)])).toEqual([
      [STEP, ['submitted', 'rejected']],
    ]);
    expect(qc.people.map((p) => p.id).sort()).toEqual([engineer.id, manager.id].sort());
  });

  it('is refused for an inspection of another company, and not found to an engineer not on it', async () => {
    const projectId = await makeProject();
    const inspection = await submit(engineer, projectId);
    expect(
      await failure(otherManager, signoffQc, { entityId: E, inspectionId: inspection.id }),
    ).toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(stranger, (ctx) => projectQc(ctx, { entityId: E, projectId })),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('projects.cost.add and .reverse: restricted charges on a project', () => {
  const add = (who: Principal, projectId: string, extra: Record<string, unknown> = {}) =>
    run<CostLineDto>(who, addCostLine, {
      entityId: E,
      projectId,
      kind: 'labour',
      quantity: '2.5',
      rate: '1200.00',
      note: 'Two and a half days of fitters',
      ...extra,
    });

  it('the Executive adds a charge; its amount is the quantity times the rate', async () => {
    const projectId = await makeProject();
    const line = await add(executive, projectId);
    expect(line).toMatchObject({
      kind: 'labour',
      quantity: '2.500',
      rate: '1200.00',
      amount: '3000.00',
      reversesId: null,
      createdBy: executive.id,
    });
    // No value leaves in an event or the audit trail: the row names the line and its kind.
    expect(await eventsOf(line.id)).toEqual([]);
    const rows = await auditOf(line.id);
    expect(rows).toEqual([
      {
        command: 'projects.cost.add',
        input: { entityId: E, projectId, kind: 'labour', vendorId: null },
        before: null,
        after: { costKind: 'labour' },
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/1200|3000|2\.5|fitters/);
  });

  it('a contractor’s charge names an active contractor', async () => {
    const projectId = await makeProject();
    const line = await add(executive, projectId, {
      kind: 'contractor',
      vendorId: contractor,
      quantity: '1',
      rate: '45000.00',
    });
    expect(line).toMatchObject({ vendorId: contractor, vendorName: 'qc suite crew' });
    expect(
      await failure(executive, addCostLine, {
        entityId: E,
        projectId,
        kind: 'contractor',
        vendorId: supplier,
        quantity: '1',
        rate: '100.00',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'cost_vendor_not_contractor' });
    expect(
      await failure(executive, addCostLine, {
        entityId: E,
        projectId,
        kind: 'labour',
        vendorId: contractor,
        quantity: '1',
        rate: '100.00',
      }),
    ).toMatchObject({ code: 'validation_failed' });
  });

  it('a correction is a reversal, once; the total adds the lines up', async () => {
    const projectId = await makeProject();
    const line = await add(executive, projectId);
    await add(executive, projectId, { quantity: '1', rate: '850.00', note: null });
    const reversal = await run<CostLineDto>(executive, reverseCostLine, {
      entityId: E,
      lineId: line.id,
      note: 'Entered against the wrong project',
    });
    expect(reversal).toMatchObject({
      reversesId: line.id,
      kind: 'labour',
      quantity: '-2.500',
      rate: '1200.00',
      amount: '-3000.00',
    });
    expect(await auditOf(reversal.id)).toEqual([
      expect.objectContaining({
        input: { entityId: E, lineId: line.id },
        after: { costKind: 'labour', reversedLineId: line.id },
      }),
    ]);
    expect(
      await failure(executive, reverseCostLine, { entityId: E, lineId: line.id }),
    ).toMatchObject({ code: 'conflict', reason: 'cost_line_reversed' });
    expect(
      await failure(executive, reverseCostLine, { entityId: E, lineId: reversal.id }),
    ).toMatchObject({ code: 'conflict', reason: 'cost_line_is_reversal' });
    const costs = await asPrincipal(executive, (ctx) => projectCosts(ctx, { entityId: E, projectId }));
    expect(costs.total).toBe('850.00');
    expect(costs.lines.find((l) => l.id === line.id)?.reversedById).toBe(reversal.id);
    // Accounts reads the lines with finance.cost.read.
    const read = await asPrincipal(accounts, (ctx) => projectCosts(ctx, { entityId: E, projectId }));
    expect(read.lines).toHaveLength(3);
  });

  it('is refused without finance.cost.read, without projects.write, to agents and for another company', async () => {
    const projectId = await makeProject();
    const input = { entityId: E, projectId, kind: 'labour', quantity: '1', rate: '100.00' };
    // The Project Manager writes the project but holds no cost grant; Accounts holds it but writes
    // no project (docs/07-security.md §3.2).
    for (const who of [manager, engineer, accounts]) {
      expect(await failure(who, addCostLine, input)).toMatchObject({ code: 'forbidden' });
    }
    for (const agent of ['agent:orchestrator', 'agent:chief'] as const) {
      expect(await failure(principalFor(agent, [E]), addCostLine, input)).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(
      await failure(executive, addCostLine, { ...input, entityId: OTHER }),
    ).toMatchObject({ code: 'forbidden' });
    const line = await add(executive, projectId);
    expect(
      await failure(executive, reverseCostLine, { entityId: OTHER, lineId: line.id }),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('cost values reach no reader without finance.cost.read', () => {
  it('the Costs tab and the contractor list are refused before anything is read', async () => {
    const projectId = await makeProject();
    for (const who of [manager, engineer, principalFor('agent:chief', [E])]) {
      await expect(
        asPrincipal(who, (ctx) => projectCosts(ctx, { entityId: E, projectId })),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        asPrincipal(who, (ctx) => listContractors(ctx, { entityId: E })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    const list = await asPrincipal(executive, (ctx) => listContractors(ctx, { entityId: E }));
    expect(list.contractors.map((c) => c.id)).toContain(contractor);
    expect(list.contractors.map((c) => c.id)).not.toContain(supplier);
  });

  it('an Executive speaking to Talk to Shakti reads none, on either pool', async () => {
    const projectId = await makeProject();
    await run(executive, addCostLine, {
      entityId: E,
      projectId,
      kind: 'labour',
      quantity: '1',
      rate: '100.00',
    });
    const voice = voiceSessionPrincipal(executive, newId(), [E]);
    if (!voice) throw new Error('no voice principal');
    await expect(
      asPrincipal(voice, (ctx) => projectCosts(ctx, { entityId: E, projectId })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const reader of [false, true]) {
      const seen = await withRequestContext(
        voice,
        {},
        async ({ tx }) =>
          (await tx.execute(
            sql`select count(*)::int as n from project_cost_lines where project_id = ${projectId}`,
          )) as unknown as { n: number }[],
        { reader },
      );
      expect(seen[0]?.n).toBe(0);
    }
    // The Executive's own reader pool reads it.
    const own = await withRequestContext(
      executive,
      {},
      async ({ tx }) =>
        (await tx.execute(
          sql`select count(*)::int as n from project_cost_lines where project_id = ${projectId}`,
        )) as unknown as { n: number }[],
      { reader: true },
    );
    expect(own[0]?.n).toBe(1);
  });
});
