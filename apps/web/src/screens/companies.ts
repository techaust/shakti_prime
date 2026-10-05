// Settings › Companies: what the edit form sends, and how a registered address reads in the grid.
// Pure functions, so the screen and its tests share them.

import type { BankDetails, EntityDto } from '@shakti/contracts';

/** The fields of the edit form, in the order it shows them. */
export const COMPANY_FIELDS = [
  'brandName',
  'upiId',
  'gstin',
  'stateCode',
  'addressLine1',
  'addressLine2',
  'city',
  'pin',
] as const;

export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** Fields a company must always have; every other one is cleared by leaving it empty. */
const REQUIRED: ReadonlySet<CompanyField> = new Set(['brandName', 'stateCode']);

/**
 * The changes the form sends: only the fields that differ from the company as loaded, an empty
 * optional field as `null`. The GSTIN is compared in capitals, as the command stores it. An
 * empty object means nothing changed, and the form closes without saving.
 */
export function companyChanges(
  company: EntityDto,
  typed: Readonly<Record<CompanyField, string>>,
): Partial<Record<CompanyField, string | null>> {
  const changes: Partial<Record<CompanyField, string | null>> = {};
  for (const field of COMPANY_FIELDS) {
    const raw = field === 'gstin' ? typed[field].toUpperCase() : typed[field];
    const value = raw === '' && !REQUIRED.has(field) ? null : raw;
    if (value !== company[field]) changes[field] = value;
  }
  return changes;
}

/** The registered address on one line, or undefined when none is recorded yet. */
export function addressLine(company: EntityDto): string | undefined {
  const parts = [company.addressLine1, company.addressLine2, company.city].filter(
    (p): p is string => p !== null && p !== '',
  );
  const place = parts.join(', ');
  if (company.pin === null) return place === '' ? undefined : place;
  return place === '' ? company.pin : `${place} ${company.pin}`;
}

/** The fields of the bank account form, in the order it shows them. */
export const BANK_FIELDS = ['bankName', 'accountNumber', 'ifsc', 'branch'] as const;

export type BankField = (typeof BANK_FIELDS)[number];

/**
 * The bank account the form sends, as typed: spaces trimmed, the IFSC in capitals and the account
 * number without the spaces people type between groups of digits. The command checks the rest.
 */
export function bankDetailsFrom(typed: Readonly<Record<string, string>>): BankDetails {
  const text = (field: BankField) => (typed[field] ?? '').trim();
  return {
    bankName: text('bankName'),
    accountNumber: text('accountNumber').replace(/\s+/g, ''),
    ifsc: text('ifsc').toUpperCase(),
    branch: text('branch'),
  };
}
