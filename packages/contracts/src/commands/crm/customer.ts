import { z } from 'zod';
import {
  ACTIVITY_NOTE_MAX,
  AccountTypeSchema,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  CustomerLanguageSchema,
  SiteTypeSchema,
} from '../../crm/enums';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The customer edits of Account 360 (docs/design/phase1.md §6.5, ADR 0008). Each names the
 * customer and the company whose page it is made from, which the request is narrowed to and the
 * timeline row is written in; the change is to the one customer record the group shares.
 */
const Customer = { entityId: EntityIdSchema, accountId: IdSchema };

const Name = z.string().trim().min(2).max(120);
const StateCode = z.string().regex(/^[0-9]{2}$/);
const Gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
const Place = z.string().trim().min(1).max(120);

/** `crm.account.update`: the customer's name, type, GSTIN and billing state; left out stays. */
export const UpdateAccountInput = z
  .object({
    ...Customer,
    name: Name.optional(),
    type: AccountTypeSchema.optional(),
    gstin: Gstin.nullable().optional(),
    billingStateCode: StateCode.nullable().optional(),
  })
  .strict();
export type UpdateAccountInput = z.infer<typeof UpdateAccountInput>;

/** The most numbers one change adds. */
export const CONTACT_PHONES_ADDED_MAX = 3;

/**
 * `crm.contact.update`: a contact of the customer, with its name, email and language of calls;
 * numbers added (normalised to E.164), the main number changed, and numbers taken off while
 * another stays.
 */
export const UpdateContactInput = z
  .object({
    ...Customer,
    contactId: IdSchema,
    name: Name.optional(),
    email: z.email().max(200).nullable().optional(),
    preferredLanguage: CustomerLanguageSchema.optional(),
    addPhones: z
      .array(z.object({ phone: PhoneInputSchema, isWhatsapp: z.boolean().default(false) }).strict())
      .max(CONTACT_PHONES_ADDED_MAX)
      .optional(),
    /** The number that becomes the main one: an id of a number the contact keeps. */
    primaryPhoneId: IdSchema.optional(),
    removePhoneIds: z.array(IdSchema).max(10).optional(),
  })
  .strict();
export type UpdateContactInput = z.infer<typeof UpdateContactInput>;

/** `crm.site.upsert`: a new site of the customer (no `siteId`), or a change to one. */
export const UpsertSiteInput = z
  .object({
    ...Customer,
    siteId: IdSchema.optional(),
    type: SiteTypeSchema,
    address: z.string().trim().min(1).max(300).nullable().optional(),
    village: Place.nullable().optional(),
    tehsil: Place.nullable().optional(),
    district: Place.nullable().optional(),
    pin: z
      .string()
      .trim()
      .regex(/^[1-9][0-9]{5}$/)
      .nullable()
      .optional(),
    stateCode: StateCode.nullable().optional(),
    location: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type UpsertSiteInput = z.infer<typeof UpsertSiteInput>;

/** What a customer edit answers: the customer, and the contact or site it changed. */
export const CustomerChangeDto = z
  .object({
    accountId: IdSchema,
    contactId: IdSchema.nullable(),
    siteId: IdSchema.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type CustomerChangeDto = z.infer<typeof CustomerChangeDto>;

/**
 * The version of a consent text as the form or script prints it: letters, digits, dots and
 * hyphens, such as `v2` or `2026-09-30`. A value outside it is refused with its own sentence.
 */
export const CONSENT_TEXT_VERSION = /^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/;

/**
 * `crm.consent.record` (CRM-10): a consent a contact of the customer gave, per channel and
 * purpose, with its source, the version of the text they agreed to and when. The wording of each
 * text version is the client's.
 */
export const RecordConsentInput = z
  .object({
    ...Customer,
    contactId: IdSchema,
    channel: ConsentChannelSchema,
    purpose: ConsentPurposeSchema,
    source: ConsentSourceSchema,
    textVersion: z
      .string()
      .trim()
      .regex(CONSENT_TEXT_VERSION, { message: 'consent_version_invalid' }),
    givenAt: z.iso.datetime({ offset: true }),
    evidenceFileId: IdSchema.optional(),
  })
  .strict();
export type RecordConsentInput = z.infer<typeof RecordConsentInput>;

/** `crm.consent.withdraw`: the consent ends now; a withdrawal stands. */
export const WithdrawConsentInput = z.object({ ...Customer, consentId: IdSchema }).strict();
export type WithdrawConsentInput = z.infer<typeof WithdrawConsentInput>;

/** A consent as Account 360 shows it. Strict. */
export const ConsentDto = z
  .object({
    id: IdSchema,
    contactId: IdSchema,
    channel: ConsentChannelSchema,
    purpose: ConsentPurposeSchema,
    source: ConsentSourceSchema,
    textVersion: z.string(),
    givenAt: z.iso.datetime(),
    withdrawnAt: z.iso.datetime().nullable(),
    hasEvidence: z.boolean(),
  })
  .strict();
export type ConsentDto = z.infer<typeof ConsentDto>;

/** `crm.note.add`: a note on the customer's timeline, or on one of their leads. */
export const AddNoteInput = z
  .object({
    ...Customer,
    opportunityId: IdSchema.optional(),
    body: z.string().trim().min(1).max(ACTIVITY_NOTE_MAX),
  })
  .strict();
export type AddNoteInput = z.infer<typeof AddNoteInput>;

/** What `crm.note.add` answers. */
export const NoteDto = z
  .object({ accountId: IdSchema, opportunityId: IdSchema.nullable() })
  .strict();
export type NoteDto = z.infer<typeof NoteDto>;
