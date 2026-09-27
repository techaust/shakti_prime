import { MetaSignatureHeaderSchema, MetaVerifyQuery, WhatsAppWebhook } from '@shakti/contracts';
import { createHmac } from 'node:crypto';
import { safeEqual } from '../http';

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
  const query = MetaVerifyQuery.safeParse(Object.fromEntries(params));
  if (!query.success || verifyToken === '') return { ok: false };
  const challenge = query.data['hub.challenge'];
  return safeEqual(query.data['hub.verify_token'], verifyToken)
    ? { ok: true, challenge }
    : { ok: false };
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
  if (header === null || appSecret === '') return false;
  // Meta sends lowercase hex; the contract's pattern is the header's only accepted form.
  if (!MetaSignatureHeaderSchema.safeParse(header.toLowerCase()).success) return false;
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
  /** False when the body is not a WhatsApp webhook the published contract accepts; no events then. */
  valid: boolean;
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  templates: TemplateStatusUpdate[];
}

type Change = WhatsAppWebhook['entry'][number]['changes'][number];

/** The contract refuses a handled field in its catch-all branch, so the field names the branch. */
function isField<F extends 'messages' | 'message_template_status_update'>(
  change: Change,
  field: F,
): change is Extract<Change, { field: F }> {
  return change.field === field;
}

/**
 * The events in a webhook body, read through the published `WhatsAppWebhook` contract. A field
 * the BOS does not handle is ignored; a body the contract refuses gives no events.
 */
export function parseWhatsAppWebhook(body: unknown): WhatsAppWebhookEvents {
  const parsed = WhatsAppWebhook.safeParse(body);
  const events: WhatsAppWebhookEvents = {
    valid: parsed.success,
    messages: [],
    statuses: [],
    templates: [],
  };
  if (!parsed.success) return events;
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (isField(change, 'messages')) {
        const phoneNumberId = change.value.metadata.phone_number_id;
        for (const message of change.value.messages ?? []) {
          events.messages.push({
            id: message.id,
            phoneNumberId,
            from: message.from,
            timestamp: Number(message.timestamp),
            type: message.type,
            text: message.text?.body,
          });
        }
        for (const status of change.value.statuses ?? []) {
          events.statuses.push({
            messageId: status.id,
            phoneNumberId,
            status: status.status === 'deleted' ? 'other' : status.status,
            timestamp: Number(status.timestamp),
            recipientId: status.recipient_id,
            errorCodes: (status.errors ?? []).map((e) => e.code),
          });
        }
      } else if (isField(change, 'message_template_status_update')) {
        events.templates.push({
          templateName: change.value.message_template_name,
          event: change.value.event,
        });
      }
    }
  }
  return events;
}
