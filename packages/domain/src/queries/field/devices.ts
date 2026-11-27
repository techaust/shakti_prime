import {
  ListMobileDevicesInput,
  MobileDeviceListDto,
  MobileDeviceRevokeReasonSchema,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { desc, eq } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

/**
 * One person's phones, newest sign-in first, for Admin › Team members, so a holder of
 * `field.device.revoke` can sign one out (docs/03-roadmap-appendix/phase4.md §6.4). Only the
 * columns without a secret are granted to the request roles; row security keeps the phones to the
 * people the caller may sign out. A person has a handful at most, so fifty is every one.
 */
export async function listMobileDevices(
  ctx: Pick<RequestContext, 'tx' | 'principal'>,
  rawInput: unknown,
): Promise<MobileDeviceListDto> {
  const input = parseQueryInput(ListMobileDevicesInput, rawInput, 'field.devices.list');
  checkPermission(ctx.principal, 'field.device.revoke', 'entity');
  const d = schema.mobileDevices;
  const rows = await ctx.tx
    .select({
      id: d.id,
      userId: d.userId,
      name: d.name,
      platform: d.platform,
      appVersion: d.appVersion,
      signedInAt: d.signedInAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
      revokedReason: d.revokedReason,
    })
    .from(d)
    .where(eq(d.userId, input.userId))
    .orderBy(desc(d.signedInAt), desc(d.id))
    .limit(50);
  return MobileDeviceListDto.parse(
    rows.map((r) => ({
      ...r,
      signedInAt: r.signedInAt.toISOString(),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokedReason:
        r.revokedReason === null ? null : MobileDeviceRevokeReasonSchema.parse(r.revokedReason),
    })),
  );
}
