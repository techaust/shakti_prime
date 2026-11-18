import {
  COPILOT_FACTS,
  SegmentSchema,
  type CopilotFact,
  type CopilotNoteKind,
  type WhatsAppTemplateCategory,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { approvedPlaybook } from '../../queries/knowledge/playbook';
import { effectiveDispositions } from '../../queries/crm/pipeline-settings';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { maskAmounts } from './amounts';
import type {
  CopilotCallLine,
  CopilotMessageLine,
  CopilotRunFacts,
  CopilotTemplate,
} from './facts';
import { istDaysBetween } from './filter';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

export interface CopilotJob {
  kind: CopilotNoteKind;
  entityId: number;
  opportunityId: string;
  now: Date;
  /** A summary's masked transcript. */
  transcript?: string;
}

/** One chat message as the Co-pilot's definer gives it. */
export interface ChatRow {
  direction: string;
  kind: string;
  body_masked: string | null;
  template_name: string | null;
  created_at: Date | string;
}

/**
 * The chat's messages, oldest first, as a brief reads them: a template by its label, a picture or
 * file by a word, a text as stored (masked). The business's own texts have their amounts masked
 * too, since a person may have quoted a price in a reply, and no price reaches a model.
 */
export function chatLines(
  rows: readonly ChatRow[],
  templates: readonly Pick<CopilotTemplate, 'name' | 'label'>[],
  now: Date,
): CopilotMessageLine[] {
  const labels = new Map(templates.map((t) => [t.name, t.label]));
  return rows.flatMap((r): CopilotMessageLine[] => {
    const direction = r.direction === 'inbound' ? 'inbound' : 'outbound';
    const daysAgo = Math.max(0, istDaysBetween(new Date(r.created_at), now));
    if (r.kind === 'template') {
      const label = r.template_name === null ? undefined : labels.get(r.template_name);
      return [{ direction, daysAgo, text: `(template) ${label ?? 'a WhatsApp template'}` }];
    }
    if (r.kind === 'media') return [{ direction, daysAgo, text: '(a picture or file)' }];
    if (r.body_masked === null || r.body_masked.trim() === '') return [];
    const text = direction === 'outbound' ? maskAmounts(r.body_masked) : r.body_masked;
    return [{ direction, daysAgo, text }];
  });
}

const CATEGORIES: readonly WhatsAppTemplateCategory[] = ['utility', 'marketing', 'authentication'];
const STATES = ['open', 'nurture', 'won', 'lost'] as const;

/**
 * What one run of the Caller Co-pilot reads, as the agent itself, under its own grants and row
 * security (docs/03-roadmap-appendix/phase2.md §7.3): the lead, its stage and recorded facts, its
 * last calls and their outcomes, the outcomes a caller may log, the customer's newest WhatsApp
 * chat (its last messages, masked as stored, whether it has opted out, the consents in force), the
 * company's templates, the lead's sent quotes still valid (their dates only, never a price) and
 * the approved Playbook directives for staff. Undefined when the agent cannot read the lead, and
 * for a brief when the lead is won or lost.
 */
export async function readCopilotFacts(
  ctx: Ctx,
  job: CopilotJob,
): Promise<CopilotRunFacts | undefined> {
  const { tx } = ctx;
  const d = AGENT_DEFAULTS.copilot;
  const o = schema.opportunities;
  const p = schema.pipelines;
  const st = schema.pipelineStages;
  const [lead] = await tx
    .select({
      id: o.id,
      entityId: o.entityId,
      accountId: o.accountId,
      ownerId: o.ownerId,
      state: o.state,
      stateChangedAt: o.stateChangedAt,
      score: o.score,
      createdAt: o.createdAt,
      pipelineName: p.name,
      segment: p.segment,
      stageName: st.name,
    })
    .from(o)
    .innerJoin(p, eq(p.id, o.pipelineId))
    .innerJoin(st, eq(st.id, o.stageId))
    .where(and(eq(o.id, job.opportunityId), eq(o.entityId, job.entityId), isNull(o.archivedAt)))
    .limit(1);
  const state = STATES.find((s) => s === lead?.state);
  if (lead === undefined || state === undefined) return undefined;
  if (job.kind === 'brief' && (state === 'won' || state === 'lost')) return undefined;
  const segment = SegmentSchema.parse(lead.segment);

  const lq = schema.leadQualifications;
  const [qualification] = await tx
    .select({
      pumpDepthFt: lq.pumpDepthFt,
      requiredHp: lq.requiredHp,
      monthlyBillRupees: lq.monthlyBillRupees,
      roofAreaSqFt: lq.roofAreaSqFt,
      sanctionedLoadKw: lq.sanctionedLoadKw,
    })
    .from(lq)
    .where(eq(lq.opportunityId, lead.id))
    .limit(1);
  const current: Partial<Record<CopilotFact, number | null>> = {};
  for (const fact of COPILOT_FACTS) {
    const value = qualification?.[fact];
    current[fact] = value === null || value === undefined ? null : Number(value);
  }

  const c = schema.calls;
  const cd = schema.callDispositions;
  const callRows = await tx
    .select({
      startedAt: c.startedAt,
      attemptNo: c.attemptNo,
      durationS: c.durationS,
      label: cd.label,
    })
    .from(c)
    .innerJoin(cd, eq(cd.id, c.dispositionId))
    .where(and(eq(c.opportunityId, lead.id), eq(c.entityId, lead.entityId)))
    .orderBy(desc(c.startedAt), desc(c.id))
    .limit(d.callsRead);
  const calls: CopilotCallLine[] = callRows.map((r) => ({
    daysAgo: Math.max(0, istDaysBetween(r.startedAt, job.now)),
    outcomeLabel: r.label,
    attemptNo: r.attemptNo,
    durationS: r.durationS,
  }));

  const outcomes = (await effectiveDispositions(ctx, lead.entityId, segment)).dispositions.map(
    (x) => ({ code: x.code, label: x.label, dispositionId: x.id }),
  );

  const w = schema.whatsappTemplates;
  const templateRows = await tx
    .select({
      name: w.name,
      label: w.label,
      category: w.category,
      status: w.status,
      purpose: w.purpose,
      params: w.params,
    })
    .from(w)
    .where(and(eq(w.entityId, lead.entityId), eq(w.language, 'en')))
    .orderBy(w.name);
  const templates: CopilotTemplate[] = templateRows.flatMap((t) => {
    const category = CATEGORIES.find((x) => x === t.category);
    if (category === undefined) return [];
    return [
      {
        name: t.name,
        label: t.label,
        category,
        approved: t.status === 'approved',
        values: Array.isArray(t.params) ? t.params.length : 0,
        forPlatform: t.purpose !== null,
      },
    ];
  });

  // The customer's newest chat with the company that still has a number, through the Co-pilot's
  // own definers: a chat is read under the customer's read rule, which no agent holds.
  const [thread] = (await tx.execute(sql`
    select thread_id, opted_out, consent_service, consent_promotional
      from app.copilot_lead_chat(${lead.entityId}::smallint, ${lead.id}::uuid)`)) as unknown as {
    thread_id: string;
    opted_out: boolean;
    consent_service: boolean;
    consent_promotional: boolean;
  }[];
  let messages: CopilotMessageLine[] = [];
  if (thread !== undefined) {
    const rows = (await tx.execute(sql`
      select direction, kind, body_masked, template_name, created_at
        from app.copilot_chat_messages(${lead.entityId}::smallint, ${lead.id}::uuid,
                                       ${thread.thread_id}::uuid, ${d.messagesRead}::integer)`)) as unknown as ChatRow[];
    messages = chatLines(rows.reverse(), templates, job.now);
  }
  const consents = {
    service: thread?.consent_service === true,
    promotional: thread?.consent_promotional === true,
  };

  // The lead's sent quotes still valid: their dates only, never an amount.
  const q = schema.quotes;
  const quoteRows = await tx
    .select({ id: q.id, validUntil: q.validUntil })
    .from(q)
    .where(
      and(
        eq(q.opportunityId, lead.id),
        eq(q.entityId, lead.entityId),
        eq(q.state, 'sent'),
        gt(q.validUntil, job.now),
      ),
    )
    .orderBy(q.validUntil, q.id)
    .limit(5);
  const quotes = quoteRows.map((r, i) => ({
    label: `Q${String(i + 1)}`,
    quoteId: r.id,
    validUntil: r.validUntil,
  }));

  const directives =
    job.kind === 'brief'
      ? (
          await approvedPlaybook(ctx, { audiences: ['staff'], limit: d.directivesRead })
        ).directives.map((r) => ({ type: r.type, title: r.title, text: r.text }))
      : [];

  const nurtureSince = state === 'nurture' ? lead.stateChangedAt : null;
  return {
    kind: job.kind,
    entityId: lead.entityId,
    opportunityId: lead.id,
    now: job.now,
    ownerId: lead.ownerId,
    lead: {
      segment,
      pipelineName: lead.pipelineName,
      stageName: lead.stageName,
      state,
      score: lead.score,
      ageDays: Math.max(0, istDaysBetween(lead.createdAt, job.now)),
      nurtureDay: nurtureSince === null ? null : istDaysBetween(nurtureSince, job.now),
      nurtureSince,
    },
    current,
    calls,
    outcomes,
    messages,
    directives,
    templates,
    quotes,
    whatsapp: {
      chat: thread?.opted_out === false,
      consents,
    },
    ...(job.transcript === undefined ? {} : { transcript: job.transcript }),
  };
}
