import {
  ConvertingBoardDto,
  ConvertingBoardInput,
  CONVERTING_BOARD_LIMIT,
  DomainError,
  OpportunityStateSchema,
  SegmentSchema,
  type ConvertingLeadDto,
  type ConvertingSizingState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { checkPermission, isAgent } from '../../command/run-command';
import { nextBestActions } from '../../crm/next-best-action';
import { shownQuoteState } from '../sales/quote-dto';
import { parseQueryInput } from '../parse-input';
import { sizesOf, stageMovesOf } from './list-board-leads';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The Lead Converter's board (`/converting`, PRD TEL-03, docs/03-roadmap-appendix/phase1.md §9): the open
 * leads the owner looks after, newest change first, at most `CONVERTING_BOARD_LIMIT`, each with the
 * few facts the next-best-action rules read (`nextBestActions`), and the list those rules make.
 * The owner is the caller, or for a team lead (`calls.log` at team scope or wider) a person of
 * their team; RLS decides which of those leads the reader sees. The leads are found first on
 * `opportunities` alone (its owner index), and the facts of that bounded set are read after: the
 * owner's earliest open callback, the newest sizing and quote, and an order held for credit.
 * Nothing here reads a supplier rate, an item cost or a margin.
 */
export async function loadConvertingBoard(
  ctx: Ctx,
  rawInput: unknown = {},
  now: Date = new Date(),
): Promise<ConvertingBoardDto> {
  const input = parseQueryInput(ConvertingBoardInput, rawInput, 'crm.converting.board');
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the converter workspace is for people, not agents');
  }
  checkPermission(ctx.principal, 'calls.log', 'own');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  const ownerId = input.ownerId ?? ctx.principal.id;
  if (ownerId !== ctx.principal.id) checkPermission(ctx.principal, 'calls.log', 'team');
  if (input.entityId !== undefined && !ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const entityIds = input.entityId === undefined ? [...ctx.entityIds] : [input.entityId];

  const o = schema.opportunities;
  const ps = schema.pipelineStages;
  const pl = schema.pipelines;
  const a = schema.accounts;
  const cs = schema.customerSites;
  // A pipeline has at most one live stage keyed qualified, so this join keeps one row per lead.
  const qualified = ctx.tx
    .select({ pipelineId: ps.pipelineId, position: ps.position })
    .from(ps)
    .where(and(eq(ps.key, 'qualified'), isNull(ps.archivedAt)))
    .as('qualified');
  const rows = await ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      accountId: o.accountId,
      state: o.state,
      score: o.score,
      createdAt: o.createdAt,
      customerName: a.name,
      village: cs.village,
      segment: pl.segment,
      pipelineName: pl.name,
      stageId: ps.id,
      stageKey: ps.key,
      stageName: ps.name,
      stagePosition: ps.position,
      qualifiedPosition: qualified.position,
    })
    .from(o)
    .innerJoin(ps, eq(ps.id, o.stageId))
    .innerJoin(pl, eq(pl.id, o.pipelineId))
    .innerJoin(a, eq(a.id, o.accountId))
    .leftJoin(cs, eq(cs.id, o.siteId))
    .leftJoin(qualified, eq(qualified.pipelineId, o.pipelineId))
    .where(
      and(
        eq(o.ownerId, ownerId),
        inArray(o.entityId, entityIds),
        eq(o.state, 'open'),
        isNull(o.archivedAt),
      ),
    )
    .orderBy(desc(o.updatedAt), desc(o.id))
    .limit(CONVERTING_BOARD_LIMIT + 1);
  const shown = rows.slice(0, CONVERTING_BOARD_LIMIT);
  const ids = shown.map((r) => r.id);

  // One transaction answers one statement at a time, so these run in turn.
  const moves = await stageMovesOf(ctx, ids);
  const sizes = await sizesOf(ctx, ids);
  const sized = await sizedLeads(ctx, ids);
  const calls = await callbacksOf(ctx, ids, ownerId);
  const quotes = await quotesOf(ctx, ids, now);
  const held = await heldOrdersOf(ctx, ids);

  const leads = shown.map((r): ConvertingLeadDto => {
    const size = sizes.get(r.id) ?? null;
    const sizing: ConvertingSizingState =
      size !== null ? 'current' : sized.has(r.id) ? 'stale' : 'none';
    return {
      opportunityId: r.id,
      entityId: r.entityId,
      accountId: r.accountId,
      customerName: r.customerName,
      village: r.village ?? null,
      segment: SegmentSchema.parse(r.segment),
      pipelineName: r.pipelineName,
      stageId: r.stageId,
      stageKey: r.stageKey,
      stageName: r.stageName,
      stagePosition: r.stagePosition,
      needsQuote: r.qualifiedPosition !== null && r.stagePosition >= r.qualifiedPosition,
      state: OpportunityStateSchema.parse(r.state),
      score: r.score,
      stageSince: (moves.get(r.id) ?? r.createdAt).toISOString(),
      nextCall: calls.get(r.id) ?? null,
      sizing,
      size,
      quote: quotes.get(r.id) ?? null,
      heldOrder: held.get(r.id) ?? null,
    };
  });

  return ConvertingBoardDto.parse({
    asOf: now.toISOString(),
    leads,
    actions: nextBestActions(leads, now),
    truncated: rows.length > CONVERTING_BOARD_LIMIT,
  });
}

