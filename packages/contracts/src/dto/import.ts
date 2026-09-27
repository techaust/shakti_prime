import { z } from 'zod';
import { ImportMappingSchema } from '../commands/imports/jobs';
import { EntityIdSchema, IdSchema } from '../ids';
import {
  ImportFormatSchema,
  ImportJobStateSchema,
  ImportKindSchema,
  ImportRowErrorCodeSchema,
  ImportRowStateSchema,
  LeadImportFieldSchema,
} from '../imports/enums';

const Count = z.number().int().min(0);

/** An import job as the import screens see it (docs/design/backend-weeks-3-5.md §8). Strict. */
export const ImportJobDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    kind: ImportKindSchema,
    state: ImportJobStateSchema,
    file: z
      .object({
        id: IdSchema,
        name: z.string(),
        size: Count,
      })
      .strict(),
    format: ImportFormatSchema,
    templateId: IdSchema.nullable(),
    columns: z.array(z.string()),
    mapping: ImportMappingSchema.nullable(),
    totalRows: Count,
    validRows: Count,
    invalidRows: Count,
    skippedRows: Count,
    committedRows: Count,
    /** The batch that failed, counted from 1, when the job stopped as `failed`. */
    failedBatch: z.number().int().min(1).nullable(),
    createdBy: IdSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ImportJobDto = z.infer<typeof ImportJobDto>;

/** A finding on one row: the lead field it concerns (or the whole row) and why. */
export const ImportRowErrorDto = z
  .object({
    field: LeadImportFieldSchema.or(z.literal('row')),
    code: ImportRowErrorCodeSchema,
  })
  .strict();
export type ImportRowErrorDto = z.infer<typeof ImportRowErrorDto>;

/**
 * Possible duplicates of a row: an earlier row of the same file with the same phone, and
 * customers the caller can already see with that phone. Suggestions only.
 */
export const ImportDedupeDto = z
  .object({
    inFileRowNo: z.number().int().min(1).nullable(),
    existing: z.array(z.object({ accountId: IdSchema, contactId: IdSchema }).strict()).max(5),
  })
  .strict();
export type ImportDedupeDto = z.infer<typeof ImportDedupeDto>;

export const ImportRowDto = z
  .object({
    rowNo: z.number().int().min(1),
    state: ImportRowStateSchema,
    raw: z.record(z.string(), z.string()),
    errors: z.array(ImportRowErrorDto),
    dedupe: ImportDedupeDto.nullable(),
    createdType: z.string().nullable(),
    createdId: IdSchema.nullable(),
    committedBatch: z.number().int().min(1).nullable(),
  })
  .strict();
export type ImportRowDto = z.infer<typeof ImportRowDto>;

export const ImportRowPage = z
  .object({
    rows: z.array(ImportRowDto),
    /** Pass as `after` for the next page; null on the last page. */
    nextAfter: z.number().int().min(1).nullable(),
  })
  .strict();
export type ImportRowPage = z.infer<typeof ImportRowPage>;

export const ImportTemplateDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    kind: ImportKindSchema,
    name: z.string(),
    mapping: ImportMappingSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ImportTemplateDto = z.infer<typeof ImportTemplateDto>;
