import { z } from 'zod';

/** CRM enumerations (docs/DATABASE.md §6.2, docs/BLUEPRINT.md §6.2, §8.1). Values are the DB check lists. */
export const AccountTypeSchema = z.enum([
  'household',
  'farm',
  'business',
  'dealer',
  'referral_partner',
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const SiteTypeSchema = z.enum(['borewell', 'rooftop', 'factory']);
export type SiteType = z.infer<typeof SiteTypeSchema>;

export const SegmentSchema = z.enum([
  'farmer_pumps',
  'residential_rooftop',
  'commercial_epc',
  'dealer_wholesale',
]);
export type Segment = z.infer<typeof SegmentSchema>;

export const StageKindSchema = z.enum(['open', 'won', 'lost']);
export type StageKind = z.infer<typeof StageKindSchema>;

export const OpportunityStateSchema = z.enum(['open', 'won', 'lost']);
export type OpportunityState = z.infer<typeof OpportunityStateSchema>;

/**
 * The language of a customer's calls: the voice agent and the caller-script variant. Screens,
 * messages and documents are always English (ADR 0014).
 */
export const CustomerLanguageSchema = z.enum(['hinglish', 'en']);
export type CustomerLanguage = z.infer<typeof CustomerLanguageSchema>;

export const ConsentChannelSchema = z.enum(['whatsapp', 'call', 'sms', 'email']);
export type ConsentChannel = z.infer<typeof ConsentChannelSchema>;

export const ConsentPurposeSchema = z.enum(['service', 'promotional']);
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;

export const ConsentSourceSchema = z.enum([
  'web_form',
  'whatsapp_opt_in',
  'walk_in_form',
  'verbal',
  'import',
]);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

export const LeadChannelSchema = z.enum([
  'meta_ads',
  'google_ads',
  'website',
  'whatsapp',
  'ivr',
  'missed_call',
  'walk_in',
  'referral',
  'import',
  'manual',
]);
export type LeadChannel = z.infer<typeof LeadChannelSchema>;

export const ContactRoleSchema = z.enum(['owner', 'family', 'manager', 'accountant', 'other']);
export type ContactRole = z.infer<typeof ContactRoleSchema>;
