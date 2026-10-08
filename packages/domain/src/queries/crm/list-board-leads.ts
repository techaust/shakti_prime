import {
  BoardLeadDto,
  BoardStagePageDto,
  DomainError,
  LeadBoardDto,
  ListBoardLeadsInput,
  ListBoardStageLeadsInput,
  OpportunityStateSchema,
  SizingKindSchema,
  type BoardStageCursorDto,
  type OpportunityState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { SIZING_ENGINE_VERSION } from '../../sizing/size';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { parseQueryInput } from '../parse-input';
import { scopeFilter } from './list-leads';

type BoardContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * A board reads each stage newest change first by `(updated_at, id)`, the order of the leads
 * list, so its cursors take the same text form (`keyset-sort.ts`): rows changed in one
 * transaction share a timestamp to the microsecond, and the id keeps their order.
 */
const BOARD_SORT_KEYS: SortKeys<'updated'> = {
  updated: { expr: schema.opportunities.updatedAt, type: 'timestamptz', nullable: false },
};
const boardOrder = () =>
  keysetOrder(BOARD_SORT_KEYS, schema.opportunities.id, undefined, {
    column: 'updated',
    direction: 'desc',
  });

/** What one card is read from, and its place in the stage's order. */
interface CardRow {
  id: string;
  entityId: number;
  stageId: string;
  state: string;
  accountId: string;
  siteId: string | null;
  ownerId: string | null;
  stateChangedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  sortValue: string | null;
}

/**
 * The leads a board shows: the permission, the company, the pipeline and the statuses as one
 * filter. RLS decides the rows; `scopeFilter` only lets the owner and team indexes serve an own
 * or team reader (AUDIT M33).
 */
async function boardScope(
  ctx: BoardContext,
  input: { entityId?: number | undefined; pipelineKey: string; states: OpportunityState[] },
): Promise<{ pipelineId: string; where: SQL | undefined }> {
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
  return {
    pipelineId: pipeline.id,
    where: and(
      isNull(o.archivedAt),
      eq(o.pipelineId, pipeline.id),
      inArray(o.entityId, entityIds),
      inArray(o.state, input.states),
      scopeFilter(ctx),
    ),
  };
}

/**
 * The leads board of one pipeline (docs/08-design-system.md §6): per stage, how many leads the caller can see
 * under the status filter, the newest `limit` of them (`BOARD_PAGE_SIZE` unless asked) with only
 * what a card shows, and for each stage with more, the cursor its "Load more" continues from
 * (`listBoardStageLeads`). The cards are found on `opportunities` alone and their customers,
 * sites and owners fetched after for that bounded set (AUDIT M31).
 */
export async function listBoardLeads(ctx: BoardContext, rawInput: unknown): Promise<LeadBoardDto> {
  const input = parseQueryInput(ListBoardLeadsInput, rawInput, 'crm.lead.board');
  const { pipelineId, where } = await boardScope(ctx, input);
  const o = schema.opportunities;
  const order = boardOrder();

  const counts = await ctx.tx
    .select({ stageId: o.stageId, count: sql<number>`count(*)::int` })
    .from(o)
    .where(where)
    .groupBy(o.stageId);

  // One row past the page in each stage says whether the stage has more.
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
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      sortValue: sortText(order).as('sort_value'),
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
    .where(lte(ranked.rank, input.limit + 1))
    .orderBy(desc(ranked.updatedAt), desc(ranked.id));

  const shown = rows.filter((r) => r.rank <= input.limit);
  const more: BoardStageCursorDto[] = [];
  for (const past of rows.filter((r) => r.rank > input.limit)) {
    const last = shown.filter((r) => r.stageId === past.stageId).at(-1);
    const cursor = nextCursor(
      order,
      true,
      last === undefined ? undefined : { value: last.sortValue, id: last.id },
    );
    if (cursor !== null) more.push({ stageId: past.stageId, cursor });
  }

  return LeadBoardDto.parse({
    pipelineId,
    counts: counts.map((c) => ({ stageId: c.stageId, count: c.count })),
    perStage: input.limit,
    items: await cardsOf(ctx, shown),
    more,
  });
}

/**
 * The next page of one stage (the column's "Load more"): the cards after the cursor the board or
 * the previous page gave, under the same filter and in the same order, and the cursor after them.
 * A cursor made for another order is refused as `validation_failed`.
 */
export async function listBoardStageLeads(
  ctx: BoardContext,
  rawInput: unknown,
): Promise<BoardStagePageDto> {
  const input = parseQueryInput(ListBoardStageLeadsInput, rawInput, 'crm.lead.board');
  const { where } = await boardScope(ctx, input);
  const o = schema.opportunities;
  const order = boardOrder();
  const rows = await ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      stageId: o.stageId,
      state: o.state,
      accountId: o.accountId,
      siteId: o.siteId,
      ownerId: o.ownerId,
      stateChangedAt: o.stateChangedAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      sortValue: sortText(order),
    })
    .from(o)
    .where(and(where, eq(o.stageId, input.stageId), afterCursor(order, input.cursor)))
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return BoardStagePageDto.parse({
    stageId: input.stageId,
    items: await cardsOf(ctx, page),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.id },
    ),
  });
}

