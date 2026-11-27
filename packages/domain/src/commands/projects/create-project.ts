import {
  CreateProjectInput,
  DomainError,
  DraftProjectDto,
  DraftProjectInput,
  newId,
  ProjectDto,
  type ProjectSegment,
  type SubsidyScheme,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { nextDocumentNo } from '../../numbering/next-document-no';
import {
  draftDecision,
  flowOf,
  installSegment,
  orderConfirmed,
  schemeOf,
  type OrderFacts,
} from '../../projects/draft-decision';
import { readProject } from '../../queries/projects/project-dto';
import { transition, type Actor } from '../../state-machines/define-machine';
import { projectStandardMachine } from '../../state-machines/machines/project-standard';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { requireEntity } from '../crm/opportunity-shared';
import { PROJECT_AUDIT_FIELDS, personActor } from './project-shared';

/** What `app.project_order_facts()` answers about an order of the company, if it is one. */
async function orderFacts(
  ctx: CommandContext,
  entityId: number,
  orderId: string,
): Promise<OrderFacts | undefined> {
  const [row] = (await ctx.tx.execute(
    sql`select order_state, account_id, site_id, segment, scheme, entity_code, projects,
               live_project_id
          from app.project_order_facts(${entityId}::smallint, ${orderId}::uuid)`,
  )) as unknown as {
    order_state: string;
    account_id: string;
    site_id: string | null;
    segment: string | null;
    scheme: string;
    entity_code: string;
    projects: number;
    live_project_id: string | null;
  }[];
  if (!row) return undefined;
  return {
    orderState: row.order_state,
    accountId: row.account_id,
    siteId: row.site_id,
    segment: row.segment,
    scheme: row.scheme,
    entityCode: row.entity_code,
    projects: row.projects,
    liveProjectId: row.live_project_id,
  };
}

/** The workshop's default steps, as `app.create_project()` copies them with no title. */
const DEFAULT_STEPS = JSON.stringify(
  WORKSHOP_DEFAULTS.projects.standardSteps.map((key) => ({ key, requires: [] })),
);

/** Raised inside the savepoint when the order already had its project, so its number goes back. */
class AlreadyDrafted extends Error {}

interface NewProject {
  entityId: number;
  orderId: string;
  facts: OrderFacts;
  segment: ProjectSegment;
  scheme: SubsidyScheme;
  actor: Actor;
  /** The person who made it, or null for the platform's draft. */
  ownerId: string | null;
  /** The platform's drafting: an order that ever had a project gets none. */
  oncePerOrder: boolean;
}

/**
 * Makes the project (the `project_standard` machine's `create` and `copy_checklist`): its number
 * from the company's series, then `app.create_project()`, which locks the order and copies the
 * checklist. Both run in a savepoint, so a number drawn for an order that turned out to have its
 * project already goes back to the series. Undefined when it had one; the command emits
 * `projects.project.drafted` for a project made.
 */
async function makeProject(ctx: CommandContext, p: NewProject): Promise<string | undefined> {
  transition(projectStandardMachine, { state: null, milestones: [] }, 'create', {
    actor: p.actor,
    now: ctx.now,
    params: {},
  });
  const id = newId();
  const flow = flowOf(p.scheme);
  try {
    const made = await ctx.savepoint(async (tx) => {
      const number = await nextDocumentNo(
        { tx, now: ctx.now },
        p.entityId,
        p.facts.entityCode,
        'project',
      );
      const [result] = (await tx.execute(
        sql`select created, template_version_id, milestones
              from app.create_project(${id}::uuid, ${p.entityId}::smallint, ${p.orderId}::uuid,
                                      ${number.formatted}, ${number.fy}, ${p.segment}, ${p.scheme},
                                      ${p.ownerId}::uuid, ${DEFAULT_STEPS}::jsonb, ${p.oncePerOrder})`,
      )) as unknown as {
        created: boolean;
        template_version_id: string | null;
        milestones: number;
      }[];
      if (result?.created !== true) throw new AlreadyDrafted();
      return {
        projectNo: number.formatted,
        templateVersionId: result.template_version_id,
        milestones: result.milestones,
      };
    });
    ctx.audit({
      aggregateType: 'project',
      aggregateId: id,
      entityId: p.entityId,
      before: null,
      after: {
        projectNo: made.projectNo,
        projectState: 'active',
        segment: p.segment,
        scheme: p.scheme,
        flow,
        templateVersionId: made.templateVersionId,
        milestones: made.milestones,
      },
    });
    return id;
  } catch (error) {
    if (error instanceof AlreadyDrafted) return undefined;
    throw error;
  }
}

const CREATE_CONSTRAINTS = {
  projects_sales_order_live_unique: 'project_exists',
  project_order_not_confirmed: 'project_order_not_confirmed',
} as const;

/**
 * `projects.project.draft` (docs/03-roadmap-appendix/phase4.md §6.1, question 1 (a)): the
 * platform's project for an order just confirmed (`sales.order.confirmed`), run by the event
 * worker as `system:workers`, which holds the platform-only `projects.draft` and reads the order
 * and makes the project only through `app.project_order_facts()` and `app.create_project()`
 * (ADR 0020). It drafts only a confirmed order of an install segment with a site, snapshots the
 * lead's segment and the quote's scheme, and copies the company's newest checklist of the segment,
 * else the workshop's default steps; a PM Surya Ghar project's steps come with the subsidy flow
 * (J4). Once per order: an order that ever had a project, even a cancelled one, gets no draft, so
 * a replayed event drafts nothing twice. No person or agent holds `projects.draft`.
 */
export const draftProject = defineCommand({
  name: 'projects.project.draft',
  permission: 'projects.draft',
  minScope: 'entity',
  input: DraftProjectInput,
  output: DraftProjectDto,
  auditFields: [...PROJECT_AUDIT_FIELDS],
  // Run for every confirmed order: a call that drafted nothing leaves no audit row.
  auditWhen: 'changed',
  constraintReasons: CREATE_CONSTRAINTS,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await orderFacts(ctx, input.entityId, input.orderId);
    const decision = draftDecision(facts);
    if (!decision.draft) return { outcome: 'skipped' as const, because: decision.because };
    if (facts === undefined) throw new DomainError('internal', 'a draft needs its order');
    const projectId = await makeProject(ctx, {
      entityId: input.entityId,
      orderId: input.orderId,
      facts,
      segment: decision.segment,
      scheme: decision.scheme,
      actor: { kind: 'system', job: 'project-drafting' },
      ownerId: null,
      oncePerOrder: true,
    });
    if (projectId === undefined) {
      return { outcome: 'skipped' as const, because: 'already_drafted' as const };
    }
    ctx.emit({
      type: 'projects.project.drafted',
      entityId: input.entityId,
      aggregateType: 'project',
      aggregateId: projectId,
      payload: { salesOrderId: input.orderId, accountId: facts.accountId },
    });
    return { outcome: 'drafted' as const, projectId };
  },
});

