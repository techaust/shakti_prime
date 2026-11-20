import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';

type Ctx = Pick<RequestContext, 'tx'>;

/** A customer's message the platform answers, as `app.whatsapp_inbound_facts()` reads it. */
export interface InboundFacts {
  messageId: string;
  entityId: number;
  threadId: string;
  kind: string;
  /** A button's own id, as WhatsApp sent it back; null for any other message. */
  buttonPayload: string | null;
  /** The chat's number, the sender's; null once it was removed. */
  waId: string | null;
  accountId: string | null;
}

/**
 * An inbound message of the request's companies through `app.whatsapp_inbound_facts()`
 * (`messaging.process`): its chat, the chat's number and customer, and a button's id. Null when
 * it is not such a message.
 */
export async function readInboundFacts(ctx: Ctx, messageId: string): Promise<InboundFacts | null> {
  const [r] = (await ctx.tx.execute(sql`
    select message_id, entity_id, thread_id, kind, button_payload, wa_id, account_id
      from app.whatsapp_inbound_facts(${messageId}::uuid)`)) as unknown as {
    message_id: string;
    entity_id: number;
    thread_id: string;
    kind: string;
    button_payload: string | null;
    wa_id: string | null;
    account_id: string | null;
  }[];
  if (r === undefined) return null;
  return {
    messageId: r.message_id,
    entityId: r.entity_id,
    threadId: r.thread_id,
    kind: r.kind,
    buttonPayload: r.button_payload,
    waId: r.wa_id,
    accountId: r.account_id,
  };
}

/** What the messaging worker adds to a message as it sends it. */
export interface SendExtras {
  /** The milestone and subject the message was queued for; null for any other message. */
  milestone: {
    name: string;
    subjectKind: string;
    subjectId: string;
    /** The person whose action brought it (a quote's sender); null for none. */
    requestedBy: string | null;
  } | null;
  /** The purpose of its template (`acceptance_code` gets its code); null for none. */
  templatePurpose: string | null;
  /** The file it carries (a quote's PDF), with the file's state; null for none. */
  file: { bucket: string; key: string; name: string; status: string } | null;
}

/**
 * The milestone, template purpose and file of a queued outbound message through
 * `app.whatsapp_send_extras()` (`messaging.process`); null when it is not such a message.
 */
export async function readSendExtras(ctx: Ctx, messageId: string): Promise<SendExtras | null> {
  const [r] = (await ctx.tx.execute(sql`
    select milestone, subject_kind, subject_id, template_purpose, file_bucket, file_key,
           file_name, file_status, requested_by
      from app.whatsapp_send_extras(${messageId}::uuid)`)) as unknown as {
    milestone: string | null;
    subject_kind: string | null;
    subject_id: string | null;
    template_purpose: string | null;
    file_bucket: string | null;
    file_key: string | null;
    file_name: string | null;
    file_status: string | null;
    requested_by: string | null;
  }[];
  if (r === undefined) return null;
  return {
    milestone:
      r.milestone === null || r.subject_kind === null || r.subject_id === null
        ? null
        : {
            name: r.milestone,
            subjectKind: r.subject_kind,
            subjectId: r.subject_id,
            requestedBy: r.requested_by,
          },
    templatePurpose: r.template_purpose,
    file:
      r.file_bucket === null || r.file_key === null
        ? null
        : {
            bucket: r.file_bucket,
            key: r.file_key,
            name: r.file_name ?? '',
            status: r.file_status ?? '',
          },
  };
}
