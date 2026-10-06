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
    }),
    tag: notice.id,
  };
}

export interface DeliverNoticesOptions {
  requestId: string;
  /** The push sender; the app's (web push with the VAPID keys, or none) when left out. */
  sender?: PushSender | undefined;
}

/**
 * Pushes a batch of new notices the notify or scan command wrote, then records what became of each
 * push (`notifications.push.record`), the browsers the push service says are gone and those that
 * took one. A notice to push goes to every browser of its person: sent when any took it, failed
 * when none did. Without the VAPID keys nothing is sent and each such push is recorded as having
 * no browser. A push service failure never fails the batch: the notices are in the centre already.
 */
export async function deliverNoticeBatch(
  principal: Principal,
  batch: NoticeBatchDto,
  options: DeliverNoticesOptions,
): Promise<Omit<Extract<NotifyResult, { outcome: 'done' }>, 'eventId' | 'outcome'>> {
  const sender = options.sender ?? pushSender();
  const outcomes: { noticeId: string; push: NoticePushOutcome }[] = [];
  const gone = new Set<string>();
  const delivered = new Set<string>();
  let pushed = 0;
  for (const notice of batch.notices) {
    if (notice.push !== 'send') continue;
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