/**
 * `projects.project.create` (docs/03-roadmap-appendix/phase4.md §6.1): a Project Manager or
 * General Manager (`projects.write` for the company) makes the project of any confirmed order of
 * the company, with the order's lead's segment, or the one they name when that is no install
 * segment (a dealer's order), and becomes its owner. An order has one project that is not
 * cancelled. People only: no agent makes a project.
 */
export const createProject = defineCommand({
  name: 'projects.project.create',
  permission: 'projects.write',
  minScope: 'entity',
  peopleOnly: true,
  input: CreateProjectInput,
  output: ProjectDto,
  auditFields: [...PROJECT_AUDIT_FIELDS],
  constraintReasons: CREATE_CONSTRAINTS,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await orderFacts(ctx, input.entityId, input.orderId);
    if (facts === undefined) {
      throw new DomainError('not_found', 'order not found', { reason: 'order_missing' });
    }
    if (!orderConfirmed(facts.orderState)) {
      throw new DomainError('validation_failed', 'the order is not confirmed', {
        reason: 'project_order_not_confirmed',
      });
    }
    if (facts.liveProjectId !== null) {
      throw new DomainError('conflict', 'the order has its project', { reason: 'project_exists' });
    }
    const segment = installSegment(facts.segment) ?? input.segment;
    if (segment === null) {
      throw new DomainError('validation_failed', 'the project needs a segment', {
        reason: 'project_segment_missing',
      });
    }
    const projectId = await makeProject(ctx, {
      entityId: input.entityId,
      orderId: input.orderId,
      facts,
      segment,
      scheme: schemeOf(facts),
      actor: personActor(ctx),
      ownerId: ctx.principal.id,
      oncePerOrder: false,
    });
    if (projectId === undefined) throw new DomainError('internal', 'the project was not made');
    ctx.emit({
      type: 'projects.project.drafted',
      entityId: input.entityId,
      aggregateType: 'project',
      aggregateId: projectId,
      payload: { salesOrderId: input.orderId, accountId: facts.accountId },
    });
    return readProject(ctx.tx, input.entityId, projectId);
  },
});
