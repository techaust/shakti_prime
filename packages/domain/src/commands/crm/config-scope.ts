import { DomainError } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';

/**
 * Refuses a change to CRM set-up outside the request's reach. A group-wide row (`entity_id`
 * null: a shared pipeline, the group's call outcomes or score rules) shapes the work of every
 * company, so only a request acting for every active company may change it, the rule shared price
 * lists and tax rows follow (AUDIT H2, 0048); a company's own row needs that company in the
 * request. The database policies hold the same rule (docs/05-database.md §6.2).
 */
export async function assertConfigScope(
  ctx: CommandContext,
  entityId: number | null,
): Promise<void> {
  if (entityId !== null) {
    if (!ctx.entityIds.includes(entityId)) {
      throw new DomainError('forbidden', 'company outside the request scope', {
        reason: 'config_company_scope',
      });
    }
    return;
  }
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a group-wide set-up change needs every company in scope', {
      reason: 'config_group_scope',
    });
  }
}
