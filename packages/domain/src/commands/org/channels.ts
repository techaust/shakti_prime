import {
  ArchiveEntityChannelInput,
  DomainError,
  EntityChannelDto,
  EntityChannelKindSchema,
  newId,
  SetEntityChannelInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';

type ChannelRow = typeof schema.entityChannels.$inferSelect;

/** The channel as Settings › Companies › Channels shows it. */
export function toEntityChannelDto(row: ChannelRow): EntityChannelDto {
  return EntityChannelDto.parse({
    id: row.id,
    entityId: row.entityId,
    channel: EntityChannelKindSchema.parse(row.channel),
    numberE164: row.numberE164,
    providerRef: row.providerRef,
    dltHeader: row.dltHeader,
    isActive: row.isActive,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  });
}

/** What the audit row shows of a channel: its kind, number, references and state. */
function audited(row: ChannelRow) {
  return {
    channelKind: row.channel,
    channelNumber: row.numberE164,
    providerRef: row.providerRef,
    dltHeader: row.dltHeader,
    verified: row.verifiedAt !== null,
    isActive: row.isActive,
  };
}

const AUDIT_FIELDS = [
  'channelKind',
  'channelNumber',
  'providerRef',
  'dltHeader',
  'verified',
  'isActive',
] as const;

/**
 * `org.channel.set`: an Executive records a company's number on one channel (Settings › Companies
 * › Channels, docs/03-roadmap-appendix/phase2.md §5.2). The number in use on the channel, if any,
 * is locked first: the same number is updated in place (its provider reference, DLT header and
 * verification); another number takes its place and the old row is kept out of use, so a call or a
 * thread that named it keeps its record. A company outside the request is refused; RLS keeps the
 * write to `admin.entities.write:all`. The numbers are the client's, entered here, never seeded.
 */
export const setEntityChannel = defineCommand({
  name: 'org.channel.set',
  permission: 'admin.entities.write',
  minScope: 'all',
  input: SetEntityChannelInput,
  output: EntityChannelDto,
  auditFields: AUDIT_FIELDS,
  unmaskedFields: [
    // A provider's reference to the number (WhatsApp's phone_number_id is a long number by
    // design), matched whole when an inbound delivery is routed to its company.
    'providerRef',
  ],
  constraintReasons: {
    entity_channels_active_unique: 'channel_changed_meanwhile',
    entity_channels_provider_ref_unique: 'channel_provider_ref_taken',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const c = schema.entityChannels;
    const [current] = await ctx.tx
      .select()
      .from(c)
      .where(
        and(eq(c.entityId, input.entityId), eq(c.channel, input.channel), eq(c.isActive, true)),
      )
      .limit(1)
      .for('update');

    if (current?.numberE164 === input.number) {
      const verifiedAt = input.verified ? (current.verifiedAt ?? ctx.now) : null;
      const providerRef = input.providerRef === undefined ? current.providerRef : input.providerRef;
      const dltHeader = input.dltHeader === undefined ? current.dltHeader : input.dltHeader;
      if (
        verifiedAt === current.verifiedAt &&
        providerRef === current.providerRef &&
        dltHeader === current.dltHeader
      ) {
        return toEntityChannelDto(current);
      }
      const [row] = await ctx.tx
        .update(c)
        .set({ providerRef, dltHeader, verifiedAt, updatedBy: ctx.principal.id })
        .where(eq(c.id, current.id))
        .returning();
      if (!row) throw new DomainError('forbidden', `channel ${current.id} is outside the scope`);
      ctx.audit({
        aggregateType: 'entity_channel',
        aggregateId: row.id,
        entityId: row.entityId,
        before: audited(current),
        after: audited(row),
      });
      return toEntityChannelDto(row);
    }

    if (current) {
      const [old] = await ctx.tx
        .update(c)
        .set({ isActive: false, updatedBy: ctx.principal.id })
        .where(eq(c.id, current.id))
        .returning();
      if (!old) throw new DomainError('forbidden', `channel ${current.id} is outside the scope`);
      ctx.audit({
        aggregateType: 'entity_channel',
        aggregateId: old.id,
        entityId: old.entityId,
        before: audited(current),
        after: audited(old),
      });
    }
    const [row] = await ctx.tx
      .insert(c)
      .values({
        id: newId(),
        entityId: input.entityId,
        channel: input.channel,
        numberE164: input.number,
        providerRef: input.providerRef ?? null,
        dltHeader: input.dltHeader ?? null,
        verifiedAt: input.verified ? ctx.now : null,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'channel insert returned no row');
    ctx.audit({
      aggregateType: 'entity_channel',
      aggregateId: row.id,
      entityId: row.entityId,
      after: audited(row),
    });
    return toEntityChannelDto(row);
  },
});

/**
 * `org.channel.archive`: an Executive takes a company's number out of use. It is kept, so what
 * named it keeps its record, and is never put back (`entity_channels_guard`): the number is set
 * again as a new row. A number of another company, or one the request cannot see, is not found.
 */
export const archiveEntityChannel = defineCommand({
  name: 'org.channel.archive',
  permission: 'admin.entities.write',
  minScope: 'all',
  input: ArchiveEntityChannelInput,
  output: EntityChannelDto,
  auditFields: ['isActive'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const c = schema.entityChannels;
    const [current] = await ctx.tx
      .select()
      .from(c)
      .where(and(eq(c.id, input.channelId), eq(c.entityId, input.entityId)))
      .limit(1)
      .for('update');
    if (!current) {
      throw new DomainError('not_found', `channel ${input.channelId} is not visible`, {
        reason: 'channel_missing',
      });
    }
    if (!current.isActive) {
      throw new DomainError('conflict', 'the number is already out of use', {
        reason: 'channel_already_archived',
      });
    }
    const [row] = await ctx.tx
      .update(c)
      .set({ isActive: false, updatedBy: ctx.principal.id })
      .where(eq(c.id, current.id))
      .returning();
    if (!row) throw new DomainError('forbidden', `channel ${current.id} is outside the scope`);
    ctx.audit({
      aggregateType: 'entity_channel',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { isActive: true },
      after: { isActive: false },
    });
    return toEntityChannelDto(row);
  },
});
