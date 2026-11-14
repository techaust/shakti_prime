import type { WebhookProvider } from '@shakti/contracts';
import type { WebhookPayload } from './contracts';

/** What a handler is told besides the payload. */
export interface WebhookHandlerContext {
  /** The `webhook_inbox` row: an idempotency key for whatever the handler records. */
  inboxId: string;
  requestId: string;
  /** Which try this is, from 1. */
  attempts: number;
}

/**
 * The outcome of a handler: the company the delivery belongs to, when it names one, recorded on
 * the row. A handler makes each item it records idempotent by the provider's own id, since a
 * delivery is processed once but its items may arrive again in another delivery.
 */
export interface WebhookHandled {
  entityId: number | null;
  /**
   * A code recorded on the processed row when the delivery was handled but recorded nothing (a
   * WhatsApp number of no company: `whatsapp_number_unknown`), shown on Integration Health.
   */
  code?: string;
}

/**
 * A provider's handler (docs/03-roadmap-appendix/phase2.md §5.1). It acts only through domain
 * commands as its principal; a thrown error is retried by QStash, and the last retry's failure
 * fails the row (`handler_failed`). Payloads are untrusted provider data, already read by the
 * provider's contract.
 */
export type WebhookHandler<P extends WebhookProvider> = (
  payload: WebhookPayload<P>,
  context: WebhookHandlerContext,
) => Promise<WebhookHandled>;

export type WebhookHandlers = { readonly [P in WebhookProvider]?: WebhookHandler<P> };

/**
 * The handler of each provider: a provider's rows are stored and marked processed with the code
 * `no_handler` until the slice that handles it (W1, I1, T3, T4, V2) adds its line here.
 */
export const WEBHOOK_HANDLERS: WebhookHandlers = {
  // WhatsApp (W1, docs/03-roadmap-appendix/phase2.md §6.1): messages, statuses, template events
  // and quality updates. Its dependencies are read when a delivery comes, never at import time.
  meta_whatsapp: async (payload, context) => {
    const { whatsappHandler } = await import('./whatsapp');
    const { whatsappHandlerDeps } = await import('./whatsapp-deps');
    return whatsappHandler(whatsappHandlerDeps())(payload, context);
  },
};
