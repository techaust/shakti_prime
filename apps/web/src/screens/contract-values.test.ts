import {
  AccountTypeSchema,
  ActivityTypeSchema,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  CustomerLanguageSchema,
  ContrastSchema,
  CUSTOMER_SEARCH_MIN_CHARS as CONTRACT_CUSTOMER_SEARCH_MIN_CHARS,
  CUSTOMER_SORT_COLUMNS as CONTRACT_CUSTOMER_SORT_COLUMNS,
  ITEM_SORT_COLUMNS as CONTRACT_ITEM_SORT_COLUMNS,
  ITEM_SPEC_FIELDS as CONTRACT_ITEM_SPEC_FIELDS,
  ItemCategorySchema,
  ItemUnitSchema,
  KIT_PRICE_SORT_COLUMNS as CONTRACT_KIT_PRICE_SORT_COLUMNS,
  KIT_SORT_COLUMNS as CONTRACT_KIT_SORT_COLUMNS,
  PriceListStateSchema,
  PriceTierCodeSchema,
  FilePurposeSchema,
  FileRejectReasonSchema,
  FileSanitisingSchema,
  PdfDocumentTypeSchema,
  FileScanVerdictInputSchema,
  FileStatusSchema,
  UploadContentTypeSchema,
  IMPLEMENTED_IMPORT_KINDS as CONTRACT_IMPORT_KINDS,
  IMPORT_JOB_SORT_COLUMNS as CONTRACT_IMPORT_JOB_SORT_COLUMNS,
  ImportJobStateSchema,
  LEAD_SORT_COLUMNS as CONTRACT_LEAD_SORT_COLUMNS,
  OpportunityLostReasonSchema,
  OpportunityNurtureReasonSchema,
  OpportunityStateSchema,
  PASSWORD_MIN_LENGTH as CONTRACT_PASSWORD_MIN_LENGTH,
  PRICE_SORT_COLUMNS as CONTRACT_PRICE_SORT_COLUMNS,
  SavedViewScreenSchema,
  SEARCH_MIN_CHARS as CONTRACT_SEARCH_MIN_CHARS,
  SegmentSchema,
  SessionRevokeReasonSchema,
  SiteTypeSchema,
  TaskKindSchema,
  TaskStateSchema,
  ThemeSchema,
  USER_SORT_COLUMNS as CONTRACT_USER_SORT_COLUMNS,
  UserStatusSchema,
  COST_PERMISSIONS,
  SCOPES,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  CUSTOMER_LANGUAGES,
  CUSTOMER_SEARCH_MIN_CHARS,
  CUSTOMER_SORT_COLUMNS,
  CONTRASTS,
  COST_PERMISSION_KEYS,
  ITEM_CATEGORIES,
  ITEM_SORT_COLUMNS,
  ITEM_SPEC_FIELDS,
  ITEM_UNITS,
  NUMERIC_SPEC_KEYS,
  SPEC_KEYS,
  KIT_PRICE_SORT_COLUMNS,
  KIT_SORT_COLUMNS,
  PRICE_LIST_STATES,
  PRICE_TIER_CODES,
  FILE_PURPOSES,
  FILE_REJECT_REASONS,
  FILE_SANITISING,
  FILE_SCAN_VERDICTS,
  PDF_DOCUMENT_TYPES,
  FILE_STATUSES,
  UPLOAD_CONTENT_TYPES,
  IMPLEMENTED_IMPORT_KINDS,
  IMPORT_JOB_SORT_COLUMNS,
  IMPORT_JOB_STATES,
  LEAD_SORT_COLUMNS,
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_NURTURE_REASONS,
  OPPORTUNITY_STATES,
  PASSWORD_MIN_LENGTH,
  PRICE_SORT_COLUMNS,
  SAVED_VIEW_SCREENS,
  SCOPE_VALUES,
  SEARCH_MIN_CHARS,
  SEGMENTS,
  SESSION_REVOKE_REASONS,
  SITE_TYPES,
  TASK_KINDS,
  TASK_STATES,
  THEMES,
  USER_SORT_COLUMNS,
  USER_STATUSES,
} from './contract-values';

