import {
  WHATSAPP_TEMPLATE_LIST_MAX,
  WhatsAppMilestoneDto,
  WhatsAppMilestoneSchema,
  WhatsAppTemplateSettingsDto,
  type WhatsAppMilestone,
  type WhatsAppMilestoneSubject,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { asc, inArray, sql } from 'drizzle-orm';
import { toTemplateDto } from '../../commands/messaging/templates';

type Ctx = Pick<RequestContext, 'tx'>;

/** What a milestone of one subject carries, as the platform reads it to make the template's values. */
export interface MilestoneSubject {
  accountId: string;
  /** The quote's or the order's number. */
  ref: string;
  /** The grand total as stored (`numeric(14,2)`), for the worker to format, never to compute. */
  grandTotal: string;
  /** The end of a quote's validity; null for an order. */
  validUntil: Date | null;
  state: string;
  /** The customer's chat the milestone would go to; null when they have none with a number. */
  threadId: string | null;
  alreadySent: boolean;
}

/**
 * The subject of a milestone through `app.whatsapp_milestone_subject()` (`messaging.process`): its
 * customer, number, total, validity and state, the chat it would go to and whether it was already
 * sent or held. Null when the subject is not of the company.
 */
export async function readMilestoneSubject(
  ctx: Ctx,
  input: {
    entityId: number;
    milestone: WhatsAppMilestone;
    subjectKind: WhatsAppMilestoneSubject;
    subjectId: string;
    threadId: string | null;
  },
): Promise<MilestoneSubject | null> {
  const [r] = (await ctx.tx.execute(sql`
    select account_id, ref, grand_total, valid_until, subject_state, thread_id, already_sent
      from app.whatsapp_milestone_subject(${input.entityId}::smallint, ${input.milestone},
                                          ${input.subjectKind}, ${input.subjectId}::uuid,
                                          ${input.threadId}::uuid)`)) as unknown as {
    account_id: string;
    ref: string;
    grand_total: string;
    valid_until: Date | string | null;
    subject_state: string;
    thread_id: string | null;
    already_sent: boolean;
  }[];
  if (r === undefined) return null;
  return {
    accountId: r.account_id,
    ref: r.ref,
    grandTotal: r.grand_total,
    validUntil: r.valid_until === null ? null : new Date(r.valid_until),
    state: r.subject_state,
    threadId: r.thread_id,
    alreadySent: r.already_sent,
  };
}

/** One line of a STATUS answer: one of the customer's quotes or orders. */
export interface StatusLine {
  kind: 'quote' | 'order';
  ref: string;
  state: string;
  /** As stored, for the answer to format, never to compute. */
  grandTotal: string;
  validUntil: Date | null;
  createdAt: Date;
}

/**
 * What STATUS answers on a chat (PRD WA-03, docs/03-roadmap-appendix/phase2.md §7.1), through
 * `app.status_summary()` (`messaging.process`): the chat's customer's own quotes (sent, accepted or
 * expired) and orders in the chat's company, newest first, five of each; nothing for a chat
 * matched to no customer.
 */
export async function readStatusSummary(ctx: Ctx, threadId: string): Promise<StatusLine[]> {
  const rows = (await ctx.tx.execute(sql`
    select kind, ref, state, grand_total, valid_until, created_at
      from app.status_summary(${threadId}::uuid)`)) as unknown as {
    kind: string;
    ref: string;
    state: string;
    grand_total: string;
    valid_until: Date | string | null;
    created_at: Date | string;
  }[];
  return rows.map((r) => ({
    kind: r.kind === 'order' ? 'order' : 'quote',
    ref: r.ref,
    state: r.state,
    grandTotal: r.grand_total,
    validUntil: r.valid_until === null ? null : new Date(r.valid_until),
    createdAt: new Date(r.created_at),
  }));
}

/**
 * Settings › WhatsApp templates (docs/03-roadmap-appendix/phase2.md §7.1), read as the caller:
 * the templates of the request's companies, by company and name (at most
 * `WHATSAPP_TEMPLATE_LIST_MAX`), and each company's milestone map. The policies read both for every
 * principal acting in the company; the screen offers changes only to whoever may make them.
 */
export async function listWhatsAppTemplateSettings(
  ctx: Pick<RequestContext, 'tx' | 'entityIds'>,
): Promise<WhatsAppTemplateSettingsDto> {
  const entityIds = [...ctx.entityIds];
  if (entityIds.length === 0) return { templates: [], milestones: [] };
  const w = schema.whatsappTemplates;
  const m = schema.whatsappMilestones;
  const templates = await ctx.tx
    .select()
    .from(w)
    .where(inArray(w.entityId, entityIds))
    .orderBy(asc(w.entityId), asc(w.name), asc(w.language))
    .limit(WHATSAPP_TEMPLATE_LIST_MAX);
  const milestones = await ctx.tx
    .select()
    .from(m)
    .where(inArray(m.entityId, entityIds))
    .orderBy(asc(m.entityId), asc(m.milestone));
  return WhatsAppTemplateSettingsDto.parse({
    templates: templates.map(toTemplateDto),
    milestones: milestones.map((row) =>
      WhatsAppMilestoneDto.parse({
        id: row.id,
        entityId: row.entityId,
        milestone: WhatsAppMilestoneSchema.parse(row.milestone),
        templateId: row.templateId,
        isActive: row.isActive,
      }),
    ),
  });
}
