import {
  WHATSAPP_LIVE_MILESTONES,
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
import { milestoneMisfit } from '../../messaging/template-shape';

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

/** One line of a STATUS answer: one of the customer's quotes, orders or projects. */
export interface StatusLine {
  kind: 'quote' | 'order' | 'project';
  ref: string;
  state: string;
  /** As stored, for the answer to format, never to compute; null for a project. */
  grandTotal: string | null;
  validUntil: Date | null;
  createdAt: Date;
  /** A project's current step: the first one still open, by its key and its title, if any. */
  step: { key: string; title: string | null } | null;
}

const STATUS_KINDS = ['quote', 'order', 'project'] as const;

/**
 * What STATUS answers on a chat (PRD WA-03, docs/03-roadmap-appendix/phase2.md §7.1, phase4.md
 * §6.1), through `app.status_summary()` (`messaging.process`): the chat's customer's own quotes
 * (sent, accepted or expired), orders and projects (not cancelled, with their current step) in the
 * chat's company, newest first, five of each; nothing for a chat matched to no customer.
 */
export async function readStatusSummary(ctx: Ctx, threadId: string): Promise<StatusLine[]> {
  const rows = (await ctx.tx.execute(sql`
    select kind, ref, state, grand_total, valid_until, created_at, step_key, step_title
      from app.status_summary(${threadId}::uuid)`)) as unknown as {
    kind: string;
    ref: string;
    state: string;
    grand_total: string | null;
    valid_until: Date | string | null;
    created_at: Date | string;
    step_key: string | null;
    step_title: string | null;
  }[];
  return rows.map((r) => ({
    kind: STATUS_KINDS.find((k) => k === r.kind) ?? 'quote',
    ref: r.ref,
    state: r.state,
    grandTotal: r.grand_total,
    validUntil: r.valid_until === null ? null : new Date(r.valid_until),
    createdAt: new Date(r.created_at),
    step: r.step_key === null ? null : { key: r.step_key, title: r.step_title },
  }));
}

/**
 * Settings › WhatsApp templates (docs/03-roadmap-appendix/phase2.md §7.1), read as the caller:
 * the templates of the request's companies, by company and name (at most
 * `WHATSAPP_TEMPLATE_LIST_MAX`), each company's milestone map, and the templates each live
 * milestone may be mapped to, by `messaging.milestone.set`'s own rule. The policies read both for
 * every principal acting in the company; the screen offers changes only to whoever may make them.
 */
export async function listWhatsAppTemplateSettings(
  ctx: Pick<RequestContext, 'tx' | 'entityIds'>,
): Promise<WhatsAppTemplateSettingsDto> {
  const entityIds = [...ctx.entityIds];
  if (entityIds.length === 0) return { templates: [], milestones: [], fits: [] };
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
  const dtos = templates.map(toTemplateDto);
  return WhatsAppTemplateSettingsDto.parse({
    templates: dtos,
    fits: WHATSAPP_LIVE_MILESTONES.flatMap((milestone) =>
      dtos
        .filter((t) => milestoneMisfit(milestone, t) === null)
        .map((t) => ({ templateId: t.id, milestone })),
    ),
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
