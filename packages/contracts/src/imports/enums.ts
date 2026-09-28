import { z } from 'zod';

/**
 * Import framework enumerations (docs/design/backend-weeks-3-5.md §8, docs/DATABASE.md §6.10).
 * Values are the database check lists.
 */

/** What a job imports. Only `leads` is implemented; the rest arrive with their modules. */
export const ImportKindSchema = z.enum(['leads', 'accounts', 'items', 'tally_masters']);
export type ImportKind = z.infer<typeof ImportKindSchema>;

/** The kinds a job may be created for today. */
export const IMPLEMENTED_IMPORT_KINDS = ['leads'] as const satisfies readonly ImportKind[];

export const ImportJobStateSchema = z.enum([
  'uploaded',
  'mapped',
  'previewed',
  'committing',
  'committed',
  'rolled_back',
  'failed',
]);
export type ImportJobState = z.infer<typeof ImportJobStateSchema>;

export const ImportRowStateSchema = z.enum([
  'pending',
  'valid',
  'invalid',
  'committed',
  'skipped',
  'rolled_back',
]);
export type ImportRowState = z.infer<typeof ImportRowStateSchema>;

/** `import_rows.created_type`: what a committed row made. Only leads are imported today. */
export const ImportCreatedTypeSchema = z.enum(['opportunity']);
export type ImportCreatedType = z.infer<typeof ImportCreatedTypeSchema>;

/**
 * Why the preview suggests an existing customer for a row (design §8): the same mobile number,
 * or the same name in the same village once case, spaces and punctuation are set aside.
 */
export const ImportDedupeReasonSchema = z.enum(['phone', 'name_village']);
export type ImportDedupeReason = z.infer<typeof ImportDedupeReasonSchema>;

/** `files.status` (docs/DATABASE.md §6.10); scanning and masking arrive with document uploads. */
export const FileStatusSchema = z.enum(['pending', 'scanning', 'masked', 'ready', 'rejected']);
export type FileStatus = z.infer<typeof FileStatusSchema>;

/** The file formats an import accepts. */
export const ImportFormatSchema = z.enum(['csv', 'xlsx']);
export type ImportFormat = z.infer<typeof ImportFormatSchema>;

/** Limits of one import file (IMP-01: 50,000 rows within five minutes). */
export const IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxRows: 50_000,
  maxColumns: 50,
  maxCellLength: 500,
  maxHeaderLength: 80,
  /** The header row is looked for among this many leading rows. */
  headerSearchRows: 20,
  /** Rows committed per transaction (design §8). */
  batchSize: 500,
} as const;

/** The fields of a lead a file column can fill. */
export const LeadImportFieldSchema = z.enum([
  'contactName',
  'phone',
  'accountName',
  'accountType',
  'preferredLanguage',
  'siteType',
  'village',
  'pin',
  'sourceCode',
  'pipelineKey',
]);
export type LeadImportField = z.infer<typeof LeadImportFieldSchema>;

/**
 * Why one row cannot be imported, keyed to `imports.rowErrors` in the message catalogue. These
 * are row findings shown in the preview, not errors of the call.
 */
export const ImportRowErrorCodeSchema = z.enum([
  'required',
  'invalid',
  'too_long',
  'phone_invalid',
  'pipeline_unknown',
  'source_unknown',
  'commit_failed',
]);
export type ImportRowErrorCode = z.infer<typeof ImportRowErrorCodeSchema>;
