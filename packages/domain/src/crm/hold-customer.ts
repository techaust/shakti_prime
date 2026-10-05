import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';

/**
 * Holds a known customer's row until the command commits (`app.hold_customer()`, DATABASE §4.1),
 * before the command reads the customer or writes a row about it. A customer merge locks both
 * customers first, so the two never cross: a write that comes first is moved by the merge, and
 * one that waits then finds the customer archived and stops. Two writes about one customer never
 * wait on each other.
 */
export async function holdCustomer(ctx: Pick<CommandContext, 'tx'>, accountId: string) {
  await ctx.tx.execute(sql`select app.hold_customer(${accountId}::uuid)`);
}
