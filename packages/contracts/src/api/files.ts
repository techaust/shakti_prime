import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';

/**
 * Uploads (docs/API.md §3.2, docs/ARCHITECTURE.md §9). File bytes never pass through the API: the
 * app asks for a 15-minute pre-signed PUT, uploads to S3, then marks the file complete, which
 * starts the malware scan and, for customer documents, the OCR masking step.
 */

export const FILE_PURPOSES = [
  'job_photo',
  'survey_photo',
  'qc_photo',
  'receipt',
  'signature',
  'selfie',
  'customer_document',
  // An import file (docs/design/backend-weeks-3-5.md §8); stored by the import screen's upload
  // until the S3 store and its pre-signed path arrive in Phase 1.
  'import',
] as const;
export const FilePurposeSchema = z.enum(FILE_PURPOSES);
export type FilePurpose = z.infer<typeof FilePurposeSchema>;

export const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export const UploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);

/** 15 MB: a compressed phone photo is well under it; a scanned PDF fits. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** `POST /files/presign`. `id` is the client's UUIDv7, so a retried request names the same file. */
export const FilePresignRequest = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    purpose: FilePurposeSchema,
    contentType: UploadContentTypeSchema,
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    sha256: z.hash('sha256').optional(),
  })
  .strict()
  .refine((v) => v.purpose !== 'signature' || v.contentType === 'image/png', {
    message: 'a signature is a PNG',
    path: ['contentType'],
  })
  .refine((v) => v.purpose !== 'import', {
    message: 'an import file is uploaded through the import screen',
    path: ['purpose'],
  });
export type FilePresignRequest = z.infer<typeof FilePresignRequest>;

export const FilePresignResponse = z
  .object({
    fileId: IdSchema,
    method: z.literal('PUT'),
    uploadUrl: z.url({ protocol: /^https$/ }),
    /** Headers the PUT must send exactly, so S3 enforces the declared type and size. */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type FilePresignResponse = z.infer<typeof FilePresignResponse>;

/** `POST /files/:id/complete`: the object landed; the server checks its size against the claim. */
export const FileCompleteParams = z.object({ id: IdSchema }).strict();

export const FileCompleteRequest = z
  .object({
    size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
    sha256: z.hash('sha256').optional(),
  })
  .strict();
export type FileCompleteRequest = z.infer<typeof FileCompleteRequest>;

/** `files.status` after the call; the record is usable when a later read shows `ready`. */
export const FileCompleteResponse = z
  .object({
    fileId: IdSchema,
    status: z.enum(['scanning', 'ready']),
  })
  .strict();
export type FileCompleteResponse = z.infer<typeof FileCompleteResponse>;
