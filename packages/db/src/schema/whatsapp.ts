import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { actorsRequired, timestamps } from './columns';
import { contactPhones } from './contacts';
import { entities } from './entities';
import { entityChannels } from './entity-channels';
import { files } from './files';
import { opportunities } from './opportunities';
import { principals } from './principals';

/**
 * One WhatsApp conversation between a company's number and one customer number
 * (docs/05-database.md §6.2, docs/03-roadmap-appendix/phase2.md §6.1). Opened by the platform on
 * the first inbound message (`app.whatsapp_record_inbound()`, `messaging.process`), never by a
 * person. Read under the customer's read rule, as Account 360: whoever reads the customer in the
 * thread's company reads the thread; a thread no customer is matched to yet (a number held by
 * several customers, or one the lead intake has not recorded) is read by holders of
 * `messaging.send` for the whole company, who match it.
 *
 * `account_id`, `contact_phone_id`, `opportunity_id` (the customer's newest open lead in the
 * company) and `assignee_id` (that lead's owner) are refreshed by the platform on each inbound
 * message; the lead's key carries the customer, so a customer merge that moves the lead moves the
 * thread with it. `window_open_until` is the 24-hour service window the customer's last message
 * opened. `opted_out_at` is when the customer sent STOP. `handled_by` says whether the assistant
 * or people answer it; `needs_reply` that a customer message waits for a person's answer.
 */
export const whatsappThreads = pgTable(
  'whatsapp_threads',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => entityChannels.id),
    /** The customer's number as WhatsApp names it: E.164 digits without the plus. */
    waId: text('wa_id').notNull(),
    accountId: uuid('account_id').references(() => accounts.id),
    contactPhoneId: uuid('contact_phone_id').references(() => contactPhones.id),
    opportunityId: uuid('opportunity_id'),
    assigneeId: uuid('assignee_id').references(() => principals.id),
    windowOpenUntil: timestamp('window_open_until', { withTimezone: true }),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    handledBy: text('handled_by').notNull().default('assistant'),
    handoffReason: text('handoff_reason'),
    handedOffAt: timestamp('handed_off_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    needsReply: boolean('needs_reply').notNull().default(false),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('whatsapp_threads_channel_wa_unique').on(t.channelId, t.waId),
    // The key the messages point at, so a message stays in its thread's company.
    unique('whatsapp_threads_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'whatsapp_threads_opportunity_fk',
      columns: [t.opportunityId, t.entityId, t.accountId],
      foreignColumns: [opportunities.id, opportunities.entityId, opportunities.accountId],
    }).onUpdate('cascade'),
    check('whatsapp_threads_wa_id_check', sql`${t.waId} ~ '^[1-9][0-9]{6,14}$'`),
    check('whatsapp_threads_handled_by_check', sql`${t.handledBy} in ('assistant', 'people')`),
    check(
      'whatsapp_threads_handoff_reason_check',
      sql`${t.handoffReason} is null or ${t.handoffReason} in ('keyword', 'request', 'filter_refusals', 'complaint')`,
    ),
    // Handed to people with a reason and a time; back with the assistant, neither.
    check(
      'whatsapp_threads_handoff_check',
      sql`(${t.handledBy} = 'people') = (${t.handoffReason} is not null)
          and (${t.handledBy} = 'people') = (${t.handedOffAt} is not null)`,
    ),
    check(
      'whatsapp_threads_customer_check',
      sql`(${t.contactPhoneId} is null or ${t.accountId} is not null)
          and (${t.opportunityId} is null or ${t.accountId} is not null)`,
    ),
    // Account 360's WhatsApp tab: the customer's threads in the company.
    index('whatsapp_threads_account_idx').on(t.accountId, t.entityId),
    index('whatsapp_threads_opportunity_idx').on(t.opportunityId),
    // `/messages`: the company's threads waiting for a reply, newest customer message first.
    index('whatsapp_threads_waiting_idx')
      .on(t.entityId, t.lastInboundAt.desc(), t.id.desc())
      .where(sql`${t.needsReply}`),
    index('whatsapp_threads_assignee_idx')
      .on(t.assigneeId, t.lastInboundAt.desc(), t.id.desc())
      .where(sql`${t.needsReply}`),
    index('whatsapp_threads_contact_phone_idx').on(t.contactPhoneId),
  ],
);

