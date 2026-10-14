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
  .object({
    id: IdSchema,
    bucket: z.string().min(1),
    key: FileKeySchema,
    /** When it was uploaded: the list's order, and where the next page starts. */
    createdAt: z.iso.datetime(),
  })
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

/** The rows one call of the identity pass reads and checks; a larger job takes several calls. */
export const IMPORT_IDENTITY_CHUNK = 1000;

/**
 * `imports.job.mask_identity` (the one-off identity pass, as the worker principal): checks the next
 * `IMPORT_IDENTITY_CHUNK` rows of one job of one company imported before the identity-number rule.
 */
export const MaskImportIdentityInput = z
  .object({ entityId: EntityIdSchema, jobId: IdSchema })
  .strict();
export type MaskImportIdentityInput = z.infer<typeof MaskImportIdentityInput>;

/**
 * One call of the pass: the job (null when another run holds it or it is checked already), the
 * rows changed, the columns left out and values masked, and whether the job is now checked.
 */
export const ImportIdentityCheckDto = z
  .object({
    entityId: EntityIdSchema,
    jobId: IdSchema.nullable(),
    rows: z.number().int().min(0),
    leftOutColumns: z.number().int().min(0),
    maskedValues: z.number().int().min(0),
    done: z.boolean(),
  })
  .strict();
export type ImportIdentityCheckDto = z.infer<typeof ImportIdentityCheckDto>;

/** The import purge's parts, by the job name each records in `retention_runs`. */
export const ImportPurgeJobSchema = z.enum([
  'import-identity-check',
  'import-rows-purge',
  'import-files-purge',
]);
export type ImportPurgeJob = z.infer<typeof ImportPurgeJobSchema>;

/**
 * `imports.purge.record_failure` (the import purge, as the worker principal): one call of the purge
 * failed in one company, recorded by its code alone (a SQLSTATE or a domain code).
 */
export const RecordImportPurgeFailureInput = z
  .object({
    entityId: EntityIdSchema,
    job: ImportPurgeJobSchema,
    error: z.string().regex(/^[a-z0-9 _.:-]{1,120}$/),
  })
  .strict();
export type RecordImportPurgeFailureInput = z.infer<typeof RecordImportPurgeFailureInput>;

export const ImportPurgeFailureDto = z
  .object({ entityId: EntityIdSchema, job: ImportPurgeJobSchema })
  .strict();
export type ImportPurgeFailureDto = z.infer<typeof ImportPurgeFailureDto>;
