import { z } from 'zod';
import {
  AccountTypeSchema,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  CustomerLanguageSchema,
  SiteTypeSchema,
} from '../../crm/enums';
import { ReferralCodeSchema } from '../../crm/config';
import { CreateLeadOutcomeSchema } from '../../crm/duplicates';
import { LeadDto } from '../../dto/lead';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';

const Name = z.string().trim().min(2).max(120);

/**
 * Walk-in form, manual entry and imports all create a lead through this input (CRM-01). With
 * `existingAccountId` the lead attaches to a customer the group already knows (ADR 0008): the
 * caller's entity is added to that account and the contact and account blocks are not needed.
 */
export const CreateLeadInput = z
  .object({
    entityId: EntityIdSchema,
    pipelineKey: z.string().trim().min(1).max(40),
    existingAccountId: IdSchema.optional(),
    contact: z
      .object({
        name: Name,
        phone: PhoneInputSchema,
        preferredLanguage: CustomerLanguageSchema.default('hinglish'),
      })
      .strict()
      .optional(),
    account: z
      .object({
        type: AccountTypeSchema,
        name: Name.optional(),
      })
      .strict()
      .optional(),
    site: z
      .object({
        type: SiteTypeSchema,
        village: z.string().trim().min(2).max(120),
        pin: z
          .string()
          .trim()
          .regex(/^[1-9][0-9]{5}$/)
          .optional(),
      })
      .strict()
      .optional(),
    consent: z
      .object({
        channel: ConsentChannelSchema,
        purpose: ConsentPurposeSchema,
        source: ConsentSourceSchema,
        textVersion: z.string().trim().min(1).max(40),
      })
      .strict()
      .optional(),
    sourceCode: z.string().trim().min(1).max(40).optional(),
    /** A referral partner's code: the lead is credited to the partner, or refused (CRM-09). */
    referralCode: ReferralCodeSchema.optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.existingAccountId !== undefined || (v.contact !== undefined && v.account !== undefined),
    { message: 'contact and account are required for a new customer', path: ['contact'] },
  )
  // A known customer keeps its own contact: a name and phone sent with it would be stored
  // nowhere, and a consent would attach to someone else (AUDIT M29).
  .refine(
    (v) =>
      v.existingAccountId === undefined || (v.contact === undefined && v.account === undefined),
    { message: 'a known customer takes no new contact or account', path: ['existingAccountId'] },
  );

export type CreateLeadInput = z.infer<typeof CreateLeadInput>;

/**
 * What `crm.lead.create` answers: the lead it made, or the customer's open lead of the same
 * segment that a repeat enquiry within `REPEAT_ENQUIRY_DAYS` was added to (`attached`, CRM-03).
 */
export const CreateLeadResultDto = LeadDto.extend({ outcome: CreateLeadOutcomeSchema }).strict();
export type CreateLeadResultDto = z.infer<typeof CreateLeadResultDto>;
