import {
  ChecklistsDto,
  ChecklistsInput,
  DomainError,
  ProjectQcDto,
  ProjectQcInput,
  ProjectSegmentSchema,
  ProjectStepsSchema,
  type ChecklistDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { parseQueryInput } from '../parse-input';
import { readMilestones } from './project-dto';
import { newestChecklist, toInspectionDtos } from './qc-read';

/**
 * The reads of the QC tab and Settings › Checklists (J6, docs/03-roadmap-appendix/phase4.md §7.3),
 * as the caller under row security: a project's inspections are read with the project, a
 * company's checklists by any holder of `projects.read` there.
 */

type QcReadContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function requireCompany(ctx: QcReadContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * The project page's QC tab: each step that has a checklist now or had an inspection, in the
 * checklist's order, with the checklist a new inspection is filled on and the step's inspections,
 * newest first. Not found when the caller does not read the project.
 */
export async function projectQc(ctx: QcReadContext, rawInput: unknown): Promise<ProjectQcDto> {
  const input = parseQueryInput(ProjectQcInput, rawInput, 'projects.qc.get');
  checkPermission(ctx.principal, 'projects.read', 'own');
  requireCompany(ctx, input.entityId);
  const p = schema.projects;
  const [project] = await ctx.tx
    .select({ id: p.id, entityId: p.entityId, segment: p.segment })
    .from(p)
    .where(and(eq(p.id, input.projectId), eq(p.entityId, input.entityId)))
    .limit(1);
  if (!project) {
    throw new DomainError('not_found', 'project not found', { reason: 'project_missing' });
  }
  const segment = ProjectSegmentSchema.parse(project.segment);
  const i = schema.qcInspections;
  const [milestones, inspectionRows] = await Promise.all([
    readMilestones(ctx.tx, project.id),
    ctx.tx
      .select()
      .from(i)
      .where(eq(i.projectId, project.id))
      .orderBy(desc(i.submittedAt), desc(i.id)),
  ]);
  const inspections = await toInspectionDtos(ctx.tx, inspectionRows);
  const steps = [];
  for (const m of milestones) {
    const checklist = await newestChecklist(ctx.tx, project.entityId, segment, m.key);
    const current = checklist !== null && checklist.items.length > 0 ? checklist : null;
    const own = inspections.filter((x) => x.milestoneId === m.id);
    if (current === null && own.length === 0) continue;
    steps.push({
      milestoneId: m.id,
      key: m.key,
      title: m.title,
      state: m.state,
      checklist: current,
      inspections: own,
    });
  }
  const ids = [
    ...new Set(
      inspections.flatMap((x) => (x.decidedBy === null ? [x.submittedBy] : [x.submittedBy, x.decidedBy])),
    ),
  ];
  const people =
    ids.length === 0
      ? []
      : await ctx.tx
          .select({ id: schema.principals.id, name: schema.principals.displayName })
          .from(schema.principals)
          .where(inArray(schema.principals.id, ids))
          .orderBy(asc(schema.principals.displayName));
  return ProjectQcDto.parse({ steps, people });
}

/**
 * Settings › Checklists: for each segment, the steps of the company's current flow template (else
 * the default steps) and any step a checklist was published for, each with its current checklist
 * and how many versions it had.
 */
export async function listChecklists(
  ctx: QcReadContext,
  rawInput: unknown,
): Promise<ChecklistsDto> {
  const input = parseQueryInput(ChecklistsInput, rawInput, 'projects.checklist.list');
  checkPermission(ctx.principal, 'projects.read', 'own');
  requireCompany(ctx, input.entityId);
  const t = schema.projectFlowTemplates;
  const c = schema.checklists;
  const counts = await ctx.tx
    .select({ segment: c.segment, stepKey: c.stepKey, versions: count() })
    .from(c)
    .where(eq(c.entityId, input.entityId))
    .groupBy(c.segment, c.stepKey);
  const segments = await Promise.all(
    ProjectSegmentSchema.options.map(async (segment) => {
      const [template] = await ctx.tx
        .select({ steps: t.stepsJson })
        .from(t)
        .where(and(eq(t.entityId, input.entityId), eq(t.segment, segment)))
        .orderBy(desc(t.version))
        .limit(1);
      const planned =
        template === undefined
          ? WORKSHOP_DEFAULTS.projects.standardSteps.map((key) => ({ key, title: null }))
          : ProjectStepsSchema.parse(template.steps).map((s) => ({ key: s.key, title: s.title }));
      const extra = counts
        .filter((n) => n.segment === segment && !planned.some((s) => s.key === n.stepKey))
        .map((n) => ({ key: n.stepKey, title: null }));
      const steps = await Promise.all(
        [...planned, ...extra].map(async (step) => {
          const current: ChecklistDto | null = await newestChecklist(
            ctx.tx,
            input.entityId,
            segment,
            step.key,
          );
          return {
            key: step.key,
            title: step.title,
            current: current !== null && current.items.length > 0 ? current : null,
            versions:
              counts.find((n) => n.segment === segment && n.stepKey === step.key)?.versions ?? 0,
          };
        }),
      );
      return { segment, steps };
    }),
  );
  return ChecklistsDto.parse({ segments });
}

