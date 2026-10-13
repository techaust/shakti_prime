import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';
import { FileKeySchema } from '../files/uploads';

/** The most import jobs one call of `imports.job.purge` clears; the worker calls again for more. */
export const IMPORT_PURGE_JOBS = 20;

/** The most import files one run deletes in one company; the next run takes the rest. */
export const IMPORT_FILE_PURGE_LIMIT = 200;

/**
 * `imports.job.purge` (the import purge, as the worker principal): clears what the rows of one
 * company's import jobs said once the reconciliation period has passed since the job ended or was
 * left (audit SEC-1).
 */
export const PurgeImportRowsInput = z.object({ entityId: EntityIdSchema }).strict();
export type PurgeImportRowsInput = z.infer<typeof PurgeImportRowsInput>;

/** One call of the purge: the jobs cleared, their rows, and whether more may be waiting. */
export const ImportRowsPurgeDto = z
  .object({
    entityId: EntityIdSchema,
    jobs: z.number().int().min(0).max(IMPORT_PURGE_JOBS),
    rows: z.number().int().min(0),
    more: z.boolean(),
  })
  .strict();
export type ImportRowsPurgeDto = z.infer<typeof ImportRowsPurgeDto>;

/** An import file whose bytes the purge deletes from the store: its job ended, or it is old. */
export const ImportFileToDeleteDto = z
  .object({ id: IdSchema, bucket: z.string().min(1), key: FileKeySchema })
  .strict();
export type ImportFileToDeleteDto = z.infer<typeof ImportFileToDeleteDto>;

/**
 * `imports.file.record_deleted` (the import purge, as the worker principal): the import files of
 * one company whose bytes the worker deleted from the store.
 */
export const RecordImportFilesDeletedInput = z
  .object({
    entityId: EntityIdSchema,
    fileIds: z.array(IdSchema).min(1).max(IMPORT_FILE_PURGE_LIMIT),
  })
  .strict();
export type RecordImportFilesDeletedInput = z.infer<typeof RecordImportFilesDeletedInput>;

export const ImportFilesDeletedDto = z
  .object({
    entityId: EntityIdSchema,
    deleted: z.number().int().min(0).max(IMPORT_FILE_PURGE_LIMIT),
  })
  .strict();
export type ImportFilesDeletedDto = z.infer<typeof ImportFilesDeletedDto>;
