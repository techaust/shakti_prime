import {
  DueWhatsAppMediaDto,
  MEDIA_RETENTION_BATCH_MAX,
  type MediaRetentionCursor,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { RequestContext } from '@shakti/db';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';

// What the WhatsApp media retention job reads (docs/03-roadmap-appendix/phase2.md §11), as
// `system:workers` with the platform-only `messaging.media.expire`, through two definers that
// check the grant and the company; neither answers a message's text or a customer row.

/**
 * The next `limit` (at most `MEDIA_RETENTION_BATCH_MAX`) media messages of one company older than
 * `WORKSHOP_DEFAULTS.retention.whatsappMediaYears` whose file is still kept, oldest first after
 * the cursor (`app.whatsapp_media_due()`), each with its file's place in the store and whether
 * another record still uses the file.
 */
export async function dueWhatsAppMedia(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
  after: MediaRetentionCursor | null,
  limit: number,
): Promise<DueWhatsAppMediaDto[]> {
  const rows = (await ctx.tx.execute(sql`
    select message_id, message_at, file_id, bucket, key, original_key, content_type, in_use
      from app.whatsapp_media_due(${entityId}::smallint,
                                  ${WORKSHOP_DEFAULTS.retention.whatsappMediaYears}::integer,
                                  ${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid,
                                  ${Math.min(Math.max(limit, 0), MEDIA_RETENTION_BATCH_MAX)}::integer)`)) as unknown as {
    message_id: string;
    message_at: string;
    file_id: string;
    bucket: string;
    key: string;
    original_key: string | null;
    content_type: string;
    in_use: boolean;
  }[];
  return rows.map((r) =>
    DueWhatsAppMediaDto.parse({
      messageId: r.message_id,
      messageAt: r.message_at,
      fileId: r.file_id,
      bucket: r.bucket,
      key: r.key,
      originalKey: r.original_key,
      contentType: r.content_type,
      inUse: r.in_use,
    }),
  );
}

/** The most keys one call to `whatsAppMediaKeysKept` takes (the store lists 1,000 at a time). */
export const MEDIA_KEYS_MAX = 1000;

/**
 * Of the keys found under one company's WhatsApp folder in the store, those to keep
 * (`app.whatsapp_media_keys_kept()`): named by a file row not deleted, or of a file still in its
 * checks. Every other key belongs to no file.
 */
export async function whatsAppMediaKeysKept(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
  bucket: string,
  keys: readonly string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  if (keys.length > MEDIA_KEYS_MAX) throw new RangeError('at most 1,000 keys at a time');
  // The keys travel as one JSON array, so no key's characters can change the statement.
  const rows = (await ctx.tx.execute(sql`
    select k from app.whatsapp_media_keys_kept(
                    ${entityId}::smallint, ${bucket}::text,
                    array(select pg_catalog.jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))) as k`)) as unknown as {
    k: string;
  }[];
  return new Set(rows.map((r) => r.k));
}