/**
 * The messages of a thread, both ways (docs/05-database.md §6.2, §7). Partitioned by month on
 * `created_at`, so the key includes it; the partitions live in the `messaging_partitions` schema,
 * which no request role can use. Customer text is untrusted and is stored only as `body_masked`:
 * identity and bank numbers masked by the shared finder before the row is written.
 *
 * `kind` `system` is the platform's confirmation of a STOP: a template, but the one message a
 * number that opted out may still be sent. An inbound message has no `status`; an outbound one
 * starts `queued` and only moves forward (`app.whatsapp_messages_guard()`): `sent`, then
 * `delivered`, then `read`; `failed` from queued or sent; `refused` (with its `refusal`) from
 * queued. A person queues a message through `messaging.message.send`; everything else is the
 * platform's, through definers that check `messaging.process`.
 */
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').notNull(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    threadId: uuid('thread_id').notNull(),
    direction: text('direction').notNull(),
    kind: text('kind').notNull(),
    /** Meta's id (`wamid.…`): an inbound message's own, an outbound one's once it is sent. */
    providerMessageId: text('provider_message_id'),
    templateName: text('template_name'),
    /** A template message's body values in order, masked as the body is. */
    templateParams: jsonb('template_params'),
    bodyMasked: text('body_masked'),
    /** A button reply's own id, which the button was sent with. */
    buttonPayload: text('button_payload'),
    fileId: uuid('file_id'),
    status: text('status'),
    statusAt: timestamp('status_at', { withTimezone: true }),
    refusal: text('refusal'),
    /** Meta's error code of a failed message. */
    errorCode: integer('error_code'),
    /** Who queued an outbound message: a person, an agent or the platform. */
    sentBy: uuid('sent_by').references(() => principals.id),
    draftedByAgentActionId: uuid('drafted_by_agent_action_id'),
    /** When the worker took the message to send it: a message is handed to Meta once, never again. */
    sendAttemptedAt: timestamp('send_attempted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'whatsapp_messages_pkey', columns: [t.id, t.createdAt] }),
    foreignKey({
      name: 'whatsapp_messages_thread_fk',
      columns: [t.threadId, t.entityId],
      foreignColumns: [whatsappThreads.id, whatsappThreads.entityId],
    }),
    foreignKey({
      name: 'whatsapp_messages_file_fk',
      columns: [t.fileId, t.entityId],
      foreignColumns: [files.id, files.entityId],
    }),
    check('whatsapp_messages_direction_check', sql`${t.direction} in ('inbound', 'outbound')`),
    check(
      'whatsapp_messages_kind_check',
      sql`${t.kind} in ('text', 'template', 'media', 'button', 'system')`,
    ),
    check(
      'whatsapp_messages_status_check',
      sql`${t.status} is null or ${t.status} in ('queued', 'sent', 'delivered', 'read', 'failed', 'refused')`,
    ),
    check(
      'whatsapp_messages_refusal_check',
      sql`${t.refusal} is null or ${t.refusal} in ('opted_out', 'window_closed', 'template_not_approved', 'tier_budget_reached', 'output_filter')`,
    ),
    // An inbound message carries Meta's id and no status or sender; an outbound one a status and
    // who queued it.
    check(
      'whatsapp_messages_direction_shape_check',
      sql`case when ${t.direction} = 'inbound'
               then ${t.providerMessageId} is not null and ${t.status} is null and ${t.sentBy} is null
                    and ${t.sendAttemptedAt} is null
               else ${t.status} is not null and ${t.sentBy} is not null end`,
    ),
    check(
      'whatsapp_messages_refused_check',
      sql`(${t.status} = 'refused') = (${t.refusal} is not null)`,
    ),
    check(
      'whatsapp_messages_template_check',
      sql`(${t.kind} in ('template', 'system')) = (${t.templateName} is not null)
          and (${t.templateName} is null or ${t.templateName} ~ '^[a-z0-9_]{1,512}$')
          and (${t.templateParams} is null
               or (jsonb_typeof(${t.templateParams}) = 'array'
                   and jsonb_array_length(${t.templateParams}) <= 20
                   and octet_length(${t.templateParams}::text) <= 8000))`,
    ),
    check(
      'whatsapp_messages_body_check',
      sql`${t.bodyMasked} is null or char_length(${t.bodyMasked}) between 1 and 4096`,
    ),
    check(
      'whatsapp_messages_provider_id_check',
      sql`${t.providerMessageId} is null or char_length(${t.providerMessageId}) between 1 and 256`,
    ),
    check(
      'whatsapp_messages_button_check',
      sql`${t.buttonPayload} is null or char_length(${t.buttonPayload}) between 1 and 256`,
    ),
    // A thread's messages, newest first.
    index('whatsapp_messages_thread_created_idx').on(
      t.threadId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // Messages waiting for the worker: a held marketing message, sent on in the next window.
    index('whatsapp_messages_queued_idx')
      .on(t.entityId, t.createdAt)
      .where(sql`${t.status} = 'queued'`),
    index('whatsapp_messages_file_idx')
      .on(t.fileId)
      .where(sql`${t.fileId} is not null`),
  ],
);

