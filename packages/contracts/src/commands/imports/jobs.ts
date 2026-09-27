import { z } from 'zod';
import { AccountTypeSchema, CustomerLanguageSchema, SiteTypeSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';
import {
  IMPLEMENTED_IMPORT_KINDS,
  IMPORT_LIMITS,
  ImportFormatSchema,
  ImportKindSchema,
  ImportRowStateSchema,
  LeadImportFieldSchema,
  type LeadImportField,
} from '../../imports/enums';

/** A column name as the header row gives it, made unique by the parser. */
export const ImportColumnSchema = z.string().min(1).max(IMPORT_LIMITS.maxHeaderLength);

const Code = z.string().trim().min(1).max(40);

/**
 * How the columns of a leads file fill a lead (docs/design/backend-weeks-3-5.md §8). `columns`
 * names the file column for each field; `defaults` fill a field no column gives, or a blank cell.
 * The contact's name and phone must come from the file, and every row needs a pipeline.
 */
export const LeadImportMappingSchema = z
  .object({
    columns: z.partialRecord(LeadImportFieldSchema, ImportColumnSchema),
    defaults: z
      .object({
        pipelineKey: Code.optional(),
        accountType: AccountTypeSchema.optional(),
        preferredLanguage: CustomerLanguageSchema.optional(),
        siteType: SiteTypeSchema.optional(),
        sourceCode: Code.optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .refine((m) => m.columns.contactName !== undefined && m.columns.phone !== undefined, {
    message: 'the name and phone columns are required',
    path: ['columns'],
  })
  .refine((m) => m.columns.pipelineKey !== undefined || m.defaults.pipelineKey !== undefined, {
    message: 'a pipeline column or default is required',
    path: ['defaults', 'pipelineKey'],
  })
  .refine(
    (m) => {
      const used = Object.values(m.columns);
      return new Set(used).size === used.length;
    },
    { message: 'a column fills one field only', path: ['columns'] },
  );
export type LeadImportMapping = z.infer<typeof LeadImportMappingSchema>;
export type { LeadImportField };

/** The mapping stored on a job or a template. Only leads exist today. */
export const ImportMappingSchema = LeadImportMappingSchema;
export type ImportMapping = LeadImportMapping;

const kindImplemented = (kind: z.infer<typeof ImportKindSchema>) =>
  (IMPLEMENTED_IMPORT_KINDS as readonly string[]).includes(kind);

/**
 * `imports.job.create`: the uploaded file and its parsed rows become a job in `uploaded` (IMP-01).
 * The server action parses the bytes first and stores them after the command commits, under a
 * key named by their SHA-256, so a refused call leaves no file behind and the same file cannot
 * start a second job in the company. The file's id is made by the command, so a repeat with the
 * same idempotency key has the same input and replays. The rows never reach the audit trail (the
 * command records a summary instead).
 */
export const CreateImportJobInput = z
  .object({
    entityId: EntityIdSchema,
    kind: ImportKindSchema.refine(kindImplemented, { message: 'this kind cannot be imported yet' }),
    file: z
      .object({
        name: z.string().trim().min(1).max(200),
        contentType: z.string().trim().min(1).max(120),
        size: z.number().int().min(1).max(IMPORT_LIMITS.maxFileBytes),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        bucket: z.string().min(1).max(63),
        key: z.string().min(1).max(300),
      })
      .strict(),
    format: ImportFormatSchema,
    columns: z
      .array(ImportColumnSchema)
      .min(1)
      .max(IMPORT_LIMITS.maxColumns)
      .refine((c) => new Set(c).size === c.length, { message: 'column names must be unique' }),
    rows: z
      .array(z.array(z.string().max(IMPORT_LIMITS.maxCellLength)).max(IMPORT_LIMITS.maxColumns))
      .min(1)
      .max(IMPORT_LIMITS.maxRows),
  })
  .strict()
  .refine((v) => v.rows.every((r) => r.length <= v.columns.length), {
    message: 'a row has more cells than the header',
    path: ['rows'],
  });
export type CreateImportJobInput = z.infer<typeof CreateImportJobInput>;

/** The upload form's fields beside the file itself; form values arrive as text. */
export const UploadImportFileInput = z
  .object({ entityId: z.coerce.number().pipe(EntityIdSchema), kind: ImportKindSchema })
  .strict();
export type UploadImportFileInput = z.infer<typeof UploadImportFileInput>;

const JobRef = { entityId: EntityIdSchema, jobId: IdSchema };

/**
 * `imports.job.map`: the job's columns are matched to lead fields, from a mapping given now or a
 * saved template of the same kind, and optionally saved as a new template.
 */
export const MapImportJobInput = z
  .object({
    ...JobRef,
    templateId: IdSchema.optional(),
    mapping: ImportMappingSchema.optional(),
    saveAsTemplate: z
      .object({ name: z.string().trim().min(2).max(80) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => (v.templateId === undefined) !== (v.mapping === undefined), {
    message: 'give a mapping or a template, not both',
    path: ['mapping'],
  })
  .refine((v) => v.saveAsTemplate === undefined || v.mapping !== undefined, {
    message: 'only a new mapping can be saved as a template',
    path: ['saveAsTemplate'],
  });
export type MapImportJobInput = z.infer<typeof MapImportJobInput>;

/** `imports.job.preview`: every row validated and checked for duplicates. */
export const PreviewImportJobInput = z.object(JobRef).strict();
export type PreviewImportJobInput = z.infer<typeof PreviewImportJobInput>;

/** `imports.job.commit`: a previewed job with valid rows starts committing. */
export const CommitImportJobInput = z.object(JobRef).strict();
export type CommitImportJobInput = z.infer<typeof CommitImportJobInput>;

/**
 * `imports.job.commit_batch`: the worker commits the next batch of valid rows in one transaction.
 * A smaller batch is allowed for tests and for a slow day; never a larger one.
 */
export const CommitImportBatchInput = z
  .object({
    ...JobRef,
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(IMPORT_LIMITS.batchSize)
      .default(IMPORT_LIMITS.batchSize),
  })
  .strict();
export type CommitImportBatchInput = z.infer<typeof CommitImportBatchInput>;

/** `imports.job.rollback`: every record the job created is archived, newest row first. */
export const RollbackImportJobInput = z.object(JobRef).strict();
export type RollbackImportJobInput = z.infer<typeof RollbackImportJobInput>;

/** Reads for the import screens. */
export const GetImportJobInput = z.object(JobRef).strict();
export type GetImportJobInput = z.infer<typeof GetImportJobInput>;

export const ListImportRowsInput = z
  .object({
    ...JobRef,
    state: ImportRowStateSchema.optional(),
    /** The last row number of the previous page. */
    after: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListImportRowsInput = z.infer<typeof ListImportRowsInput>;

/**
 * The import screen's list: the jobs of one company, or of every company of the request when
 * `entityId` is left out, newest first, keyset-paginated by the opaque `cursor` of the last page.
 */
export const ListImportJobsInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ListImportJobsInput = z.infer<typeof ListImportJobsInput>;

export const ListImportTemplatesInput = z
  .object({ entityId: EntityIdSchema, kind: ImportKindSchema })
  .strict();
export type ListImportTemplatesInput = z.infer<typeof ListImportTemplatesInput>;
