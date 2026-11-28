import {
  AccountProjectsInput,
  GetProjectInput,
  hasGrant,
  ListProjectsInput,
  OrderProjectDto,
  OrderProjectInput,
  ProjectFiltersDto,
  ProjectFiltersInput,
  ProjectPageDto,
  ProjectPeopleDto,
  ProjectPeopleInput,
  ProjectRowDto,
  ProjectStepsSchema,
  ProjectTemplatesDto,
  ProjectTemplatesInput,
  ProjectSegmentSchema,
  ProjectViewDto,
  DomainError,
  type ProjectSegment,
  type ProjectState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, count, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { parseQueryInput } from '../parse-input';
import { readProject } from './project-dto';

type ProjectReadContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** `/projects` reads the newest change first by `(updated_at, id)`. */
const PROJECT_SORT_KEYS: SortKeys<'updated'> = {
  updated: { expr: schema.projects.updatedAt, type: 'timestamptz', nullable: false },
};
const projectOrder = () =>
  keysetOrder(PROJECT_SORT_KEYS, schema.projects.id, undefined, {
    column: 'updated',
    direction: 'desc',
  });

function requireCompany(ctx: ProjectReadContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/** Every project screen needs `projects.read` at some scope; row security decides the rows. */
function checkProjectRead(ctx: ProjectReadContext): void {
  checkPermission(ctx.principal, 'projects.read', 'own');
}

/** A project's current step: the first one still open, in checklist order. */
const currentStep = (projectId: SQL | typeof schema.projects.id) => sql`(
  select jsonb_build_object('key', m.key, 'title', m.title)
    from ${schema.projectMilestones} m
   where m.project_id = ${projectId} and m.state = 'open'
   order by m.position
   limit 1)`;

interface CustomerFacts {
  accountName: string;
  village: string | null;
  district: string | null;
}

/**
 * The customer and the village of the projects named (`app.project_customers()`), which a Field
 * Engineer reads for the projects they are on although not the customer row itself.
 */
async function customersOf(
  ctx: ProjectReadContext,
  ids: readonly string[],
): Promise<Map<string, CustomerFacts>> {
  if (ids.length === 0) return new Map();
  const rows = (await ctx.tx.execute(
    sql`select project_id, account_name, village, district
          from app.project_customers(${`{${ids.join(',')}}`}::uuid[])`,
  )) as unknown as {
    project_id: string;
    account_name: string;
    village: string | null;
    district: string | null;
  }[];
  return new Map(
    rows.map((r) => [
      r.project_id,
      { accountName: r.account_name, village: r.village, district: r.district },
    ]),
  );
}

const ROW_COLUMNS = {
  id: schema.projects.id,
  entityId: schema.projects.entityId,
  projectNo: schema.projects.projectNo,
  segment: schema.projects.segment,
  scheme: schema.projects.scheme,
  flow: schema.projects.flow,
  state: schema.projects.state,
  updatedAt: schema.projects.updatedAt,
  // A scalar read per listed row, not a join the planner may loop over the scanned rows.
  ownerName: sql<
    string | null
  >`(select o.display_name from ${schema.principals} o where o.id = ${schema.projects.ownerId})`,
  step: sql<{ key: string; title: string | null } | null>`${currentStep(schema.projects.id)}`,
};

interface ListedRow {
  id: string;
  entityId: number;
  projectNo: string;
  segment: string;
  scheme: string;
  flow: string;
  state: string;
  updatedAt: Date;
  ownerName: string | null;
  step: { key: string; title: string | null } | null;
}

async function toRows(ctx: ProjectReadContext, rows: readonly ListedRow[]) {
  const customers = await customersOf(
    ctx,
    rows.map((r) => r.id),
  );
  return rows.map((r) =>
    ProjectRowDto.parse({
      id: r.id,
      entityId: r.entityId,
      projectNo: r.projectNo,
      customerName: customers.get(r.id)?.accountName ?? null,
      village: customers.get(r.id)?.village ?? null,
      segment: r.segment,
      scheme: r.scheme,
      flow: r.flow,
      state: r.state,
      ownerName: r.ownerName,
      stepKey: r.step?.key ?? null,
      stepTitle: r.step?.title ?? null,
      updatedAt: new Date(r.updatedAt).toISOString(),
    }),
  );
}

/**
 * `/projects` (docs/03-roadmap-appendix/phase4.md §6.1): one company's projects the caller reads,
 * newest change first, by state, owner, segment and current step, a keyset page at a time on
 * `projects_entity_state_updated_idx`. A caller reading at `own` scope only (a Field Engineer, a
 * Lead Converter) is led by their own projects, found first (`ownProjectIds()`) and named by id in
 * the list's query: an index condition runs ahead of the row policy, whose `own` predicate
 * (`app.project_is_mine()`, once per row) then runs for those rows only, not for every project of
 * the company (tests/spike/projects-explain.ts).
 */
export async function listProjects(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<ProjectPageDto> {
  const input = parseQueryInput(ListProjectsInput, rawInput, 'projects.project.list');
  const only = hasGrant(ctx.principal.permissions, 'projects.read', 'entity')
    ? undefined
    : await ownProjectIds(ctx, input.entityId);
  const rows = (await projectListQuery(ctx, { ...input, only })) as ListedRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return ProjectPageDto.parse({
    items: await toRows(ctx, page),
    nextCursor: nextCursor(
      projectOrder(),
      rows.length > input.limit,
      last === undefined
        ? undefined
        : { value: (last as ListedRow & { sortValue: string }).sortValue, id: last.id },
    ),
  });
}

/**
 * The projects of a company a caller owns or is on (`projects_owner_idx`,
 * `project_assignments_person_idx`), each read under the policies; at most 1,000, those still open
 * (in progress or on hold) first, then the newest change, so a person on many finished projects
 * over the years never loses an open one from their list.
 */
export async function ownProjectIds(ctx: ProjectReadContext, entityId: number): Promise<string[]> {
  const rows = await ownProjectIdsQuery(ctx, entityId);
  return rows.map((r) => r.id);
}

/**
 * The query `ownProjectIds` runs, unexecuted, so its plan can be read
 * (`tests/spike/projects-explain.ts`). Checks the permission and the company first.
 */
export function ownProjectIdsQuery(ctx: ProjectReadContext, entityId: number) {
  checkProjectRead(ctx);
  requireCompany(ctx, entityId);
  const p = schema.projects;
  const a = schema.projectAssignments;
  const me = ctx.principal.id;
  const mine = ctx.tx
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.entityId, entityId), eq(p.ownerId, me)))
    .union(
      ctx.tx
        .select({ id: a.projectId })
        .from(a)
        .where(and(eq(a.entityId, entityId), eq(a.personId, me))),
    );
  return ctx.tx
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.entityId, entityId), inArray(p.id, mine)))
    .orderBy(sql`${p.state} in ('completed', 'cancelled')`, desc(p.updatedAt), desc(p.id))
    .limit(1000);
}

