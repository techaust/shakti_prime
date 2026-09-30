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

export const OpportunityStateSchema = z.enum(['open', 'nurture', 'won', 'lost']);
export type OpportunityState = z.infer<typeof OpportunityStateSchema>;

/** Why a lead is lost (design §7.2 `lose`); a code, so reports can count them. */
export const OpportunityLostReasonSchema = z.enum([
  'price_too_high',
  'bought_elsewhere',
  'not_interested',
  'not_reachable',
  'no_budget',
  'not_eligible',
  'duplicate',
  'other',
]);
export type OpportunityLostReason = z.infer<typeof OpportunityLostReasonSchema>;

/** Why a lead is parked on the nurture cadence (design §7.2 `nurture`). */
export const OpportunityNurtureReasonSchema = z.enum([
  'not_ready_yet',
  'waiting_for_funds',
  'waiting_for_subsidy',
  'waiting_for_season',
  'other',
]);
export type OpportunityNurtureReason = z.infer<typeof OpportunityNurtureReasonSchema>;

/**
 * The lead details a stage's exit rules may require (`stage_exit_rules_json`:
 * `{ "requiredFields": [...] }`, CRM-05, workshop CRM-2): a site, its village, PIN and GST state
 * code, and the lead's source; and the sizing details, named with their units, that the sizing
 * panel records (docs/design/phase1.md §6.7).
 */
export const StageExitFieldSchema = z.enum([
  'site',
  'village',
  'pin',
  'stateCode',
  'source',
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
]);
export type StageExitField = z.infer<typeof StageExitFieldSchema>;

/**
 * The exit fields a stage may require today: the lead's source, and its site with the village and
 * PIN, which the lead form records and `crm.site.upsert` (slice C2) lets a caller fill in later.
 * The GST state code and the sizing details join this list when a screen records them; until then
 * a stage cannot require one, so no lead is held by a detail nobody can fill in.
 */
export const RECORDED_STAGE_EXIT_FIELDS = [
  'site',
  'village',
  'pin',
  'source',
] as const satisfies readonly StageExitField[];

/**
 * Stages every pipeline keeps (`pipeline_stages.key` from the seed): New, where leads enter, and
 * Qualified and Quoted, which the queue, handover and quotes move leads to. They may be renamed
 * and reordered, never archived.
 */
export const PROTECTED_STAGE_KEYS = ['new', 'qualified', 'quoted'] as const;

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
