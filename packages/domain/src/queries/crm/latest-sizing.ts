import { DomainError, LatestSizingInput, SizingDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

type SizingContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The newest sizing of a lead, of one kind or of either (docs/design/phase1.md §6.7): the one a
 * quote uses and the sizing panel opens with. Null when the lead has none, or when the caller
 * cannot read the lead, since a sizing is read with its lead (RLS). Served by
 * `sizings_opportunity_latest_idx`: one index step for the lead, newest first.
 */
export async function latestSizing(
  ctx: SizingContext,
  rawInput: unknown,
): Promise<SizingDto | null> {
  const input = parseQueryInput(LatestSizingInput, rawInput, 'crm.sizing.latest');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }

  const s = schema.sizings;
  const [row] = await ctx.tx
    .select()
    .from(s)
    .where(
      and(
        eq(s.opportunityId, input.opportunityId),
        eq(s.entityId, input.entityId),
        input.kind === undefined ? undefined : eq(s.kind, input.kind),
      ),
    )
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(1);
  if (!row) return null;
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
