import { LeadImportMappingSchema, type LeadImportMapping } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  checkLeadRow,
  enumWord,
  firstRowByPhone,
  leadCandidate,
  matchKey,
  nameVillageKey,
} from './leads';

const mapping: LeadImportMapping = LeadImportMappingSchema.parse({
  columns: {
    contactName: 'Name',
    phone: 'Mobile',
    village: 'Village',
    accountType: 'Type',
    preferredLanguage: 'Language',
    sourceCode: 'Source',
  },
  defaults: { pipelineKey: 'farmer_pumps', siteType: 'borewell' },
});

const lookups = {
  pipelineKeys: new Set(['farmer_pumps']),
  sourceCodes: new Set(['import', 'walk_in']),
};

const row = (overrides: Record<string, string> = {}) => ({
  Name: 'Ram Kumar',
  Mobile: '098765 43210',
  Village: 'Sikar',
  Type: 'Farm',
  Language: 'English',
  Source: '',
  ...overrides,
});

describe('leads import rows', () => {
  it('turns a row into crm.lead.create input with defaults and normalised values', () => {
    const check = checkLeadRow(row(), mapping, 1, lookups);
    expect(check).toEqual({
      state: 'valid',
      phone: '+919876543210',
      errors: [],
      input: {
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        contact: { name: 'Ram Kumar', phone: '+919876543210', preferredLanguage: 'en' },
        account: { type: 'farm' },
        site: { type: 'borewell', village: 'Sikar' },
        sourceCode: 'import',
      },
    });
  });

  it('adds no site without a village or PIN, and a household customer by default', () => {
    const bare = LeadImportMappingSchema.parse({
      columns: { contactName: 'Name', phone: 'Mobile' },
      defaults: { pipelineKey: 'farmer_pumps' },
    });
    expect(leadCandidate(row(), bare, 2)).toEqual({
      entityId: 2,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Ram Kumar', phone: '098765 43210', preferredLanguage: 'hinglish' },
      account: { type: 'household' },
      sourceCode: 'import',
    });
  });

  it('names each field that is missing or wrong, once', () => {
    const check = checkLeadRow(
      row({ Name: '', Mobile: '12345', Type: 'Castle', Source: 'billboard' }),
      mapping,
      1,
      lookups,
    );
    expect(check.state).toBe('invalid');
    expect(check.errors).toEqual(
      expect.arrayContaining([
        { field: 'contactName', code: 'required' },
        { field: 'phone', code: 'phone_invalid' },
        { field: 'accountType', code: 'invalid' },
        { field: 'sourceCode', code: 'source_unknown' },
      ]),
    );
    expect(check.errors).toHaveLength(4);
  });

  it('flags a pipeline the entity does not have and a long name', () => {
    const own = LeadImportMappingSchema.parse({
      columns: { contactName: 'Name', phone: 'Mobile', pipelineKey: 'Pipeline' },
    });
    const check = checkLeadRow(
      { Name: 'R'.repeat(121), Mobile: '9876543210', Pipeline: 'rooftop_old' },
      own,
      1,
      lookups,
    );
    expect(check.errors).toEqual([
      { field: 'contactName', code: 'too_long' },
      { field: 'pipelineKey', code: 'pipeline_unknown' },
    ]);
  });

  it('points a repeated phone back at its first row', () => {
    const repeats = firstRowByPhone([
      { rowNo: 1, phone: '+919876543210' },
      { rowNo: 2, phone: null },
      { rowNo: 3, phone: '+919876543210' },
      { rowNo: 4, phone: '+919812345678' },
      { rowNo: 5, phone: '+919876543210' },
    ]);
    expect([...repeats]).toEqual([
      [3, 1],
      [5, 1],
    ]);
  });

  it('compares names and villages without case, spaces or punctuation', () => {
    expect(matchKey(' Ram Lal ')).toBe('ramlal');
    expect(matchKey('RAM-LAL.')).toBe('ramlal');
    expect(matchKey(undefined)).toBe('');
    const input = (name: string, village?: string) =>
      ({
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        sourceCode: 'import',
        contact: { name, phone: '+919876543210', preferredLanguage: 'hinglish' },
        account: { type: 'farm' },
        ...(village === undefined ? {} : { site: { type: 'borewell', village } }),
      }) as Parameters<typeof nameVillageKey>[0];
    expect(nameVillageKey(input('Ram Lal', 'Sri Ganganagar'))).toEqual({
      name: 'ramlal',
      village: 'sriganganagar',
    });
    // No village, or nothing left to compare, is no match at all.
    expect(nameVillageKey(input('Ram Lal'))).toBeNull();
    expect(nameVillageKey(input('..', 'Sikar'))).toBeNull();
  });

  it('reads enum words as people type them', () => {
    expect(enumWord(' Referral partner ')).toBe('referral_partner');
    expect(enumWord('ROOF-TOP')).toBe('roof_top');
  });

  it('refuses a mapping without name and phone, a pipeline, or with a column used twice', () => {
    expect(
      LeadImportMappingSchema.safeParse({ columns: { contactName: 'Name' }, defaults: {} }).success,
    ).toBe(false);
    expect(
      LeadImportMappingSchema.safeParse({ columns: { contactName: 'Name', phone: 'Mobile' } })
        .success,
    ).toBe(false);
    expect(
      LeadImportMappingSchema.safeParse({
        columns: { contactName: 'Name', phone: 'Name' },
        defaults: { pipelineKey: 'farmer_pumps' },
      }).success,
    ).toBe(false);
  });
});
