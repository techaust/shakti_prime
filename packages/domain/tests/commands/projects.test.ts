import {
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DraftProjectDto,
  type Principal,
  type ProjectDto,
  type ProjectTemplateDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
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
import { failureOf, runCommand } from '../../src/command/run-command';
import { assignProject } from '../../src/commands/projects/assign-project';
import { createProject, draftProject } from '../../src/commands/projects/create-project';
import {
  cancelProject,
  completeMilestone,
  completeProject,
  holdProject,
  resumeProject,
} from '../../src/commands/projects/move-project';
import { publishProjectTemplate } from '../../src/commands/projects/publish-template';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { readProject } from '../../src/queries/projects/project-dto';
import { WORKSHOP_DEFAULTS } from '../../src/workshop-defaults';

// J1 projects (docs/03-roadmap-appendix/phase4.md §6.1): drafting from a confirmed order per
// segment and once per order, a project made by hand, the standard flow's moves, the people on a
// project and versioned checklists. Projects are made in company 2; company 1 is the wrong one.
// The orders, customers and leads are written with the migrator connection, with synthetic values.
const E = 2;
const OTHER = 1;
const P = '01990000-0000-7000-8000-000000b8';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const PRICE_LIST = fixed(0x0001);
let serial = 0x0100;
const nextId = () => fixed((serial += 1));

let teamId: string;
let manager: Principal;
let otherManager: Principal;
let engineer: Principal;
let strangerEngineer: Principal;
let executive: Principal;
let gm: Principal;
const workers = (entityIds: number[] = [E]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

/** Removes this file's projects, checklists of company 2, orders, quotes, leads and customers. */
async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      const orders = tx`select id from sales_orders where price_list_id = ${PRICE_LIST}`;
      const projects = tx`select id from projects where sales_order_id in (${orders})`;
      await tx`delete from project_assignments where project_id in (${projects})`;
      await tx`delete from project_milestones where project_id in (${projects})`;
      await tx`delete from projects where sales_order_id in (${orders})`;
      // Checklists are never removed by a request; this file starts company 2 with none.
      await tx`delete from project_flow_templates where entity_id = ${E}
                 and id not in (select template_version_id from projects where template_version_id is not null)`;
      await tx`delete from sales_orders where price_list_id = ${PRICE_LIST}`;
      await tx`delete from quotes where price_list_id = ${PRICE_LIST}`;
      await tx`delete from opportunities where id::text like ${`${P}%`}`;
      await tx`delete from customer_sites where id::text like ${`${P}%`}`;
      await tx`delete from account_entities where account_id::text like ${`${P}%`}`;
      await tx`delete from accounts where id::text like ${`${P}%`}`;
      await tx`delete from price_lists where id = ${PRICE_LIST}`;
    }),
  );
}

