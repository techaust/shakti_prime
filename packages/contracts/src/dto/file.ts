import { z } from 'zod';
import { FilePurposeSchema, UploadContentTypeSchema } from '../api/files';
import { EntityIdSchema, IdSchema } from '../ids';
import { FileStatusSchema } from '../imports/enums';

/**
 * Why the checks refused a file (`files.scan_result.reason`); each has a sentence in the message
 * catalogue under `files.rejected`, which the uploader shows.
 */
export const FileRejectReasonSchema = z.enum([
  // The malware scan found a threat.
  'file_infected',
  // The scanner could not scan the object (unsupported, access denied or failed).
  'file_scan_failed',
  // No scanner exists where the file was uploaded, and that is a hosted environment.
  'file_not_scanned',
  // The bytes are not the declared type, or cannot be read as it.
  'file_unreadable',
  // An image of more pixels than the re-encoder accepts.
  'file_image_too_large',
  // A PDF that carries scripts, launch actions or embedded files.
  'file_pdf_active_content',
  // A PDF of more pages than the vault reads.
  'file_pdf_too_many_pages',
  // The masking step could not find the numbers it must cover, so nothing was kept.
  'file_mask_failed',
  // One page of a vault PDF took longer to read than a check may take, so nothing was kept.
  'file_pdf_page_too_dense',
  // The masking step is not set up where the vault photo or PDF was uploaded.
  'file_masking_unavailable',
  // The upload began but never completed; the sweep refused it.
  'file_upload_abandoned',
]);
export type FileRejectReason = z.infer<typeof FileRejectReasonSchema>;

/** A stored file as the screens see it; the store's key and checksum stay on the server. Strict. */
export const FileDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    purpose: FilePurposeSchema,
    name: z.string(),
    contentType: z.string(),
    size: z.number().int().min(1),
    status: FileStatusSchema,
    /** Set when the checks refused the file. */
    rejectReason: FileRejectReasonSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type FileDto = z.infer<typeof FileDto>;

/**
 * What `files.upload.begin` records: the file's id and where its bytes go. The web layer signs the
 * upload address for `key` (the store is outside the domain) and answers `FilePresignResponse`.
 */
export const UploadSlotDto = z
  .object({
    fileId: IdSchema,
    entityId: EntityIdSchema,
    key: z.string().min(1).max(300),
    contentType: UploadContentTypeSchema,
    size: z.number().int().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type UploadSlotDto = z.infer<typeof UploadSlotDto>;
