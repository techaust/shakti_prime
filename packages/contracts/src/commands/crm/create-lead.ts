import { z } from 'zod';
import {
  AccountTypeSchema,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  SiteTypeSchema,
} from '../../crm/enums';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';
import { LocaleSchema } from '../../principal';

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
        nameHi: Name.optional(),
        phone: PhoneInputSchema,
        preferredLanguage: LocaleSchema.default('hi'),
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
  })
  .strict()
  .refine(
    (v) =>
      v.existingAccountId !== undefined || (v.contact !== undefined && v.account !== undefined),
    { message: 'contact and account are required for a new customer', path: ['contact'] },
  );

export type CreateLeadInput = z.infer<typeof CreateLeadInput>;
