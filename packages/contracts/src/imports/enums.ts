import { z } from 'zod';

/**
 * Import framework enumerations (docs/03-roadmap-appendix/backend-weeks-3-5.md §8, docs/05-database.md §6.10).
 * Values are the database check lists.
 */

/**
 * What a job imports: leads, customers (`accounts`), the PIN code master (`pin_codes`, from the
 * public India Post directory) and the catalogue's items (`items`, C5); Tally masters arrive with
 * their module.
 */
export const ImportKindSchema = z.enum([
  'leads',
  'accounts',
  'pin_codes',
  'items',
  'tally_masters',
  // U1: the group's vendor master (docs/03-roadmap-appendix/phase3.md §6.3).
  'vendors',
  // H1 stock ledger: a company's opening stock, posted as one batch (opening_stock_posted).
  'opening_stock',
  // R3: serials sold before go-live, entered with their customer and warranty, no stock moved.
  'installed_base',
]);
export type ImportKind = z.infer<typeof ImportKindSchema>;

/** The kinds a job may be created for today. */
export const IMPLEMENTED_IMPORT_KINDS = [
  'leads',
  'accounts',
  'pin_codes',
  // U1 vendors.
  'vendors',
  // H1 stock ledger
  'opening_stock',
  // C5: the catalogue's items.
  'items',
  // R3 warranty claims: the installed base.
  'installed_base',
] as const satisfies readonly ImportKind[];
export type ImplementedImportKind = (typeof IMPLEMENTED_IMPORT_KINDS)[number];

/**
 * The kinds whose rows are shared by every company (the PIN code master, and the catalogue's items):
 * only a request acting for every active company imports them, the PIN code master as an Executive
 * (docs/03-roadmap-appendix/phase1.md §6.3) and items with `catalogue.write` (phase3 §6.1).
 */
export const GROUP_IMPORT_KINDS = ['pin_codes', 'items'] as const satisfies readonly ImportKind[];

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
  // U1: a vendor a row added, or one with the row's GSTIN that the row updated (a rollback leaves
  // an updated vendor as it is).
  'vendor',
  'vendor_update',
  // An item an items row added; a row that changed an existing item records nothing.
  'item',
  // H1 stock ledger: the opening movement a row posted.
  'stock_movement',
  // R3: a serial of the installed base a row entered.
  'serial',
]);
export type ImportCreatedType = z.infer<typeof ImportCreatedTypeSchema>;

/**
 * Why the preview suggests an existing customer for a row (design §8): the same mobile number,
 * or the same name in the same village once case, spaces and punctuation are set aside.
 */
export const ImportDedupeMatchSchema = z.enum(['phone', 'name_village']);
export type ImportDedupeMatch = z.infer<typeof ImportDedupeMatchSchema>;

/**
 * `files.status` (docs/05-database.md §6.10): `pending` until the bytes land, `scanning` while the
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
  /**
   * The most each of a workbook's own small parts (the workbook, its styles, its relationships and
   * the content types) may hold once unpacked; each is a few kilobytes in any real workbook.
   */
  maxPartBytes: 5 * 1024 * 1024,
  /**
   * The most a workbook's shared strings (every distinct text of the sheet, kept in memory while
   * the sheet is read) may hold once unpacked: a 50,000-row list of ten columns, most of its texts
   * distinct, holds about 3 MB (measured with ExcelJS 4.4).
   */
  maxSharedStringsBytes: 32 * 1024 * 1024,
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
  // The lead's referral partner, by the partner's code (CRM-09).
  'referralCode',
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

/**
 * U1: the fields of a vendor a file column can fill: its name, GSTIN, PAN, address, payment terms
 * and lead time in days, and one of its people. A GSTIN already in the vendor master updates that
 * vendor (docs/03-roadmap-appendix/phase3.md §6.3).
 */
export const VendorImportFieldSchema = z.enum([
  'vendorName',
  'gstin',
  'pan',
  'addressLine',
  'city',
  'pin',
  'paymentTermsDays',
  'leadTimeDays',
  'personName',
  'personRole',
  'personPhone',
  'personEmail',
]);
export type VendorImportField = z.infer<typeof VendorImportFieldSchema>;

/**
 * H1: a row of a company's opening stock: the hub and bin by code, the item by its stock code, the
 * quantity and its unit cost, and for a tracked item its serial (one row per serial). A `company`
 * column, when given, must name the job's company.
 */
export const OpeningStockImportFieldSchema = z.enum([
  'company',
  'hub',
  'bin',
  'sku',
  'qty',
  'unitCost',
  'serialNo',
]);
export type OpeningStockImportField = z.infer<typeof OpeningStockImportFieldSchema>;

