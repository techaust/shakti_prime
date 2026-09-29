import {
  ContrastSchema,
  ITEM_SORT_COLUMNS as CONTRACT_ITEM_SORT_COLUMNS,
  ITEM_SPEC_FIELDS as CONTRACT_ITEM_SPEC_FIELDS,
  ItemCategorySchema,
  ItemUnitSchema,
  KIT_PRICE_SORT_COLUMNS as CONTRACT_KIT_PRICE_SORT_COLUMNS,
  KIT_SORT_COLUMNS as CONTRACT_KIT_SORT_COLUMNS,
  PriceListStateSchema,
  PriceTierCodeSchema,
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
  CONTRASTS,
  ITEM_CATEGORIES,
  ITEM_SORT_COLUMNS,
  ITEM_SPEC_FIELDS,
  ITEM_UNITS,
  KIT_PRICE_SORT_COLUMNS,
  KIT_SORT_COLUMNS,
  PRICE_LIST_STATES,
  PRICE_TIER_CODES,
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
    expect(ITEM_CATEGORIES).toEqual(ItemCategorySchema.options);
    expect(ITEM_UNITS).toEqual(ItemUnitSchema.options);
    expect(PRICE_LIST_STATES).toEqual(PriceListStateSchema.options);
    expect(PRICE_TIER_CODES).toEqual(PriceTierCodeSchema.options);
  });

  it('equal the contract’s own lists and limits', () => {
    expect(IMPLEMENTED_IMPORT_KINDS).toEqual(CONTRACT_IMPORT_KINDS);
    expect(LEAD_SORT_COLUMNS).toEqual(CONTRACT_LEAD_SORT_COLUMNS);
    expect(USER_SORT_COLUMNS).toEqual(CONTRACT_USER_SORT_COLUMNS);
    expect(PRICE_SORT_COLUMNS).toEqual(CONTRACT_PRICE_SORT_COLUMNS);
    expect(IMPORT_JOB_SORT_COLUMNS).toEqual(CONTRACT_IMPORT_JOB_SORT_COLUMNS);
    expect(ITEM_SORT_COLUMNS).toEqual(CONTRACT_ITEM_SORT_COLUMNS);
    expect(KIT_SORT_COLUMNS).toEqual(CONTRACT_KIT_SORT_COLUMNS);
    expect(KIT_PRICE_SORT_COLUMNS).toEqual(CONTRACT_KIT_PRICE_SORT_COLUMNS);
    expect(ITEM_SPEC_FIELDS).toEqual(CONTRACT_ITEM_SPEC_FIELDS);
    expect(PASSWORD_MIN_LENGTH).toBe(CONTRACT_PASSWORD_MIN_LENGTH);
    expect(SEARCH_MIN_CHARS).toBe(CONTRACT_SEARCH_MIN_CHARS);
  });
});
