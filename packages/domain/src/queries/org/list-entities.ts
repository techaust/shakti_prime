import type { EntityDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { asc, isNull } from 'drizzle-orm';
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
