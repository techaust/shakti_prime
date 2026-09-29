import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

/** A tag's name: a short label, unique in its company whatever its case. */
export const TagNameSchema = z.string().trim().min(1).max(40);

/**
 * `crm.tag.create`: a tag for one company, or for the whole group (`entityId` null) in a request
 * for every company.
 */
export const CreateTagInput = z
  .object({ entityId: EntityIdSchema.nullable(), name: TagNameSchema })
  .strict();
export type CreateTagInput = z.infer<typeof CreateTagInput>;

/** `crm.tag.archive`: the tag goes off the list of tags to choose; leads keep it. */
export const ArchiveTagInput = z.object({ tagId: IdSchema }).strict();
export type ArchiveTagInput = z.infer<typeof ArchiveTagInput>;

/** `crm.lead.tag` and `crm.lead.untag`: a tag put on a lead, or taken off it. */
export const LeadTagInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema, tagId: IdSchema })
  .strict();
export type LeadTagInput = z.infer<typeof LeadTagInput>;

/** A tag. Strict. */
export const TagDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    name: z.string(),
    archivedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type TagDto = z.infer<typeof TagDto>;

/** What `crm.lead.tag` and `crm.lead.untag` answer: whether the lead carries the tag now. */
export const LeadTagDto = z
  .object({ opportunityId: IdSchema, tagId: IdSchema, tagged: z.boolean() })
  .strict();
export type LeadTagDto = z.infer<typeof LeadTagDto>;