/**
 * The query `listProjects` runs, unexecuted, so its plan can be read
 * (`tests/spike/projects-explain.ts`). Checks the permission and the company first.
 */
export function projectListQuery(
  ctx: ProjectReadContext,
  input: {
    entityId: number;
    state?: ProjectState | undefined;
    segment?: ProjectSegment | undefined;
    ownerId?: string | undefined;
    step?: string | undefined;
    cursor?: string | undefined;
    limit: number;
    /** A caller reading at `own` scope only: their own projects' ids (`ownProjectIds()`). */
    only?: readonly string[] | undefined;
  },
) {
  checkProjectRead(ctx);
  requireCompany(ctx, input.entityId);
  const p = schema.projects;
  const order = projectOrder();
  return ctx.tx
    .select({ ...ROW_COLUMNS, sortValue: sortText(order) })
    .from(p)
    .where(
      and(
        eq(p.entityId, input.entityId),
        input.state === undefined ? undefined : eq(p.state, input.state),
        input.segment === undefined ? undefined : eq(p.segment, input.segment),
        input.ownerId === undefined ? undefined : eq(p.ownerId, input.ownerId),
        input.step === undefined
          ? undefined
          : sql`(${currentStep(p.id)}) ->> 'key' = ${input.step}`,
        input.only === undefined
          ? undefined
          : sql`${p.id} = any(${`{${input.only.join(',')}}`}::uuid[])`,
        afterCursor(order, input.cursor),
      ),
    )
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
}

