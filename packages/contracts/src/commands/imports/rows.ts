import { z } from 'zod';
import { AccountTypeSchema, CustomerLanguageSchema, SiteTypeSchema } from '../../crm/enums';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';
import { GstStateCodeSchema } from '../org/update-entity';

/** The most sites later rows of one customer add to it from one file. */
export const MORE_SITES_MAX = 100;

/** A site a customers row gives: its type, its village, and its PIN when the file has one. */
export const AccountImportSiteInput = z
  .object({
    type: SiteTypeSchema,
    village: z.string().trim().min(2).max(120),
    pin: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/)
      .optional(),
  })
  .strict();
export type AccountImportSiteInput = z.infer<typeof AccountImportSiteInput>;

/**
 * What one checked row of a customers file becomes (docs/design/phase1.md §6.3), as the preview
 * stores it and the commit reads it: the customer as `crm.lead.create` would make it, without a
 * lead, and every company it deals with. Rows of one customer (the same mobile number) fold into
 * the first of them, which then names the companies of them all and carries their other sites
 * (`moreSites`). A row whose number belongs to a customer the importer can see names that
 * customer (`existingAccountId`): its companies are added to it, and nothing else is made.
 */
export const AccountImportRowInput = z
  .object({
    entityIds: z
      .array(EntityIdSchema)
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'each company once' }),
    contact: z
      .object({
        name: z.string().trim().min(2).max(120),
        phone: PhoneInputSchema,
        preferredLanguage: CustomerLanguageSchema.default('hinglish'),
      })
      .strict(),
    account: z
      .object({ type: AccountTypeSchema, name: z.string().trim().min(2).max(120).optional() })
      .strict(),
    site: AccountImportSiteInput.optional(),
    /** The different sites of later rows of the same customer, in file order. */
    moreSites: z.array(AccountImportSiteInput).min(1).max(MORE_SITES_MAX).optional(),
    existingAccountId: IdSchema.optional(),
  })
  .strict();
export type AccountImportRowInput = z.infer<typeof AccountImportRowInput>;

/** A six-digit Indian PIN code; the first digit is never 0. */
export const PinCodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/);

/**
 * One post office of the PIN code master, as the preview checks a row of the India Post
 * directory and the commit writes it (`pin_codes`).
 */
export const PinCodeImportRowInput = z
  .object({
    pin: PinCodeSchema,
    officeName: z.string().trim().min(1).max(120),
    taluk: z.string().trim().min(1).max(120).optional(),
    district: z.string().trim().min(2).max(120),
    stateCode: GstStateCodeSchema.optional(),
  })
  .strict();
export type PinCodeImportRowInput = z.infer<typeof PinCodeImportRowInput>;

/** The lead and site forms ask what the PIN master knows of a PIN (PRD CRM-02). */
export const LookupPinInput = z.object({ pin: PinCodeSchema }).strict();
export type LookupPinInput = z.infer<typeof LookupPinInput>;

/**
 * What the PIN master knows of one PIN: its post-office localities, offered for the village, and
 * the tehsil, district and state a site with this PIN is given when every office of the PIN
 * agrees on them (null where they differ or the directory left them out). `known` is false for a
 * PIN outside the master, which saves the site and flags it for review.
 */
export const PinLookupDto = z
  .object({
    pin: PinCodeSchema,
    known: z.boolean(),
    tehsil: z.string().nullable(),
    district: z.string().nullable(),
    stateCode: GstStateCodeSchema.nullable(),
    localities: z.array(z.string()).max(100),
  })
  .strict();
export type PinLookupDto = z.infer<typeof PinLookupDto>;
