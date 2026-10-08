import { AccountTypeSchema, DomainError, type AccountType } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';

export type SalesOrderRow = typeof schema.salesOrders.$inferSelect;

/**
 * The order row a change starts from, locked for this transaction, as the caller reads it, with
 * its customer's type: `order_missing` when the caller cannot read it or it is of another company.
 */
export async function lockSalesOrder(
  ctx: CommandContext,
  entityId: number,
  orderId: string,
): Promise<{ row: SalesOrderRow; accountType: AccountType }> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const so = schema.salesOrders;
  const [row] = await ctx.tx
    .select()
    .from(so)
    .where(and(eq(so.id, orderId), eq(so.entityId, entityId)))
    .for('update')
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `order ${orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  const [account] = await ctx.tx
    .select({ type: schema.accounts.type })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, row.accountId))
    .limit(1);
  if (!account) throw new DomainError('internal', `order ${orderId} has no readable customer`);
  return { row, accountType: AccountTypeSchema.parse(account.type) };
}

/** The one write of a move: the update policy holds the caller to their scope over the order. */
export async function writeSalesOrder(
  ctx: CommandContext,
  row: SalesOrderRow,
  change: Partial<
    Pick<
      SalesOrderRow,
      | 'state'
      | 'stateChangedAt'
      | 'confirmedAt'
      | 'confirmedBy'
      | 'creditHeldAt'
      | 'creditHoldReason'
      | 'creditHoldJson'
      | 'creditReleaseBy'
      | 'creditReleaseReason'
      | 'creditReleasedAt'
      | 'cancelReason'
    >
  >,
): Promise<void> {
  const so = schema.salesOrders;
  const updated = await ctx.tx
    .update(so)
    .set({ ...change, updatedBy: ctx.principal.id })
    .where(eq(so.id, row.id))
    .returning({ id: so.id });
  if (updated.length === 0) {
    throw new DomainError('forbidden', `order ${row.id} is outside the caller's scope`);
  }
}