/** The cards of a bounded set of leads, with their customers, villages and owners' names. */
async function cardsOf(ctx: BoardContext, rows: readonly CardRow[]): Promise<BoardLeadDto[]> {
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
  const leadIds = rows.map((r) => r.id);
  const stageMoves = await stageMovesOf(ctx, leadIds);
  const sizes = await sizesOf(ctx, leadIds);
  // A lead's customer is always readable to whoever reads the lead (AUDIT M25); one that is not
  // is left out rather than shown half-empty, as the leads list does.
  return rows.flatMap((r) => {
    const customerName = customers.get(r.accountId);
    if (customerName === undefined) return [];
    return [
      BoardLeadDto.parse({
        id: r.id,
        entityId: r.entityId,
        stageId: r.stageId,
        state: OpportunityStateSchema.parse(r.state),
        accountId: r.accountId,
        customerName,
        village: r.siteId === null ? null : (villages.get(r.siteId) ?? null),
        ownerId: r.ownerId,
        ownerName: r.ownerId === null ? null : (owners.get(r.ownerId) ?? null),
        stateChangedAt: r.stateChangedAt.toISOString(),
        // No SLA rules exist yet (they arrive with the tele-calling queues in Phase 1).
        sla: null,
        stageSince: (stageMoves.get(r.id) ?? r.createdAt).toISOString(),
        size: sizes.get(r.id) ?? null,
        updatedAt: r.updatedAt.toISOString(),
      }),
    ];
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

/**
 * When each lead last moved stage (`stage_moved` on its timeline, read with the lead), for the
 * card's time in stage; a lead that never moved has none and counts from when it was made.
 */
async function stageMovesOf(ctx: BoardContext, ids: readonly string[]): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map();
  const a = schema.activities;
  const rows = await ctx.tx
    .select({ id: a.opportunityId, at: sql<Date>`max(${a.createdAt})`.mapWith(a.createdAt) })
    .from(a)
    .where(and(inArray(a.opportunityId, [...ids]), eq(a.type, 'stage_moved')))
    .groupBy(a.opportunityId);
  return new Map(rows.flatMap((r) => (r.id === null ? [] : [[r.id, r.at] as const])));
}

/**
 * The size of each lead's newest sizing, read with the lead (docs/03-roadmap-appendix/phase1.md §7.3, the
 * board's follow-up): a pump's standard HP or a rooftop system's recommended kWp, from today's
 * engine only (an older engine's result has another shape), recorded by a person (SECURITY §3.3).
 */
async function sizesOf(
  ctx: BoardContext,
  ids: readonly string[],
): Promise<Map<string, NonNullable<BoardLeadDto['size']>>> {
  if (ids.length === 0) return new Map();
  const s = schema.sizings;
  const p = schema.principals;
  const rows = await ctx.tx
    .selectDistinctOn([s.opportunityId], {
      id: s.opportunityId,
      kind: s.kind,
      hp: sql<string | null>`${s.resultJson} -> 'power' ->> 'standardHp'`,
      kwp: sql<string | null>`${s.resultJson} -> 'rooftop' ->> 'recommendedKwp'`,
    })
    .from(s)
    .innerJoin(p, and(eq(p.id, s.createdBy), eq(p.kind, 'user')))
    .where(and(inArray(s.opportunityId, [...ids]), eq(s.engineVersion, SIZING_ENGINE_VERSION)))
    .orderBy(s.opportunityId, desc(s.createdAt), desc(s.id));
  const number = (value: string | null) => {
    const n = value === null ? Number.NaN : Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return new Map(
    rows.map((r) => [
      r.id,
      {
        kind: SizingKindSchema.parse(r.kind),
        hp: r.kind === 'pump' ? number(r.hp) : null,
        kwp: r.kind === 'rooftop' ? number(r.kwp) : null,
      },
    ]),
  );
}
