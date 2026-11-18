import {
  COPILOT_FACTS,
  SegmentSchema,
  type CopilotFact,
  type CopilotNoteKind,
  type WhatsAppTemplateCategory,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { approvedPlaybook } from '../../queries/knowledge/playbook';
import { effectiveDispositions } from '../../queries/crm/pipeline-settings';
import { AGENT_DEFAULTS } from '../agent-defaults';
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

  // The customer's newest chat with the company that still has a number.
  const th = schema.whatsappThreads;
  const [thread] = await tx
    .select({ id: th.id, contactPhoneId: th.contactPhoneId, optedOutAt: th.optedOutAt })
    .from(th)
    .where(
      and(eq(th.entityId, lead.entityId), eq(th.accountId, lead.accountId), isNotNull(th.waId)),
    )
    .orderBy(sql`${th.lastInboundAt} desc nulls last`, desc(th.id))
    .limit(1);
  let messages: CopilotMessageLine[] = [];
  const consents = { service: false, promotional: false };
  if (thread !== undefined) {
    const m = schema.whatsappMessages;
    const rows = await tx
      .select({
        direction: m.direction,
        kind: m.kind,
        body: m.bodyMasked,
        templateName: m.templateName,
        createdAt: m.createdAt,
      })
      .from(m)
      .where(and(eq(m.threadId, thread.id), eq(m.entityId, lead.entityId)))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(d.messagesRead);
    const labels = new Map(templates.map((t) => [t.name, t.label]));
    messages = rows.reverse().flatMap((r): CopilotMessageLine[] => {
      const direction = r.direction === 'inbound' ? 'inbound' : 'outbound';
      const daysAgo = Math.max(0, istDaysBetween(r.createdAt, job.now));
      if (r.kind === 'template') {
        const label = r.templateName === null ? undefined : labels.get(r.templateName);
        return [{ direction, daysAgo, text: `(template) ${label ?? 'a WhatsApp template'}` }];
      }
      if (r.kind === 'media') return [{ direction, daysAgo, text: '(a picture or file)' }];
      if (r.body === null || r.body.trim() === '') return [];
      return [{ direction, daysAgo, text: r.body }];
    });
    if (thread.contactPhoneId !== null) {
      const cp = schema.contactPhones;
      const cs = schema.consents;
      const held = await tx
        .selectDistinct({ purpose: cs.purpose })
        .from(cs)
        .innerJoin(cp, eq(cp.contactId, cs.contactId))
        .where(
          and(
            eq(cp.id, thread.contactPhoneId),
            eq(cs.channel, 'whatsapp'),
            inArray(cs.purpose, ['service', 'promotional']),
            isNull(cs.withdrawnAt),
            lte(cs.givenAt, job.now),
          ),
        );
      consents.service = held.some((h) => h.purpose === 'service');
      consents.promotional = held.some((h) => h.purpose === 'promotional');
    }
  }

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
      chat: thread?.optedOutAt === null,
      consents,
    },
    ...(job.transcript === undefined ? {} : { transcript: job.transcript }),
  };
}