beforeAll(async () => {
  await removeRows();
  teamId = await createTestTeam(E, 'projects suite team');
  const person = async (
    role: 'project_manager' | 'field_engineer' | 'executive' | 'general_manager',
    entityId = E,
  ) => {
    const user = await createTestUser([{ entityId, roleKey: role }], { name: `projects ${role}` });
    return principalFor(role, [entityId], { id: user.id });
  };
  manager = await person('project_manager');
  otherManager = await person('project_manager', OTHER);
  engineer = await person('field_engineer');
  strangerEngineer = await person('field_engineer');
  executive = await person('executive');
  gm = await person('general_manager');
  await asMigrator(
    (m) => m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
      values (${PRICE_LIST}, ${tierId('dealer')}, ${E}, 9200, '2090-01-01', now())`,
  );
});

afterAll(async () => {
  await removeRows();
  await closeDb();
});

interface OrderOptions {
  /** The lead's pipeline segment; null for a dealer's order, which has no lead or quote. */
  segment: 'farmer_pumps' | 'residential_rooftop' | 'commercial_epc' | 'dealer_wholesale' | null;
  site?: boolean;
  scheme?: 'none' | 'pm_surya_ghar' | 'pm_kusum';
  state?: 'draft' | 'confirmed' | 'cancelled';
  entityId?: number;
}

/** A customer's order of company `entityId`, written as the migrator, with its lead and quote. */
async function makeOrder(options: OrderOptions): Promise<string> {
  const entityId = options.entityId ?? E;
  const account = nextId();
  const site = options.site === false ? null : nextId();
  const order = nextId();
  const state = options.state ?? 'confirmed';
  const owner = manager.id;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'farm', 'projects suite customer', ${owner})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${nextId()}, ${account}, ${entityId}, ${owner}, ${teamId}, ${owner})`;
      if (site !== null) {
        await tx`insert into customer_sites (id, account_id, type, village, created_by)
          values (${site}, ${account}, 'borewell', 'projects suite village', ${owner})`;
      }
      let quote: string | null = null;
      let lead: string | null = null;
      if (options.segment !== null) {
        const index = PIPELINE_SEED.findIndex((p) => p.segment === options.segment);
        const pipeline = PIPELINE_SEED[index];
        if (!pipeline) throw new Error('no pipeline');
        lead = nextId();
        quote = nextId();
        await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${lead}, ${entityId}, ${account}, ${site}, ${pipeline.id}, ${stageId(index + 1, 1)}, ${owner}, ${teamId}, ${owner})`;
        await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id, tier_id,
                   price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal, cgst,
                   sgst, igst, tax_total, round_off, grand_total, created_by)
          values (${quote}, ${entityId}, ${`PS/Q/2098-99/${quote.slice(-4)}`}, '2098-99', ${lead}, ${account},
                  ${site}, ${tierId('dealer')}, ${PRICE_LIST}, ${options.scheme ?? 'none'}, '08', 'intra',
                  now() + interval '15 days', 0, 0, 0, 0, 0, 0, 0, ${owner})`;
      }
      const confirmed = state === 'confirmed';
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, account_type,
                 site_id, tier_id, price_list_id, place_of_supply_state, supply_kind, state, subtotal, cgst, sgst,
                 igst, tax_total, round_off, grand_total, confirmed_at, confirmed_by, cancel_reason, created_by)
        values (${order}, ${entityId}, ${`PS/SO/2098-99/${order.slice(-4)}`}, '2098-99', ${quote}, ${lead},
                ${account}, 'farm', ${site}, ${tierId('dealer')}, ${PRICE_LIST}, '08', 'intra', ${state},
                0, 0, 0, 0, 0, 0, 0, ${confirmed ? new Date() : null}, ${confirmed ? owner : null},
                ${state === 'cancelled' ? 'projects suite' : null}, ${owner})`;
    }),
  );
  return order;
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
): Promise<{ code?: string | undefined; reason?: unknown; stage?: string | undefined }> {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason, stage: failureOf(error)?.stage };
}

const draft = (orderId: string, who: Principal = workers()) =>
  run<DraftProjectDto>(who, draftProject, { entityId: E, orderId });

async function projectsOf(orderId: string): Promise<{ id: string; state: string }[]> {
  return asMigrator(
    (m) =>
      m<{ id: string; state: string }[]>`
      select id::text as id, state from projects where sales_order_id = ${orderId} order by created_at`,
  );
}

const read = (who: Principal, projectId: string) =>
  asPrincipal(who, (context) => readProject(context.tx, E, projectId));

async function eventsOf(aggregateId: string): Promise<string[]> {
  const rows = await asOutboxPublisher(
    (p) => p<{ type: string }[]>`
      select type from outbox_events where aggregate_id = ${aggregateId} order by sequence`,
  );
  return rows.map((r) => r.type);
}

async function draftedId(orderId: string): Promise<string> {
  const result = await draft(orderId);
  if (result.outcome !== 'drafted') throw new Error(`not drafted: ${result.because}`);
  return result.projectId;
}

describe('projects.project.draft: the platform drafts a project from a confirmed order', () => {
  it('drafts each install segment with a site, copying the default steps when no checklist is published', async () => {
    for (const segment of ['farmer_pumps', 'commercial_epc'] as const) {
      const order = await makeOrder({ segment });
      const projectId = await draftedId(order);
      const project = await read(manager, projectId);
      expect(project).toMatchObject({
        salesOrderId: order,
        segment,
        scheme: 'none',
        flow: 'standard',
        state: 'active',
        ownerId: null,
        templateVersionId: null,
      });
      expect(project.projectNo).toMatch(/\/PRJ\/\d{4}-\d{2}\/\d{4}$/);
      expect(project.milestones.map((m) => [m.position, m.key, m.title, m.state])).toEqual(
        WORKSHOP_DEFAULTS.projects.standardSteps.map((key, i) => [i + 1, key, null, 'open']),
      );
      expect(await eventsOf(projectId)).toEqual(['projects.project.drafted']);
    }
  });

  it('drafts nothing for a dealer, an order without a site, an unconfirmed or a cancelled order', async () => {
    const cases = [
      [{ segment: 'dealer_wholesale' }, 'not_install_segment'],
      [{ segment: null }, 'not_install_segment'],
      [{ segment: 'farmer_pumps', site: false }, 'no_site'],
      [{ segment: 'farmer_pumps', state: 'draft' }, 'order_not_confirmed'],
      [{ segment: 'farmer_pumps', state: 'cancelled' }, 'order_not_confirmed'],
    ] as const;
    for (const [options, because] of cases) {
      const order = await makeOrder(options);
      expect({ options, result: await draft(order) }).toEqual({
        options,
        result: { outcome: 'skipped', because },
      });
      expect(await projectsOf(order)).toEqual([]);
    }
  });

  it('drafts once per order: a replay, a delivery beside it, or one after the project was cancelled drafts nothing', async () => {
    const order = await makeOrder({ segment: 'farmer_pumps' });
    const [first, second] = await Promise.all([draft(order), draft(order)]);
    expect([first.outcome, second.outcome].sort()).toEqual(['drafted', 'skipped']);
    expect(await draft(order)).toEqual({ outcome: 'skipped', because: 'already_drafted' });
    const [project] = await projectsOf(order);
    if (!project) throw new Error('no project');
    await run(manager, cancelProject, {
      entityId: E,
      projectId: project.id,
      reason: 'customer withdrew',
    });
    expect(await draft(order)).toEqual({ outcome: 'skipped', because: 'already_drafted' });
    expect((await projectsOf(order)).map((p) => p.state)).toEqual(['cancelled']);
    expect(await eventsOf(project.id)).toEqual([
      'projects.project.drafted',
      'projects.project.cancelled',
    ]);
  });

  it('records the Surya Ghar flow for a PM Surya Ghar sale, with its steps left to the subsidy flow', async () => {
    const order = await makeOrder({ segment: 'residential_rooftop', scheme: 'pm_surya_ghar' });
    const project = await read(manager, await draftedId(order));
    expect(project).toMatchObject({ scheme: 'pm_surya_ghar', flow: 'surya_ghar', milestones: [] });
    expect(
      await failure(manager, completeProject, { entityId: E, projectId: project.id }),
    ).toMatchObject({ code: 'conflict', reason: 'project_subsidy_flow' });
  });

  it('is refused to every person and agent, and to the platform acting in another company', async () => {
    const order = await makeOrder({ segment: 'farmer_pumps' });
    for (const who of [manager, executive, principalFor('agent:orchestrator', [E])]) {
      expect(await failure(who, draftProject, { entityId: E, orderId: order })).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(
      await failure(workers([OTHER]), draftProject, { entityId: E, orderId: order }),
    ).toMatchObject({ code: 'forbidden' });
    expect(await projectsOf(order)).toEqual([]);
  });
});

describe('projects.template.publish: versioned checklists per company and segment', () => {
  const steps = (keys: string[]) =>
    keys.map((key) => ({ key, title: `Step ${key}`, requires: [] }));

  it('a new project copies the newest version, and a running project keeps the one it copied', async () => {
    const v1 = await run<ProjectTemplateDto>(executive, publishProjectTemplate, {
      entityId: E,
      segment: 'residential_rooftop',
      steps: steps(['survey', 'install']),
    });
    const before = await read(
      manager,
      await draftedId(await makeOrder({ segment: 'residential_rooftop' })),
    );
    expect(before.templateVersionId).toBe(v1.id);
    expect(before.milestones.map((m) => [m.key, m.title])).toEqual([
      ['survey', 'Step survey'],
      ['install', 'Step install'],
    ]);
    const v2 = await run<ProjectTemplateDto>(executive, publishProjectTemplate, {
      entityId: E,
      segment: 'residential_rooftop',
      steps: steps(['survey', 'net_meter', 'install']),
    });
    expect(v2.version).toBe(v1.version + 1);
    const after = await read(
      manager,
      await draftedId(await makeOrder({ segment: 'residential_rooftop' })),
    );
    expect(after.templateVersionId).toBe(v2.id);
    expect(after.milestones.map((m) => m.key)).toEqual(['survey', 'net_meter', 'install']);
    // The project drafted before keeps its two steps.
    expect((await read(manager, before.id)).milestones.map((m) => m.key)).toEqual([
      'survey',
      'install',
    ]);
  });

  it('is for the Executive alone, in the companies of the request', async () => {
    const input = { entityId: E, segment: 'farmer_pumps', steps: steps(['survey']) };
    for (const who of [gm, manager]) {
      expect(await failure(who, publishProjectTemplate, input)).toMatchObject({
        code: 'forbidden',
      });
    }
    const elsewhere = principalFor('executive', [OTHER], { id: executive.id });
    expect(await failure(elsewhere, publishProjectTemplate, input)).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await failure(executive, publishProjectTemplate, {
        ...input,
        steps: [...steps(['survey']), ...steps(['survey'])],
      }),
    ).toMatchObject({ code: 'validation_failed' });
  });
});

describe('projects.project.create: a Project Manager makes a project by hand', () => {
  it("makes one for a dealer's confirmed order with the segment named, owned by its maker", async () => {
    const order = await makeOrder({ segment: null, site: false });
    expect(await failure(manager, createProject, { entityId: E, orderId: order })).toMatchObject({
      code: 'validation_failed',
      reason: 'project_segment_missing',
    });
    const project = await run<ProjectDto>(manager, createProject, {
      entityId: E,
      orderId: order,
      segment: 'commercial_epc',
    });
    expect(project).toMatchObject({ segment: 'commercial_epc', ownerId: manager.id, siteId: null });
    expect(
      await failure(manager, createProject, {
        entityId: E,
        orderId: order,
        segment: 'farmer_pumps',
      }),
    ).toMatchObject({ code: 'conflict', reason: 'project_exists' });
  });

  it('refuses an unconfirmed order, and allows a new project once the last was cancelled', async () => {
    const unconfirmed = await makeOrder({ segment: 'farmer_pumps', state: 'draft' });
    expect(
      await failure(manager, createProject, { entityId: E, orderId: unconfirmed }),
    ).toMatchObject({ code: 'validation_failed', reason: 'project_order_not_confirmed' });
    const order = await makeOrder({ segment: 'farmer_pumps' });
    const first = await draftedId(order);
    await run(manager, cancelProject, { entityId: E, projectId: first, reason: 'wrong site' });
    const second = await run<ProjectDto>(manager, createProject, { entityId: E, orderId: order });
    expect(second.id).not.toBe(first);
  });

  it('is refused to a Field Engineer, an agent and a manager of another company', async () => {
    const order = await makeOrder({ segment: 'farmer_pumps' });
    for (const who of [engineer, principalFor('agent:orchestrator', [E])]) {
      expect(await failure(who, createProject, { entityId: E, orderId: order })).toMatchObject({
        code: 'forbidden',
      });
    }
    expect(
      await failure(otherManager, createProject, { entityId: E, orderId: order }),
    ).toMatchObject({ code: 'forbidden' });
    expect(await projectsOf(order)).toEqual([]);
  });
});

describe('the standard flow: steps in order, hold and resume, complete and cancel', () => {
  let projectId: string;

  beforeAll(async () => {
    projectId = await draftedId(await makeOrder({ segment: 'farmer_pumps' }));
  });

  const ref = () => ({ entityId: E, projectId });

  it('people are named by a manager of the company, and an engineer then reads only that project', async () => {
    expect(
      await failure(engineer, assignProject, {
        ...ref(),
        ownerId: null,
        assigneeIds: [engineer.id],
      }),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(manager, assignProject, {
        ...ref(),
        ownerId: manager.id,
        assigneeIds: [otherManager.id],
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'project_person_outside' });
    const assigned = await run<ProjectDto>(manager, assignProject, {
      ...ref(),
      ownerId: manager.id,
      assigneeIds: [engineer.id],
    });
    expect(assigned).toMatchObject({ ownerId: manager.id, assigneeIds: [engineer.id] });
    expect((await read(engineer, projectId)).id).toBe(projectId);
    await expect(read(strangerEngineer, projectId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a step is done only in order, by a manager or the engineer on the project', async () => {
    const [first, second] = WORKSHOP_DEFAULTS.projects.standardSteps;
    expect(
      await failure(manager, completeMilestone, { ...ref(), milestoneKey: second }),
    ).toMatchObject({ code: 'conflict', reason: 'milestone_out_of_order' });
    expect(
      await failure(strangerEngineer, completeMilestone, { ...ref(), milestoneKey: first }),
    ).toMatchObject({ code: 'not_found', reason: 'project_missing' });
    const done = await run<ProjectDto>(engineer, completeMilestone, {
      ...ref(),
      milestoneKey: first,
    });
    expect(done.milestones[0]).toMatchObject({ key: first, state: 'done', doneBy: engineer.id });
    expect(
      await failure(manager, completeMilestone, { ...ref(), milestoneKey: 'no_such_step' }),
    ).toMatchObject({ code: 'not_found', reason: 'milestone_missing' });
    const otherCompany = principalFor('project_manager', [OTHER], { id: manager.id });
    expect(
      await failure(otherCompany, completeMilestone, { ...ref(), milestoneKey: second }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('a manager holds with a reason and resumes; an engineer may do neither', async () => {
    expect(await failure(engineer, holdProject, { ...ref(), reason: 'rain' })).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(manager, holdProject, { ...ref(), reason: ' ' })).toMatchObject({
      code: 'validation_failed',
    });
    const held = await run<ProjectDto>(manager, holdProject, {
      ...ref(),
      reason: 'waiting for rain to stop',
    });
    expect(held).toMatchObject({ state: 'on_hold', holdReason: 'waiting for rain to stop' });
    expect(
      await failure(engineer, completeMilestone, {
        ...ref(),
        milestoneKey: WORKSHOP_DEFAULTS.projects.standardSteps[1],
      }),
    ).toMatchObject({ code: 'conflict', reason: 'project_standard_transition_not_allowed' });
    const resumed = await run<ProjectDto>(manager, resumeProject, ref());
    expect(resumed).toMatchObject({ state: 'active', holdReason: null });
  });

  it('completes only with every step done, then refuses any further move', async () => {
    expect(await failure(manager, completeProject, ref())).toMatchObject({
      code: 'conflict',
      reason: 'milestones_open',
    });
    for (const key of WORKSHOP_DEFAULTS.projects.standardSteps.slice(1)) {
      await run(manager, completeMilestone, { ...ref(), milestoneKey: key });
    }
    const completed = await run<ProjectDto>(manager, completeProject, ref());
    expect(completed.state).toBe('completed');
    expect(await failure(manager, cancelProject, { ...ref(), reason: 'late' })).toMatchObject({
      code: 'conflict',
      reason: 'project_standard_transition_not_allowed',
    });
    const events = await eventsOf(projectId);
    expect(events[0]).toBe('projects.project.drafted');
    expect(events.filter((t) => t === 'projects.project.milestone_completed')).toHaveLength(
      WORKSHOP_DEFAULTS.projects.standardSteps.length,
    );
    expect(events.slice(-1)).toEqual(['projects.project.completed']);
    expect(events).toContain('projects.project.held');
  });

  it('a project of another company is not found, and a request for another company is refused', async () => {
    const elsewhere = await makeOrder({ segment: 'farmer_pumps', entityId: OTHER });
    const theirs = await run<DraftProjectDto>(workers([OTHER]), draftProject, {
      entityId: OTHER,
      orderId: elsewhere,
    });
    if (theirs.outcome !== 'drafted') throw new Error('not drafted');
    expect(
      await failure(manager, holdProject, {
        entityId: OTHER,
        projectId: theirs.projectId,
        reason: 'x',
      }),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(manager, holdProject, {
        entityId: E,
        projectId: theirs.projectId,
        reason: 'x',
      }),
    ).toMatchObject({ code: 'not_found', reason: 'project_missing' });
  });
});

describe('every project command is refused without its grant, and for another company', () => {
  it("refuses a role without the command's grant, and a request naming another company", async () => {
    const order = await makeOrder({ segment: 'farmer_pumps' });
    const projectId = await draftedId(order);
    const ref = { entityId: E, projectId };
    const steps = [{ key: 'survey', title: 'Survey', requires: [] }];
    const cases: [AnyCommand, unknown, Principal, Principal][] = [
      // [command, input, a role without its grant, a role holding it]
      [draftProject, { entityId: E, orderId: order }, manager, workers()],
      [createProject, { entityId: E, orderId: order }, engineer, manager],
      [
        completeMilestone,
        { ...ref, milestoneKey: 'survey' },
        principalFor('accounts', [E]),
        manager,
      ],
      [holdProject, { ...ref, reason: 'rain' }, engineer, manager],
      [resumeProject, ref, engineer, manager],
      [completeProject, ref, engineer, manager],
      [cancelProject, { ...ref, reason: 'withdrawn' }, engineer, manager],
      [assignProject, { ...ref, ownerId: null, assigneeIds: [] }, engineer, manager],
      [publishProjectTemplate, { entityId: E, segment: 'commercial_epc', steps }, gm, executive],
    ];
    for (const [command, input, without, holder] of cases) {
      expect({
        command: command.name,
        refused: await failure(without, command, input),
      }).toMatchObject({
        command: command.name,
        refused: { code: 'forbidden', stage: 'guard' },
      });
      // The same input naming another company, from a holder acting in this one.
      const elsewhere = { ...(input as object), entityId: OTHER };
      expect({
        command: command.name,
        refused: await failure(holder, command, elsewhere),
      }).toMatchObject({
        command: command.name,
        refused: { code: 'forbidden' },
      });
    }
    expect((await projectsOf(order)).map((p) => p.state)).toEqual(['active']);
  });
});
