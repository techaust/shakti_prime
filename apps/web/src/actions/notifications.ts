'use server';

// The notification centre, the bell and Settings › Notifications (docs/03-roadmap-appendix/phase1.md §8.1).

import {
  ListNoticesInput,
  MarkAllNoticesReadInput,
  MarkNoticesReadInput,
  PushSubscribeInput,
  PushUnsubscribeInput,
  SetNotificationSettingsInput,
  type NoticeCountDto,
  type NoticePageDto,
  type NoticesReadDto,
  type NotificationSettingsDto,
  type PushSubscriptionDto,
} from '@shakti/contracts';
import {
  countNotices as countNoticesQuery,
  executeCommand,
  executeQuery,
  listNotices as listNoticesQuery,
  loadNotificationSettings as loadSettingsQuery,
  markAllNoticesRead as markAllCommand,
  markNoticesRead as markCommand,
  setNotificationSettings as setSettingsCommand,
  subscribePush as subscribeCommand,
  unsubscribePush as unsubscribeCommand,
  type AnyCommand,
} from '@shakti/domain';
import { inboxCountKey } from './inbox-count-cache';
import { noticeCounts } from './notice-count-cache';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

/** The caller's notices in the companies being viewed, newest first, a page at a time. */
export async function listNotices(rawInput: unknown): Promise<ActionResult<NoticePageDto>> {
  return toResult('listNotices', async () => {
    const principal = await signedIn();
    const input = parseInput(ListNoticesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listNoticesQuery(context, input), {
      name: 'listNotices',
    });
  });
}

/**
 * How many unread notices the caller has, for the bell: read on every staff page and every 15
 * seconds while a page is in view, so it is reused for a few seconds per person and company
 * scope (`notice-count-cache.ts`), and cleared when the person reads a notice.
 */
export async function noticeCount(): Promise<ActionResult<NoticeCountDto>> {
  return toResult('noticeCount', async () => {
    const principal = await signedIn();
    const key = inboxCountKey(principal.id, principal.entityIds);
    const kept = noticeCounts.get(key, Date.now());
    if (kept !== undefined) return { unread: kept };
    const { requestId } = await requestMeta();
    const count = await executeQuery(
      principal,
      { requestId },
      (context) => countNoticesQuery(context),
      { name: 'noticeCount' },
    );
    noticeCounts.set(key, count.unread, Date.now());
    return count;
  });
}

/** A change to the caller's own notices, in the companies being viewed. */
async function own<T>(
  action: string,
  schema: Schema<unknown>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    const result = (await executeCommand(
      principal,
      { requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
    noticeCounts.forget(principal.id);
    return result;
  });
}

/** Marks the caller's notices read, by id. */
export async function markNoticesRead(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<NoticesReadDto>> {
  return own('markNoticesRead', MarkNoticesReadInput, markCommand, rawInput, idempotencyKey);
}

/** Marks every unread notice of the caller in the companies being viewed read. */
export async function markAllNoticesRead(
  idempotencyKey?: unknown,
): Promise<ActionResult<NoticesReadDto>> {
  return own('markAllNoticesRead', MarkAllNoticesReadInput, markAllCommand, {}, idempotencyKey);
}

/** The caller's notification settings. */
export async function notificationSettings(): Promise<ActionResult<NotificationSettingsDto>> {
  return toResult('notificationSettings', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => loadSettingsQuery(context), {
      name: 'notificationSettings',
    });
  });
}

/** Saves the caller's switches per kind of notice and their quiet hours. */
export async function saveNotificationSettings(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<NotificationSettingsDto>> {
  return own(
    'saveNotificationSettings',
    SetNotificationSettingsInput,
    setSettingsCommand,
    rawInput,
    idempotencyKey,
  );
}

/** This browser receives the caller's alerts from now on. */
export async function subscribePush(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PushSubscriptionDto>> {
  return own('subscribePush', PushSubscribeInput, subscribeCommand, rawInput, idempotencyKey);
}

/** This browser no longer receives the caller's alerts. */
export async function unsubscribePush(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PushSubscriptionDto>> {
  return own('unsubscribePush', PushUnsubscribeInput, unsubscribeCommand, rawInput, idempotencyKey);
}