/**
 * R3: a row of the installed base (docs/03-roadmap-appendix/phase3.md §7.5): a serial the company
 * sold before go-live, by the item's stock code and the serial number; its customer by mobile
 * number, a customer of the company already; the site by its village, when the customer has
 * several; the delivery date, and the warranty's end when it is not the item's months from
 * delivery. A `company` column, when given, must name the job's company.
 */
export const InstalledBaseImportFieldSchema = z.enum([
  'company',
  'sku',
  'serialNo',
  'phone',
  'village',
  'deliveredOn',
  'warrantyUntil',
]);
export type InstalledBaseImportField = z.infer<typeof InstalledBaseImportFieldSchema>;

/**
 * The fields of a catalogue item a file column can fill (phase3 §6.1): its code (the only one every
 * file needs), name, category, HSN code and units, serial tracking, DCR and ALMM, the warranties,
 * the barcode and the serial pattern. A row whose code the catalogue has changes that item, and
 * a blank cell keeps what the item has.
 */
export const ItemImportFieldSchema = z.enum([
  'sku',
  'itemName',
  'category',
  'hsn',
  'unit',
  'purchaseUnit',
  'purchaseUnitFactor',
  'isSerialTracked',
  'isDcr',
  'almmRef',
  'warrantyMonths',
  'supplierWarrantyMonths',
  'barcode',
  'serialPattern',
]);
export type ItemImportField = z.infer<typeof ItemImportFieldSchema>;

/** Every field a file column can fill, whatever the kind. */
export const ImportFieldSchema = z.enum([
  ...LeadImportFieldSchema.options,
  'company',
  'officeName',
  'taluk',
  'district',
  'state',
  // U1 vendors (a vendor's PIN code is the leads' own field).
  'vendorName',
  'gstin',
  'pan',
  'addressLine',
  'city',
  'paymentTermsDays',
  'leadTimeDays',
  'personName',
  'personRole',
  'personPhone',
  'personEmail',
  // H1 stock ledger
  'hub',
  'bin',
  'qty',
  'unitCost',
  'serialNo',
  // C5: the item fields, 'sku' among them, which opening stock shares.
  ...ItemImportFieldSchema.options,
  // R3: the installed base's dates (its other fields are the leads' and opening stock's).
  'deliveredOn',
  'warrantyUntil',
]);
export type ImportField = z.infer<typeof ImportFieldSchema>;

/** The fields each kind offers, in the order the matching form lists them. */
export const IMPORT_FIELDS = {
  leads: LeadImportFieldSchema.options,
  accounts: AccountImportFieldSchema.options,
  pin_codes: PinCodeImportFieldSchema.options,
  vendors: VendorImportFieldSchema.options,
  // H1 stock ledger
  opening_stock: OpeningStockImportFieldSchema.options,
  items: ItemImportFieldSchema.options,
  // R3 warranty claims
  installed_base: InstalledBaseImportFieldSchema.options,
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
  // Only a holder of sales.credit.write adds a dealer (DOM-1, the owner's decision of 13-10-2026).
  'dealer_needs_executive',
  // A referral code no active partner of the company has (CRM-09).
  'referral_code_unknown',
  // U1: the GSTIN is an archived vendor's, which an import does not change.
  'vendor_archived',
  // H1 opening stock: a hub, bin or stock code the group does not have; an item not sold or not
  // stocked; a serial on an item without them, none on one with them, a quantity other than 1 for
  // a serial, a serial already held or given twice; a company other than the job's; opening stock
  // already entered for the company.
  'hub_unknown',
  'bin_unknown',
  'sku_unknown',
  'item_not_stockable',
  'serial_not_tracked',
  'serial_required',
  'serial_qty',
  'serial_taken',
  'company_mismatch',
  'opening_stock_posted',
  // Items (C5): a category, HSN code or unit outside the lists, a serial pattern refused, a
  // barcode another item or an earlier row has, a category whose required details only the item
  // sheet takes, a code of an item no longer sold, and a barcode hidden as an identity number.
  'category_unknown',
  'hsn_invalid',
  'unit_unknown',
  'serial_pattern_invalid',
  'barcode_taken',
  'item_details_needed',
  'item_archived',
  'barcode_hidden',
  // An item kept out of stock (a service) that the row would make another category or serial-tracked.
  'item_not_stocked',
  // R3 installed base: a mobile number no customer of the company has; a village none of the
  // customer's sites is in, or a blank one for a customer of several sites; a date that is not a
  // date or lies ahead; no warranty end given for an item without warranty months.
  'customer_unknown',
  'site_unknown',
  'date_invalid',
  'warranty_unknown',
]);
export type ImportRowErrorCode = z.infer<typeof ImportRowErrorCodeSchema>;
