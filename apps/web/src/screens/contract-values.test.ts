import {
  AGENT_ACTION_STATES,
  AGENT_AUTONOMY,
  AGENT_ROLE_KEYS,
  AGENT_RUN_OUTCOMES,
  AGENT_SETTING_SOURCES,
  CommissionBasisSchema,
  DuplicateKindSchema,
  DuplicateReasonSchema,
  DuplicateSignalSchema,
  DuplicateStateSchema,
  ContrastSchema,
  FirstContactSlaSchema,
  LockHoursSchema,
  ScoreRuleInput,
  DispositionNextActionSchema,
  RECORDED_STAGE_EXIT_FIELDS as CONTRACT_RECORDED_STAGE_EXIT_FIELDS,
  PROTECTED_STAGE_KEYS as CONTRACT_PROTECTED_STAGE_KEYS,
  ScoreFactorSchema,
  StageExitFieldSchema,
  SystemSizeUnitSchema,
  AccountTypeSchema,
  ActivityTypeSchema,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  CustomerLanguageSchema,
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
  MORE_SITES_MAX as CONTRACT_MORE_SITES_MAX,
  LEAD_SORT_COLUMNS as CONTRACT_LEAD_SORT_COLUMNS,
  OpportunityLostReasonSchema,
  OpportunityNurtureReasonSchema,
  OpportunityStateSchema,
  PASSWORD_MIN_LENGTH as CONTRACT_PASSWORD_MIN_LENGTH,
  PipeMaterialSchema,
  PumpDriveSchema,
  PumpSizingInputs,
  PumpTypeSchema,
  RooftopSizingInputs,
  PRICE_SORT_COLUMNS as CONTRACT_PRICE_SORT_COLUMNS,
  SavedViewScreenSchema,
  QUOTE_MAX_QTY as CONTRACT_QUOTE_MAX_QTY,
  SEARCH_MIN_CHARS as CONTRACT_SEARCH_MIN_CHARS,
  SegmentSchema,
  SessionRevokeReasonSchema,
  SizingAdvisorySchema,
  SizingKindSchema,
  QuoteStateSchema,
  SubsidySchemeSchema,
  SizingReasonSchema,
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
  COMMISSION_BASES,
  CONTRASTS,
  FIRST_CONTACT_SLA_MAX,
  LOCK_HOURS_MAX,
  SCORE_POINTS_LIMIT,
  DISPOSITION_NEXT_ACTIONS,
  RECORDED_STAGE_EXIT_FIELDS,
  PROTECTED_STAGE_KEYS,
  SCORE_FACTORS,
  STAGE_EXIT_FIELDS,
  SYSTEM_SIZE_UNITS,
  ACCOUNT_TYPES,
  ACTIVITY_TYPES,
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  CONSENT_SOURCES,
  CUSTOMER_LANGUAGES,
  CUSTOMER_SEARCH_MIN_CHARS,
  CUSTOMER_SORT_COLUMNS,
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
  MORE_SITES_MAX,
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_NURTURE_REASONS,
  OPPORTUNITY_STATES,
  PASSWORD_MIN_LENGTH,
  PIPE_MATERIALS,
  PRICE_SORT_COLUMNS,
  PUMP_DRIVES,
  PUMP_TYPES,
  SAVED_VIEW_SCREENS,
  SCOPE_VALUES,
  QUOTE_MAX_QTY,
  SEARCH_MIN_CHARS,
  SEGMENTS,
  SESSION_REVOKE_REASONS,
  SIZING_ADVISORIES,
  SIZING_INPUT_LIMITS,
  SIZING_KINDS,
  QUOTE_STATES,
  SUBSIDY_SCHEMES,
  SIZING_REASONS,
  SITE_TYPES,
  DUPLICATE_KINDS,
  DUPLICATE_REASONS,
  DUPLICATE_SIGNALS,
  DUPLICATE_STATES,
  TASK_KINDS,
  TASK_STATES,
  AGENT_ROLES,
  AGENT_AUTONOMY_LEVELS,
  AGENT_ACTION_STATE_VALUES,
  AGENT_RUN_OUTCOME_VALUES,
  AGENT_SETTING_SOURCE_VALUES,
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
    expect(DISPOSITION_NEXT_ACTIONS).toEqual(DispositionNextActionSchema.options);
    expect(SCORE_FACTORS).toEqual(ScoreFactorSchema.options);
    expect(STAGE_EXIT_FIELDS).toEqual(StageExitFieldSchema.options);
    expect(SYSTEM_SIZE_UNITS).toEqual(SystemSizeUnitSchema.options);
    expect(COMMISSION_BASES).toEqual(CommissionBasisSchema.options);
    expect(SIZING_KINDS).toEqual(SizingKindSchema.options);
    expect(QUOTE_STATES).toEqual(QuoteStateSchema.options);
    expect(SUBSIDY_SCHEMES).toEqual(SubsidySchemeSchema.options);
    expect(SIZING_REASONS).toEqual(SizingReasonSchema.options);
    expect(SIZING_ADVISORIES).toEqual(SizingAdvisorySchema.options);
    // The panel offers a submersible first, the catalogue lists a surface pump first.
    expect([...PUMP_TYPES].sort()).toEqual([...PumpTypeSchema.options].sort());
    expect(PUMP_DRIVES).toEqual(PumpDriveSchema.options);
    expect(PIPE_MATERIALS).toEqual(PipeMaterialSchema.options);
    expect(TASK_KINDS).toEqual(TaskKindSchema.options);
    expect(TASK_STATES).toEqual(TaskStateSchema.options);
    expect(AGENT_ROLES).toEqual(AGENT_ROLE_KEYS);
    expect(AGENT_AUTONOMY_LEVELS).toEqual(AGENT_AUTONOMY);
    expect(AGENT_ACTION_STATE_VALUES).toEqual(AGENT_ACTION_STATES);
    expect(AGENT_RUN_OUTCOME_VALUES).toEqual(AGENT_RUN_OUTCOMES);
    expect(AGENT_SETTING_SOURCE_VALUES).toEqual(AGENT_SETTING_SOURCES);
    expect(ACTIVITY_TYPES).toEqual(ActivityTypeSchema.options);
    expect(DUPLICATE_KINDS).toEqual(DuplicateKindSchema.options);
    expect(DUPLICATE_REASONS).toEqual(DuplicateReasonSchema.options);
    expect(DUPLICATE_SIGNALS).toEqual(DuplicateSignalSchema.options);
    expect(DUPLICATE_STATES).toEqual(DuplicateStateSchema.options);
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
    expect(MORE_SITES_MAX).toBe(CONTRACT_MORE_SITES_MAX);
    expect(LEAD_SORT_COLUMNS).toEqual(CONTRACT_LEAD_SORT_COLUMNS);
    expect(RECORDED_STAGE_EXIT_FIELDS).toEqual(CONTRACT_RECORDED_STAGE_EXIT_FIELDS);
    expect(PROTECTED_STAGE_KEYS).toEqual(CONTRACT_PROTECTED_STAGE_KEYS);
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
    expect(QUOTE_MAX_QTY).toBe(CONTRACT_QUOTE_MAX_QTY);
    expect(CUSTOMER_SEARCH_MIN_CHARS).toBe(CONTRACT_CUSTOMER_SEARCH_MIN_CHARS);
    expect(SCOPE_VALUES).toEqual(SCOPES);
    expect(COST_PERMISSION_KEYS).toEqual(COST_PERMISSIONS);
  });

  it('hold the settings limits the contracts hold', () => {
    expect(LockHoursSchema.safeParse(LOCK_HOURS_MAX).success).toBe(true);
    expect(LockHoursSchema.safeParse(LOCK_HOURS_MAX + 1).success).toBe(false);
    expect(FirstContactSlaSchema.safeParse(FIRST_CONTACT_SLA_MAX).success).toBe(true);
    expect(FirstContactSlaSchema.safeParse(FIRST_CONTACT_SLA_MAX + 1).success).toBe(false);
    const rule = (points: number) =>
      ScoreRuleInput.safeParse({ factor: 'age_days', match: { maxDays: 1 }, points }).success;
    expect([rule(SCORE_POINTS_LIMIT), rule(-SCORE_POINTS_LIMIT)]).toEqual([true, true]);
    expect([rule(SCORE_POINTS_LIMIT + 1), rule(-SCORE_POINTS_LIMIT - 1)]).toEqual([false, false]);
  });

  it('give each sizing measurement the range the contract accepts', () => {
    const shape = { ...PumpSizingInputs.shape, ...RooftopSizingInputs.shape };
    for (const [field, limits] of Object.entries(SIZING_INPUT_LIMITS)) {
      // Each of these fields is a number schema, which reports its bounds.
      const bounds = shape[field as keyof typeof shape] as unknown as {
        minValue: number | null;
        maxValue: number | null;
      };
      expect({ field, min: bounds.minValue, max: bounds.maxValue }).toEqual({ field, ...limits });
    }
  });
});