/**
 * The list's filter choices: the people who own a project the caller reads in the company, and
 * the keys of the steps the company's projects have, the default steps first, each with the
 * newest title the Executive published for it. A caller reading at `own` scope only is led by
 * their own projects (`ownProjectIds()`), named by id, as the list is, so the row policy's `own`
 * predicate runs for those rows only.
 */
export async function listProjectFilters(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<ProjectFiltersDto> {
  const input = parseQueryInput(ProjectFiltersInput, rawInput, 'projects.filters');
  checkProjectRead(ctx);
  requireCompany(ctx, input.entityId);
  const only = hasGrant(ctx.principal.permissions, 'projects.read', 'entity')
    ? undefined
    : await ownProjectIds(ctx, input.entityId);
  const owners = only?.length === 0 ? [] : await projectOwnersQuery(ctx, input.entityId, only);
  const t = schema.projectFlowTemplates;
  const templates = await ctx.tx
    .select({ steps: t.stepsJson })
    .from(t)
    .where(eq(t.entityId, input.entityId))
    .orderBy(desc(t.publishedAt), desc(t.id));
  const titles = new Map<string, string | null>(
    WORKSHOP_DEFAULTS.projects.standardSteps.map((key) => [key, null]),
  );
  const named = new Set<string>();
  // Newest version first: a key takes the first title it is published with.
  for (const row of templates) {
    const parsed = ProjectStepsSchema.safeParse(row.steps);
    if (!parsed.success) continue;
    for (const step of parsed.data) {
      if (named.has(step.key)) continue;
      named.add(step.key);
      titles.set(step.key, step.title);
    }
  }
  return ProjectFiltersDto.parse({
    owners,
    steps: [...titles].map(([key, title]) => ({ key, title })),
  });
}

/**
 * The people who own a project of the company the caller reads, by name; for a caller reading at
 * `own` scope only, of their own projects (`only`), named by id. Unexecuted, so its plan can be
 * read (`tests/spike/projects-explain.ts`).
 */
export function projectOwnersQuery(
  ctx: ProjectReadContext,
  entityId: number,
  only: readonly string[] | undefined,
) {
  const p = schema.projects;
  return ctx.tx
    .selectDistinct({ id: schema.principals.id, name: schema.principals.displayName })
    .from(p)
    .innerJoin(schema.principals, eq(schema.principals.id, p.ownerId))
    .where(
      and(
        eq(p.entityId, entityId),
        only === undefined ? undefined : sql`${p.id} = any(${`{${only.join(',')}}`}::uuid[])`,
      ),
    )
    .orderBy(asc(schema.principals.displayName), asc(schema.principals.id))
    .limit(200);
}

/**
 * The project page: the project with its steps and people, its order's number, its customer and
 * village, and the names of the people it shows. Not found when the caller does not read it.
 */
export async function getProject(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<ProjectViewDto> {
  const input = parseQueryInput(GetProjectInput, rawInput, 'projects.project.get');
  checkProjectRead(ctx);
  requireCompany(ctx, input.entityId);
  const project = await readProject(ctx.tx, input.entityId, input.projectId);
  const customer = (await customersOf(ctx, [project.id])).get(project.id);
  // The order's number, when the caller reads the order (a Project Manager reads it with the lead).
  const [order] = await ctx.tx
    .select({ soNo: schema.salesOrders.soNo })
    .from(schema.salesOrders)
    .where(eq(schema.salesOrders.id, project.salesOrderId))
    .limit(1);
  const ids = [
    ...new Set(
      [project.ownerId, ...project.assigneeIds, ...project.milestones.map((m) => m.doneBy)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const people =
    ids.length === 0
      ? []
      : await ctx.tx
          .select({ id: schema.principals.id, name: schema.principals.displayName })
          .from(schema.principals)
          .where(inArray(schema.principals.id, ids));
  return ProjectViewDto.parse({
    project,
    soNo: order?.soNo ?? null,
    customerName: customer?.accountName ?? null,
    village: customer?.village ?? null,
    district: customer?.district ?? null,
    people,
  });
}

/** Account 360's projects of a customer in one company, newest first (`projects_account_idx`). */
export async function accountProjects(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<ProjectRowDto[]> {
  const input = parseQueryInput(AccountProjectsInput, rawInput, 'projects.account.list');
  checkProjectRead(ctx);
  requireCompany(ctx, input.entityId);
  const p = schema.projects;
  const rows = (await ctx.tx
    .select(ROW_COLUMNS)
    .from(p)
    .where(and(eq(p.accountId, input.accountId), eq(p.entityId, input.entityId)))
    .orderBy(desc(p.createdAt), desc(p.id))
    .limit(20)) as ListedRow[];
  return toRows(ctx, rows);
}

/**
 * The order page's link to its project: the order's project not cancelled, if the caller reads
 * it; null otherwise, and for a caller without `projects.read`.
 */
export async function orderProject(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<OrderProjectDto> {
  const input = parseQueryInput(OrderProjectInput, rawInput, 'projects.order.get');
  requireCompany(ctx, input.entityId);
  if (!hasGrant(ctx.principal.permissions, 'projects.read', 'own')) return null;
  const p = schema.projects;
  const [row] = await ctx.tx
    .select({ id: p.id, projectNo: p.projectNo, state: p.state })
    .from(p)
    .where(
      and(
        eq(p.salesOrderId, input.orderId),
        eq(p.entityId, input.entityId),
        ne(p.state, 'cancelled'),
      ),
    )
    .limit(1);
  return OrderProjectDto.parse(row ?? null);
}

/** Settings › Project steps: each segment's newest checklist of the company and its count. */
export async function listProjectTemplates(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<ProjectTemplatesDto> {
  const input = parseQueryInput(ProjectTemplatesInput, rawInput, 'projects.template.list');
  checkProjectRead(ctx);
  requireCompany(ctx, input.entityId);
  const t = schema.projectFlowTemplates;
  const counts = await ctx.tx
    .select({ segment: t.segment, versions: count() })
    .from(t)
    .where(eq(t.entityId, input.entityId))
    .groupBy(t.segment);
  const segments = await Promise.all(
    ProjectSegmentSchema.options.map(async (segment) => {
      const [current] = await ctx.tx
        .select()
        .from(t)
        .where(and(eq(t.entityId, input.entityId), eq(t.segment, segment)))
        .orderBy(desc(t.version))
        .limit(1);
      return {
        segment,
        versions: counts.find((c) => c.segment === segment)?.versions ?? 0,
        current:
          current === undefined
            ? null
            : {
                id: current.id,
                entityId: current.entityId,
                segment: current.segment,
                version: current.version,
                steps: current.stepsJson,
                publishedAt: current.publishedAt.toISOString(),
                publishedBy: current.publishedBy,
              },
      };
    }),
  );
  return ProjectTemplatesDto.parse({ segments });
}

/** The people with a role in one company, whom a Project Manager may name on a project, by name. */
export async function listProjectPeople(
  ctx: ProjectReadContext,
  rawInput: unknown,
): Promise<ProjectPeopleDto> {
  const input = parseQueryInput(ProjectPeopleInput, rawInput, 'projects.people.list');
  checkPermission(ctx.principal, 'projects.write', 'entity');
  requireCompany(ctx, input.entityId);
  const r = schema.userEntityRoles;
  const who = schema.principals;
  // A person's own users row is theirs alone to read: their name is on their principal row.
  const people = await ctx.tx
    .selectDistinctOn([who.displayName, who.id], {
      id: who.id,
      name: who.displayName,
      roleKey: schema.roles.key,
    })
    .from(r)
    .innerJoin(who, eq(who.id, r.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, r.roleId))
    .where(eq(r.entityId, input.entityId))
    .orderBy(asc(who.displayName), asc(who.id))
    .limit(300);
  return ProjectPeopleDto.parse({ people });
}
