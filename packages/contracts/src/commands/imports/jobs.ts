import { z } from 'zod';
import { AccountTypeSchema, CustomerLanguageSchema, SiteTypeSchema } from '../../crm/enums';
import { ImportJobSortSchema } from '../../dto/list-sort';
import { EntityIdSchema, IdSchema } from '../../ids';
import {
  AccountImportFieldSchema,
  IMPLEMENTED_IMPORT_KINDS,
  IMPORT_LIMITS,
  ImportFieldSchema,
  ImportFormatSchema,
  ImportKindSchema,
  ImportRowStateSchema,
  LeadImportFieldSchema,
  PinCodeImportFieldSchema,
  type ImplementedImportKind,
  type LeadImportField,
} from '../../imports/enums';

/** A column name as the header row gives it, made unique by the parser. */
export const ImportColumnSchema = z.string().min(1).max(IMPORT_LIMITS.maxHeaderLength);

const Code = z.string().trim().min(1).max(40);

/** A column fills one field at most. */
function columnsUnique(m: { columns: Partial<Record<string, string>> }): boolean {
  const used = Object.values(m.columns);
  return new Set(used).size === used.length;
}

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
  .refine(columnsUnique, { message: 'a column fills one field only', path: ['columns'] });
export type LeadImportMapping = z.infer<typeof LeadImportMappingSchema>;
export type { LeadImportField };

/**
 * How the columns of a customers file fill a customer (docs/design/phase1.md §6.3): the contact's
 * name and phone come from the file; a `company` column names each row's company, else the job's.
 */
export const AccountImportMappingSchema = z
  .object({
    columns: z.partialRecord(AccountImportFieldSchema, ImportColumnSchema),
    defaults: z
      .object({
        accountType: AccountTypeSchema.optional(),
        preferredLanguage: CustomerLanguageSchema.optional(),
        siteType: SiteTypeSchema.optional(),
      })
      .strict()
      .default({}),
  })
  .strict()
  .refine((m) => m.columns.contactName !== undefined && m.columns.phone !== undefined, {
    message: 'the name and phone columns are required',
    path: ['columns'],
  })
  .refine(columnsUnique, { message: 'a column fills one field only', path: ['columns'] });
export type AccountImportMapping = z.infer<typeof AccountImportMappingSchema>;

/**
 * How the columns of the India Post directory fill the PIN code master: the PIN, the office's
 * name and its district are required; the taluk and the state are kept when the file has them.
 */
export const PinCodeImportMappingSchema = z
  .object({
    columns: z.partialRecord(PinCodeImportFieldSchema, ImportColumnSchema),
    defaults: z.object({}).strict().default({}),
  })
  .strict()
  .refine(
    (m) =>
      m.columns.pin !== undefined &&
      m.columns.officeName !== undefined &&
      m.columns.district !== undefined,
    { message: 'the PIN, office and district columns are required', path: ['columns'] },
  )
  .refine(columnsUnique, { message: 'a column fills one field only', path: ['columns'] });
export type PinCodeImportMapping = z.infer<typeof PinCodeImportMappingSchema>;

/**
 * A mapping of any kind, as a job or a template stores it and the screens read it. The command
 * checks it again against the job's own kind (`importMappingSchemaFor`).
 */
export const ImportMappingSchema = z
  .object({
    columns: z.partialRecord(ImportFieldSchema, ImportColumnSchema),
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
  .refine(columnsUnique, { message: 'a column fills one field only', path: ['columns'] });
export type ImportMapping = z.infer<typeof ImportMappingSchema>;

/** The mapping rules of one kind. */
export function importMappingSchemaFor(kind: ImplementedImportKind) {
  switch (kind) {
    case 'leads':
      return LeadImportMappingSchema;
    case 'accounts':
      return AccountImportMappingSchema;
    case 'pin_codes':
      return PinCodeImportMappingSchema;
  }
}

/** A kind a job may be created for today. */
export const ImplementedImportKindSchema = z.enum(IMPLEMENTED_IMPORT_KINDS);

/**
 * `imports.job.create`: an uploaded import file of the company, read and parsed by the server
 * (the streaming reader for a workbook), becomes a job in `uploaded` with one pending row per data
 * row (IMP-01). The file came through the pre-signed upload and passed its checks (`ready`); one
 * file starts one job, and the same content cannot start a second job in the company. The rows
 * never reach the audit trail (the command records a summary instead).
 */
export const CreateImportJobInput = z
  .object({
    entityId: EntityIdSchema,
    kind: ImplementedImportKindSchema,
    fileId: IdSchema,
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

/**
 * The import screen's second call, once its file is uploaded and checked: the company, what the
 * file holds, and the uploaded file. The server reads the file and starts the job.
 */
export const StartImportInput = z
  .object({
    entityId: EntityIdSchema,
    kind: ImplementedImportKindSchema,
    fileId: IdSchema,
  })
  .strict();
export type StartImportInput = z.infer<typeof StartImportInput>;

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

/**
 * `imports.job.fail` (the import worker): a committing job whose worker call still failed on its
 * last queue retry stops as `failed`, so it never waits for ever.
 */
export const FailImportJobInput = z.object(JobRef).strict();
export type FailImportJobInput = z.infer<typeof FailImportJobInput>;

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
 * `entityId` is left out, newest first unless another order is asked for, keyset-paginated by the
 * opaque `cursor` of the last page.
 */
export const ListImportJobsInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    sort: ImportJobSortSchema.optional(),
  })
  .strict();
export type ListImportJobsInput = z.infer<typeof ListImportJobsInput>;

export const ListImportTemplatesInput = z
  .object({ entityId: EntityIdSchema, kind: ImportKindSchema })
  .strict();
export type ListImportTemplatesInput = z.infer<typeof ListImportTemplatesInput>;
