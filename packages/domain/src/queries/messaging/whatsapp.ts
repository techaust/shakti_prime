import {
  DomainError,
  IdSchema,
  ListAccountThreadsInput,
  ListWaitingThreadsInput,
  ReadThreadInput,
  ThreadViewDto,
  WaitingThreadDto,
  WaitingThreadPageDto,
  WhatsAppMessageDto,
  WhatsAppTemplateDto,
  type MessagingRefusal,
  type WaitingThreadPageDto as WaitingPage,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

// The WhatsApp reads (docs/03-roadmap-appendix/phase2.md §6.1): the chats waiting for a reply on
// `/messages`, a customer's chats on Account 360 and the Converting workspace, one chat with a page
// of its messages, and Integration Health's counts. Every read runs as the caller under row
// security: a chat is read under its customer's read rule, its messages and files with it.

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const Cursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

function cursorOf(raw: string | undefined): z.output<typeof Cursor> | undefined {
  if (raw === undefined) return undefined;
  const after = decodeCursor(Cursor, raw);
  if (!PG_TIME.test(after.t)) throw new DomainError('validation_failed', 'cursor is not valid');
  return after;
}

const iso = (v: Date | string | null): string | null =>
  v === null ? null : (v instanceof Date ? v : new Date(v)).toISOString();

const entityList = (ids: readonly number[]): string => `{${ids.join(',')}}`;

interface ThreadRow extends Record<string, unknown> {
  id: string;
  entity_id: number;
  wa_id: string;
  account_id: string | null;
  opportunity_id: string | null;
  assignee_id: string | null;
  window_open_until: Date | string | null;
  opted_out: boolean;
  handled_by: string;
  handoff_reason: string | null;
  handed_off_at: Date | string | null;
  last_inbound_at: Date | string | null;
  last_text: string | null;
  needs_reply: boolean;
  customer_name: string | null;
}

/** The thread columns every read answers, over the alias `t`. */
const THREAD_COLUMNS = sql`
  t.id, t.entity_id, t.wa_id, t.account_id, t.opportunity_id, t.assignee_id, t.window_open_until,
  app.whatsapp_thread_opted_out(t.id) as opted_out, t.handled_by, t.handoff_reason,
  t.handed_off_at, t.last_inbound_at, t.last_inbound_at::text as last_text, t.needs_reply,
  (select a.name from accounts a where a.id = t.account_id) as customer_name`;

function toThread(row: ThreadRow): WaitingThreadDto {
  return WaitingThreadDto.parse({
    id: row.id,
    entityId: row.entity_id,
    number: `+${row.wa_id}`,
    accountId: row.account_id,
    opportunityId: row.opportunity_id,
    assigneeId: row.assignee_id,
    windowOpenUntil: iso(row.window_open_until),
    optedOut: row.opted_out,
    handledBy: row.handled_by,
    handoffReason: row.handoff_reason,
    handedOffAt: iso(row.handed_off_at),
    lastInboundAt: iso(row.last_inbound_at),
    needsReply: row.needs_reply,
    customerName: row.customer_name,
  });
}

/**
 * The page of `/messages` as SQL, exported so the plan of the very statement can be explained:
 * chats of the request's companies (or one) waiting for a reply that the caller may answer
 * (`app.whatsapp_send_scope_ok()`), read under the chat's read rule, newest customer message
 * first. The waiting index `(entity_id, last_inbound_at desc, id desc) where needs_reply` gives
 * the order, so a page stops after `limit` rows.
 */
export function waitingThreadsSql(
  ctx: Ctx,
  limit: number,
  entityId: number | undefined,
  after: z.output<typeof Cursor> | undefined,
): SQL {
  const companies = entityId === undefined ? ctx.entityIds : [entityId];
  const keyset =
    after === undefined
      ? sql`true`
      : sql`(t.last_inbound_at, t.id) < (${after.t}::text::timestamptz, ${after.id}::uuid)`;
  return sql`
    select ${THREAD_COLUMNS}
      from whatsapp_threads t
     where t.needs_reply
       and t.entity_id = any(${entityList(companies)}::int[])
       and ${keyset}
       and app.whatsapp_send_scope_ok(t.entity_id, t.account_id, t.opportunity_id)
     order by t.last_inbound_at desc, t.id desc
     limit ${limit}`;
}

/** `/messages`: the chats waiting for a reply the caller may answer, keyset. */
export async function listWaitingThreads(ctx: Ctx, rawInput: unknown): Promise<WaitingPage> {
  const input = parseQueryInput(ListWaitingThreadsInput, rawInput, 'messaging.waiting');
  if (input.entityId !== undefined && !ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope');
  }
  const rows = (await ctx.tx.execute(
    waitingThreadsSql(ctx, input.limit + 1, input.entityId, cursorOf(input.cursor)),
  )) as unknown as ThreadRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return WaitingThreadPageDto.parse({
    items: page.map(toThread),
    nextCursor:
      rows.length > input.limit && last !== undefined && last.last_text !== null
        ? encodeCursor({ t: last.last_text, id: last.id })
        : null,
  });
}

/** A customer's chats in one company, newest customer message first (Account 360, Converting). */
export async function listAccountThreads(
  ctx: Ctx,
  rawInput: unknown,
): Promise<WaitingThreadDto[]> {
  const input = parseQueryInput(ListAccountThreadsInput, rawInput, 'messaging.account_threads');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope');
  }
  const rows = (await ctx.tx.execute(sql`
    select ${THREAD_COLUMNS}
      from whatsapp_threads t
     where t.account_id = ${input.accountId}::uuid and t.entity_id = ${input.entityId}
     order by t.last_inbound_at desc nulls last, t.id desc
     limit 20`)) as unknown as ThreadRow[];
  return rows.map(toThread);
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  thread_id: string;
  direction: string;
  kind: string;
  template_name: string | null;
  template_params: unknown;
  body_masked: string | null;
  file_id: string | null;
  status: string | null;
  refusal: string | null;
  sent_by: string | null;
  sent_by_name: string | null;
  created_at: Date | string;
  created_text: string;
  status_at: Date | string | null;
}