describe('the contract values copied for the browser', () => {
  it('list every code of their schema, in the same order', () => {
    expect(THEMES).toEqual(ThemeSchema.options);
    expect(CONTRASTS).toEqual(ContrastSchema.options);
    expect(USER_STATUSES).toEqual(UserStatusSchema.options);
    expect(SESSION_REVOKE_REASONS).toEqual(SessionRevokeReasonSchema.options);
    expect(OPPORTUNITY_STATES).toEqual(OpportunityStateSchema.options);
    expect(OPPORTUNITY_LOST_REASONS).toEqual(OpportunityLostReasonSchema.options);
    expect(OPPORTUNITY_NURTURE_REASONS).toEqual(OpportunityNurtureReasonSchema.options);
    expect(SEGMENTS).toEqual(SegmentSchema.options);
    expect(IMPORT_JOB_STATES).toEqual(ImportJobStateSchema.options);
    expect(SAVED_VIEW_SCREENS).toEqual(SavedViewScreenSchema.options);
    expect(TASK_KINDS).toEqual(TaskKindSchema.options);
    expect(TASK_STATES).toEqual(TaskStateSchema.options);
    expect(ACTIVITY_TYPES).toEqual(ActivityTypeSchema.options);
    expect(ACCOUNT_TYPES).toEqual(AccountTypeSchema.options);
    expect(SITE_TYPES).toEqual(SiteTypeSchema.options);
    expect(CUSTOMER_LANGUAGES).toEqual(CustomerLanguageSchema.options);
    expect(CONSENT_CHANNELS).toEqual(ConsentChannelSchema.options);
    expect(CONSENT_PURPOSES).toEqual(ConsentPurposeSchema.options);
    expect(CONSENT_SOURCES).toEqual(ConsentSourceSchema.options);
    expect(ITEM_CATEGORIES).toEqual(ItemCategorySchema.options);
    expect(ITEM_UNITS).toEqual(ItemUnitSchema.options);
    expect(PRICE_LIST_STATES).toEqual(PriceListStateSchema.options);
    expect(PRICE_TIER_CODES).toEqual(PriceTierCodeSchema.options);
    expect(FILE_STATUSES).toEqual(FileStatusSchema.options);
    expect(FILE_PURPOSES).toEqual(FilePurposeSchema.options);
    expect(UPLOAD_CONTENT_TYPES).toEqual(UploadContentTypeSchema.options);
    expect(FILE_REJECT_REASONS).toEqual(FileRejectReasonSchema.options);
    expect(FILE_SCAN_VERDICTS).toEqual(FileScanVerdictInputSchema.options);
    expect(FILE_SANITISING).toEqual(FileSanitisingSchema.options);
    expect(PDF_DOCUMENT_TYPES).toEqual(PdfDocumentTypeSchema.options);
  });

  it('equal the contract’s own lists and limits', () => {
    expect(IMPLEMENTED_IMPORT_KINDS).toEqual(CONTRACT_IMPORT_KINDS);
    expect(LEAD_SORT_COLUMNS).toEqual(CONTRACT_LEAD_SORT_COLUMNS);
    expect(CUSTOMER_SORT_COLUMNS).toEqual(CONTRACT_CUSTOMER_SORT_COLUMNS);
    expect(USER_SORT_COLUMNS).toEqual(CONTRACT_USER_SORT_COLUMNS);
    expect(PRICE_SORT_COLUMNS).toEqual(CONTRACT_PRICE_SORT_COLUMNS);
    expect(IMPORT_JOB_SORT_COLUMNS).toEqual(CONTRACT_IMPORT_JOB_SORT_COLUMNS);
    expect(ITEM_SORT_COLUMNS).toEqual(CONTRACT_ITEM_SORT_COLUMNS);
    expect(KIT_SORT_COLUMNS).toEqual(CONTRACT_KIT_SORT_COLUMNS);
    expect(KIT_PRICE_SORT_COLUMNS).toEqual(CONTRACT_KIT_PRICE_SORT_COLUMNS);
    expect(ITEM_SPEC_FIELDS).toEqual(CONTRACT_ITEM_SPEC_FIELDS);
    const fields = Object.values(CONTRACT_ITEM_SPEC_FIELDS).flat();
    expect([...SPEC_KEYS].sort()).toEqual([...new Set(fields.map((f) => f.key))].sort());
    expect([...NUMERIC_SPEC_KEYS].sort()).toEqual(
      [...new Set(fields.filter((f) => f.kind === 'number').map((f) => f.key))].sort(),
    );
    expect(PASSWORD_MIN_LENGTH).toBe(CONTRACT_PASSWORD_MIN_LENGTH);
    expect(SEARCH_MIN_CHARS).toBe(CONTRACT_SEARCH_MIN_CHARS);
    expect(CUSTOMER_SEARCH_MIN_CHARS).toBe(CONTRACT_CUSTOMER_SEARCH_MIN_CHARS);
    expect(SCOPE_VALUES).toEqual(SCOPES);
    expect(COST_PERMISSION_KEYS).toEqual(COST_PERMISSIONS);
  });
});
