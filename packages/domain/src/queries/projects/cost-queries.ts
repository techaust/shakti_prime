import {
  ContractorsDto,
  ContractorsInput,
  DomainError,
  ProjectCostsDto,
  ProjectCostsInput,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { costTotal } from '../../projects/cost-amount';
import { parseQueryInput } from '../parse-input';
import { readProjectCostLines, reversalsOf, toCostLineDtos } from './cost-read';

/**
 * The reads of the project page's Costs tab (J6, docs/03-roadmap-appendix/phase4.md §7.3, PRD
 * PRJ-05): refused without `finance.cost.read` for the company before anything is read, and
 * narrowed again by row security on `project_cost_lines`.
 */

type CostReadContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function requireCostReader(ctx: CostReadContext, entityId: number): void {
  checkPermission(ctx.principal, 'finance.cost.read', 'entity');
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/** A project's cost lines in the order they were added, reversals among them, and their total. */
export async function projectCosts(
  ctx: CostReadContext,
  rawInput: unknown,
): Promise<ProjectCostsDto> {
  const input = parseQueryInput(ProjectCostsInput, rawInput, 'projects.cost.list');
  requireCostReader(ctx, input.entityId);
  const p = schema.projects;
  const [project] = await ctx.tx
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.id, input.projectId), eq(p.entityId, input.entityId)))
    .limit(1);
  if (!project) {
    throw new DomainError('not_found', 'project not found', { reason: 'project_missing' });
  }
  const rows = await readProjectCostLines(ctx.tx, project.id);
  const lines = await toCostLineDtos(ctx.tx, rows, reversalsOf(rows));
  const ids = [...new Set(lines.map((l) => l.createdBy))];
  const people =
    ids.length === 0
      ? []
      : await ctx.tx
          .select({ id: schema.principals.id, name: schema.principals.displayName })
          .from(schema.principals)
          .where(inArray(schema.principals.id, ids))
          .orderBy(asc(schema.principals.displayName));
  return ProjectCostsDto.parse({ lines, total: costTotal(lines.map((l) => l.amount)), people });
}

/** The contractors a charge may name: the group's active vendors of kind contractor, by name. */
export async function listContractors(
  ctx: CostReadContext,
  rawInput: unknown,
): Promise<ContractorsDto> {
  const input = parseQueryInput(ContractorsInput, rawInput, 'projects.cost.contractors');
  requireCostReader(ctx, input.entityId);
  const v = schema.vendors;
  const contractors = await ctx.tx
    .select({ id: v.id, name: v.name })
    .from(v)
    .where(and(eq(v.kind, 'contractor'), eq(v.isActive, true)))
    .orderBy(asc(v.name), asc(v.id))
    .limit(500);
  return ContractorsDto.parse({ contractors });
}