/** The leads with a sizing a person recorded, of any engine (`sizesOf` finds today's). */
async function sizedLeads(ctx: Ctx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const s = schema.sizings;
  const p = schema.principals;
  const rows = await ctx.tx
    .selectDistinct({ id: s.opportunityId })
    .from(s)
    .innerJoin(p, and(eq(p.id, s.createdBy), eq(p.kind, 'user')))
    .where(inArray(s.opportunityId, [...ids]));
  return new Set(rows.map((r) => r.id));
}

/** The owner's earliest open callback on each lead, due or not, as the call queue reads it. */
async function callbacksOf(
  ctx: Ctx,
  ids: readonly string[],
  ownerId: string,
): Promise<Map<string, NonNullable<ConvertingLeadDto['nextCall']>>> {
  if (ids.length === 0) return new Map();
  const t = schema.tasks;
  const rows = await ctx.tx
    .select({ id: t.opportunityId, dueAt: sql<Date>`min(${t.dueAt})`.mapWith(t.dueAt) })
    .from(t)
    .where(
      and(
        inArray(t.opportunityId, [...ids]),
        eq(t.assigneeId, ownerId),
        eq(t.state, 'open'),
        eq(t.kind, 'callback'),
      ),
    )
    .groupBy(t.opportunityId);
  return new Map(
    rows.map((r) => [r.id, { kind: 'callback' as const, dueAt: r.dueAt.toISOString() }]),
  );
}

/**
 * Each lead's quote: its newest draft or sent one, else its newest of any state, with the state a
 * person sees (a lapsed draft or sent quote reads as expired).
 */
async function quotesOf(
  ctx: Ctx,
  ids: readonly string[],
  now: Date,
): Promise<Map<string, NonNullable<ConvertingLeadDto['quote']>>> {
  if (ids.length === 0) return new Map();
  const q = schema.quotes;
  const rows = await ctx.tx
    .selectDistinctOn([q.opportunityId], {
      opportunityId: q.opportunityId,
      id: q.id,
      quoteNo: q.quoteNo,
      state: q.state,
      validUntil: q.validUntil,
      grandTotal: q.grandTotal,
    })
    .from(q)
    .where(inArray(q.opportunityId, [...ids]))
    .orderBy(
      q.opportunityId,
      sql`(${q.state} in ('draft', 'sent')) desc`,
      desc(q.createdAt),
      desc(q.id),
    );
  return new Map(
    rows.map((r) => [
      r.opportunityId,
      {
        id: r.id,
        quoteNo: r.quoteNo,
        state: shownQuoteState(r.state, r.validUntil, now),
        validUntil: r.validUntil.toISOString(),
        grandTotal: r.grandTotal,
      },
    ]),
  );
}

/** The order of each lead that the dealer credit check holds, newest hold first. */
async function heldOrdersOf(
  ctx: Ctx,
  ids: readonly string[],
): Promise<Map<string, NonNullable<ConvertingLeadDto['heldOrder']>>> {
  if (ids.length === 0) return new Map();
  const so = schema.salesOrders;
  const rows = await ctx.tx
    .selectDistinctOn([so.opportunityId], {
      opportunityId: so.opportunityId,
      id: so.id,
      soNo: so.soNo,
      heldAt: so.creditHeldAt,
      grandTotal: so.grandTotal,
    })
    .from(so)
    .where(
      and(inArray(so.opportunityId, [...ids]), eq(so.state, 'draft'), isNotNull(so.creditHeldAt)),
    )
    .orderBy(so.opportunityId, desc(so.creditHeldAt), desc(so.id));
  return new Map(
    rows.flatMap((r) =>
      r.opportunityId === null || r.heldAt === null
        ? []
        : [
            [
              r.opportunityId,
              { id: r.id, soNo: r.soNo, heldAt: r.heldAt.toISOString(), grandTotal: r.grandTotal },
            ] as const,
          ],
    ),
  );
}
