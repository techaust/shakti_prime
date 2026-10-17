import {
  NOTICE_TYPES,
  NotificationSettingsDto,
  PushBrowserInput,
  PushSubscriptionDto,
  type NotificationSettingsDto as Settings,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { parseQueryInput } from '../parse-input';

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

/**
 * Whether this browser receives the caller's pushes: its address is one of the caller's own
 * browsers (`push_subscriptions_read` shows a person only their own). A browser where another
 * person turned alerts on reads as not subscribed, so Settings offers to turn them on for the
 * person signed in rather than telling them alerts are on (#168 review L4).
 */
export async function loadPushBrowser(ctx: Ctx, rawInput: unknown): Promise<PushSubscriptionDto> {
  const input = parseQueryInput(PushBrowserInput, rawInput, 'notifications.push.browser');
  const s = schema.pushSubscriptions;
  const rows = await ctx.tx
    .select({ id: s.id })
    .from(s)
    .where(and(eq(s.endpoint, input.endpoint), eq(s.userId, ctx.principal.id)))
    .limit(1);
  return PushSubscriptionDto.parse({ subscribed: rows.length > 0 });
}
