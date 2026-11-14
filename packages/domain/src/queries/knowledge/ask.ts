import {
  AskSourceSchema,
  DomainError,
  type AskConversationDto,
  type AskMessageDto,
  type AskSource,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { askMessageDto } from '../../commands/knowledge/ask';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const Sources = z.array(AskSourceSchema);

/** A conversation as a follow-up question reads it. */
export interface AskConversationForFollowUp {
  conversation: AskConversationDto;
  /** Its newest questions and answers, oldest first, at most the number asked for. */
  recent: AskMessageDto[];
  /** Every record its lookups returned, in any turn: what a new answer may also cite. */
  returned: AskSource[];
}

/**
 * One of the caller's own conversations, for a follow-up question (docs/03-roadmap-appendix/
 * phase2.md §6.5): row security shows it only to its person, in a request covering all its
 * companies; any other is `ask_conversation_missing`. Reads the conversation's messages on
 * `ask_messages_conversation_idx`, newest first.
 */
export async function loadAskConversation(
  ctx: Ctx,
  conversationId: string,
  recentTurns: number,
): Promise<AskConversationForFollowUp> {
  const c = schema.askConversations;
  const [row] = await ctx.tx.select().from(c).where(eq(c.id, conversationId)).limit(1);
  if (row === undefined) {
    throw new DomainError('not_found', `conversation ${conversationId} is not visible`, {
      reason: 'ask_conversation_missing',
    });
  }
  const m = schema.askMessages;
  const messages = await ctx.tx
    .select()
    .from(m)
    .where(eq(m.conversationId, row.id))
    .orderBy(desc(m.createdAt), desc(m.id));
  const seen = new Set<string>();
  const returned: AskSource[] = [];
  for (const message of messages) {
    for (const source of Sources.parse(message.returnedJson)) {
      const key = `${source.kind}:${source.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      returned.push(source);
    }
  }
  return {
    conversation: {
      id: row.id,
      entityId: row.entityId,
      entityIds: row.entityIds,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    recent: messages.slice(0, recentTurns).reverse().map(askMessageDto),
    returned,
  };
}
