import {
  DomainError,
  MarkAllNoticesReadInput,
  MarkNoticesReadInput,
  newId,
  NoticesReadDto,
  NotificationSettingsDto,
  PushSubscribeInput,
  PushSubscriptionDto,
  PushUnsubscribeInput,
  SetNotificationSettingsInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { loadNotificationSettings } from '../../queries/notifications/settings';

/*
 * A person's own notices, settings and browsers (docs/03-roadmap-appendix/phase1.md §8.1). Reading one's own
 * notices needs no permission; changing them is the caller's own profile (`profile.write`, which
 * every staff role holds for themselves), for people only. RLS lets a person reach only their own
 * rows, so someone else's notice answers as if it did not exist.
 */

/** `notifications.notice.read`: the caller's notices, by id, marked read; already read ones stay. */
export const markNoticesRead = defineCommand({
  name: 'notifications.notice.read',
  permission: 'profile.write',
  minScope: 'own',
  peopleOnly: true,
  input: MarkNoticesReadInput,
  output: NoticesReadDto,
  auditFields: ['read'],
  async handler(ctx, input) {
    const n = schema.notifications;
    const rows = await ctx.tx
      .update(n)
      .set({ readAt: ctx.now })
      .where(
        and(
          inArray(n.id, [...input.ids]),
          eq(n.userId, ctx.principal.id),
          inArray(n.entityId, [...ctx.entityIds]),
          isNull(n.readAt),
        ),
      )
      .returning({ id: n.id });
    if (rows.length > 0) {
      ctx.audit({
        aggregateType: 'notice_read',
        aggregateId: newId(),
        entityId: null,
        before: null,
        after: { read: rows.length },
      });
    }
    return { read: rows.length };
  },
});

/** `notifications.notice.read_all`: every unread notice of the caller in the request's companies. */
export const markAllNoticesRead = defineCommand({
  name: 'notifications.notice.read_all',
  permission: 'profile.write',
  minScope: 'own',
  peopleOnly: true,
  input: MarkAllNoticesReadInput,
  output: NoticesReadDto,
  auditFields: ['read'],
  async handler(ctx) {
    const n = schema.notifications;
    const rows = await ctx.tx
      .update(n)
      .set({ readAt: ctx.now })
      .where(
        and(
          eq(n.userId, ctx.principal.id),
          inArray(n.entityId, [...ctx.entityIds]),
          isNull(n.readAt),
        ),
      )
      .returning({ id: n.id });
    if (rows.length > 0) {
      ctx.audit({
        aggregateType: 'notice_read',
        aggregateId: newId(),
        entityId: null,
        before: null,
        after: { read: rows.length },
      });
    }
    return { read: rows.length };
  },
});

/**
 * `notifications.preferences.set`: the caller's switches for the kinds of notice they send, and
 * their quiet hours (none when both are null). A kind left out keeps what it had. Answers the
 * settings as they now stand.
 */
export const setNotificationSettings = defineCommand({
  name: 'notifications.preferences.set',
  permission: 'profile.write',
  minScope: 'own',
  peopleOnly: true,
  input: SetNotificationSettingsInput,
  output: NotificationSettingsDto,
  auditFields: ['centreOff', 'pushOff', 'quietFrom', 'quietTo'],
  async handler(ctx, input) {
    const before = await loadNotificationSettings(ctx);
    const user = ctx.principal.id;
    for (const choice of input.types) {
      await ctx.tx.execute(sql`
        insert into notification_preferences (id, user_id, type, in_app, push)
        values (${newId()}::uuid, ${user}::uuid, ${choice.type}, ${choice.inApp}, ${choice.push})
        on conflict on constraint notification_preferences_user_type_unique
        do update set in_app = excluded.in_app, push = excluded.push`);
    }
    await ctx.tx.execute(sql`
      insert into notification_preferences (id, user_id, type, quiet_from, quiet_to)
      values (${newId()}::uuid, ${user}::uuid, null, ${input.quietFrom}::time, ${input.quietTo}::time)
      on conflict on constraint notification_preferences_user_type_unique
      do update set quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to`);
    const after = await loadNotificationSettings(ctx);
    // How many kinds are kept out of the centre and not pushed, and the quiet hours.
    const summary = (s: typeof before) => ({
      centreOff: s.types.filter((t) => !t.inApp).length,
      pushOff: s.types.filter((t) => !t.push).length,
      quietFrom: s.quietFrom,
      quietTo: s.quietTo,
    });
    ctx.audit({
      aggregateType: 'notification_settings',
      aggregateId: user,
      entityId: null,
      before: summary(before),
      after: summary(after),
    });
    return after;
  },
});

/**
 * `notifications.push.subscribe`: this browser receives the caller's pushes from now on, taken
 * over from whoever used it before (`app.claim_push_subscription()`). Only a push service the app
 * knows is accepted (`isPushServiceEndpoint`, in the input).
 */
export const subscribePush = defineCommand({
  name: 'notifications.push.subscribe',
  permission: 'profile.write',
  minScope: 'own',
  peopleOnly: true,
  input: PushSubscribeInput,
  output: PushSubscriptionDto,
  auditFields: [],
  // The browser's address works as a key to its pushes: the audit row records none of it.
  auditInput: () => ({}),
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select app.claim_push_subscription(${input.endpoint}, ${input.keys.p256dh},
        ${input.keys.auth}, ${input.userAgent ?? null}) as id`)) as unknown as { id: string }[];
    const id = rows[0]?.id;
    if (id === undefined) throw new DomainError('internal', 'the browser was not kept');
    ctx.audit({ aggregateType: 'push_subscription', aggregateId: id, entityId: null });
    return { subscribed: true };
  },
});

/** `notifications.push.unsubscribe`: this browser no longer receives the caller's pushes. */
export const unsubscribePush = defineCommand({
  name: 'notifications.push.unsubscribe',
  permission: 'profile.write',
  minScope: 'own',
  peopleOnly: true,
  input: PushUnsubscribeInput,
  output: PushSubscriptionDto,
  auditFields: [],
  auditInput: () => ({}),
  async handler(ctx, input) {
    const s = schema.pushSubscriptions;
    const rows = await ctx.tx
      .delete(s)
      .where(and(eq(s.endpoint, input.endpoint), eq(s.userId, ctx.principal.id)))
      .returning({ id: s.id });
    for (const row of rows) {
      ctx.audit({ aggregateType: 'push_subscription', aggregateId: row.id, entityId: null });
    }
    return { subscribed: false };
  },
});