/**
 * A page of a chat's messages as SQL, newest first, keyset on `(created_at, id)`, exported so its
 * plan can be explained: the thread's index `(thread_id, created_at desc, id desc)` in each monthly
 * partition. A file shows only when the caller may open it (`files_whatsapp_read` and its checks:
 * a file not yet `ready` shows as being checked).
 */
export function threadMessagesSql(
  threadId: string,
  entityId: number,
  limit: number,
  after: z.output<typeof Cursor> | undefined,
): SQL {
  const keyset =
    after === undefined
      ? sql`true`
      : sql`(m.created_at, m.id) < (${after.t}::text::timestamptz, ${after.id}::uuid)`;
  return sql`
    select m.id, m.thread_id, m.direction, m.kind, m.template_name, m.template_params,
           m.body_masked, m.file_id, m.status, m.refusal, m.sent_by,
           (select p.display_name from principals p where p.id = m.sent_by) as sent_by_name,
           m.created_at, m.created_at::text as created_text, m.status_at
      from whatsapp_messages m
     where m.thread_id = ${threadId}::uuid and m.entity_id = ${entityId}
       and ${keyset}
     order by m.created_at desc, m.id desc
     limit ${limit}`;
}

function toMessage(row: MessageRow): WhatsAppMessageDto {
  const params = Array.isArray(row.template_params)
    ? row.template_params.filter((p): p is string => typeof p === 'string')
    : null;
  return WhatsAppMessageDto.parse({
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction,
    kind: row.kind,
    templateName: row.template_name,
    templateParams: params,
    body: row.body_masked,
    fileId: row.file_id,
    status: row.status,
    refusal: row.refusal as MessagingRefusal | null,
    sentBy: row.sent_by,
    sentByName: row.sent_by_name,
    createdAt: iso(row.created_at),
    statusAt: iso(row.status_at),
  });
}

/**
 * One chat as the thread component shows it: the chat, a page of its messages, the customers of
 * the company holding its number when it is matched to none, the approved templates people may
 * send, and whether the caller may send on it. A chat the caller does not read is not found.
 */
