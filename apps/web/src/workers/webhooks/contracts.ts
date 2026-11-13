import {
  ExotelCallStatusWebhook,
  ExotelIncomingWebhook,
  StoredGoogleLead,
  LiveKitWebhook,
  MetaLeadgenWebhook,
  WhatsAppWebhook,
  type WebhookProvider,
} from '@shakti/contracts';
import { asExotelStrings } from '../../integrations/exotel/status-callback';

/** What the worker needs of a contract: a parse that answers instead of throwing. */
export interface PayloadContract<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * Exotel sends every value as a string, but a JSON callback may carry numbers, so its callbacks are
 * read as strings first, as `parseStatusCallback` reads them.
 */
function asStrings<T>(schema: Schema<T>): PayloadContract<T> {
  return { safeParse: (value) => schema.safeParse(asExotelStrings(value)) };
}

/**
 * The published contract each provider's stored payload is read with (docs/06-api.md §3.4) before
 * a handler sees it.
 */
export const WEBHOOK_CONTRACTS = {
  meta_whatsapp: WhatsAppWebhook,
  meta_leadgen: MetaLeadgenWebhook,
  // Stored without its form key, which the route drops.
  google_leadform: StoredGoogleLead,
  exotel_status: asStrings<ExotelCallStatusWebhook>(ExotelCallStatusWebhook),
  exotel_incoming: asStrings<ExotelIncomingWebhook>(ExotelIncomingWebhook),
  livekit: LiveKitWebhook,
} as const satisfies Record<WebhookProvider, PayloadContract<unknown>>;

/** A provider's payload as its contract reads it. */
export type WebhookPayload<P extends WebhookProvider> =
  (typeof WEBHOOK_CONTRACTS)[P] extends PayloadContract<infer T> ? T : never;
