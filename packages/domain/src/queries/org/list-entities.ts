import type { EntityDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { asc, eq, isNull } from 'drizzle-orm';
import { toEntityDto } from './entity-dto';

/** Entities visible to the caller, for the entity switcher. RLS limits the rows. */
export async function listEntities(ctx: Pick<RequestContext, 'tx'>): Promise<EntityDto[]> {
  const rows = await ctx.tx
    .select()
    .from(schema.entities)
    .where(isNull(schema.entities.archivedAt))
    .orderBy(asc(schema.entities.id));
  return rows.map(toEntityDto);
}

/**
 * Where one company stands, for a worker that walks the companies in turn as `system:workers`,
 * scoped to that company: `live`, `archived` (kept, never deleted) or `missing` (no company has
 * that number, so the walk is over: the seed numbers the companies from 1).
 */
export async function companyStanding(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
): Promise<'live' | 'archived' | 'missing'> {
  const [row] = await ctx.tx
    .select({ archivedAt: schema.entities.archivedAt })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId))
    .limit(1);
  if (!row) return 'missing';
  return row.archivedAt === null ? 'live' : 'archived';
}
