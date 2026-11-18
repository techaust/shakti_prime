import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { whatsappTemplates, whatsappThreads } from './whatsapp';

/**
 * The milestone registry (docs/03-roadmap-appendix/phase2.md §7.1, PRD WA-01): which approved
 * template of the company each customer milestone sends, one row per company and milestone.
 * Written by an Executive in Settings › WhatsApp templates (`messaging.milestone.set`,
 * `messaging.templates.write:all`), read by every principal acting in the company. A milestone
 * whose template is not approved is held, not sent; `is_active` false stops it without losing the
 * map. Each later phase adds only the handler of its milestone's event.
 */
export const whatsappMilestones = pgTable(
  'whatsapp_milestones',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    milestone: text('milestone').notNull(),
    templateId: uuid('template_id').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('whatsapp_milestones_entity_milestone_unique').on(t.entityId, t.milestone),
    // The template is the company's own.
    foreignKey({
      name: 'whatsapp_milestones_template_fk',
      columns: [t.templateId, t.entityId],
      foreignColumns: [whatsappTemplates.id, whatsappTemplates.entityId],
    }),
    check(
      'whatsapp_milestones_milestone_check',
      sql`${t.milestone} in ('quote_sent', 'order_confirmed', 'dispatched', 'visit_booked', 'visit_reminder', 'installed', 'payment_due', 'handover_kit')`,
    ),
    index('whatsapp_milestones_template_idx').on(t.templateId),
  ],
);

/**
 * Each milestone once per subject (docs/03-roadmap-appendix/phase2.md §7.1): the platform's record
 * that it queued the milestone's template for a quote or an order on a chat (`queued`, with the
 * message), or held it because the template is not approved (`held`, WA-01). A second ask for the
 * same milestone and subject finds the key and sends nothing. Written and read only by the
 * platform's definers (`messaging.process`); no request role reads it.
 */
export const whatsappMilestoneSends = pgTable(
  'whatsapp_milestone_sends',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    milestone: text('milestone').notNull(),
    subjectKind: text('subject_kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    threadId: uuid('thread_id'),
    /** The queued message (`whatsapp_messages.id`, partitioned, so no key points at it). */
    messageId: uuid('message_id'),
    outcome: text('outcome').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('whatsapp_milestone_sends_subject_unique').on(t.milestone, t.subjectKind, t.subjectId),
    foreignKey({
      name: 'whatsapp_milestone_sends_thread_fk',
      columns: [t.threadId, t.entityId],
      foreignColumns: [whatsappThreads.id, whatsappThreads.entityId],
    }),
    check(
      'whatsapp_milestone_sends_milestone_check',
      sql`${t.milestone} in ('quote_sent', 'order_confirmed', 'dispatched', 'visit_booked', 'visit_reminder', 'installed', 'payment_due', 'handover_kit')`,
    ),
    check(
      'whatsapp_milestone_sends_subject_kind_check',
      sql`${t.subjectKind} in ('quote', 'sales_order')`,
    ),
    check('whatsapp_milestone_sends_outcome_check', sql`${t.outcome} in ('queued', 'held')`),
    // A queued milestone names its chat and message; a held one neither.
    check(
      'whatsapp_milestone_sends_shape_check',
      sql`(${t.outcome} = 'queued') = (${t.messageId} is not null)
          and (${t.messageId} is null or ${t.threadId} is not null)`,
    ),
    index('whatsapp_milestone_sends_thread_idx').on(t.threadId),
    index('whatsapp_milestone_sends_message_idx').on(t.messageId),
  ],
);
