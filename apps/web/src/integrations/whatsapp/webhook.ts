import { createHmac } from 'node:crypto';
import { asArray, asObject, asString, at, safeEqual } from '../http';

/**
 * The Meta webhook for WhatsApp (docs/API.md §3.4, `GET/POST /webhooks/meta/whatsapp`): the
 * verification handshake, the `X-Hub-Signature-256` check over the raw body, and the events the
 * worker needs from a payload. The route verifies, stores the raw body in `webhook_inbox` and
 * answers 200; the worker reads it with `parseWhatsAppWebhook()` (both arrive in Phase 1).
 * Message text is untrusted customer input and is never logged.
 */

export type HandshakeResult = { ok: true; challenge: string } | { ok: false };

/** Meta's subscription check: answer the challenge only for our verify token. */
export function verifyHandshake(params: URLSearchParams, verifyToken: string): HandshakeResult {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge') ?? '';
  if (mode !== 'subscribe' || verifyToken === '' || challenge === '') return { ok: false };
  return safeEqual(token, verifyToken) ? { ok: true, challenge } : { ok: false };
}

/**
 * True when `X-Hub-Signature-256` is `sha256=` and the HMAC-SHA256 of the exact raw body under the
 * app secret. The body must be the bytes as received: parsing and re-serialising changes them.
 */
export function verifyHubSignature(
  rawBody: string | Uint8Array,
  header: string | null,
  appSecret: string,
): boolean {
  if (header === null || !header.startsWith('sha256=') || appSecret === '') return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(header.slice('sha256='.length).toLowerCase(), expected);
}

export interface InboundMessage {
  /** Meta's message id: the idempotency key in `webhook_inbox`. */
  id: string;
  phoneNumberId: string;
  from: string;
  timestamp: number;
  type: string;
  /** Present for `text` messages; untrusted. */
  text: string | undefined;
}

export interface StatusUpdate {
  /** The id `sendTemplate` or `sendText` returned. */
  messageId: string;
  phoneNumberId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'other';
  timestamp: number;
  recipientId: string | undefined;
  /** Meta's error codes for a failed message. */
  errorCodes: number[];
}

export interface TemplateStatusUpdate {
  templateName: string;
  event: string;
}

export interface WhatsAppWebhookEvents {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  templates: TemplateStatusUpdate[];
}

const STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

function seconds(value: unknown): number {
  const text = asString(value) ?? '';
  return /^\d+$/.test(text) ? Number(text) : 0;
}

/** The events in a webhook body; anything unrecognised is ignored. */
export function parseWhatsAppWebhook(body: unknown): WhatsAppWebhookEvents {
  const events: WhatsAppWebhookEvents = { messages: [], statuses: [], templates: [] };
  if (asString(asObject(body)?.object) !== 'whatsapp_business_account') return events;
  for (const entry of asArray(asObject(body)?.entry)) {
    for (const change of asArray(asObject(entry)?.changes)) {
      const field = asString(asObject(change)?.field);
      const value = asObject(asObject(change)?.value);
      if (value === undefined) continue;
      if (field === 'messages') {
        const phoneNumberId = asString(at(value, 'metadata', 'phone_number_id')) ?? '';
        for (const message of asArray(value.messages)) {
          const id = asString(asObject(message)?.id);
          const from = asString(asObject(message)?.from);
          if (id === undefined || from === undefined) continue;
          events.messages.push({
            id,
            phoneNumberId,
            from,
            timestamp: seconds(asObject(message)?.timestamp),
            type: asString(asObject(message)?.type) ?? 'unknown',
            text: asString(at(message, 'text', 'body')),
          });
        }
        for (const status of asArray(value.statuses)) {
          const messageId = asString(asObject(status)?.id);
          if (messageId === undefined) continue;
          const state = asString(asObject(status)?.status) ?? '';
          events.statuses.push({
            messageId,
            phoneNumberId,
            status: STATUSES.has(state) ? (state as StatusUpdate['status']) : 'other',
            timestamp: seconds(asObject(status)?.timestamp),
            recipientId: asString(asObject(status)?.recipient_id),
            errorCodes: asArray(asObject(status)?.errors)
              .map((e) => asObject(e)?.code)
              .filter((c): c is number => typeof c === 'number'),
          });
        }
      } else if (field === 'message_template_status_update') {
        const templateName = asString(value.message_template_name);
        const event = asString(value.event);
        if (templateName !== undefined && event !== undefined) {
          events.templates.push({ templateName, event });
        }
      }
    }
  }
  return events;
}
