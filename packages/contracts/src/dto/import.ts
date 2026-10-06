import { z } from 'zod';
import { ImportMappingSchema } from '../commands/imports/jobs';
import { EntityIdSchema, IdSchema } from '../ids';
import {
  ImportCreatedTypeSchema,
  ImportDedupeMatchSchema,
  ImportFormatSchema,
  ImportJobStateSchema,
  ImportKindSchema,
  ImportRowErrorCodeSchema,
  ImportFieldSchema,
  ImportRowStateSchema,
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
    /**
     * The companies the checked rows name, the job's own included, and those through which the
     * importer saw a customer a row is linked to; null until the rows are checked. Adding the rows
     * and undoing them need a request that acts for all of them.
     */
    entityIds: z.array(EntityIdSchema).nullable(),
    createdBy: IdSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ImportJobDto = z.infer<typeof ImportJobDto>;

/** A finding on one row: the field it concerns (or the whole row) and why. */
export const ImportRowErrorDto = z
  .object({
    field: ImportFieldSchema.or(z.literal('row')),
    code: ImportRowErrorCodeSchema,
  })
  .strict();
export type ImportRowErrorDto = z.infer<typeof ImportRowErrorDto>;

/**
 * Possible duplicates of a row: an earlier row of the same file with the same phone, and
 * customers the caller can already see with that phone or with the same name in the same
 * village, each with the reason it was suggested. Suggestions only, but for a customers file:
 * a row whose mobile number belongs to a customer the caller can see is linked to that customer
 * (`linkedTo`), and a row with a site that is folded or linked says what became of it (`site`).
 */
export const ImportDedupeDto = z
  .object({
    inFileRowNo: z.number().int().min(1).nullable(),
    /** A customers row: the existing customer it is added to instead of making a new one. */
    linkedTo: IdSchema.optional(),
    /**
     * A customers row with a site, folded into an earlier one: its site is added to that
     * customer, is the same as one already there, or is past the most one customer takes. A row
     * linked to an existing customer, or folded into one that is, adds no site: `kept`, the
     * customer's sites stay as they are.
     */
    site: z.enum(['added', 'same', 'too_many', 'kept']).optional(),
    existing: z
      .array(
        z
          .object({
            accountId: IdSchema,
            contactId: IdSchema,
            /** Rows previewed before name and village matching were suggested by phone only. */
            matchedBy: ImportDedupeMatchSchema.default('phone'),
          })
          .strict(),
      )
      .max(5),
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
    createdType: ImportCreatedTypeSchema.nullable(),
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
    /**
     * The names of the customers this page's dedupe suggestions point at, by account id, as the
     * caller may read them; a customer they can no longer see is left out.
     */
    customers: z.record(z.string(), z.string()),
  })
  .strict();
export type ImportRowPage = z.infer<typeof ImportRowPage>;

/** One page of import jobs, newest first, with the names of the people who started them. */
export const ImportJobPage = z
  .object({
    items: z.array(ImportJobDto),
    /** Display names by principal id, for `createdBy`. */
    creators: z.record(z.string(), z.string()),
    /** Pass as `cursor` for the next page; null on the last page. */
    nextCursor: z.string().nullable(),
  })
  .strict();
export type ImportJobPage = z.infer<typeof ImportJobPage>;

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
