import { z } from 'zod';
import { FileNameSchema, FileSha256Schema } from '../../api/files';
import { EntityIdSchema, IdSchema } from '../../ids';
import { FileKeySchema } from '../files/uploads';

/**
 * Printed documents (ADR 0009, docs/03-roadmap-appendix/phase1.md §6.4). A command that issues a document emits
 * `print.document.requested`; the render worker loads the document, renders its template with
 * Chromium, records the PDF with `files.document.record` and attaches it to the document.
 */

/** The purposes a rendered PDF is stored under: a quote, or a company's proof page. */
export const RENDERED_FILE_PURPOSES = ['quote_pdf', 'print_proof'] as const;
export const RenderedFilePurposeSchema = z.enum(RENDERED_FILE_PURPOSES);
export type RenderedFilePurpose = z.infer<typeof RenderedFilePurposeSchema>;

/**
 * `files.document.record` (the render worker, `files.process`): a PDF the worker rendered from
 * the BOS's own template and stored under `key`. It is recorded `ready` with no checks, since no
 * person's file is in it. `fileId` is chosen by the worker from the job, so a repeated delivery
 * records the same file once.
 */
export const RecordRenderedFileInput = z
  .object({
    entityId: EntityIdSchema,
    fileId: IdSchema,
    purpose: RenderedFilePurposeSchema,
    bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,62}$/),
    key: FileKeySchema,
    name: FileNameSchema,
    size: z.number().int().min(1),
    sha256: FileSha256Schema,
  })
  .strict();
export type RecordRenderedFileInput = z.infer<typeof RecordRenderedFileInput>;

/**
 * The rendered purposes whose earlier files are retired when a new one is recorded: a company's
 * proof page prints its bank account in full, so an earlier page would keep a replaced account
 * readable (P4 review L10).
 */
export const RETIRED_ON_REPRINT = ['print_proof'] as const;

/** At most this many earlier files are retired by one call. */
export const RETIRE_RENDERED_LIMIT = 100;

/**
 * `files.document.retire` (the render worker, `files.process`): after `keepFileId` is recorded,
 * the company's other ready files of `purpose` are refused as replaced (`file_replaced`). The
 * answer names each one's key, so the worker deletes its bytes.
 */
export const RetireRenderedFilesInput = z
  .object({
    entityId: EntityIdSchema,
    purpose: z.enum(RETIRED_ON_REPRINT),
    keepFileId: IdSchema,
  })
  .strict();
export type RetireRenderedFilesInput = z.infer<typeof RetireRenderedFilesInput>;

export const RetireRenderedFilesDto = z
  .object({
    retired: z.number().int().min(0).max(RETIRE_RENDERED_LIMIT),
    keys: z.array(FileKeySchema).max(RETIRE_RENDERED_LIMIT),
  })
  .strict();
export type RetireRenderedFilesDto = z.infer<typeof RetireRenderedFilesDto>;

/**
 * `print.proof.request`: an Executive asks for a one-page proof of a company's letterhead, logo,
 * address, GSTIN and bank details, rendered by the same worker as every document.
 */
export const RequestPrintProofInput = z.object({ entityId: EntityIdSchema }).strict();
export type RequestPrintProofInput = z.infer<typeof RequestPrintProofInput>;

/** The proof's id, which is also the id of its file once the worker has stored it. */
export const PrintProofDto = z
  .object({ proofId: IdSchema, entityId: EntityIdSchema, requestedAt: z.iso.datetime() })
  .strict();
export type PrintProofDto = z.infer<typeof PrintProofDto>;
