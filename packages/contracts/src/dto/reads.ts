import { z } from 'zod';
import { ItemCategorySchema, ItemUnitSchema, MoneySchema } from '../catalogue/enums';
import { SegmentSchema, StageKindSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { LeadSortSchema, PriceSortSchema, UserSortSchema } from './list-sort';
import { SessionDto, UserDto } from './user';

/** A page of a keyset-paginated list: `nextCursor` is null on the last page (docs/API.md §1). */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict();

/** Admin › Team members: staff users with their roles, a page at a time. */
export const UserPageDto = pageOf(UserDto);
export type UserPageDto = z.infer<typeof UserPageDto>;

/** Admin › Team members › Sign-ins: one person's sessions, newest first. */
export const SessionListDto = z.array(SessionDto);
export type SessionListDto = z.infer<typeof SessionListDto>;

/** Filters of the users list: by name unless another order is asked for. */
export const ListUsersInput = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    sort: UserSortSchema.optional(),
  })
  .strict();
export type ListUsersInput = z.input<typeof ListUsersInput>;

/** Filters of a person's sign-ins. */
export const ListSessionsInput = z.object({ userId: IdSchema }).strict();
export type ListSessionsInput = z.infer<typeof ListSessionsInput>;

/** A pipeline stage, for stage names on lead screens. */
export const PipelineStageDto = z
  .object({ id: IdSchema, key: z.string(), name: z.string(), kind: StageKindSchema })
  .strict();
export type PipelineStageDto = z.infer<typeof PipelineStageDto>;

/** A pipeline the caller can create leads in, with its stages in order. */
export const PipelineDto = z
  .object({
    id: IdSchema,
    key: z.string(),
    name: z.string(),
    segment: SegmentSchema,
    entityId: EntityIdSchema.nullable(),
    stages: z.array(PipelineStageDto),
  })
  .strict();
export type PipelineDto = z.infer<typeof PipelineDto>;

/** Where a lead came from, for the lead form. */
export const LeadSourceDto = z.object({ code: z.string(), name: z.string() }).strict();
export type LeadSourceDto = z.infer<typeof LeadSourceDto>;

/** Leads list: the next page after a cursor, newest change first unless asked otherwise. */
export const ListLeadsInput = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: LeadSortSchema.optional(),
  })
  .strict();
export type ListLeadsInput = z.input<typeof ListLeadsInput>;

/**
 * Where a price list stands today: a `draft` prices nothing; an approved list is `scheduled`
 * before its start date, `live` from it and `ended` after its end date. An archived list is
 * `ended` too.
 */
export const PriceListStateSchema = z.enum(['draft', 'scheduled', 'live', 'ended']);
export type PriceListState = z.infer<typeof PriceListStateSchema>;

/** A price list the caller can read (Price Master). */
export const PriceListDto = z
  .object({
    id: IdSchema,
    tierCode: z.string(),
    tierName: z.string(),
    /** Null for a list shared by every company. */
    entityId: EntityIdSchema.nullable(),
    version: z.number().int(),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    /** False once the list has ended or been archived: its prices can no longer change. */
    open: z.boolean(),
    state: PriceListStateSchema,
    /** When the list was approved; null for a draft. */
    approvedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type PriceListDto = z.infer<typeof PriceListDto>;

/**
 * One active item and its price on one list. Carries no cost field: Price Master shows selling
 * prices only (CLAUDE.md, docs/SECURITY.md §4).
 */
export const PriceRowDto = z
  .object({
    itemId: IdSchema,
    sku: z.string(),
    name: z.string(),
    category: ItemCategorySchema,
    unit: ItemUnitSchema,
    price: MoneySchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type PriceRowDto = z.infer<typeof PriceRowDto>;

/** Price Master: one page of a list's items, by name. */
export const PricePageDto = pageOf(PriceRowDto);
export type PricePageDto = z.infer<typeof PricePageDto>;

/** One price list's items, by item name unless another order is asked for. */
export const ListPricesInput = z
  .object({
    priceListId: IdSchema,
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: PriceSortSchema.optional(),
  })
  .strict();
export type ListPricesInput = z.input<typeof ListPricesInput>;
