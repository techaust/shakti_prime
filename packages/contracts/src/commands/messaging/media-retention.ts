import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

// W2 WhatsApp media retention (docs/03-roadmap-appendix/phase2.md §11, BLUEPRINT §7.9): a
// customer's WhatsApp file goes `WORKSHOP_DEFAULTS.retention.whatsappMediaYears` after its message
// arrived; the message keeps its text and a short summary of what was sent. The job looks at one
// company's media messages a batch at a time, oldest first, deletes each due file's bytes from the
// store and records the batch (`messaging.media.expire`); then it removes the keys under the
// company's WhatsApp folder that no file names (`messaging.media.record_orphans`). A dry run
// counts and changes nothing.

const Count = z.number().int().min(0);

/** The most messages one batch looks at, and the most the removal names. */
export const MEDIA_RETENTION_BATCH_MAX = 500;

/**
 * Where the next batch starts: after the last message the previous batch looked at, by the time it
 * arrived (exact to the microsecond, as the database writes it) and its id.
 */
export const MediaRetentionCursorSchema = z
  .object({
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/),
    id: IdSchema,
  })
  .strict();
export type MediaRetentionCursor = z.infer<typeof MediaRetentionCursorSchema>;

/**
 * A media message older than the period whose file is still kept, as the job reads it: its file's
 * place in the store, and whether another record still uses the file (`inUse`), which keeps it.
 */
export const DueWhatsAppMediaDto = z
  .object({
    messageId: IdSchema,
    messageAt: MediaRetentionCursorSchema.shape.at,
    fileId: IdSchema,
    bucket: z.string(),
    key: z.string(),
    inUse: z.boolean(),
  })
  .strict();
export type DueWhatsAppMediaDto = z.infer<typeof DueWhatsAppMediaDto>;

/**
 * `messaging.media.expire`: the messages of one batch whose files' bytes the job deleted from the
 * store, and how many files of the batch the store refused (recorded as the batch's error).
 */
export const ExpireWhatsAppMediaInput = z
  .object({
    entityId: EntityIdSchema,
    messageIds: z.array(IdSchema).max(MEDIA_RETENTION_BATCH_MAX),
    failed: Count.default(0),
  })
  .strict();
export type ExpireWhatsAppMediaInput = z.input<typeof ExpireWhatsAppMediaInput>;

/** What the removal recorded: each message whose file went, and the files kept as in use. */
export const ExpireWhatsAppMediaDto = z
  .object({
    entityId: EntityIdSchema,
    removed: z.array(z.object({ messageId: IdSchema, fileId: IdSchema }).strict()),
    inUse: Count,
  })
  .strict();
export type ExpireWhatsAppMediaDto = z.infer<typeof ExpireWhatsAppMediaDto>;

/**
 * `messaging.media.record_orphans`: one company's sweep of the keys no file names, when it began,
 * the keys it removed and those the store refused.
 */
export const RecordWhatsAppMediaOrphansInput = z
  .object({
    entityId: EntityIdSchema,
    startedAt: z.iso.datetime(),
    removed: Count,
    failed: Count,
  })
  .strict();
export type RecordWhatsAppMediaOrphansInput = z.input<typeof RecordWhatsAppMediaOrphansInput>;

export const RecordWhatsAppMediaOrphansDto = z
  .object({ entityId: EntityIdSchema, removed: Count, failed: Count })
  .strict();
export type RecordWhatsAppMediaOrphansDto = z.infer<typeof RecordWhatsAppMediaOrphansDto>;

/** The checks' verdict on a removed file: passed, refused, or never finished. */
export const MEDIA_SUMMARY_VERDICTS = ['passed', 'refused', 'unchecked'] as const;
export type MediaSummaryVerdict = (typeof MEDIA_SUMMARY_VERDICTS)[number];

/** What a removed file was, as its message keeps it (`whatsapp_messages.media_summary`). */
export const WhatsAppMediaSummaryDto = z
  .object({
    contentType: z.string().max(100),
    name: z.string().max(200),
    size: z.number().int().positive(),
    verdict: z.enum(MEDIA_SUMMARY_VERDICTS),
    removedAt: z.iso.datetime(),
  })
  .strict();
export type WhatsAppMediaSummaryDto = z.infer<typeof WhatsAppMediaSummaryDto>;
