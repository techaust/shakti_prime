import { SizingPumpDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, exists, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';

/** An upper bound on the pumps the panel offers; the catalogue holds a few dozen models. */
const MAX_PUMPS = 500;

/**
 * The pumps a sizing can be checked against (docs/03-roadmap-appendix/phase1.md §6.7): items on sale that
 * have a head-flow curve, by name. A pump is known by its curve, not by its category's name, so
 * the list holds whatever the catalogue calls it. Items and curves are shared by every company.
 */
export async function listSizingPumps(
  ctx: Pick<RequestContext, 'tx' | 'principal'>,
): Promise<SizingPumpDto[]> {
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  const i = schema.items;
  const pc = schema.pumpCurves;
  const rows = await ctx.tx
    .select({ id: i.id, sku: i.sku, name: i.name })
    .from(i)
    .where(
      and(
        eq(i.isActive, true),
        isNull(i.archivedAt),
        exists(ctx.tx.select({ one: pc.id }).from(pc).where(eq(pc.itemId, i.id))),
      ),
    )
    .orderBy(asc(i.name), asc(i.id))
    .limit(MAX_PUMPS);
  return rows.map((row) => SizingPumpDto.parse(row));
}
