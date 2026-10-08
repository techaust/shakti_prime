import { z } from 'zod';
import { QuoteRowDto } from './quote';
import { SalesOrderRowDto } from './sales-order';
import {
  AccountTypeSchema,
  ActivityTypeSchema,
  ContactRoleSchema,
  CustomerLanguageSchema,
  OpportunityStateSchema,
  SiteTypeSchema,
} from '../crm/enums';
import { E164Schema } from '../crm/phone';
import { EntityIdSchema, IdSchema } from '../ids';
import { ConsentDto } from '../commands/crm/customer';
import { TagDto } from '../commands/crm/tags';
import { TaskDto } from '../commands/crm/tasks';
import { listSortOf } from './list-sort';
import { pageOf } from './reads';
import { SearchTextSchema } from './search';

/**
 * Customers: by name, which the `(name, id)` index serves. Other columns would need a join or an
 * index of their own to sort a large company's customers.
 */
export const CUSTOMER_SORT_COLUMNS = ['name'] as const;
export const CustomerSortSchema = listSortOf(CUSTOMER_SORT_COLUMNS);
export type CustomerSort = z.infer<typeof CustomerSortSchema>;

/**
 * The customers list (`/customers`): the caller's customers in the request's companies, one row
 * per customer and company, by name. `q` finds a name, a contact's name, a village or the last
 * digits of a phone.
 */
/** A customers search looks for a name, contact or village from three characters. */
export const CUSTOMER_SEARCH_MIN_CHARS = 3;

/** The most customers one search finds; the list says when a search found more. */
export const CUSTOMER_SEARCH_MAX = 200;

export const ListCustomersInput = z
  .object({
    q: SearchTextSchema.min(CUSTOMER_SEARCH_MIN_CHARS).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: CustomerSortSchema.optional(),
  })
  .strict();
export type ListCustomersInput = z.input<typeof ListCustomersInput>;

/** A customer in the list: a phone shows only its last four digits here. */
export const CustomerRowDto = z
  .object({
    /** The customer's relationship with the company: one row per customer and company. */
    id: IdSchema,
    accountId: IdSchema,
    entityId: EntityIdSchema,
    name: z.string(),
    type: AccountTypeSchema,
    contactName: z.string().nullable(),
    phoneLast4: z.string().length(4).nullable(),
    village: z.string().nullable(),
    ownerId: IdSchema.nullable(),
    ownerName: z.string().nullable(),
    openLeads: z.number().int().min(0),
  })
  .strict();
export type CustomerRowDto = z.infer<typeof CustomerRowDto>;

export const CustomerPageDto = z
  .object({
    items: z.array(CustomerRowDto),
    nextCursor: z.string().nullable(),
    /** The search found more than `CUSTOMER_SEARCH_MAX` customers; only the first are listed. */
    truncated: z.boolean(),
  })
  .strict();
export type CustomerPageDto = z.infer<typeof CustomerPageDto>;

/** Account 360 (`/customers/[accountId]`): the customer as one company deals with them. */
export const LoadAccount360Input = z
  .object({ accountId: IdSchema, entityId: EntityIdSchema.optional() })
  .strict();
export type LoadAccount360Input = z.input<typeof LoadAccount360Input>;

export const ContactPhoneDto = z
  .object({
    id: IdSchema,
    e164: E164Schema,
    isPrimary: z.boolean(),
    isWhatsapp: z.boolean(),
    isDnd: z.boolean(),
  })
  .strict();
export type ContactPhoneDto = z.infer<typeof ContactPhoneDto>;

export const CustomerContactDto = z
  .object({
    id: IdSchema,
    role: ContactRoleSchema,
    name: z.string(),
    email: z.string().nullable(),
    preferredLanguage: CustomerLanguageSchema,
    phones: z.array(ContactPhoneDto),
  })
  .strict();
export type CustomerContactDto = z.infer<typeof CustomerContactDto>;

