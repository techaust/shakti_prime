import {
  AGENT_PRINCIPAL_IDS,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type CrewDto,
  type DraftProjectDto,
  type Principal,
  type ScheduleSlotDto,
  type UnavailabilityDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestTeam,
  createTestUser,
  PIPELINE_SEED,
  principalFor,
  stageId,
  tierId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { draftProject } from '../../src/commands/projects/create-project';
import { completeMilestone, holdProject } from '../../src/commands/projects/move-project';
import { saveCrew } from '../../src/commands/projects/schedule-crews';
import {
  cancelSlot,
  confirmSlot,
  doneSlot,
  moveSlot,
  proposeSlot,
} from '../../src/commands/projects/schedule-slots';
import {
  recordUnavailability,
  removeUnavailability,
} from '../../src/commands/projects/schedule-unavailability';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// J5 scheduling board (docs/03-roadmap-appendix/phase4.md §7.2, §13): the visit, crew and time
// away commands on real Postgres. Conflicts are named by findScheduleConflicts() before every save
// and saved over only by a person with a reason, which the audit row keeps with them; the
// Orchestrator only proposes. Visits are booked in company 2, far ahead, on projects drafted from
// orders written with the migrator connection; each test books its own engineers, so their
// visits never meet another test's. Company 1 is the wrong one.
const E = 2;
const OTHER = 1;
const P = '01990000-0000-7000-8000-000000c5';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
/** This suite's price list of company 2, and of company 1. */
const PRICE_LISTS: Record<number, string> = { 2: fixed(0x0001), 1: fixed(0x0002) };
let serial = 0x0100;
const nextId = () => fixed((serial += 1));

/** A day far ahead, in IST, so every visit is in the future and no other suite's. */
const at = (time: string, day = '2097-03-10') =>
  `${new Date(`${day}T${time}:00+05:30`).toISOString()}`;

/** This suite's team in each company. */
const teams = new Map<number, string>();
let manager: Principal;
let otherManager: Principal;
const orchestrator = (entityIds: number[] = [E]): Principal =>
  principalFor('agent:orchestrator', entityIds, { id: AGENT_PRINCIPAL_IDS['agent:orchestrator'] });
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

/** A site 0.1° of latitude from the other: 32 minutes apart by road, 47 with the buffer. */
const HERE = { lat: 26.9, lng: 75.8 };
const THERE = { lat: 27.0, lng: 75.8 };

async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const orders = tx`select id from sales_orders where price_list_id::text like ${`${P}%`}`;
      const projects = tx`select id from projects where sales_order_id in (${orders})`;
      await tx`delete from schedule_slots where project_id in (${projects})`;
      await tx`delete from crew_members where crew_id in (select id from crews where name like 'schedule suite%')`;
      await tx`delete from crews where name like 'schedule suite%'`;
      await tx`delete from unavailability where note like 'schedule suite%'`;
      await tx`delete from project_milestones where project_id in (${projects})`;
      await tx`delete from projects where sales_order_id in (${orders})`;
      await tx`delete from sales_orders where price_list_id::text like ${`${P}%`}`;
      await tx`delete from quotes where price_list_id::text like ${`${P}%`}`;
      await tx`delete from opportunities where id::text like ${`${P}%`}`;
      await tx`delete from customer_sites where id::text like ${`${P}%`}`;
      await tx`delete from account_entities where account_id::text like ${`${P}%`}`;
      await tx`delete from accounts where id::text like ${`${P}%`}`;
      await tx`delete from price_lists where id::text like ${`${P}%`}`;
    }),
  );
}

async function person(
  role: 'project_manager' | 'field_engineer',
  entities: number[] = [E],
): Promise<Principal> {
  const user = await createTestUser(
    entities.map((entityId) => ({ entityId, roleKey: role })),
    { name: `schedule suite ${role}` },
  );
  return principalFor(role, [entities[0] ?? E], { id: user.id });
}

