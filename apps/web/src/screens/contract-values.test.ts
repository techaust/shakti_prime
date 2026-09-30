import {
  CommissionBasisSchema,
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
  ThemeSchema,
  USER_SORT_COLUMNS as CONTRACT_USER_SORT_COLUMNS,
  UserStatusSchema,
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
  SEARCH_MIN_CHARS,
  SEGMENTS,
  SESSION_REVOKE_REASONS,
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
  });

  it('equal the contract’s own lists and limits', () => {
    expect(IMPLEMENTED_IMPORT_KINDS).toEqual(CONTRACT_IMPORT_KINDS);
    expect(LEAD_SORT_COLUMNS).toEqual(CONTRACT_LEAD_SORT_COLUMNS);
    expect(RECORDED_STAGE_EXIT_FIELDS).toEqual(CONTRACT_RECORDED_STAGE_EXIT_FIELDS);
    expect(PROTECTED_STAGE_KEYS).toEqual(CONTRACT_PROTECTED_STAGE_KEYS);
    expect(USER_SORT_COLUMNS).toEqual(CONTRACT_USER_SORT_COLUMNS);
    expect(PRICE_SORT_COLUMNS).toEqual(CONTRACT_PRICE_SORT_COLUMNS);
    expect(IMPORT_JOB_SORT_COLUMNS).toEqual(CONTRACT_IMPORT_JOB_SORT_COLUMNS);
    expect(PASSWORD_MIN_LENGTH).toBe(CONTRACT_PASSWORD_MIN_LENGTH);
    expect(SEARCH_MIN_CHARS).toBe(CONTRACT_SEARCH_MIN_CHARS);
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
});