export const CustomerSiteDto = z
  .object({
    id: IdSchema,
    type: SiteTypeSchema,
    address: z.string().nullable(),
    village: z.string().nullable(),
    tehsil: z.string().nullable(),
    district: z.string().nullable(),
    pin: z.string().nullable(),
    /** The PIN is not in the PIN code master: the site waits for someone to check it (CRM-02). */
    pinNeedsReview: z.boolean(),
    stateCode: z.string().nullable(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  })
  .strict();
export type CustomerSiteDto = z.infer<typeof CustomerSiteDto>;

export const CustomerLeadDto = z
  .object({
    id: IdSchema,
    pipelineName: z.string(),
    stageName: z.string(),
    state: OpportunityStateSchema,
    ownerId: IdSchema.nullable(),
    ownerName: z.string().nullable(),
    updatedAt: z.iso.datetime(),
    tags: z.array(z.object({ id: IdSchema, name: z.string() }).strict()),
  })
  .strict();
export type CustomerLeadDto = z.infer<typeof CustomerLeadDto>;

export const CustomerTaskDto = TaskDto.extend({ assigneeName: z.string().nullable() }).strict();
export type CustomerTaskDto = z.infer<typeof CustomerTaskDto>;

/** A value of a timeline row's payload: an id, a code, a count or a short label. */
export const ActivityValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ActivityDto = z
  .object({
    id: IdSchema,
    type: ActivityTypeSchema,
    opportunityId: IdSchema.nullable(),
    actorId: IdSchema,
    actorName: z.string().nullable(),
    payload: z.record(z.string(), ActivityValueSchema),
    body: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ActivityDto = z.infer<typeof ActivityDto>;

export const TimelinePageDto = pageOf(ActivityDto);
export type TimelinePageDto = z.infer<typeof TimelinePageDto>;

/** A page of a customer's timeline in one company, or of one lead's, newest first. */
export const ListTimelineInput = z
  .object({
    entityId: EntityIdSchema,
    accountId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((v) => (v.accountId === undefined) !== (v.opportunityId === undefined), {
    message: 'name a customer or a lead',
  });
export type ListTimelineInput = z.input<typeof ListTimelineInput>;

export const Account360Dto = z
  .object({
    account: z
      .object({
        id: IdSchema,
        name: z.string(),
        type: AccountTypeSchema,
        gstin: z.string().nullable(),
        billingStateCode: z.string().nullable(),
        /** The price tier the customer's quotes are priced from (PRICE-1); null until set. */
        tierId: IdSchema.nullable(),
        /** Its name, for a caller who reads the price tiers (`pricing.read`). */
        tierName: z.string().nullable(),
      })
      .strict(),
    entityId: EntityIdSchema,
    /** The other companies of the request where the caller reads this customer. */
    otherEntityIds: z.array(EntityIdSchema),
    ownerId: IdSchema.nullable(),
    ownerName: z.string().nullable(),
    /** Whether the caller may change the customer (their customer write scope covers it). */
    canEdit: z.boolean(),
    /** Whether the caller may add tasks and tags on the customer's leads. */
    canWorkLeads: z.boolean(),
    /** Whether the caller may make tags (`crm.lead.assign`). */
    canManageTags: z.boolean(),
    /** Whether the caller may set the customer's price tier (`crm.account.tier.set`). */
    canSetTier: z.boolean(),
    /** Whether the caller may make a quote on the customer's leads (`sales.quote.create`). */
    canQuote: z.boolean(),
    /** The customer's newest quotes in this company (`sales.quote.*`, read with their leads). */
    quotes: z.array(QuoteRowDto),
    /**
     * Whether the caller may make a dealer's order without a quote here: the customer is a dealer
     * and the caller's `sales.order.create` scope covers the relationship.
     */
    canOrder: z.boolean(),
    /** The customer's newest orders in this company (read with their leads, or with the dealer). */
    orders: z.array(SalesOrderRowDto),
    contacts: z.array(CustomerContactDto),
    sites: z.array(CustomerSiteDto),
    leads: z.array(CustomerLeadDto),
    tasks: z.array(CustomerTaskDto),
    consents: z.array(ConsentDto),
    /** The live tags that may go on the customer's leads in this company. */
    tags: z.array(TagDto),
    timeline: TimelinePageDto,
  })
  .strict();
export type Account360Dto = z.infer<typeof Account360Dto>;

/** The caller's open tasks, soonest due first. */
export const ListMyTasksInput = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListMyTasksInput = z.input<typeof ListMyTasksInput>;

export const MyTaskDto = TaskDto.extend({ accountName: z.string() }).strict();
export type MyTaskDto = z.infer<typeof MyTaskDto>;

export const MyTaskPageDto = pageOf(MyTaskDto);
export type MyTaskPageDto = z.infer<typeof MyTaskPageDto>;