beforeAll(async () => {
  await removeRows();
  for (const e of [E, OTHER]) teams.set(e, await createTestTeam(e, 'schedule suite team'));
  manager = await person('project_manager');
  otherManager = await person('project_manager', [OTHER]);
  for (const [e, priceList] of Object.entries(PRICE_LISTS)) {
    await asMigrator(
      (
        m,
      ) => m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
        values (${priceList}, ${tierId('dealer')}, ${Number(e)}, 9300, '2090-01-01', now())`,
    );
  }
});

afterAll(async () => {
  await removeRows();
  await closeDb();
});

interface ProjectFacts {
  projectId: string;
  /** The first open step's id. */
  stepId: string;
  entityId: number;
}

/**
 * A farmer-pumps project of company `entityId` drafted by the platform from a confirmed order, its
 * site at `point` (none when null), with the default steps.
 */
async function makeProject(
  point: { lat: number; lng: number } | null = HERE,
  entityId = E,
): Promise<ProjectFacts> {
  const account = nextId();
  const site = nextId();
  const order = nextId();
  const lead = nextId();
  const quote = nextId();
  const owner = manager.id;
  const team = teams.get(entityId);
  const priceList = PRICE_LISTS[entityId];
  const index = PIPELINE_SEED.findIndex((p) => p.segment === 'farmer_pumps');
  const pipeline = PIPELINE_SEED[index];
  if (!pipeline || !priceList || !team) throw new Error('no pipeline, price list or team');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'farm', 'schedule suite customer', ${owner})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${nextId()}, ${account}, ${entityId}, ${owner}, ${team}, ${owner})`;
      await tx`insert into customer_sites (id, account_id, type, village, lat, lng, created_by)
        values (${site}, ${account}, 'borewell', 'schedule suite village', ${point?.lat ?? null},
                ${point?.lng ?? null}, ${owner})`;
      await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${lead}, ${entityId}, ${account}, ${site}, ${pipeline.id}, ${stageId(index + 1, 1)}, ${owner}, ${team}, ${owner})`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id, tier_id,
                 price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal, cgst,
                 sgst, igst, tax_total, round_off, grand_total, created_by)
        values (${quote}, ${entityId}, ${`SS/Q/2097-98/${quote.slice(-4)}`}, '2097-98', ${lead}, ${account},
                ${site}, ${tierId('dealer')}, ${priceList}, 'none', '08', 'intra',
                now() + interval '15 days', 0, 0, 0, 0, 0, 0, 0, ${owner})`;
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, account_type,
                 site_id, tier_id, price_list_id, place_of_supply_state, supply_kind, state, subtotal, cgst, sgst,
                 igst, tax_total, round_off, grand_total, confirmed_at, confirmed_by, created_by)
        values (${order}, ${entityId}, ${`SS/SO/2097-98/${order.slice(-4)}`}, '2097-98', ${quote}, ${lead},
                ${account}, 'farm', ${site}, ${tierId('dealer')}, ${priceList}, '08', 'intra', 'confirmed',
                0, 0, 0, 0, 0, 0, 0, now(), ${owner}, ${owner})`;
    }),
  );
  const drafted = (await asPrincipal({ ...workers(), entityIds: [entityId] }, (context) =>
    runCommand(draftProject, { context, audit, outbox }, { entityId, orderId: order }),
  )) as DraftProjectDto;
  if (drafted.outcome !== 'drafted') throw new Error(`not drafted: ${drafted.because}`);
  const [step] = await asMigrator(
    (m) => m<{ id: string }[]>`select id::text as id from project_milestones
      where project_id = ${drafted.projectId} order by position limit 1`,
  );
  if (!step) throw new Error('no step');
  return { projectId: drafted.projectId, stepId: step.id, entityId };
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
): Promise<{
  code: string | undefined;
  reason: unknown;
  details: Record<string, unknown> | undefined;
}> {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: Record<string, unknown> } | undefined;
  return { code: e?.code, reason: e?.details?.reason, details: e?.details };
}

const visit = (
  project: ProjectFacts,
  who: { engineerId?: string; crewId?: string },
  from: string,
  to: string,
  extra: Record<string, unknown> = {},
) => ({
  entityId: project.entityId,
  projectId: project.projectId,
  milestoneId: project.stepId,
  engineerId: who.engineerId ?? null,
  crewId: who.crewId ?? null,
  startsAt: at(from),
  endsAt: at(to),
  ...extra,
});

async function auditOf(
  aggregateId: string,
  command: string,
): Promise<{ outcome: string; after: Record<string, unknown> | null }[]> {
  return asMigrator(
    (m) => m<{ outcome: string; after: Record<string, unknown> | null }[]>`
      select outcome, after_json as after from audit_logs
       where aggregate_id = ${aggregateId} and command = ${command} order by created_at`,
  );
}

describe('projects.slot.propose', () => {
  it('a Project Manager proposes a visit to an open step: nothing is booked until a person confirms', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const slot = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
    );
    expect(slot).toMatchObject({
      state: 'proposed',
      proposedBy: manager.id,
      confirmedAt: null,
      travelMin: null,
      overrideReason: null,
      conflicts: [],
    });
    expect(await auditOf(slot.id, 'projects.slot.propose')).toEqual([
      expect.objectContaining({
        outcome: 'ok',
        after: expect.objectContaining({ slotState: 'proposed', conflicts: [] }),
      }),
    ]);
  });

  it('is refused to an engineer and in another company', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const input = visit(project, { engineerId: engineer.id }, '10:00', '11:00');
    expect(await failure(engineer, proposeSlot, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(otherManager, proposeSlot, input)).toMatchObject({ code: 'forbidden' });
    // The other company's manager, naming their own company, does not find the project.
    expect(await failure(otherManager, proposeSlot, { ...input, entityId: OTHER })).toMatchObject({
      code: 'not_found',
      reason: 'milestone_missing',
    });
  });

  it('names a double booking, saves over it only with a reason, and audits the reason with the conflict', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const first = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(project, { engineerId: engineer.id }, '10:00', '12:00'),
    );
    const clash = visit(project, { engineerId: engineer.id }, '11:00', '13:00');
    const refused = await failure(manager, proposeSlot, clash);
    expect(refused).toMatchObject({ code: 'conflict', reason: 'schedule_conflict' });
    expect(refused.details?.conflicts).toEqual([
      expect.objectContaining({ kind: 'double_booking', personId: engineer.id, slotId: first.id }),
    ]);
    const saved = await run<ScheduleSlotDto>(manager, proposeSlot, {
      ...clash,
      overrideReason: 'customer asked for this time',
    });
    expect(saved).toMatchObject({
      overrideReason: 'customer asked for this time',
      conflicts: [expect.objectContaining({ kind: 'double_booking', slotId: first.id })],
    });
    expect(await auditOf(saved.id, 'projects.slot.propose')).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({
          overrideReason: 'customer asked for this time',
          conflicts: [expect.objectContaining({ kind: 'double_booking', slotId: first.id })],
        }),
      }),
    ]);
  });

  it('names too little travel time between two sites, and records the trip from the visit before', async () => {
    const engineer = await person('field_engineer');
    const here = await makeProject(HERE);
    const there = await makeProject(THERE);
    const first = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(here, { engineerId: engineer.id }, '09:30', '10:30'),
    );
    expect(
      (
        await failure(
          manager,
          proposeSlot,
          visit(there, { engineerId: engineer.id }, '10:46', '11:30'),
        )
      ).details?.conflicts,
    ).toEqual([
      expect.objectContaining({ kind: 'travel_time', slotId: first.id, neededMin: 47, gapMin: 16 }),
    ]);
    const enough = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(there, { engineerId: engineer.id }, '11:17', '12:00'),
    );
    expect(enough).toMatchObject({ travelMin: 32, conflicts: [] });
  });

  it("names the person's time away, and a visit they have in another company", async () => {
    const engineer = await person('field_engineer', [E, OTHER]);
    const project = await makeProject();
    const away = await run<UnavailabilityDto>(manager, recordUnavailability, {
      entityId: E,
      personId: engineer.id,
      startsAt: at('13:00'),
      endsAt: at('18:00'),
      kind: 'training',
      note: 'schedule suite',
    });
    expect(
      (
        await failure(
          manager,
          proposeSlot,
          visit(project, { engineerId: engineer.id }, '14:00', '15:00'),
        )
      ).details?.conflicts,
    ).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        unavailabilityId: away.id,
        unavailabilityKind: 'training',
      }),
    ]);
    const elsewhere = await makeProject(HERE, OTHER);
    const theirs = await run<ScheduleSlotDto>(
      otherManager,
      proposeSlot,
      visit(elsewhere, { engineerId: engineer.id }, '09:30', '10:30'),
    );
    expect(
      (
        await failure(
          manager,
          proposeSlot,
          visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
        )
      ).details?.conflicts,
    ).toEqual([expect.objectContaining({ kind: 'double_booking', slotId: theirs.id })]);
  });

  it('refuses a time already past, a closed step and a project not in progress', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    expect(
      await failure(manager, proposeSlot, {
        ...visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
        startsAt: '2020-01-01T04:00:00.000Z',
        endsAt: '2020-01-01T05:00:00.000Z',
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'slot_in_past' });
    await run(manager, completeMilestone, {
      entityId: E,
      projectId: project.projectId,
      milestoneKey: 'survey',
    });
    expect(
      await failure(
        manager,
        proposeSlot,
        visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'slot_step_closed' });
    const held = await makeProject();
    await run(manager, holdProject, {
      entityId: E,
      projectId: held.projectId,
      reason: 'schedule suite',
    });
    expect(
      await failure(
        manager,
        proposeSlot,
        visit(held, { engineerId: engineer.id }, '10:00', '11:00'),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'slot_project_not_active' });
  });

  it('refuses an engineer outside the company and a visit with neither or both of an engineer and a crew', async () => {
    const project = await makeProject();
    const outsider = await person('field_engineer', [OTHER]);
    expect(
      await failure(
        manager,
        proposeSlot,
        visit(project, { engineerId: outsider.id }, '10:00', '11:00'),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'schedule_slot_person_outside' });
    expect(await failure(manager, proposeSlot, visit(project, {}, '10:00', '11:00'))).toMatchObject(
      {
        code: 'validation_failed',
      },
    );
  });
});

describe('the Orchestrator only proposes', () => {
  it('proposes a free time, never over a conflict, and confirms, moves or cancels nothing', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const proposed = await run<ScheduleSlotDto>(
      orchestrator(),
      proposeSlot,
      visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
    );
    expect(proposed).toMatchObject({
      state: 'proposed',
      proposedBy: AGENT_PRINCIPAL_IDS['agent:orchestrator'],
    });
    expect(
      await failure(orchestrator(), proposeSlot, {
        ...visit(project, { engineerId: engineer.id }, '10:30', '11:30'),
        overrideReason: 'the agent insists',
      }),
    ).toMatchObject({ code: 'conflict', reason: 'schedule_conflict' });
    const ref = { entityId: E, slotId: proposed.id };
    for (const [command, input] of [
      [confirmSlot, ref],
      [moveSlot, { ...ref, engineerId: engineer.id, startsAt: at('15:00'), endsAt: at('16:00') }],
      [cancelSlot, { ...ref, reason: 'schedule suite' }],
    ] as const) {
      expect(await failure(orchestrator(), command, input)).toMatchObject({ code: 'forbidden' });
    }
    // A person confirms the Orchestrator's proposal.
    expect(await run<ScheduleSlotDto>(manager, confirmSlot, ref)).toMatchObject({
      state: 'confirmed',
      confirmedBy: manager.id,
    });
  });
});

describe('projects.slot.confirm, .move and .cancel', () => {
  it('checks the conflicts again as it confirms: a clash booked since the proposal needs a reason', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const first = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
    );
    await run(manager, proposeSlot, {
      ...visit(project, { engineerId: engineer.id }, '10:30', '11:30'),
      overrideReason: 'schedule suite clash',
    });
    const ref = { entityId: E, slotId: first.id };
    expect(await failure(manager, confirmSlot, ref)).toMatchObject({
      code: 'conflict',
      reason: 'schedule_conflict',
    });
    const confirmed = await run<ScheduleSlotDto>(manager, confirmSlot, {
      ...ref,
      overrideReason: 'both are short',
    });
    expect(confirmed).toMatchObject({ state: 'confirmed', overrideReason: 'both are short' });
    expect(await failure(manager, confirmSlot, ref)).toMatchObject({
      code: 'conflict',
      reason: 'schedule_slot_transition_not_allowed',
    });
    expect(await failure(otherManager, confirmSlot, ref)).toMatchObject({ code: 'forbidden' });
  });

  it('moves a visit to a free time, keeping its state and clearing the reason it no longer needs', async () => {
    const engineer = await person('field_engineer');
    const other = await person('field_engineer');
    const project = await makeProject();
    await run(manager, proposeSlot, visit(project, { engineerId: engineer.id }, '10:00', '11:00'));
    const second = await run<ScheduleSlotDto>(manager, proposeSlot, {
      ...visit(project, { engineerId: engineer.id }, '10:30', '11:30'),
      overrideReason: 'schedule suite clash',
    });
    await run(manager, confirmSlot, {
      entityId: E,
      slotId: second.id,
      overrideReason: 'schedule suite clash',
    });
    const moved = await run<ScheduleSlotDto>(manager, moveSlot, {
      entityId: E,
      slotId: second.id,
      engineerId: other.id,
      startsAt: at('14:00'),
      endsAt: at('15:00'),
    });
    expect(moved).toMatchObject({
      state: 'confirmed',
      engineerId: other.id,
      startsAt: at('14:00'),
      overrideReason: null,
      conflicts: [],
    });
    expect(
      await failure(engineer, moveSlot, {
        entityId: E,
        slotId: second.id,
        engineerId: engineer.id,
        startsAt: at('16:00'),
        endsAt: at('17:00'),
      }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('cancels with a reason, and a cancelled visit frees the time', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const slot = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
    );
    const cancelled = await run<ScheduleSlotDto>(manager, cancelSlot, {
      entityId: E,
      slotId: slot.id,
      reason: 'customer away',
    });
    expect(cancelled).toMatchObject({ state: 'cancelled', cancelReason: 'customer away' });
    expect(
      await run<ScheduleSlotDto>(
        manager,
        proposeSlot,
        visit(project, { engineerId: engineer.id }, '10:00', '11:00'),
      ),
    ).toMatchObject({ conflicts: [] });
    expect(
      await failure(manager, cancelSlot, { entityId: E, slotId: slot.id, reason: 'again' }),
    ).toMatchObject({
      code: 'conflict',
      reason: 'schedule_slot_transition_not_allowed',
    });
  });
});

describe('projects.slot.done', () => {
  /** A confirmed visit of the engineer that started an hour ago, written as the migrator. */
  async function startedVisit(engineerId: string, project: ProjectFacts, offsetHours = -1) {
    const id = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into schedule_slots (id, entity_id, project_id, milestone_id, engineer_id, starts_at,
                 ends_at, state, confirmed_at, confirmed_by, proposed_by, created_by)
        values (${id}, ${E}, ${project.projectId}, ${project.stepId}, ${engineerId},
                now() + ${`${offsetHours} hours`}::interval, now() + ${`${offsetHours + 2} hours`}::interval,
                'confirmed', now(), ${manager.id}, ${manager.id}, ${manager.id})`,
    );
    return id;
  }

  it('the engineer on a visit that has started records it done, with a note; the step stays open', async () => {
    const engineer = await person('field_engineer');
    const project = await makeProject();
    const slotId = await startedVisit(engineer.id, project);
    const done = await run<ScheduleSlotDto>(engineer, doneSlot, {
      entityId: E,
      slotId,
      note: 'pump fitted',
    });
    expect(done).toMatchObject({ state: 'done', doneBy: engineer.id, doneNote: 'pump fitted' });
    const [step] = await asMigrator(
      (m) =>
        m<{ state: string }[]>`select state from project_milestones where id = ${project.stepId}`,
    );
    expect(step?.state).toBe('open');
  });

  it('is refused before the visit starts, to another engineer, and in another company', async () => {
    const engineer = await person('field_engineer');
    const stranger = await person('field_engineer');
    const project = await makeProject();
    const later = await startedVisit(engineer.id, project, 3);
    expect(await failure(engineer, doneSlot, { entityId: E, slotId: later })).toMatchObject({
      code: 'conflict',
      reason: 'slot_not_started',
    });
    const started = await startedVisit(engineer.id, project);
    expect(await failure(stranger, doneSlot, { entityId: E, slotId: started })).toMatchObject({
      code: 'not_found',
      reason: 'slot_missing',
    });
    expect(await failure(otherManager, doneSlot, { entityId: E, slotId: started })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('projects.crew.save', () => {
  it('makes a crew and changes its members; a crew visit checks every member', async () => {
    const lead = await person('field_engineer');
    const helper = await person('field_engineer');
    const crew = await run<CrewDto>(manager, saveCrew, {
      entityId: E,
      name: `schedule suite crew ${lead.id.slice(-4)}`,
      leadId: lead.id,
      memberIds: [lead.id],
    });
    expect(crew).toMatchObject({ leadId: lead.id, memberIds: [lead.id], archivedAt: null });
    const changed = await run<CrewDto>(manager, saveCrew, {
      entityId: E,
      crewId: crew.id,
      name: crew.name,
      leadId: lead.id,
      memberIds: [lead.id, helper.id],
    });
    expect(changed.memberIds).toEqual([lead.id, helper.id].sort());
    const project = await makeProject();
    const own = await run<ScheduleSlotDto>(
      manager,
      proposeSlot,
      visit(project, { engineerId: helper.id }, '10:00', '11:00'),
    );
    expect(
      (await failure(manager, proposeSlot, visit(project, { crewId: crew.id }, '10:30', '12:00')))
        .details?.conflicts,
    ).toEqual([
      expect.objectContaining({ kind: 'double_booking', personId: helper.id, slotId: own.id }),
    ]);
    // Archived, it takes no new visit.
    await run(manager, saveCrew, {
      entityId: E,
      crewId: crew.id,
      name: crew.name,
      leadId: lead.id,
      memberIds: [lead.id],
      archived: true,
    });
    expect(
      await failure(manager, proposeSlot, visit(project, { crewId: crew.id }, '14:00', '15:00')),
    ).toMatchObject({ code: 'not_found', reason: 'crew_missing' });
  });

  it('refuses a person outside the company, a lead outside the crew, an engineer, and another company', async () => {
    const lead = await person('field_engineer');
    const outsider = await person('field_engineer', [OTHER]);
    const input = {
      entityId: E,
      name: `schedule suite crew ${lead.id.slice(-4)}`,
      leadId: lead.id,
      memberIds: [lead.id],
    };
    expect(
      await failure(manager, saveCrew, { ...input, memberIds: [lead.id, outsider.id] }),
    ).toMatchObject({ code: 'validation_failed', reason: 'crew_person_outside' });
    expect(await failure(manager, saveCrew, { ...input, leadId: outsider.id })).toMatchObject({
      code: 'validation_failed',
    });
    expect(await failure(lead, saveCrew, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(otherManager, saveCrew, input)).toMatchObject({ code: 'forbidden' });
    await run(manager, saveCrew, input);
    expect(await failure(manager, saveCrew, input)).toMatchObject({
      code: 'conflict',
      reason: 'crew_name_taken',
    });
  });
});

describe('projects.unavailability.record and .remove', () => {
  it('records and removes a time away for a person of the company', async () => {
    const engineer = await person('field_engineer');
    const away = await run<UnavailabilityDto>(manager, recordUnavailability, {
      entityId: E,
      personId: engineer.id,
      startsAt: at('00:00', '2097-03-11'),
      endsAt: at('00:00', '2097-03-13'),
      kind: 'leave',
      note: 'schedule suite',
    });
    expect(away).toMatchObject({ personId: engineer.id, kind: 'leave', createdBy: manager.id });
    const removed = await run<UnavailabilityDto>(manager, removeUnavailability, {
      entityId: E,
      unavailabilityId: away.id,
    });
    expect(removed.id).toBe(away.id);
    expect(
      await failure(manager, removeUnavailability, { entityId: E, unavailabilityId: away.id }),
    ).toMatchObject({ code: 'not_found', reason: 'unavailability_missing' });
  });

  it('is refused to an engineer, for a person outside the company, and in another company', async () => {
    const engineer = await person('field_engineer');
    const outsider = await person('field_engineer', [OTHER]);
    const input = {
      entityId: E,
      personId: engineer.id,
      startsAt: at('00:00'),
      endsAt: at('12:00'),
      kind: 'other',
      note: 'schedule suite',
    };
    expect(await failure(engineer, recordUnavailability, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(otherManager, recordUnavailability, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await failure(manager, recordUnavailability, { ...input, personId: outsider.id }),
    ).toMatchObject({ code: 'validation_failed', reason: 'unavailability_person_outside' });
    expect(
      await failure(manager, recordUnavailability, { ...input, endsAt: at('00:00', '2097-07-10') }),
    ).toMatchObject({ code: 'validation_failed' });
  });
});
