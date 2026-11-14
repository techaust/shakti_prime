import { z } from 'zod';
import {
  ConsentChannelSchema,
  ConsentPurposeSchema,
  CustomerLanguageSchema,
} from '../../crm/enums';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * `crm.lead.ingest` (docs/03-roadmap-appendix/phase2.md §6.2): a lead that arrives from an
 * integration, made by the platform (`system:workers`, the platform-only `crm.ingest.run`) with the
 * same normalisation, PIN lookup, dedupe and attach-to-open-lead as a lead typed in. Its callers:
 * the Lead Ads and Google lead form handlers and the website route (I1), the WhatsApp inbound
 * handler for an unknown number (W1: channel `whatsapp`, the click-to-WhatsApp `referral` with
 * `ctwaClid` as attribution, no consent), and inbound and missed calls (T4).
 */

/** The channels a lead may arrive by without a person typing it, as `lead_sources.channel` names them. */
export const INGEST_CHANNELS = [
  'meta_ads',
  'google_ads',
  'website',
  'whatsapp',
  'ivr',
  'missed_call',
] as const;
export const IngestChannelSchema = z.enum(INGEST_CHANNELS);
export type IngestChannel = z.infer<typeof IngestChannelSchema>;

/** A provider's id (a campaign, ad, form, lead or click id): kept whole, never shown to a customer. */
const ProviderRef = z.string().trim().min(1).max(200);

const UtmSchema = z
  .object({
    source: z.string().trim().min(1).max(100).optional(),
    medium: z.string().trim().min(1).max(100).optional(),
    campaign: z.string().trim().min(1).max(150).optional(),
    term: z.string().trim().min(1).max(150).optional(),
    content: z.string().trim().min(1).max(150).optional(),
  })
  .strict();

/**
 * Where the lead came from, kept on the lead (`opportunities.campaign_json`) for return on ad spend
 * (BLUEPRINT §8.1): the provider's ids as they arrived. `ctwaClid` and `sourceUrl` are the
 * click-to-WhatsApp `referral`; `gclid` is Google's click id; `utm` the website's.
 */
export const LeadAttributionSchema = z
  .object({
    campaignId: ProviderRef.optional(),
    adsetId: ProviderRef.optional(),
    adId: ProviderRef.optional(),
    formId: ProviderRef.optional(),
    pageId: ProviderRef.optional(),
    gclid: ProviderRef.optional(),
    ctwaClid: ProviderRef.optional(),
    referralSourceId: ProviderRef.optional(),
    referralSourceType: z.string().trim().min(1).max(40).optional(),
    sourceUrl: z.url().max(500).optional(),
    utm: UtmSchema.optional(),
  })
  .strict();
export type LeadAttribution = z.infer<typeof LeadAttributionSchema>;

/**
 * The qualification facts a lead carries (`lead_qualifications`), each optional: from a form's
 * mapped questions, from `crm.lead.qualification.set`, or proposed by an agent.
 */
export const LeadQualificationFactsSchema = z
  .object({
    pumpDepthFt: z.number().int().min(1).max(5000).optional(),
    requiredHp: z.number().min(0.5).max(500).optional(),
    monthlyBillRupees: z.number().int().min(1).max(100_000_000).optional(),
    roofAreaSqFt: z.number().int().min(1).max(10_000_000).optional(),
    sanctionedLoadKw: z.number().min(0.1).max(100_000).optional(),
    discomConsumerNo: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9/-]{4,30}$/)
      .optional(),
  })
  .strict();
export type LeadQualificationFacts = z.infer<typeof LeadQualificationFactsSchema>;

/** The names of the qualification facts, in the order a screen shows them. */
export const LEAD_QUALIFICATION_FACTS = [
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
  'discomConsumerNo',
] as const satisfies readonly (keyof LeadQualificationFacts)[];
export type LeadQualificationFact = (typeof LEAD_QUALIFICATION_FACTS)[number];

/**
 * A consent the person gave on the form: only when the form's mapped consent question was ticked
 * (a website's consent box, a Lead Ads form's consent question), with the version of the text it
 * showed. Recorded with the source `web_form`, one row per channel. Never sent for WhatsApp.
 */
export const IngestConsentSchema = z
  .object({
    channels: z.array(ConsentChannelSchema).min(1).max(4),
    purpose: ConsentPurposeSchema,
    textVersion: z.string().trim().min(1).max(60),
    givenAt: z.iso.datetime(),
  })
  .strict()
  .refine((c) => new Set(c.channels).size === c.channels.length, {
    message: 'each channel once',
    path: ['channels'],
  });
export type IngestConsent = z.infer<typeof IngestConsentSchema>;

export const LeadIngestInput = z
  .object({
    entityId: EntityIdSchema,
    channel: IngestChannelSchema,
    /**
     * The company's connected form, page or site (`lead_sources`): its pipeline, segment and
     * channel are the lead's. Without one, `pipelineKey` names the pipeline (WhatsApp, calls).
     */
    sourceId: IdSchema.optional(),
    pipelineKey: z.string().trim().min(1).max(40).optional(),
    /**
     * The provider's own id of this lead or message (Meta `leadgen_id`, Google `lead_id`, the
     * WhatsApp message id): the caller runs the command with an idempotency key made from it, so a
     * repeated event makes nothing.
     */
    externalId: ProviderRef.optional(),
    contact: z
      .object({
        name: z.string().trim().min(1).max(120),
        phone: PhoneInputSchema,
        preferredLanguage: CustomerLanguageSchema.optional(),
      })
      .strict(),
    site: z
      .object({
        village: z.string().trim().min(2).max(120).optional(),
        pin: z
          .string()
          .trim()
          .regex(/^[1-9][0-9]{5}$/)
          .optional(),
      })
      .strict()
      .optional(),
    attribution: LeadAttributionSchema.optional(),
    consent: IngestConsentSchema.optional(),
    qualification: LeadQualificationFactsSchema.optional(),
    /** What the person wrote on the form, kept on the lead's timeline with numbers masked. */
    message: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((v) => v.sourceId !== undefined || v.pipelineKey !== undefined, {
    message: 'a source or a pipeline is required',
    path: ['pipelineKey'],
  })
  .refine((v) => v.channel !== 'whatsapp' || v.consent === undefined, {
    message: 'a WhatsApp message carries no form consent',
    path: ['consent'],
  });
export type LeadIngestInput = z.infer<typeof LeadIngestInput>;

/**
 * Who the lead went to (question 3 of the design): a Cold Calling Tele-Caller by the weighted
 * round-robin, the Sales Team Lead as routed work when none is present, the colleague who already
 * looks after the customer in the company, or the owner of the open lead the enquiry joined.
 */
export const IngestAssigneeSchema = z.enum([
  'caller',
  'team_lead',
  'customer_owner',
  'lead_owner',
  'unassigned',
]);
export type IngestAssignee = z.infer<typeof IngestAssigneeSchema>;

/** `created` opened a new lead; `attached` added the enquiry to the customer's open lead. */
export const LeadIngestResultDto = z
  .object({
    leadId: IdSchema,
    entityId: EntityIdSchema,
    accountId: IdSchema,
    contactId: IdSchema,
    contactPhoneId: IdSchema,
    outcome: z.enum(['created', 'attached']),
    ownerId: IdSchema.nullable(),
    assignedTo: IngestAssigneeSchema,
  })
  .strict();
export type LeadIngestResultDto = z.infer<typeof LeadIngestResultDto>;
