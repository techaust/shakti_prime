import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';

/**
 * The companies a conversation covers: `entity_ids` lists them (the companies the person viewed
 * when they asked first, in order), and `entity_id` names the one company when there is one, null
 * when the conversation covers several. Both are kept so the standard company column holds for a
 * conversation of one company, and row security reads the list.
 */
const companiesCheck = (entityId: unknown, entityIds: unknown) =>
  sql`cardinality(${entityIds}) between 1 and 32
      and array_position(${entityIds}, null) is null
      and case when ${entityId} is null then cardinality(${entityIds}) > 1
               else ${entityIds} = array[${entityId}] end`;

/**
 * A person's Ask the Business conversation (docs/03-roadmap-appendix/phase2.md §6.5): its title is
 * its first question, masked by the finder and cut to 120 characters. Only its person reads it,
 * in a request covering all its companies (migration of B1); written only by `knowledge.ask.*`;
 * removed with its messages 90 days after it was last used (`ask-conversations-purge`).
 */
export const askConversations = pgTable(
  'ask_conversations',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    entityId: smallint('entity_id').references(() => entities.id),
    entityIds: smallint('entity_ids').array().notNull(),
    title: text('title').notNull(),
    ...timestamps,
  },
  (t) => [
    check('ask_conversations_companies_check', companiesCheck(t.entityId, t.entityIds)),
    check('ask_conversations_title_check', sql`char_length(${t.title}) between 1 and 120`),
    // The key a message names its conversation by, with its person and companies.
    unique('ask_conversations_owner_unique').on(t.id, t.userId, t.entityIds),
    // The person's list, last used first (and the person's foreign key).
    index('ask_conversations_user_updated_idx').on(t.userId, t.updatedAt.desc(), t.id.desc()),
    // The retention sweep.
    index('ask_conversations_updated_idx').on(t.updatedAt),
  ],
);

/**
 * One question and its answer in a conversation: both masked by the finder, the answer after the
 * grounding filter, with the sources it cites (`cited_json`) and every source the turn's tools
 * returned (`returned_json`), which later answers of the conversation may cite. Written once,
 * never changed; removed with its conversation or 90 days after it was asked.
 */
export const askMessages = pgTable(
  'ask_messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => principals.id),
    entityId: smallint('entity_id').references(() => entities.id),
    entityIds: smallint('entity_ids').array().notNull(),
    question: text('question').notNull(),
    answer: text('answer').notNull(),
    outcome: text('outcome').notNull(),
    unsourced: integer('unsourced').notNull().default(0),
    citedJson: jsonb('cited_json').notNull().default([]),
    returnedJson: jsonb('returned_json').notNull().default([]),
    model: text('model'),
    costPaise: integer('cost_paise').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'ask_messages_conversation_fk',
      columns: [t.conversationId, t.userId, t.entityIds],
      foreignColumns: [askConversations.id, askConversations.userId, askConversations.entityIds],
    }).onDelete('cascade'),
    check('ask_messages_companies_check', companiesCheck(t.entityId, t.entityIds)),
    check('ask_messages_question_check', sql`char_length(${t.question}) between 1 and 2000`),
    check('ask_messages_answer_check', sql`char_length(${t.answer}) <= 8000`),
    check(
      'ask_messages_outcome_check',
      sql`${t.outcome} in ('answered', 'unsourced', 'no_answer')`,
    ),
    check('ask_messages_unsourced_check', sql`${t.unsourced} between 0 and 1000`),
    check(
      'ask_messages_cited_check',
      sql`jsonb_typeof(${t.citedJson}) = 'array' and jsonb_array_length(${t.citedJson}) <= 50`,
    ),
    check(
      'ask_messages_returned_check',
      sql`jsonb_typeof(${t.returnedJson}) = 'array' and jsonb_array_length(${t.returnedJson}) <= 500`,
    ),
    check('ask_messages_model_check', sql`char_length(${t.model}) <= 60`),
    check('ask_messages_cost_check', sql`${t.costPaise} >= 0`),
    // A conversation's messages in order (and the conversation's foreign key).
    index('ask_messages_conversation_idx').on(t.conversationId, t.createdAt, t.id),
    // The retention sweep.
    index('ask_messages_created_idx').on(t.createdAt),
  ],
);
