import { UpdateEntityInput, type EntityDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { addressLine, COMPANY_FIELDS, companyChanges, type CompanyField } from './companies';

const company: EntityDto = {
  id: 1,
  code: 'SS',
  legalName: 'Shakti Supreme',
  brandName: 'Shakti Supreme',
  stateCode: '08',
  gstin: null,
  upiId: 'shaktisupreme@upi',
  addressLine1: null,
  addressLine2: null,
  city: null,
  pin: null,
};

/** The form as loaded: every field as the company has it, an empty one as an empty box. */
function typedFrom(c: EntityDto): Record<CompanyField, string> {
  return Object.fromEntries(COMPANY_FIELDS.map((f) => [f, c[f] ?? ''])) as Record<
    CompanyField,
    string
  >;
}

describe('the company edit form', () => {
  it('sends nothing when nothing changed', () => {
    expect(companyChanges(company, typedFrom(company))).toEqual({});
  });

  it('sends only what changed, the GSTIN in capitals and an emptied field as cleared', () => {
    const typed = {
      ...typedFrom(company),
      upiId: '',
      gstin: '08abcde1234f1z5',
      addressLine1: 'Plot 14, Industrial Area',
      city: 'Jaipur',
      pin: '302013',
    };
    const changes = companyChanges(company, typed);
    expect(changes).toEqual({
      upiId: null,
      gstin: '08ABCDE1234F1Z5',
      addressLine1: 'Plot 14, Industrial Area',
      city: 'Jaipur',
      pin: '302013',
    });
    expect(UpdateEntityInput.safeParse({ entityId: 1, ...changes }).success).toBe(true);
  });

  it('keeps a required field as typed, so an empty one is refused under that field', () => {
    const changes = companyChanges(company, { ...typedFrom(company), stateCode: '' });
    expect(changes).toEqual({ stateCode: '' });
    const parsed = UpdateEntityInput.safeParse({ entityId: 1, ...changes });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toEqual(['stateCode']);
  });

  it('refuses a GSTIN of another state when both are sent, under the GSTIN', () => {
    const parsed = UpdateEntityInput.safeParse({
      entityId: 1,
      stateCode: '08',
      gstin: '27ABCDE1234F1Z5',
    });
    expect(parsed.error?.issues[0]?.path).toEqual(['gstin']);
  });
});

describe('the registered address in the grid', () => {
  it('reads on one line, and is absent until one is recorded', () => {
    expect(addressLine(company)).toBeUndefined();
    expect(
      addressLine({
        ...company,
        addressLine1: 'Plot 14, Industrial Area',
        addressLine2: 'Near the bus stand',
        city: 'Jaipur',
        pin: '302013',
      }),
    ).toBe('Plot 14, Industrial Area, Near the bus stand, Jaipur 302013');
    expect(addressLine({ ...company, pin: '302013' })).toBe('302013');
  });
});
