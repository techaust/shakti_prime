import { z } from 'zod';

/**
 * Import framework enumerations (docs/design/backend-weeks-3-5.md §8, docs/DATABASE.md §6.10).
 * Values are the database check lists.
 */

/**
 * What a job imports: leads, customers (`accounts`) and the PIN code master (`pin_codes`, from the
 * public India Post directory); items and Tally masters arrive with their modules.
 */
export const ImportKindSchema = z.enum([
  'leads',
  'accounts',
  'pin_codes',
  'items',
  'tally_masters',
]);
export type ImportKind = z.infer<typeof ImportKindSchema>;

/** The kinds a job may be created for today. */
export const IMPLEMENTED_IMPORT_KINDS = [
  'leads',
  'accounts',
  'pin_codes',
] as const satisfies readonly ImportKind[];
export type ImplementedImportKind = (typeof IMPLEMENTED_IMPORT_KINDS)[number];

/**
 * The kinds whose rows are shared by every company (the PIN code master): only a request acting
 * for every active company imports them, as an Executive (docs/design/phase1.md §6.3).
 */
export const GROUP_IMPORT_KINDS = ['pin_codes'] as const satisfies readonly ImportKind[];

/** True for a kind whose job runs in a request for every company (`GROUP_IMPORT_KINDS`). */
export function isGroupImportKind(kind: ImportKind): boolean {
  return (GROUP_IMPORT_KINDS as readonly ImportKind[]).includes(kind);
}

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

/**
 * `import_rows.created_type`: what a committed row made: a lead, a customer, or an office of the
 * PIN code master (only an office the row added; an office it corrected records nothing). A
 * customers row whose mobile number belongs to a customer the importer can see links to that
 * customer instead (`account_link`, the customer's id): its companies are added to it, and a
 * rollback leaves that customer as it is.
 */
export const ImportCreatedTypeSchema = z.enum([
  'opportunity',
  'account',
  'account_link',
  'pin_code',
]);
export type ImportCreatedType = z.infer<typeof ImportCreatedTypeSchema>;

/**
 * Why the preview suggests an existing customer for a row (design §8): the same mobile number,
 * or the same name in the same village once case, spaces and punctuation are set aside.
 */
export const ImportDedupeMatchSchema = z.enum(['phone', 'name_village']);
export type ImportDedupeMatch = z.infer<typeof ImportDedupeMatchSchema>;

/**
 * `files.status` (docs/DATABASE.md §6.10): `pending` until the bytes land, `scanning` while the
 * malware scan runs, `scanned` (no threat found) or `not_scanned` (no scanner on a developer's
 * machine) while the file is re-encoded or checked, then `ready` or `rejected`. `masked` is the
 * WhatsApp filing step (the `document_filing` machine).
 */
export const FileStatusSchema = z.enum([
  'pending',
  'scanning',
  'scanned',
  'not_scanned',
  'masked',
  'ready',
  'rejected',
]);
export type FileStatus = z.infer<typeof FileStatusSchema>;

/** The file formats an import accepts. */
export const ImportFormatSchema = z.enum(['csv', 'xlsx']);
export type ImportFormat = z.infer<typeof ImportFormatSchema>;

/** Limits of one import file (IMP-01: 50,000 rows within five minutes). */
export const IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  /**
   * The most an Excel workbook may hold once unpacked, counted over every part of the file before
   * the spreadsheet reader opens it, so a small file that unpacks into gigabytes is refused. A
   * workbook at the row and column limits with short cells unpacks to about 86 MB, and a
   * 50,000-row lead list of ten columns to about 40 MB (measured with ExcelJS 4.4), so 100 MB
   * admits the files the other limits allow in practice.
   */
  maxUnzippedBytes: 100 * 1024 * 1024,
  /**
   * The most one part of a workbook over 1 MB unpacked may grow when unpacked. Worksheet parts
   * unpack to 13 to 17 times their packed size (measured); deflate allows about 1,000 times,
   * which only a crafted file reaches.
   */
  maxZipRatio: 100,
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
 * The fields of a customer a file column can fill. `company` names a company the customer deals
 * with, by its code or its name; a blank cell means the job's own company.
 */
export const AccountImportFieldSchema = z.enum([
  'contactName',
  'phone',
  'accountName',
  'accountType',
  'preferredLanguage',
  'village',
  'siteType',
  'pin',
  'company',
]);
export type AccountImportField = z.infer<typeof AccountImportFieldSchema>;

/**
 * The fields of a post office of the PIN code master, as the India Post directory lists them: the
 * PIN, the office's name, its taluk (the screens say tehsil), its district and its state (a name
 * or the two-digit GST state code).
 */
export const PinCodeImportFieldSchema = z.enum(['pin', 'officeName', 'taluk', 'district', 'state']);
export type PinCodeImportField = z.infer<typeof PinCodeImportFieldSchema>;

/** Every field a file column can fill, whatever the kind. */
export const ImportFieldSchema = z.enum([
  ...LeadImportFieldSchema.options,
  'company',
  'officeName',
  'taluk',
  'district',
  'state',
]);
export type ImportField = z.infer<typeof ImportFieldSchema>;

/** The fields each kind offers, in the order the matching form lists them. */
export const IMPORT_FIELDS = {
  leads: LeadImportFieldSchema.options,
  accounts: AccountImportFieldSchema.options,
  pin_codes: PinCodeImportFieldSchema.options,
} as const satisfies Record<ImplementedImportKind, readonly ImportField[]>;
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
  'customer_held_by_colleague',
  'company_unknown',
  'state_unknown',
]);
export type ImportRowErrorCode = z.infer<typeof ImportRowErrorCodeSchema>;
