import type { EventPayload } from '@shakti/contracts';

/** A customer's message as `messaging.message.received` names it. */
export type ReceivedMessage = Partial<Pick<EventPayload<'messaging.message.received'>, 'platform'>>;

/**
 * Whether the platform answers this customer message itself (docs/03-roadmap-appendix/phase2.md
 * §7.1): the STATUS keyword, or a six-digit code sent while a code waits on the chat. The WhatsApp
 * handler answers such a message deterministically and marks its `messaging.message.received`
 * event `platform`; no agent drafts a reply to it. The Concierge (A3) calls this with the event's
 * payload before it drafts; an event without the mark (written before S3) is not the platform's.
 */
export function isHandledByPlatform(message: ReceivedMessage): boolean {
  return message.platform === true;
}
