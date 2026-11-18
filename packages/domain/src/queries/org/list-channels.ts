import {
  DomainError,
  ENTITY_CHANNEL_KINDS,
  ListEntityChannelsInput,
  type EntityChannelDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { toEntityChannelDto } from '../../commands/org/channels';

/**
 * `org.channel.list`: a company's numbers in use, in the order of `ENTITY_CHANNEL_KINDS`, for
 * Settings › Companies › Channels. Any principal acting in the company reads them (the
 * `entity_channels` read policy); at most one per channel (`entity_channels_active_unique`), so the
 * list is short and served by that index.
 */
export async function listEntityChannels(
  ctx: Pick<RequestContext, 'tx' | 'entityIds'>,
  rawInput: ListEntityChannelsInput,
): Promise<EntityChannelDto[]> {
  const input = ListEntityChannelsInput.parse(rawInput);
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const c = schema.entityChannels;
  const rows = await ctx.tx
    .select()
    .from(c)
    .where(and(eq(c.entityId, input.entityId), eq(c.isActive, true)));
  const order = (channel: string) => ENTITY_CHANNEL_KINDS.indexOf(channel as never);
  return rows.map(toEntityChannelDto).sort((a, b) => order(a.channel) - order(b.channel));
}