/**
 * Meta's message ids, each once across every monthly partition of `whatsapp_messages`: an inbound
 * message or an outbound one once sent. A repeated delivery of a message finds its key and
 * changes nothing; a status names its message by it. Written and read only by the platform's
 * definers; no request role reads it.
 */
export const whatsappMessageKeys = pgTable(
  'whatsapp_message_keys',
  {
    providerMessageId: text('provider_message_id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    messageId: uuid('message_id').notNull(),
    messageCreatedAt: timestamp('message_created_at', { withTimezone: true }).notNull(),
    threadId: uuid('thread_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'whatsapp_message_keys_message_fk',
      columns: [t.messageId, t.messageCreatedAt],
      foreignColumns: [whatsappMessages.id, whatsappMessages.createdAt],
    }),
    foreignKey({
      name: 'whatsapp_message_keys_thread_fk',
      columns: [t.threadId, t.entityId],
      foreignColumns: [whatsappThreads.id, whatsappThreads.entityId],
    }),
    check(
      'whatsapp_message_keys_id_check',
      sql`char_length(${t.providerMessageId}) between 1 and 256`,
    ),
    index('whatsapp_message_keys_message_idx').on(t.messageId),
    index('whatsapp_message_keys_thread_idx').on(t.threadId),
  ],
);

/**
 * A company's WhatsApp message templates as registered in Meta (docs/03-roadmap-appendix/phase2.md
 * §6.1): written by an Executive through `messaging.template.register`
 * (`messaging.templates.write`), its `status` only by the platform from Meta's template events.
 * `params` names each body value in order (its count is the template's), `buttons` the buttons it
 * carries; `purpose` marks a template the platform itself sends (the welcome, the confirmation of a
 * STOP), one per company and purpose; such a template takes no body values.
 * Read by every principal acting in the company, since the composer offers the approved ones.
 */
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    name: text('name').notNull(),
    language: text('language').notNull().default('en'),
    category: text('category').notNull(),
    status: text('status').notNull().default('pending'),
    statusAt: timestamp('status_at', { withTimezone: true }),
    params: jsonb('params').notNull().default([]),
    buttons: jsonb('buttons').notNull().default([]),
    purpose: text('purpose'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('whatsapp_templates_entity_name_unique').on(t.entityId, t.name, t.language),
    check('whatsapp_templates_name_check', sql`${t.name} ~ '^[a-z0-9_]{1,512}$'`),
    check('whatsapp_templates_language_check', sql`${t.language} in ('en')`),
    check(
      'whatsapp_templates_category_check',
      sql`${t.category} in ('utility', 'marketing', 'authentication')`,
    ),
    check(
      'whatsapp_templates_status_check',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'paused', 'disabled')`,
    ),
    check('whatsapp_templates_purpose_check', sql`${t.purpose} is null or ${t.purpose} in ('welcome', 'opt_out_confirmation')`),
    // One template a company's platform sends for each purpose.
    uniqueIndex('whatsapp_templates_purpose_unique')
      .on(t.entityId, t.purpose)
      .where(sql`${t.purpose} is not null`),
    check(
      'whatsapp_templates_params_check',
      sql`jsonb_typeof(${t.params}) = 'array' and jsonb_array_length(${t.params}) <= 20
          and octet_length(${t.params}::text) <= 4000`,
    ),
    check(
      'whatsapp_templates_buttons_check',
      sql`jsonb_typeof(${t.buttons}) = 'array' and jsonb_array_length(${t.buttons}) <= 10
          and octet_length(${t.buttons}::text) <= 4000`,
    ),
  ],
);
