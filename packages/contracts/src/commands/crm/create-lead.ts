import { z } from 'zod';
import {
  AccountTypeSchema,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  SiteTypeSchema,
} from '../../crm/enums';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema } from '../../ids';
import { LocaleSchema } from '../../principal';

const Name = z.string().trim().min(2).max(120);

/** Walk-in form, manual entry and imports all create a lead through this input (CRM-01). */
export const CreateLeadInput = z
  .object({
    entityId: EntityIdSchema,
    pipelineKey: z.string().trim().min(1).max(40),
    contact: z
      .object({
        name: Name,
        nameHi: Name.optional(),
        phone: PhoneInputSchema,
        preferredLanguage: LocaleSchema.default('hi'),
      })
      .strict(),
    account: z
      .object({
        type: AccountTypeSchema,
        name: Name.optional(),
      })
      .strict(),
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
  .strict();

export type CreateLeadInput = z.infer<typeof CreateLeadInput>;
