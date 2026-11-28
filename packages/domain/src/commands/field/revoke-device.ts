import { DomainError, RevokedMobileDeviceDto, RevokeMobileDeviceInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/**
 * `field.device.revoke` (docs/03-roadmap-appendix/phase4.md §4, §6.4): signs one phone out of the
 * field app from Admin › Team members, a lost or stolen phone above all. Its refresh token stops
 * working at once and its next call, access token or refresh, is refused with `device_revoked`.
 * Row security decides whose phones the caller may sign out (migration of F1): any with the grant
 * at scope all, those of people holding a role in a company of the request at scope entity.
 */
export const revokeMobileDevice = defineCommand({
  name: 'field.device.revoke',
  permission: 'field.device.revoke',
  minScope: 'entity',
  peopleOnly: true,
  input: RevokeMobileDeviceInput,
  output: RevokedMobileDeviceDto,
  auditFields: ['revokedAt'],
  async handler(ctx, input) {
    const d = schema.mobileDevices;
    const [row] = await ctx.tx
      .update(d)
      .set({ revokedAt: ctx.now, revokedReason: 'revoked', revokedBy: ctx.principal.id })
      .where(and(eq(d.id, input.id), isNull(d.revokedAt)))
      .returning({ id: d.id, userId: d.userId });
    if (!row) {
      throw new DomainError('not_found', 'no phone still signed in with that id', {
        reason: 'device_missing',
      });
    }
    ctx.audit({
      aggregateType: 'mobile_device',
      aggregateId: row.id,
      entityId: null,
      before: { userId: row.userId, revokedAt: null },
      after: { userId: row.userId, revokedAt: ctx.now },
    });
    return { id: row.id, userId: row.userId, revokedAt: ctx.now.toISOString() };
  },
});
