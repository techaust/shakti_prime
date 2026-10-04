import { z } from 'zod';
import { FileNameSchema, FileSha256Schema } from '../../api/files';
import { EntityIdSchema, IdSchema } from '../../ids';
import { FileKeySchema } from '../files/uploads';

/**
 * Printed documents (ADR 0009, docs/design/phase1.md §6.4). A command that issues a document emits
 * `print.document.requested`; the render worker loads the document, renders its template with
 * Chromium, records the PDF with `files.document.record` and attaches it to the document.
 */

/** The purposes a rendered PDF is stored under: a quote, or a company's sample page. */
export const RENDERED_FILE_PURPOSES = ['quote_pdf', 'print_sample'] as const;
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
 * `print.sample.request`: an Executive asks for a one-page sample of a company's letterhead, logo,
 * address, GSTIN and bank details, rendered by the same worker as every document.
 */
export const RequestPrintSampleInput = z.object({ entityId: EntityIdSchema }).strict();
export type RequestPrintSampleInput = z.infer<typeof RequestPrintSampleInput>;

/** The sample's id, which is also the id of its file once the worker has stored it. */
export const PrintSampleDto = z
  .object({ sampleId: IdSchema, entityId: EntityIdSchema, requestedAt: z.iso.datetime() })
  .strict();
export type PrintSampleDto = z.infer<typeof PrintSampleDto>;
