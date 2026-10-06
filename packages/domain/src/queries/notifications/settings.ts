import {
  NOTICE_TYPES,
  NotificationSettingsDto,
  type NotificationSettingsDto as Settings,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';

type Ctx = Pick<RequestContext, 'tx' | 'principal'>;

/**
 * The caller's notification settings (Settings › Notifications): every kind of notice with its
 * in-app and push switches, on for a kind they never changed, and their quiet hours, none when
 * they set none.
 */
export async function loadNotificationSettings(ctx: Ctx): Promise<Settings> {
  const p = schema.notificationPreferences;
  const rows = await ctx.tx
    .select({
      type: p.type,
      inApp: p.inApp,
      push: p.push,
      quietFrom: sql<string | null>`to_char(${p.quietFrom}, 'HH24:MI')`,
      quietTo: sql<string | null>`to_char(${p.quietTo}, 'HH24:MI')`,
    })
    .from(p)
    .where(eq(p.userId, ctx.principal.id));
  const quiet = rows.find((r) => r.type === null);
  return NotificationSettingsDto.parse({
    types: NOTICE_TYPES.map((type) => {
      const row = rows.find((r) => r.type === type);
      return { type, inApp: row?.inApp ?? true, push: row?.push ?? true };
    }),
    quietFrom: quiet?.quietFrom ?? null,
    quietTo: quiet?.quietTo ?? null,
  });
}
