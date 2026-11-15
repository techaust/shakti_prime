import {
  ASK_ANSWER_MAX,
  ASK_QUESTION_MAX,
  ASK_TITLE_MAX,
  AskSourceSchema,
  AskTurnDto,
  DeleteAskConversationInput,
  DeletedAskConversationDto,
  DomainError,
  newId,
  RecordAskInput,
  type AskConversationDto,
  type AskMessageDto,
  type AskSource,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCommand } from '../../command/define-command';
import { maskForModel } from '../../privacy/model-text';

/*
 * Ask the Business's conversation (docs/03-roadmap-appendix/phase2.md §6.5). A person with
 * `knowledge.ask` keeps their own questions and answers; nobody else reads them, and no agent runs
 * these commands. `knowledge.ask.record` is called by `askTheBusiness()` once the grounding filter
 * has passed the answer; it checks again that every cited record is one the conversation's lookups
 * returned, and masks the question and the answer with the finder before they are stored. The
 * audit trail records what happened, never the text.
 */

const Sources = z.array(AskSourceSchema);

/** `text` masked by the finder and kept within `max` characters. */
function masked(text: string, max: number): string {
  return maskForModel(text).slice(0, max).trim();
}

/** A conversation's title: its first question's first line, cut at a word. */
function titleOf(question: string): string {
  const line = (question.split('\n')[0] ?? '').trim();
  if (line.length <= ASK_TITLE_MAX) return line;
  const cut = line.slice(0, ASK_TITLE_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > ASK_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const key = (s: AskSource) => `${s.kind}:${s.id}`;

type ConversationRow = typeof schema.askConversations.$inferSelect;
type MessageRow = typeof schema.askMessages.$inferSelect;

function conversationDto(row: ConversationRow): AskConversationDto {
  return {
    id: row.id,
    entityId: row.entityId,
    entityIds: row.entityIds,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function askMessageDto(row: MessageRow): AskMessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    question: row.question,
    answer: row.answer,
    outcome: row.outcome as AskMessageDto['outcome'],
    unsourced: row.unsourced,
    cited: Sources.parse(row.citedJson),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `knowledge.ask.record`: one question and its filtered answer. A conversation the person reads
 * takes it as a follow-up, in that conversation's companies; any other id starts a conversation
 * over the companies of the request. Refused (`ask_citation_unreturned`) when it cites a record no
 * lookup of the conversation returned.
 */
export const recordAsk = defineCommand({
  name: 'knowledge.ask.record',
  permission: 'knowledge.ask',
  minScope: 'team',
  peopleOnly: true,
  input: RecordAskInput,
  output: AskTurnDto,
  auditFields: ['askAnswered', 'citedSources', 'unsourcedFigures'],
  // Never the question or the answer: what happened and which records it points to.
  auditInput: (input) => ({
    conversationId: input.conversationId,
    outcome: input.outcome,
    unsourced: input.unsourced,
    cited: input.cited,
    model: input.model,
    costPaise: input.costPaise,
  }),
  // Another person's conversation by the same id: it is not this person's to follow up.
  constraintReasons: { ask_conversations_pkey: 'ask_conversation_missing' },
  async handler(ctx, input) {
    const c = schema.askConversations;
    const m = schema.askMessages;
    const [existing] = await ctx.tx.select().from(c).where(eq(c.id, input.conversationId)).limit(1);
    let conversation: ConversationRow;
    let earlier: AskSource[] = [];
    if (existing === undefined) {
      const entityIds = [...new Set(ctx.entityIds)].sort((a, b) => a - b);
      const one = entityIds.length === 1 ? (entityIds[0] ?? null) : null;
      const values = {
        id: input.conversationId,
        userId: ctx.principal.id,
        entityId: one,
        entityIds,
        title: titleOf(masked(input.question, ASK_QUESTION_MAX)),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      await ctx.tx.insert(c).values(values);
      conversation = values;
    } else {
      const rows = await ctx.tx
        .select({ returned: m.returnedJson })
        .from(m)
        .where(eq(m.conversationId, existing.id))
        .orderBy(asc(m.createdAt));
      earlier = rows.flatMap((r) => Sources.parse(r.returned));
      await ctx.tx.update(c).set({ updatedAt: ctx.now }).where(eq(c.id, existing.id));
      conversation = { ...existing, updatedAt: ctx.now };
    }
    const known = new Set([...earlier, ...input.returned].map(key));
    if (input.cited.some((s) => !known.has(key(s)))) {
      throw new DomainError('validation_failed', 'the answer cites a record no lookup returned', {
        reason: 'ask_citation_unreturned',
      });
    }
    const [row] = await ctx.tx
      .insert(m)
      .values({
        id: newId(),
        conversationId: conversation.id,
        userId: ctx.principal.id,
        entityId: conversation.entityId,
        entityIds: conversation.entityIds,
        question: masked(input.question, ASK_QUESTION_MAX),
        answer: masked(input.answer, ASK_ANSWER_MAX),
        outcome: input.outcome,
        unsourced: input.unsourced,
        citedJson: input.cited,
        returnedJson: input.returned,
        model: input.model,
        costPaise: input.costPaise,
        createdAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'ask message insert returned no row');
    ctx.audit({
      aggregateType: 'ask_conversation',
      aggregateId: conversation.id,
      entityId: conversation.entityId,
      after: {
        askAnswered: input.outcome !== 'no_answer',
        citedSources: input.cited.length,
        unsourcedFigures: input.unsourced,
      },
    });
    return { conversation: conversationDto(conversation), message: askMessageDto(row) };
  },
});

/**
 * `knowledge.ask.delete`: the person removes one of their conversations with its messages. Another
 * person's, or one outside the request's companies, is not found.
 */
export const deleteAskConversation = defineCommand({
  name: 'knowledge.ask.delete',
  permission: 'knowledge.ask',
  minScope: 'team',
  peopleOnly: true,
  input: DeleteAskConversationInput,
  output: DeletedAskConversationDto,
  auditFields: ['askMessages'],
  async handler(ctx, input) {
    const c = schema.askConversations;
    const [row] = await ctx.tx
      .select({
        id: c.id,
        entityId: c.entityId,
        messages: sql<number>`(select count(*)::int from ask_messages m where m.conversation_id = ${c.id})`,
      })
      .from(c)
      .where(eq(c.id, input.conversationId))
      .limit(1);
    if (row === undefined) {
      throw new DomainError('not_found', `conversation ${input.conversationId} is not visible`, {
        reason: 'ask_conversation_missing',
      });
    }
    await ctx.tx.delete(c).where(eq(c.id, row.id));
    ctx.audit({
      aggregateType: 'ask_conversation',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { askMessages: row.messages },
    });
    return { conversationId: row.id };
  },
});
