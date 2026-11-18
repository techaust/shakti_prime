import { DomainError, PendingScreenPop, ScreenPopDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { checkPermission, isAgent } from '../../command/run-command';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * What the person the IVR rings is shown (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05):
 * their ringing call, taken from the key-value store by `GET /api/v1/calls/ringing`, read under
 * their own policies. Of the customers the platform matched, only those the person reads in the
 * call's company are named (`account_entities_read`), in the platform's order; the number goes
 * out as its last four digits, and whole only to fill the new-lead form when no customer of the
 * company holds it. A person outside the call's company, an agent and anyone without `calls.dial`
 * are refused.
 */
export async function readScreenPop(ctx: Ctx, rawPending: unknown): Promise<ScreenPopDto> {
  const pending = PendingScreenPop.parse(rawPending);
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the screen-pop is for people, not agents');
  }
  checkPermission(ctx.principal, 'calls.dial', 'own');
  if (!ctx.entityIds.includes(pending.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: pending.entityId,
    });
  }
  const ae = schema.accountEntities;
  const a = schema.accounts;
  const rows =
    pending.accountIds.length === 0
      ? []
      : await ctx.tx
          .select({ accountId: a.id, name: a.name })
          .from(ae)
          .innerJoin(a, eq(a.id, ae.accountId))
          .where(
            and(
              eq(ae.entityId, pending.entityId),
              inArray(ae.accountId, [...pending.accountIds]),
              isNull(a.archivedAt),
            ),
          );
  const order = new Map(pending.accountIds.map((id, i) => [id, i]));
  const customers = rows
    .map((r) => ({ accountId: r.accountId, name: r.name }))
    .sort((x, y) => (order.get(x.accountId) ?? 0) - (order.get(y.accountId) ?? 0));
  return ScreenPopDto.parse({
    providerCallId: pending.providerCallId,
    entityId: pending.entityId,
    ringingAt: pending.ringingAt,
    // The store holds the whole number only when no customer matched, else its last four digits.
    phoneLast4: pending.phone.slice(-4),
    customers,
    newLeadPhone: pending.accountIds.length === 0 ? pending.phone : null,
  });
}
