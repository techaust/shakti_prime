import { PriceTierOptionDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';

/**
 * The price tiers in use, by name, for an Executive giving a customer its tier on Account 360
 * (`crm.account.tier.set`, workshop PRICE-1).
 */
export async function listPriceTierOptions(
  ctx: Pick<RequestContext, 'tx' | 'principal'>,
): Promise<PriceTierOptionDto[]> {
  checkPermission(ctx.principal, 'pricing.write', 'all');
  const t = schema.priceTiers;
  const rows = await ctx.tx
    .select({ id: t.id, code: t.code, name: t.name })
    .from(t)
    .where(and(eq(t.isActive, true), isNull(t.archivedAt)))
    .orderBy(asc(t.name), asc(t.id));
  return rows.map((row) => PriceTierOptionDto.parse(row));
}