export async function readWhatsAppThread(ctx: Ctx, rawInput: unknown): Promise<ThreadViewDto> {
  const input = parseQueryInput(ReadThreadInput, rawInput, 'messaging.thread');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope');
  }
  const [row] = (await ctx.tx.execute(sql`
    select ${THREAD_COLUMNS},
           app.whatsapp_send_scope_ok(t.entity_id, t.account_id, t.opportunity_id) as can_send
      from whatsapp_threads t
     where t.id = ${input.threadId}::uuid and t.entity_id = ${input.entityId}`)) as unknown as (ThreadRow & {
    can_send: boolean;
  })[];
  if (!row) {
    throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
      reason: 'whatsapp_thread_missing',
    });
  }
  const rows = (await ctx.tx.execute(
    threadMessagesSql(row.id, row.entity_id, input.limit + 1, cursorOf(input.cursor)),
  )) as unknown as MessageRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const holders =
    row.account_id === null
      ? ((await ctx.tx.execute(sql`
          select distinct a.id as account_id, a.name
            from contact_phones cp
            join account_contacts ac on ac.contact_id = cp.contact_id
            join accounts a on a.id = ac.account_id and a.archived_at is null
            join account_entities ae on ae.account_id = a.id and ae.entity_id = ${row.entity_id}
           where cp.e164 = ${`+${row.wa_id}`}
           order by a.name, a.id
           limit 20`)) as unknown as { account_id: string; name: string }[])
      : [];
  const templates = (await ctx.tx.execute(sql`
    select id, entity_id, name, language, category, status, params, buttons, purpose
      from whatsapp_templates
     where entity_id = ${row.entity_id} and status = 'approved' and purpose is null
     order by name
     limit 100`)) as unknown as {
    id: string;
    entity_id: number;
    name: string;
    language: string;
    category: string;
    status: string;
    params: unknown;
    buttons: unknown;
    purpose: string | null;
  }[];
  const holds = ctx.principal.permissions.some((g) => g.key === 'messaging.send');
  return ThreadViewDto.parse({
    thread: toThread(row),
    messages: page.map(toMessage),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ t: last.created_text, id: last.id })
        : null,
    holders: holders.map((h) => ({ accountId: h.account_id, name: h.name })),
    templates: templates.map((t) =>
      WhatsAppTemplateDto.parse({
        id: t.id,
        entityId: t.entity_id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        params: t.params,
        buttons: t.buttons,
        purpose: t.purpose,
      }),
    ),
    canSend: holds && row.can_send,
  });
}

/**
 * Integration Health's counts from the database (the quality, limit and budget come from the
 * key-value store): each company's active WhatsApp number with its templates waiting for Meta's
 * review or turned down, and the last day's messages refused (by reason) and failed in the
 * request's companies, as the caller reads them.
 */
export async function readWhatsAppCounts(ctx: Ctx): Promise<{
  numbers: { entityId: number; channelId: string; pending: number; rejected: number }[];
  refusals: { refusal: MessagingRefusal; count: number }[];
  failed: number;
}> {
  const companies = entityList(ctx.entityIds);
  const numbers = (await ctx.tx.execute(sql`
    select ec.entity_id, ec.id,
           (select count(*)::int from whatsapp_templates wt
             where wt.entity_id = ec.entity_id and wt.status = 'pending') as pending,
           (select count(*)::int from whatsapp_templates wt
             where wt.entity_id = ec.entity_id and wt.status = 'rejected') as rejected
      from entity_channels ec
     where ec.channel = 'whatsapp' and ec.is_active and ec.entity_id = any(${companies}::int[])
     order by ec.entity_id`)) as unknown as {
    entity_id: number;
    id: string;
    pending: number;
    rejected: number;
  }[];
  const counts = (await ctx.tx.execute(sql`
    select coalesce(m.refusal, 'failed') as reason, count(*)::int as n
      from whatsapp_messages m
     where m.created_at > now() - interval '1 day'
       and m.entity_id = any(${companies}::int[])
       and m.status in ('refused', 'failed')
     group by 1 order by 1`)) as unknown as { reason: string; n: number }[];
  return {
    numbers: numbers.map((n) => ({
      entityId: n.entity_id,
      channelId: n.id,
      pending: n.pending,
      rejected: n.rejected,
    })),
    refusals: counts
      .filter((c) => c.reason !== 'failed')
      .map((c) => ({ refusal: c.reason as MessagingRefusal, count: c.n })),
    failed: counts.find((c) => c.reason === 'failed')?.n ?? 0,
  };
}

