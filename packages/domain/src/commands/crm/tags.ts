import {
  ArchiveTagInput,
  CreateTagInput,
  DomainError,
  LeadTagDto,
  LeadTagInput,
  newId,
  TagDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { lockOpportunity, requireEntity } from './opportunity-shared';

type TagRow = typeof schema.tags.$inferSelect;

function toTagDto(row: TagRow): TagDto {
  return TagDto.parse({
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
}

/**
 * `crm.tag.create` (DATABASE §6.2): a team lead, GM or Executive (`crm.lead.assign`) makes a tag
 * for a company of the request, or for the whole group in a request for every company (the insert
 * policy asks `app.request_covers_group()`). A name already used in that company is refused.
 */
export const createTag = defineCommand({
  name: 'crm.tag.create',
  permission: 'crm.lead.assign',
  minScope: 'own',
  input: CreateTagInput,
  output: TagDto,
  auditFields: ['name'],
  constraintReasons: { tags_entity_name_unique: 'tag_name_taken' },
  async handler(ctx, input) {
    if (input.entityId !== null) requireEntity(ctx, input.entityId);
    const [row] = await ctx.tx
      .insert(schema.tags)
      .values({
        id: newId(),
        entityId: input.entityId,
        name: input.name,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'tag insert returned no row');
    ctx.audit({
      aggregateType: 'tag',
      aggregateId: row.id,
      entityId: row.entityId,
      after: { name: row.name },
    });
    return toTagDto(row);
  },
});

/** `crm.tag.archive`: the tag leaves the list to choose from; the leads that carry it keep it. */
export const archiveTag = defineCommand({
  name: 'crm.tag.archive',
  permission: 'crm.lead.assign',
  minScope: 'own',
  input: ArchiveTagInput,
  output: TagDto,
  auditFields: ['archivedAt'],
  async handler(ctx, input) {
    const t = schema.tags;
    const [row] = await ctx.tx
      .update(t)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(and(eq(t.id, input.tagId), isNull(t.archivedAt)))
      .returning();
    if (!row) {
      throw new DomainError('not_found', `tag ${input.tagId} is not open to change`, {
        reason: 'tag_missing',
      });
    }
    ctx.audit({
      aggregateType: 'tag',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString() },
    });
    return toTagDto(row);
  },
});

/** A live tag the caller reads, of the lead's company or of the whole group. */
async function usableTag(ctx: CommandContext, tagId: string, entityId: number): Promise<TagRow> {
  const t = schema.tags;
  const [tag] = await ctx.tx.select().from(t).where(eq(t.id, tagId)).limit(1);
  if (tag === undefined || tag.archivedAt !== null || (tag.entityId ?? entityId) !== entityId) {
    throw new DomainError('not_found', `tag ${tagId} is not available for this lead`, {
      reason: 'tag_missing',
    });
  }
  return tag;
}

/**
 * `crm.lead.tag`: a live tag of the lead's company, or of the whole group, goes on a lead the
 * caller may write. A tag the lead already carries changes nothing.
 */
export const tagLead = defineCommand({
  name: 'crm.lead.tag',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: LeadTagInput,
  output: LeadTagDto,
  auditFields: [],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const lead = await lockOpportunity(ctx, input);
    const tag = await usableTag(ctx, input.tagId, lead.entityId);
    const added = await ctx.tx
      .insert(schema.opportunityTags)
      .values({
        opportunityId: lead.id,
        tagId: tag.id,
        entityId: lead.entityId,
        createdBy: ctx.principal.id,
      })
      .onConflictDoNothing()
      .returning({ tagId: schema.opportunityTags.tagId });
    if (added.length > 0) {
      ctx.audit({
        aggregateType: 'opportunity',
        aggregateId: lead.id,
        entityId: lead.entityId,
        after: { tagId: tag.id },
      });
      await ctx.activity({
        type: 'tagged',
        opportunityId: lead.id,
        accountId: lead.accountId,
        entityId: lead.entityId,
        payload: { tagId: tag.id, tagName: tag.name },
      });
    }
    return { opportunityId: lead.id, tagId: tag.id, tagged: true };
  },
});

/** `crm.lead.untag`: a tag comes off a lead the caller may write; one it does not carry is a no-op. */
export const untagLead = defineCommand({
  name: 'crm.lead.untag',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: LeadTagInput,
  output: LeadTagDto,
  auditFields: [],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const lead = await lockOpportunity(ctx, input);
    const ot = schema.opportunityTags;
    const removed = await ctx.tx
      .delete(ot)
      .where(and(eq(ot.opportunityId, lead.id), eq(ot.tagId, input.tagId)))
      .returning({ tagId: ot.tagId });
    if (removed.length > 0) {
      const [tag] = await ctx.tx
        .select({ name: schema.tags.name })
        .from(schema.tags)
        .where(eq(schema.tags.id, input.tagId))
        .limit(1);
      ctx.audit({
        aggregateType: 'opportunity',
        aggregateId: lead.id,
        entityId: lead.entityId,
        before: { tagId: input.tagId },
      });
      await ctx.activity({
        type: 'untagged',
        opportunityId: lead.id,
        accountId: lead.accountId,
        entityId: lead.entityId,
        payload: { tagId: input.tagId, tagName: tag?.name ?? null },
      });
    }
    return { opportunityId: lead.id, tagId: input.tagId, tagged: false };
  },
});
