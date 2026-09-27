import {
  DomainError,
  OpportunityDto,
  OpportunityStateSchema,
  type StageKind,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../../command/context';
import { transition, type TransitionResult } from '../../state-machines/define-machine';
import {
  opportunityMachine,
  type OpportunityEvent,
  type OpportunityMachineState,
  type OpportunityParams,
  type OpportunityRecord,
} from '../../state-machines/machines/opportunity';

/**
 * What the six opportunity commands share (docs/design/backend-weeks-3-5.md §7.2): the locked
 * row, the facts the machine's guards read, the one write and the DTO. Every state change goes
 * through `transition()`; a command never sets `state` without it.
 */

export type OpportunityRow = typeof schema.opportunities.$inferSelect;

/** The request must be narrowed to the lead's company, as `crm.lead.create` is. */
export function requireEntity(ctx: CommandContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * The lead, locked for this transaction. A lead the caller cannot read, one of another company
 * or an archived one is not found: RLS decides what the caller sees.
 */
export async function lockOpportunity(
  ctx: CommandContext,
  input: { entityId: number; opportunityId: string },
): Promise<OpportunityRow> {
  const o = schema.opportunities;
  const [row] = await ctx.tx
    .select()
    .from(o)
    .where(and(eq(o.id, input.opportunityId), eq(o.entityId, input.entityId), isNull(o.archivedAt)))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }
  return row;
}

/** `stage_exit_rules_json`: `{ "requiredFields": [...] }`; `{}` requires nothing. */
const ExitRules = z.object({ requiredFields: z.array(z.string()).max(20).optional() }).loose();

/** The facts the opportunity machine's guards read, loaded under the caller's own policies. */
export async function opportunityRecord(
  ctx: CommandContext,
  row: OpportunityRow,
): Promise<OpportunityRecord> {
  const [stage] = await ctx.tx
    .select({ rules: schema.pipelineStages.stageExitRulesJson })
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.id, row.stageId))
    .limit(1);
  const rules = ExitRules.safeParse(stage?.rules ?? {});
  if (!rules.success) {
    throw new DomainError('internal', `stage ${row.stageId} has exit rules that cannot be read`);
  }
  const cs = schema.customerSites;
  const [site] =
    row.siteId === null
      ? []
      : await ctx.tx
          .select({ village: cs.village, pin: cs.pin, stateCode: cs.stateCode })
          .from(cs)
          .where(eq(cs.id, row.siteId))
          .limit(1);
  return {
    state: OpportunityStateSchema.parse(row.state),
    pipelineId: row.pipelineId,
    exitRequiredFields: rules.data.requiredFields ?? [],
    fields: {
      site: row.siteId,
      village: site?.village ?? null,
      pin: site?.pin ?? null,
      stateCode: site?.stateCode ?? null,
      source: row.sourceId,
    },
    lockedUntil: row.lockedUntil,
    stateChangedAt: row.stateChangedAt,
    // Quotes and sales orders arrive in Phase 1; until then no lead can be won.
    hasAcceptedQuoteOrConfirmedOrder: false,
  };
}

/** Fires `event` on the lead as the caller: illegal moves, permission and guards in one place. */
export function fire(
  ctx: CommandContext,
  record: OpportunityRecord,
  event: OpportunityEvent,
  params: OpportunityParams = {},
): TransitionResult<OpportunityMachineState, OpportunityEvent> {
  return transition(opportunityMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params,
  });
}

/** The first stage of a kind in the pipeline, by position; archived stages are skipped. */
export async function firstStage(
  ctx: CommandContext,
  pipelineId: string,
  kind: StageKind,
): Promise<{ id: string; key: string } | undefined> {
  const ps = schema.pipelineStages;
  const [stage] = await ctx.tx
    .select({ id: ps.id, key: ps.key })
    .from(ps)
    .where(and(eq(ps.pipelineId, pipelineId), eq(ps.kind, kind), isNull(ps.archivedAt)))
    .orderBy(asc(ps.position))
    .limit(1);
  return stage;
}

type OpportunityChange = Partial<
  Pick<
    OpportunityRow,
    'state' | 'stateChangedAt' | 'stageId' | 'ownerId' | 'teamId' | 'lockedUntil'
  >
>;

/**
 * The one write of a transition. The update policy asks for `crm.lead.write` at the row's scope
 * before and after, so a lead outside the caller's write scope, or handed to someone outside it,
 * is refused here.
 */
export async function writeOpportunity(
  ctx: CommandContext,
  row: OpportunityRow,
  change: OpportunityChange,
): Promise<OpportunityRow> {
  const o = schema.opportunities;
  const [updated] = await ctx.tx
    .update(o)
    .set({ ...change, updatedBy: ctx.principal.id })
    .where(eq(o.id, row.id))
    .returning();
  if (!updated) {
    throw new DomainError('forbidden', `opportunity ${row.id} is outside the caller's write scope`);
  }
  return updated;
}

/** Records the change of one lead: the fields it had and the fields it has now. */
export function auditOpportunity(
  ctx: CommandContext,
  row: OpportunityRow,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  ctx.audit({
    aggregateType: 'opportunity',
    aggregateId: row.id,
    entityId: row.entityId,
    before,
    after,
  });
}

/** Whitelists what an opportunity command answers (AGENTS.md §5). */
export function toOpportunityDto(row: OpportunityRow): OpportunityDto {
  return OpportunityDto.parse({
    id: row.id,
    entityId: row.entityId,
    pipelineId: row.pipelineId,
    stageId: row.stageId,
    state: row.state,
    stateChangedAt: row.stateChangedAt.toISOString(),
    ownerId: row.ownerId,
    teamId: row.teamId,
    lockedUntil: row.lockedUntil?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}