/** What `app.whatsapp_send_facts()` answers, for the messaging worker. */
export interface SendFactsRow {
  messageId: string;
  createdAt: string;
  entityId: number;
  threadId: string;
  kind: string;
  status: string;
  sendAttempted: boolean;
  templateName: string | null;
  templateParams: string[];
  body: string | null;
  fileId: string | null;
  waId: string;
  phoneNumberId: string | null;
  windowOpenUntil: Date | null;
  optedOut: boolean;
  confirmation: boolean;
  templateCategory: string | null;
  templateStatus: string | null;
  sentLastHour: number;
  /** The company's own numbers, the only ones a message may name. */
  companyNumbers: string[];
}

/** The facts the messaging worker checks a queued message against, as the platform reads them. */
export async function readSendFacts(ctx: Ctx, messageId: string): Promise<SendFactsRow | null> {
  const [r] = (await ctx.tx.execute(
    sql`select * from app.whatsapp_send_facts(${messageId}::uuid)`,
  )) as unknown as Record<string, unknown>[];
  if (r === undefined) return null;
  const params = Array.isArray(r.template_params)
    ? r.template_params.filter((p): p is string => typeof p === 'string')
    : [];
  const numbers = (await ctx.tx.execute(sql`
    select number_e164 from entity_channels
     where entity_id = ${Number(r.entity_id)} and is_active`)) as unknown as {
    number_e164: string;
  }[];
  return {
    messageId: String(r.message_id),
    createdAt: iso(r.created_at as Date | string) ?? '',
    entityId: Number(r.entity_id),
    threadId: String(r.thread_id),
    kind: String(r.kind),
    status: String(r.status),
    sendAttempted: r.send_attempted === true,
    templateName: (r.template_name as string | null) ?? null,
    templateParams: params,
    body: (r.body_masked as string | null) ?? null,
    fileId: (r.file_id as string | null) ?? null,
    waId: String(r.wa_id),
    phoneNumberId: (r.phone_number_id as string | null) ?? null,
    windowOpenUntil:
      r.window_open_until === null ? null : new Date(r.window_open_until as string | Date),
    optedOut: r.opted_out === true,
    confirmation: r.confirmation === true,
    templateCategory: (r.template_category as string | null) ?? null,
    templateStatus: (r.template_status as string | null) ?? null,
    sentLastHour: Number(r.sent_last_hour),
    companyNumbers: numbers.map((n) => n.number_e164),
  };
}

/**
 * The company a WhatsApp delivery is for, by its number's provider reference or its number, before
 * any company is in the request (`app.whatsapp_channel_entity()`); null when no active number of
 * any company matches.
 */
export async function whatsappChannelEntity(
  ctx: Ctx,
  ref: { phoneNumberId?: string; numberE164?: string },
): Promise<number | null> {
  const [r] = (await ctx.tx.execute(
    sql`select app.whatsapp_channel_entity(${ref.phoneNumberId ?? null}, ${ref.numberE164 ?? null}) as entity_id`,
  )) as unknown as { entity_id: number | null }[];
  return r?.entity_id ?? null;
}

/** The companies that registered a template under a name and language. */
export async function whatsappTemplateEntities(
  ctx: Ctx,
  name: string,
  language: string,
): Promise<number[]> {
  const rows = (await ctx.tx.execute(
    sql`select app.whatsapp_template_entities(${name}, ${language}) as entity_id`,
  )) as unknown as { entity_id: number }[];
  return rows.map((r) => Number(r.entity_id));
}
