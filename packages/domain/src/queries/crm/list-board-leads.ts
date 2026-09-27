import {
  BoardLeadDto,
  DomainError,
  LeadBoardDto,
  ListBoardLeadsInput,
  OpportunityStateSchema,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';
import { scopeFilter } from './list-leads';

type BoardContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** Cards per stage: a column past this shows its count and the newest cards. */
export const BOARD_CARDS_PER_STAGE = 100;

/**
 * The leads board of one pipeline (DESIGN.md §6): per stage, how many leads the caller can see
 * under the status filter, and the newest `BOARD_CARDS_PER_STAGE` of them with only what a card
 * shows. RLS decides the rows; `scopeFilter` only lets the owner and team indexes serve an own or
 * team reader (AUDIT M33). The cards are found on `opportunities` alone and their customers,
 * sites and owners fetched after for that bounded set (AUDIT M31).
 */
export async function listBoardLeads(ctx: BoardContext, rawInput: unknown): Promise<LeadBoardDto> {
  const input = parseQueryInput(ListBoardLeadsInput, rawInput, 'crm.lead.board');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  if (input.entityId !== undefined && !ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const entityIds = input.entityId === undefined ? [...ctx.entityIds] : [input.entityId];

  const p = schema.pipelines;
  const [pipeline] = await ctx.tx
    .select({ id: p.id, entityId: p.entityId })
    .from(p)
    .where(and(eq(p.key, input.pipelineKey), eq(p.isActive, true), isNull(p.archivedAt)))
    .limit(1);
  if (
    pipeline === undefined ||
    (pipeline.entityId !== null && !entityIds.includes(pipeline.entityId))
  ) {
    throw new DomainError('not_found', `pipeline ${input.pipelineKey} is not visible`, {
      reason: 'lead_pipeline_missing',
    });
  }

  const o = schema.opportunities;
  const where = and(
    isNull(o.archivedAt),
    eq(o.pipelineId, pipeline.id),
    inArray(o.entityId, entityIds),
    inArray(o.state, input.states),
    scopeFilter(ctx),
  );

  const counts = await ctx.tx
    .select({ stageId: o.stageId, count: sql<number>`count(*)::int` })
    .from(o)
    .where(where)
    .groupBy(o.stageId);

  const ranked = ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      stageId: o.stageId,
      state: o.state,
      accountId: o.accountId,
      siteId: o.siteId,
      ownerId: o.ownerId,
      stateChangedAt: o.stateChangedAt,
      updatedAt: o.updatedAt,
      rank: sql<number>`row_number() over (partition by ${o.stageId} order by ${o.updatedAt} desc, ${o.id} desc)`.as(
        'rank',
      ),
    })
    .from(o)
    .where(where)
    .as('ranked');
  const rows = await ctx.tx
    .select()
    .from(ranked)
    .where(lte(ranked.rank, BOARD_CARDS_PER_STAGE))
    .orderBy(desc(ranked.updatedAt), desc(ranked.id));

  // One transaction answers one statement at a time, so these run in turn.
  const customers = await namesOf(
    ctx,
    rows.map((r) => r.accountId),
  );
  const villages = await villagesOf(
    ctx,
    rows.flatMap((r) => (r.siteId === null ? [] : [r.siteId])),
  );
  const owners = await ownersOf(
    ctx,
    rows.flatMap((r) => (r.ownerId === null ? [] : [r.ownerId])),
  );

  return LeadBoardDto.parse({
    pipelineId: pipeline.id,
    counts: counts.map((c) => ({ stageId: c.stageId, count: c.count })),
    perStage: BOARD_CARDS_PER_STAGE,
    // A lead's customer is always readable to whoever reads the lead (AUDIT M25); one that is
    // not is left out rather than shown half-empty, as the leads list does.
    items: rows.flatMap((r) => {
      const customerName = customers.get(r.accountId);
      if (customerName === undefined) return [];
      return [
        BoardLeadDto.parse({
          id: r.id,
          entityId: r.entityId,
          stageId: r.stageId,
          state: OpportunityStateSchema.parse(r.state),
          customerName,
          village: r.siteId === null ? null : (villages.get(r.siteId) ?? null),
          ownerId: r.ownerId,
          ownerName: r.ownerId === null ? null : (owners.get(r.ownerId) ?? null),
          stateChangedAt: r.stateChangedAt.toISOString(),
          // No SLA rules exist yet (they arrive with the tele-calling queues in Phase 1).
          sla: null,
          updatedAt: r.updatedAt.toISOString(),
        }),
      ];
    }),
  });
}

async function namesOf(ctx: BoardContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const a = schema.accounts;
  const rows = await ctx.tx
    .select({ id: a.id, name: a.name })
    .from(a)
    .where(inArray(a.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function villagesOf(
  ctx: BoardContext,
  ids: readonly string[],
): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const cs = schema.customerSites;
  const rows = await ctx.tx
    .select({ id: cs.id, village: cs.village })
    .from(cs)
    .where(inArray(cs.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.village]));
}

/** Owners by their display name; every signed-in person may read names (principals_read). */
async function ownersOf(ctx: BoardContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const pr = schema.principals;
  const rows = await ctx.tx
    .select({ id: pr.id, name: pr.displayName })
    .from(pr)
    .where(inArray(pr.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}
