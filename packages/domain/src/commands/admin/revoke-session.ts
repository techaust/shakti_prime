import { DomainError, RevokedSessionsDto, RevokeSessionInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertUserInScope } from './shared';

/** `admin.session.revoke`: forces one session out. The row stays for the sessions screen. */
export const revokeSession = defineCommand({
  name: 'admin.session.revoke',
  permission: 'admin.users.write',
  minScope: 'all',
  input: RevokeSessionInput,
  output: RevokedSessionsDto,
  auditFields: ['revokedAt', 'revokedReason'],
  async handler(ctx, input) {
    const s = schema.sessions;
    const [live] = await ctx.tx
      .select({ userId: s.userId })
      .from(s)
      .where(and(eq(s.id, input.sessionId), isNull(s.revokedAt)))
      .limit(1);
    if (!live) {
      throw new DomainError('not_found', 'no live session with that id', {
        reason: 'session_missing',
      });
    }
    await assertUserInScope(ctx, live.userId);
    const [row] = await ctx.tx
      .update(s)
      .set({ revokedAt: ctx.now, revokedReason: input.reason })
      .where(and(eq(s.id, input.sessionId), isNull(s.revokedAt)))
      .returning({ id: s.id, userId: s.userId });
    if (!row) {
      throw new DomainError('not_found', 'no live session with that id', {
        reason: 'session_missing',
      });
    }
    ctx.audit({
      aggregateType: 'session',
      aggregateId: row.id,
      entityId: null,
      before: { userId: row.userId, revokedAt: null },
      after: { userId: row.userId, revokedAt: ctx.now, revokedReason: input.reason },
    });
    const entityId = ctx.entityIds[0];
    if (entityId !== undefined) {
      ctx.emit({
        type: 'auth.session.revoked',
        entityId,
        aggregateType: 'session',
        aggregateId: row.id,
        payload: { userId: row.userId, reason: input.reason },
      });
    }
    return { userId: row.userId, revokedSessionIds: [row.id] };
  },
});
