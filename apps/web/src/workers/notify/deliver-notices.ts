import type {
  NoticeBatchDto,
  NotifyResult,
  Principal,
  PushOutcome as NoticePushOutcome,
  WrittenNoticeDto,
} from '@shakti/contracts';
import { executeCommand, recordPush } from '@shakti/domain';
import en from '../../../messages/en.json';
import { logger } from '../../log';
import { pushSender, type PushMessage, type PushSender } from '../../notifications/push';
import { noticeHref } from '../../screens/notices';

/** The push of one notice: its kind's sentence and the screen it opens, never a name or number. */
export function pushMessageOf(notice: WrittenNoticeDto): PushMessage {
  // The one catalogue is English (ADR 0014); a worker has no person's locale to resolve.
  const words = en.pushAlerts[notice.type];
  return {
    title: words.title,
    body: words.body,
    url: noticeHref({
      type: notice.type,
      entityId: notice.entityId,
      accountId: notice.payload.accountId ?? null,
      quoteId: notice.payload.quoteId ?? null,
      subjectId: notice.subjectId,
    }),
    tag: notice.id,
  };
}

/** How many notices are pushed at once in a batch. */
export const PUSH_CONCURRENCY = 8;

export interface DeliverNoticesOptions {
  requestId: string;
  /** The push sender; the app's (web push with the VAPID keys, or none) when left out. */
  sender?: PushSender | undefined;
  /** The time (epoch milliseconds) after which no further notice is started; unlimited when left out. */
  deadlineAt?: number | undefined;
  now?: (() => number) | undefined;
}

/**
 * Pushes a batch of new notices the notify or scan command wrote, and the older ones whose push a
 * cut-off run left pending (`resend`), then records what became of each push
 * (`notifications.push.record`), the browsers the push service says are gone and those that took
 * one. A notice to push goes to every browser of its person: sent when any took it, failed when
 * none did. Without the VAPID keys nothing is sent and each such push is recorded as having no
 * browser. Notices are pushed several at a time; once `deadlineAt` has passed no further notice is
 * started, and a notice not started stays pending (nothing is recorded for it), so the next scan
 * sends it. A push service failure never fails the batch: the notices are in the centre already.
 */
export async function deliverNoticeBatch(
  principal: Principal,
  batch: NoticeBatchDto,
  options: DeliverNoticesOptions,
): Promise<Omit<Extract<NotifyResult, { outcome: 'done' }>, 'eventId' | 'outcome'>> {
  const sender = options.sender ?? pushSender();
  const now = options.now ?? Date.now;
  const outcomes: { noticeId: string; push: NoticePushOutcome }[] = [];
  const gone = new Set<string>();
  const delivered = new Set<string>();
  let pushed = 0;
  const queue = [...batch.notices, ...batch.resend].filter((notice) => notice.push === 'send');
  let next = 0;
  const work = async (): Promise<void> => {
    while (next < queue.length) {
      if (options.deadlineAt !== undefined && now() >= options.deadlineAt) return;
      const notice = queue[next];
      next += 1;
      if (notice === undefined) return;
      if (sender === undefined) {
        outcomes.push({ noticeId: notice.id, push: 'none' });
        continue;
      }
      const message = pushMessageOf(notice);
      let sent = false;
      for (const target of notice.targets) {
        const answer = await sender.send(target, message);
        if (answer === 'ok') {
          sent = true;
          delivered.add(target.endpoint);
        } else if (answer === 'gone') {
          gone.add(target.endpoint);
        }
      }
      if (sent) pushed += 1;
      outcomes.push({ noticeId: notice.id, push: sent ? 'sent' : 'failed' });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, work));
  if (outcomes.length > 0 || gone.size > 0) {
    try {
      await executeCommand(
        principal,
        { entityIds: [batch.entityId], requestId: options.requestId },
        recordPush,
        { entityId: batch.entityId, outcomes, gone: [...gone], delivered: [...delivered] },
      );
    } catch (error) {
      // The notices stand; only what became of their pushes is not recorded.
      logger.log('warn', 'notifications.push_not_recorded', {
        requestId: options.requestId,
        entityId: batch.entityId,
        error,
      });
    }
  }
  return {
    created: batch.notices.length,
    pushed,
    heldForQuietHours: batch.notices.filter((n) => n.push === 'held').length,
  };
}
