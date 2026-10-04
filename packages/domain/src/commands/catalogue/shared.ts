import { DomainError } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';

/**
 * The company an event about a shared catalogue row is filed under: the one the request acts
 * for, else the first in scope. The payload carries only ids and codes either way.
 */
export function eventEntity(ctx: CommandContext): number {
  const entityId = ctx.activeEntityId ?? ctx.entityIds[0];
  if (entityId === undefined) {
    throw new DomainError('forbidden', 'no entity in the request scope');
  }
  return entityId;
}

/**
 * Refuses a catalogue change from a request that does not act for every active company. Items,
 * kits and pump curves are shared by every company, so a `catalogue.write` grant held in one
 * company must not change what the others sell (the owner's decision of 29-09-2026, the rule of
 * GST rates and group price lists). The write policies of the four tables enforce the same rule.
 */
export async function assertCatalogueGroupScope(ctx: CommandContext): Promise<void> {
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a catalogue change needs every company in scope', {
      reason: 'catalogue_needs_all_companies',
    });
  }
}
