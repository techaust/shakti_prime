// What the Lead Converter journeys (`e2e/converting.spec.ts`) and their seed (`e2e/setup/converting.ts`)
// agree on. No database code here, so the journey runs inside the Linux snapshot container too.
import type { ProjectName } from './support/users';

/** The name of the converter each project signs in as (three people, one per project, so the boards never share). */
export const CONVERTER_NAME = 'Pushpa Rawat';

/** The key of a project's converter: `emailFor(converterKey(project))` is the email they sign in with. */
export function converterKey(project: ProjectName): string {
  return `converting-${project}`;
}

/** The price tier, item and price the converter's quotes are made from: test values for the journeys alone. */
export const CONVERTING_TIER = 'Converting prices';
export const CONVERTING_ITEM = {
  sku: 'CNV-MOD-540',
  name: 'Converting solar module 540 Wp',
  price: '12000.00',
  /** The option the quote form shows for it. */
  option: 'Converting solar module 540 Wp (CNV-MOD-540), ₹12,000.00',
} as const;

/**
 * The three leads each converter starts a run with, all at Qualified: the first has a callback due
 * and no sizing (the one the journey works), the second a sent quote that runs out within a day, and
 * the third an order held for credit. The last four digits of a phone are fixed, so the page
 * reads the same on every run.
 */
export const CONVERTING_LEADS = {
  work: { name: 'Dhanna Ram Bairwa', lastDigits: '0061' },
  expiring: { name: 'Hari Singh Shekhawat', lastDigits: '0062' },
  held: { name: 'Bhanwari Devi Choudhary', lastDigits: '0063' },
} as const;
export type ConvertingLead = keyof typeof CONVERTING_LEADS;
