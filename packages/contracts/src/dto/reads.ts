import { z } from 'zod';
import { ItemUnitSchema, MoneySchema } from '../catalogue/enums';
import { SegmentSchema, StageKindSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';
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

/** Keyset position of the users list, ordered by name then id. */
export const UserCursorSchema = z.object({ name: z.string().max(200), id: IdSchema }).strict();

/** Filters of the users list. */
export const ListUsersInput = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
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

/** Leads list: the next page after a cursor. */
export const ListLeadsInput = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListLeadsInput = z.input<typeof ListLeadsInput>;

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
    category: z.string(),
    unit: ItemUnitSchema,
    price: MoneySchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type PriceRowDto = z.infer<typeof PriceRowDto>;

/** Price Master: one page of a list's items, by name. */
export const PricePageDto = pageOf(PriceRowDto);
export type PricePageDto = z.infer<typeof PricePageDto>;

/** Keyset position of the prices list, ordered by item name then id. */
export const PriceCursorSchema = z.object({ name: z.string().max(1000), id: IdSchema }).strict();

export const ListPricesInput = z
  .object({
    priceListId: IdSchema,
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListPricesInput = z.input<typeof ListPricesInput>;
