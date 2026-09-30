import { z } from 'zod';
import {
  FilePurposeSchema,
  FileSha256Schema,
  UPLOAD_FIELDS,
  UploadContentTypeSchema,
  withUploadRules,
} from '../../api/files';
import { FileRejectReasonSchema } from '../../dto/file';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * `files.upload.begin`: the fields of `POST /files/presign`, checked by its purpose's limits, and
 * the name of the store the server uploads to (`files.bucket`), which the caller never chooses.
 */
export const BeginUploadInput = withUploadRules(
  z.object({ ...UPLOAD_FIELDS, bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,62}$/) }).strict(),
);
export type BeginUploadInput = z.infer<typeof BeginUploadInput>;

/** A store key the app made: segments of letters, digits, dots, dashes and underscores. */
export const FileKeySchema = z
  .string()
  .max(300)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/);

/**
 * `files.upload.complete`. `stored` is what the file store reported for the object (its size, and
 * the SHA-256 the store checked on upload), read by the server before the command runs; the
 * command compares it with what the upload declared.
 */
export const CompleteUploadInput = z
  .object({
    fileId: IdSchema,
    purpose: FilePurposeSchema,
    stored: z
      .object({
        size: z.number().int().min(0),
        sha256: FileSha256Schema.nullable(),
      })
      .strict(),
  })
  .strict();
export type CompleteUploadInput = z.infer<typeof CompleteUploadInput>;

/**
 * What the malware scan said: GuardDuty found no threat, or no scanner exists (a developer's
 * machine, where the worker records `not_scanned`).
 */
export const FileScanVerdictInputSchema = z.enum(['no_threats_found', 'not_scanned']);
export type FileScanVerdictInput = z.infer<typeof FileScanVerdictInputSchema>;

/** `files.file.mark_scanned` (the worker): `scanning` → `scanned` or `not_scanned`. */
export const MarkFileScannedInput = z
  .object({
    entityId: EntityIdSchema,
    fileId: IdSchema,
    verdict: FileScanVerdictInputSchema,
  })
  .strict();
export type MarkFileScannedInput = z.infer<typeof MarkFileScannedInput>;

/** What the worker did to the bytes before the file became usable. */
export const FileSanitisingSchema = z.enum(['re_encoded', 'pdf_checked', 'masked']);
export type FileSanitising = z.infer<typeof FileSanitisingSchema>;

/**
 * `files.file.mark_ready` (the worker): the checked copy, which may sit under a new key with a new
 * size and checksum (a re-encoded image, a masked photo), and what was done to it.
 */
export const MarkFileReadyInput = z
  .object({
    entityId: EntityIdSchema,
    fileId: IdSchema,
    sanitising: FileSanitisingSchema,
    stored: z
      .object({
        key: FileKeySchema,
        contentType: UploadContentTypeSchema,
        size: z.number().int().min(1),
        sha256: FileSha256Schema,
      })
      .strict(),
    /** Numbers and codes covered by the masking step; 0 when nothing was masked. */
    regionsMasked: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type MarkFileReadyInput = z.infer<typeof MarkFileReadyInput>;

/**
 * `files.file.reject` (the worker). `scanStatus` is the scanner's own code, kept for the record
 * (`GuardDutyMalwareScanStatus`), never shown to a person.
 */
export const RejectFileInput = z
  .object({
    entityId: EntityIdSchema,
    fileId: IdSchema,
    reason: FileRejectReasonSchema,
    scanStatus: z
      .string()
      .regex(/^[A-Z_]{1,40}$/)
      .optional(),
  })
  .strict();
export type RejectFileInput = z.infer<typeof RejectFileInput>;
