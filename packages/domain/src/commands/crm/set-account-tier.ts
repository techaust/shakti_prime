import { AccountTierDto, DomainError, SetAccountTierInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/**
 * `crm.account.tier.set` (docs/design/phase1.md §7.3, workshop PRICE-1): the price tier every
 * quote of the customer is priced from, or none. The workshop pack proposes no map from customer
 * type to tier, so an Executive gives each customer its tier on Account 360 (the owner's decision
 * of 05-10-2026). A tier decides every price the customer is quoted, so it takes `pricing.write`
 * for all companies, the Price Master's own permission, which only the Executive role holds, and
 * not `crm.account.write`, which callers hold for their own customers: a caller could otherwise
 * move a customer to a cheaper tier. The trigger `accounts_tier_guard` refuses the change to any
 * other request in the database too. The customer is one record for the group (ADR 0008), so the
 * tier applies in every company; the update policy still needs the caller's customer write scope.
 */
export const setAccountTier = defineCommand({
  name: 'crm.account.tier.set',
  permission: 'pricing.write',
  minScope: 'all',
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  peopleOnly: true,
  input: SetAccountTierInput,
  output: AccountTierDto,
  auditFields: [],
  async handler(ctx, input) {
    if (input.tierId !== null) {
      const t = schema.priceTiers;
      const [tier] = await ctx.tx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.id, input.tierId), eq(t.isActive, true), isNull(t.archivedAt)))
        .limit(1);
      if (!tier) {
        throw new DomainError('not_found', `price tier ${input.tierId} is not in use`, {
          reason: 'price_tier_missing',
        });
      }
    }
    const a = schema.accounts;
    const [account] = await ctx.tx
      .select({ id: a.id, tierId: a.tierId })
      .from(a)
      .where(and(eq(a.id, input.accountId), isNull(a.archivedAt)))
      .limit(1);
    if (!account) {
      throw new DomainError('not_found', `account ${input.accountId} is not visible`, {
        reason: 'account_missing',
      });
    }
    if (account.tierId === input.tierId) return { accountId: account.id, tierId: account.tierId };
    const [row] = await ctx.tx
      .update(a)
      .set({ tierId: input.tierId, updatedBy: ctx.principal.id })
      .where(eq(a.id, account.id))
      .returning({ id: a.id, tierId: a.tierId });
    if (!row) {
      throw new DomainError('not_found', `account ${input.accountId} cannot be changed`, {
        reason: 'account_missing',
      });
    }
    ctx.audit({
      aggregateType: 'account',
      aggregateId: row.id,
      entityId: null,
      before: { tierId: account.tierId },
      after: { tierId: row.tierId },
    });
    return { accountId: row.id, tierId: row.tierId };
  },
});
