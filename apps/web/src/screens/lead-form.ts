import type { AccountType, CustomerLanguage, PipelineDto, SiteType } from '@shakti/contracts';

// The form's choices, in the order they are offered; `lead-form.test.ts` keeps them equal to the
// contract's lists, without sending the contract's schemas to the browser.
export const ACCOUNT_TYPES = [
  'farm',
  'household',
  'business',
  'dealer',
  'referral_partner',
] as const satisfies readonly AccountType[];
export const SITE_TYPES = ['borewell', 'rooftop', 'factory'] as const satisfies readonly SiteType[];
export const CUSTOMER_LANGUAGES = ['hinglish', 'en'] as const satisfies readonly CustomerLanguage[];

/** The New lead form's fields as typed, each trimmed. */
export interface LeadFormFields {
  entityId: string;
  pipelineKey: string;
  name: string;
  phone: string;
  accountType: string;
  accountName: string;
  language: string;
  village: string;
  siteType: string;
  pin: string;
  sourceCode: string;
  /** A referral partner's code, when a partner sent the customer; optional. */
  referralCode?: string;
}

/**
 * The `crm.lead.create` input for a new customer from the form. Optional parts are left out when
 * empty, so the command decides what is missing and answers with the field it is about; a site is
 * sent once a village is given. The phone goes as typed: the contract turns it into E.164.
 */
export function buildLeadInput(f: LeadFormFields): Record<string, unknown> {
  return {
    entityId: Number(f.entityId),
    pipelineKey: f.pipelineKey,
    contact: { name: f.name, phone: f.phone, preferredLanguage: f.language || 'hinglish' },
    account: { type: f.accountType, ...(f.accountName === '' ? {} : { name: f.accountName }) },
    ...(f.village === ''
      ? {}
      : {
          site: { type: f.siteType, village: f.village, ...(f.pin === '' ? {} : { pin: f.pin }) },
        }),
    ...(f.sourceCode === '' ? {} : { sourceCode: f.sourceCode }),
    ...(f.referralCode === undefined || f.referralCode.trim() === ''
      ? {}
      : { referralCode: f.referralCode.trim() }),
  };
}

/** The pipelines a lead for `entityId` may go into: the shared ones and that company's own. */
export function pipelinesFor(pipelines: readonly PipelineDto[], entityId: number): PipelineDto[] {
  return pipelines.filter((p) => p.entityId === null || p.entityId === entityId);
}
