import { DomainError } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';

/**
 * Refuses a tax change from a request that does not act for every active company. GST rates and
 * composite splits carry no company, so one row prices all of them, and a `tax.rates.write` grant
 * held in one company must not reach the others (the shared price-list rule, AUDIT H2). The
 * database policies on both tables enforce the same rule (0048).
 */
export async function assertTaxGroupScope(ctx: CommandContext): Promise<void> {
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a tax change needs every company in scope', {
      reason: 'tax_group_scope',
    });
  }
}
