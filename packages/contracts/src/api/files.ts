import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';

/**
 * Uploads (docs/API.md §3.2, docs/ARCHITECTURE.md §9). File bytes never pass through the API: the
 * caller asks for a 15-minute pre-signed PUT, uploads to the file store, then marks the file
 * complete, which starts the checks (malware scan, re-encoding, PDF check and, for vault photos,
 * the OCR masking) that must pass before the file is `ready`.
 */

export const FILE_PURPOSES = [
  'job_photo',
  'survey_photo',
  'qc_photo',
  'receipt',
  'signature',
  'selfie',
  'customer_document',
  // An import file (docs/design/backend-weeks-3-5.md §8); stored by the import screen's upload.
  'import',
  // A quote's rendered PDF, and the copy the customer signed (Phase 1 accepts a quote by it).
  'quote_pdf',
  'signed_quote',
  // A company's logo and letterhead, printed on its documents.
  'entity_logo',
  'letterhead',
  // A Knowledge Vault document (K1).
  'knowledge',
  // The evidence of a customer's consent (a signed form, a photo of it).
  'consent_evidence',
] as const;
export const FilePurposeSchema = z.enum(FILE_PURPOSES);
export type FilePurpose = z.infer<typeof FilePurposeSchema>;

export const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  // An import file (`import`): a CSV or an Excel workbook.
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const UploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);
export type UploadContentType = z.infer<typeof UploadContentTypeSchema>;

/** 15 MB: a compressed phone photo is well under it; a scanned PDF fits; an import file is 10 MB at most. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** A file's SHA-256 as lowercase hex, as `files.sha256` stores it. */
export const FileSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The name a person's file carried, shown back to them: no folder, no control characters, at most
 * 200 characters (`files_name_length_check`).
 */
export const FileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (name) =>
      !Array.from({ length: name.length }, (_, i) => name.charCodeAt(i)).some(
        // A slash, a backslash, or a control character.
        (code) => code === 0x2f || code === 0x5c || code < 0x20 || code === 0x7f,
      ),
    { message: 'a file name has no folder and no control characters' },
  );

/** The fields an upload declares before any byte is sent. */
export const UPLOAD_FIELDS = {
  entityId: EntityIdSchema,
  purpose: FilePurposeSchema,
  name: FileNameSchema,
  contentType: UploadContentTypeSchema,
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  sha256: FileSha256Schema,
};

/** The rules every upload keeps, whichever door it comes through. */
export function withUploadRules<T extends z.ZodType<{ purpose: FilePurpose; contentType: string }>>(
  schema: T,
): T {
  return schema
    .refine((v) => v.purpose !== 'signature' || v.contentType === 'image/png', {
      message: 'a signature is a PNG',
      path: ['contentType'],
    })
    .refine(
      (v) =>
        (v.purpose === 'import') ===
        (v.contentType === 'text/csv' ||
          v.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      {
        message: 'a CSV or a workbook is an import file, and an import file is one of them',
        path: ['contentType'],
      },
    );
}

/**
 * `POST /files/presign`. The SHA-256 is bound into the upload's signature, so the store refuses
 * any other bytes; the caller computes it before asking.
 */
export const FilePresignRequest = withUploadRules(z.object(UPLOAD_FIELDS).strict());
export type FilePresignRequest = z.infer<typeof FilePresignRequest>;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * An upload address: https, or http on this machine for the development store, which has no
 * certificate.
 */
export const UploadUrlSchema = z.url().refine((raw) => {
  const url = new URL(raw);
  return (
    url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname))
  );
});

export const FilePresignResponse = z
  .object({
    fileId: IdSchema,
    method: z.literal('PUT'),
    uploadUrl: UploadUrlSchema,
    /**
     * Headers the PUT must send exactly: they are bound into the signature, so the store refuses
     * another type, checksum or key. The length is bound as well; every HTTP client sends it itself.
     */
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type FilePresignResponse = z.infer<typeof FilePresignResponse>;

/** `POST /files/:id/complete`: the object landed; the server checks its size and SHA-256. */
export const FileCompleteParams = z.object({ id: IdSchema }).strict();

/** The purpose the upload began with, which names the permission the call needs. */
export const FileCompleteRequest = z.object({ purpose: FilePurposeSchema }).strict();
export type FileCompleteRequest = z.infer<typeof FileCompleteRequest>;

/** `files.status` after the call; the record is usable when a later read shows `ready`. */
export const FileCompleteResponse = z
  .object({
    fileId: IdSchema,
    status: z.literal('scanning'),
  })
  .strict();
export type FileCompleteResponse = z.infer<typeof FileCompleteResponse>;
