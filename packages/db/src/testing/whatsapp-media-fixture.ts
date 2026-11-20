// W2 media retention: a customer's WhatsApp photo or PDF as the platform keeps it, for the suites
// on real Postgres (docs/03-roadmap-appendix/phase2.md §11): an inbound media message recorded
// through `app.whatsapp_record_inbound()` at the time given (years back, for the retention
// period), with a `whatsapp_media` file row attached as `messaging.media.attach` leaves it. The
// bytes are the caller's to put in its own store. Values are test data, never copy.
import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { asMigrator, asPrincipal, principalFor } from './index';
import type { WhatsAppChannelFixture, WhatsAppCustomerFixture } from './whatsapp-fixture';

export interface WhatsAppMediaFixture {
  threadId: string;
  messageId: string;
  /** When the message arrived, as the database stores it. */
  createdAt: string;
  fileId: string;
  bucket: string;
  key: string;
  /** The upload's own key, when the checks stored a changed copy under `key`. */
  originalKey: string | null;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

/** A media message of the customer that arrived at `at`, its file attached, stored in `bucket`. */
export async function whatsappMediaMessage(
  channel: WhatsAppChannelFixture,
  customer: WhatsAppCustomerFixture,
  options: {
    at: Date;
    bucket?: string;
    contentType?: 'image/jpeg' | 'application/pdf';
    status?: 'ready' | 'rejected' | 'scanning';
    caption?: string;
    /** Recorded as the checks leave a file they replaced with a masked copy beside the upload. */
    checkedCopy?: boolean;
  },
): Promise<WhatsAppMediaFixture> {
  const workers: Principal = {
    ...principalFor('system:workers', [customer.entityId]),
    id: SYSTEM_WORKERS_PRINCIPAL_ID,
    kind: 'system',
  };
  const recorded = await asPrincipal(workers, async ({ tx }) => {
    const rows = (await tx.execute(sql`
      select thread_id, message_id from app.whatsapp_record_inbound(
        ${channel.phoneNumberId}, ${customer.waId}, ${`wamid.${newId()}`}, 'media',
        ${options.caption ?? null}, null, ${options.at.toISOString()}::timestamptz, 'people')`)) as unknown as {
      thread_id: string;
      message_id: string;
    }[];
    return rows[0];
  });
  if (!recorded) throw new Error('no media message recorded');
  const fileId = newId();
  const contentType = options.contentType ?? 'image/jpeg';
  const bucket = options.bucket ?? 'memory';
  const extension = EXTENSIONS[contentType] ?? 'bin';
  const upload = `${String(customer.entityId)}/whatsapp_media/${fileId}.${extension}`;
  const key =
    options.checkedCopy === true ? upload.replace(/\.[a-z]+$/, `-checked.${extension}`) : upload;
  const originalKey = options.checkedCopy === true ? upload : null;
  const createdAt = await asMigrator(async (m) => {
    await m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256,
                               status, scan_result, created_by)
            values (${fileId}, ${customer.entityId}, 'whatsapp_media', ${bucket}, ${key},
                    ${upload.slice(upload.lastIndexOf('/') + 1)}, ${contentType}, 2048,
                    ${'a'.repeat(64)}, ${options.status ?? 'ready'},
                    ${originalKey === null ? null : m.json({ originalKey })},
                    ${SYSTEM_WORKERS_PRINCIPAL_ID})`;
    const [row] = await m<{ created_at: string }[]>`
      update whatsapp_messages set file_id = ${fileId}
       where id = ${recorded.message_id}
      returning to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`;
    if (!row) throw new Error('the media message is gone');
    return row.created_at;
  });
  return {
    threadId: recorded.thread_id,
    messageId: recorded.message_id,
    createdAt,
    fileId,
    bucket,
    key,
    originalKey,
  };
}

/** The message's file and summary, and its file row's deletion, read with the migrator. */
export async function whatsappMediaState(fixture: WhatsAppMediaFixture): Promise<{
  fileId: string | null;
  bodyMasked: string | null;
  mediaSummary: Record<string, unknown> | null;
  fileDeletedAt: Date | null;
}> {
  return asMigrator(async (m) => {
    const [row] = await m<
      {
        file_id: string | null;
        body_masked: string | null;
        media_summary: Record<string, unknown> | null;
        deleted_at: Date | null;
      }[]
    >`
      select msg.file_id, msg.body_masked, msg.media_summary, f.deleted_at
        from whatsapp_messages msg join files f on f.id = ${fixture.fileId}
       where msg.id = ${fixture.messageId}`;
    if (!row) throw new Error('the media message is gone');
    return {
      fileId: row.file_id,
      bodyMasked: row.body_masked,
      mediaSummary: row.media_summary,
      fileDeletedAt: row.deleted_at,
    };
  });
}
