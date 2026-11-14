import type { WebhookErrorCode, WebhookProvider } from '@shakti/contracts';
import type { WebhookPayload } from './contracts';
import { handleGoogleLeadform, handleMetaLeadgen } from './lead-forms';

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
   * A code the row keeps: with `failed`, why the handler set the delivery aside for good (a lead
   * form nobody has connected yet), shown on Integration health's failed list with Process again;
   * without it, a note on a processed row (a provider's test lead, which makes nothing).
   */
  code?: WebhookErrorCode;
  failed?: boolean;
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
 * The handler of each provider. A provider without one has its rows stored and marked processed
 * with the code `no_handler` until the slice that handles it (W1, I1, T3, T4, V2) adds its line
 * here. I1 handles the Lead Ads and Google lead forms (`./lead-forms.ts`).
 */
export const WEBHOOK_HANDLERS: WebhookHandlers = {
  meta_leadgen: handleMetaLeadgen,
  google_leadform: handleGoogleLeadform,
};
