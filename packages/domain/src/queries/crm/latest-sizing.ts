import { DomainError, LatestSizingInput, SizingDto, StaleSizingDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, exists, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { SIZING_ENGINE_VERSION } from '../../sizing/size';
import { parseQueryInput } from '../parse-input';

type SizingContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The newest sizing of a lead, of one kind or of either (docs/03-roadmap-appendix/phase1.md §6.7): the one a
 * quote uses and the sizing panel opens with. Only sizings a person recorded count (SECURITY
 * §3.3). Null when the lead has none, or when the caller cannot read the lead, since a sizing is
 * read with its lead (RLS). A sizing from an engine version other than today's is answered as
 * stale (`StaleSizingDto`: size the lead again), since its stored result has another shape and
 * may rest on other rules; it never fails the read. Served by
 * `sizings_opportunity_kind_latest_idx`: for one kind, the first index entry of the lead and kind;
 * for either kind, the lead's few rows sorted.
 */
export async function latestSizing(
  ctx: SizingContext,
  rawInput: unknown,
): Promise<SizingDto | StaleSizingDto | null> {
  const input = parseQueryInput(LatestSizingInput, rawInput, 'crm.sizing.latest');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }

  const s = schema.sizings;
  const p = schema.principals;
  const [row] = await ctx.tx
    .select()
    .from(s)
    .where(
      and(
        eq(s.opportunityId, input.opportunityId),
        eq(s.entityId, input.entityId),
        input.kind === undefined ? undefined : eq(s.kind, input.kind),
        // Only a sizing a person recorded counts (SECURITY §3.3); the insert policy already holds
        // every row to a user principal, and this keeps the read to that rule on its own.
        exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(p)
            .where(and(eq(p.id, s.createdBy), eq(p.kind, 'user'))),
        ),
      ),
    )
    // Nulls last, as the index is built, so the planner reads the index in order and stops at
    // the first row (both columns are never null).
    .orderBy(sql`${s.createdAt} desc nulls last`, sql`${s.id} desc nulls last`)
    .limit(1);
  if (!row) return null;
  if (row.engineVersion !== SIZING_ENGINE_VERSION) {
    return StaleSizingDto.parse({
      stale: true,
      id: row.id,
      entityId: row.entityId,
      opportunityId: row.opportunityId,
      kind: row.kind,
      engineVersion: row.engineVersion,
      createdAt: row.createdAt.toISOString(),
    });
  }
  // Today's version: a row that does not parse is a fault of this engine, not an old result.
  return SizingDto.parse({
    id: row.id,
    entityId: row.entityId,
    opportunityId: row.opportunityId,
    siteId: row.siteId,
    kind: row.kind,
    itemId: row.itemId,
    inputs: row.inputsJson,
    result: row.resultJson,
    inBounds: row.inBounds,
    reasons: row.reasonsJson,
    engineVersion: row.engineVersion,
    createdAt: row.createdAt.toISOString(),
  });
}
