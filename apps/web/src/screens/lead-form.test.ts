import {
  AccountTypeSchema,
  CreateLeadInput,
  CustomerLanguageSchema,
  SiteTypeSchema,
  type PipelineDto,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_TYPES,
  buildLeadInput,
  CUSTOMER_LANGUAGES,
  pipelinesFor,
  SITE_TYPES,
  type LeadFormFields,
} from './lead-form';

const typed: LeadFormFields = {
  entityId: '3',
  pipelineKey: 'farmer_pumps',
  name: 'Ramesh Kumar',
  phone: '98123 45678',
  accountType: 'farm',
  accountName: '',
  language: 'hinglish',
  village: '',
  siteType: '',
  pin: '',
  sourceCode: '',
};

describe('the New lead form', () => {
  it('sends a new customer with only what was filled in, which the contract accepts', () => {
    const input = buildLeadInput(typed);
    expect(input).toEqual({
      entityId: 3,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Ramesh Kumar', phone: '98123 45678', preferredLanguage: 'hinglish' },
      account: { type: 'farm' },
    });
    expect(CreateLeadInput.parse(input).contact?.phone).toBe('+919812345678');
  });

  it('adds the site once a village is given, and the source and farm name when chosen', () => {
    const input = buildLeadInput({
      ...typed,
      accountName: 'Kumar Farms',
      village: 'Chomu',
      siteType: 'borewell',
      pin: '303702',
      sourceCode: 'walk_in',
      language: 'en',
    });
    expect(input).toMatchObject({
      account: { type: 'farm', name: 'Kumar Farms' },
      contact: { preferredLanguage: 'en' },
      site: { type: 'borewell', village: 'Chomu', pin: '303702' },
      sourceCode: 'walk_in',
    });
    expect(CreateLeadInput.safeParse(input).success).toBe(true);
  });

  it('leaves a site without its kind for the contract to name as the field to fix', () => {
    const parsed = CreateLeadInput.safeParse(buildLeadInput({ ...typed, village: 'Chomu' }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['site', 'type']);
  });

  it('offers every customer type, site kind and call language the contract knows', () => {
    expect([...ACCOUNT_TYPES].sort()).toEqual([...AccountTypeSchema.options].sort());
    expect([...SITE_TYPES].sort()).toEqual([...SiteTypeSchema.options].sort());
    expect([...CUSTOMER_LANGUAGES].sort()).toEqual([...CustomerLanguageSchema.options].sort());
  });

  it('offers the shared pipelines and the chosen company’s own', () => {
    const pipeline = (key: string, entityId: number | null) =>
      ({ key, entityId }) as unknown as PipelineDto;
    const all = [pipeline('shared', null), pipeline('one', 1), pipeline('two', 2)];
    expect(pipelinesFor(all, 2).map((p) => p.key)).toEqual(['shared', 'two']);
  });
});
