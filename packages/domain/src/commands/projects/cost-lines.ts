import {
  AddCostLineInput,
  CostLineDto,
  DomainError,
  newId,
  ReverseCostLineInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { costLineAmount, quantityText } from '../../projects/cost-amount';
import { toScaled } from '../../money/paise';
import { toCostLineDtos } from '../../queries/projects/cost-read';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * A project's labour, contractor and other direct charges (docs/03-roadmap-appendix/phase4.md
 * §7.3, question 10 (a), PRD PRJ-05): written by a person holding `finance.cost.read` who also
 * writes the project, and never changed afterwards; a correction is a reversal line. Restricted:
 * the audit row names the line's id and kind only (its input too: `auditInput`), no event is
 * raised, and the answer is the strict `CostLineDto`, which only a holder of the cost grant
 * receives.
 */

const COST_AUDIT_FIELDS = ['costKind', 'reversedLineId'] as const;

/** Whose names the constraints and the guard raise, as catalogue reasons. */
const COST_CONSTRAINTS = {
  project_cost_lines_contractor_check: 'cost_vendor_not_contractor',
  project_cost_lines_reverses_unique: 'cost_line_reversed',
  project_cost_lines_reversal_check: 'cost_line_reversed',
} as const;

const COST_GRANTS = {
  permission: 'finance.cost.read',
  minScope: 'entity',
  alsoRequires: [{ permission: 'projects.write', minScope: 'own' }],
  peopleOnly: true,
} as const;

/** The project of a company as the caller reads it, or `project_missing`. */
async function readProjectRef(
  ctx: CommandContext,
  entityId: number,
  projectId: string,
): Promise<{ id: string; entityId: number }> {
  requireEntity(ctx, entityId);
  const p = schema.projects;
  const [row] = await ctx.tx
    .select({ id: p.id, entityId: p.entityId })
    .from(p)
    .where(and(eq(p.id, projectId), eq(p.entityId, entityId)))
    .limit(1);
  if (!row) throw new DomainError('not_found', 'project not found', { reason: 'project_missing' });
  return row;
}

/** `projects.cost.add`: a charge on a project, its amount the quantity times the rate. */
export const addCostLine = defineCommand({
  name: 'projects.cost.add',
  ...COST_GRANTS,
  input: AddCostLineInput,
  output: CostLineDto,
  // The audit row keeps which line was asked for, never its quantity, rate or note.
  auditInput: ({ entityId, projectId, kind, vendorId }) => ({
    entityId,
    projectId,
    kind,
    vendorId,
  }),
  auditFields: [...COST_AUDIT_FIELDS],
  constraintReasons: COST_CONSTRAINTS,
  async handler(ctx, input) {
    const project = await readProjectRef(ctx, input.entityId, input.projectId);
    const { quantity, amount } = costLineAmount(input.quantity, input.rate);
    const [row] = await ctx.tx
      .insert(schema.projectCostLines)
      .values({
        id: newId(),
        entityId: project.entityId,
        projectId: project.id,
        kind: input.kind,
        vendorId: input.vendorId,
        quantity,
        rate: input.rate,
        amount,
        note: input.note,
        createdAt: ctx.now,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'the cost line insert returned no row');
    ctx.audit({
      aggregateType: 'project_cost_line',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: { costKind: row.kind },
    });
    const [dto] = await toCostLineDtos(ctx.tx, [row], new Map());
    if (!dto) throw new Error('unreachable');
    return dto;
  },
});

/**
 * `projects.cost.reverse`: a line taken back by a reversal line of the same kind, contractor and
 * rate with the quantity and amount negated. A line is reversed once, and a reversal is not.
 */
export const reverseCostLine = defineCommand({
  name: 'projects.cost.reverse',
  ...COST_GRANTS,
  input: ReverseCostLineInput,
  output: CostLineDto,
  auditInput: ({ entityId, lineId }) => ({ entityId, lineId }),
  auditFields: [...COST_AUDIT_FIELDS],
  constraintReasons: COST_CONSTRAINTS,
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const l = schema.projectCostLines;
    const [line] = await ctx.tx
      .select()
      .from(l)
      .where(and(eq(l.id, input.lineId), eq(l.entityId, input.entityId)))
      .limit(1);
    if (!line) {
      throw new DomainError('not_found', 'cost line not found', { reason: 'cost_line_missing' });
    }
    if (line.reversesId !== null) {
      throw new DomainError('conflict', 'a reversal is not reversed', {
        reason: 'cost_line_is_reversal',
      });
    }
    const [already] = await ctx.tx
      .select({ id: l.id })
      .from(l)
      .where(eq(l.reversesId, line.id))
      .limit(1);
    if (already) {
      throw new DomainError('conflict', 'the line is already reversed', {
        reason: 'cost_line_reversed',
      });
    }
    const amount = line.amount.startsWith('-') ? line.amount.slice(1) : `-${line.amount}`;
    const [row] = await ctx.tx
      .insert(l)
      .values({
        id: newId(),
        entityId: line.entityId,
        projectId: line.projectId,
        kind: line.kind,
        vendorId: line.vendorId,
        quantity: quantityText(-toScaled(line.quantity, 3)),
        rate: line.rate,
        amount,
        note: input.note,
        reversesId: line.id,
        createdAt: ctx.now,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'the reversal insert returned no row');
    ctx.audit({
      aggregateType: 'project_cost_line',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: { costKind: row.kind, reversedLineId: line.id },
    });
    const [dto] = await toCostLineDtos(ctx.tx, [row], new Map());
    if (!dto) throw new Error('unreachable');
    return dto;
  },
});
