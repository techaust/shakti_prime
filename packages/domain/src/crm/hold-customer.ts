import { DomainError } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
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

/**
 * Holds the customer (`holdCustomer`) and stops with `account_missing` when it is archived, as a
 * merge leaves the customer it merged away: a write that waited on the merge stops rather than
 * writing about the archived customer. Only a merge archives a customer.
 */
export async function holdLiveCustomer(ctx: Pick<CommandContext, 'tx'>, accountId: string) {
  await holdCustomer(ctx, accountId);
  await requireLiveCustomer(ctx, accountId);
}

/** Stops with `account_missing` when the customer, already held, is archived or out of sight. */
export async function requireLiveCustomer(ctx: Pick<CommandContext, 'tx'>, accountId: string) {
  const a = schema.accounts;
  const [live] = await ctx.tx
    .select({ id: a.id })
    .from(a)
    .where(and(eq(a.id, accountId), isNull(a.archivedAt)))
    .limit(1);
  if (!live) {
    throw new DomainError('not_found', `account ${accountId} is not visible`, {
      reason: 'account_missing',
    });
  }
}

/**
 * Holds the customer of a lead of the company (`holdLiveCustomer`) before the command reads or
 * locks the lead, in the order a merge locks them (customers, then their leads). A lead the caller
 * cannot read holds nothing; the command's own read answers `lead_missing`.
 */
export async function holdLeadCustomer(
  ctx: Pick<CommandContext, 'tx'>,
  lead: { entityId: number; opportunityId: string },
) {
  const o = schema.opportunities;
  const [found] = await ctx.tx
    .select({ accountId: o.accountId })
    .from(o)
    .where(and(eq(o.id, lead.opportunityId), eq(o.entityId, lead.entityId)))
    .limit(1);
  if (found) await holdLiveCustomer(ctx, found.accountId);
}
