import { COPILOT_FACTS, type CopilotFact } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { approvedPlaybook } from '../../queries/knowledge/playbook';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { maskAmounts } from '../copilot/amounts';
import type { ConciergeMessageLine, ConciergeRunFacts } from './facts';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

export interface ConciergeJob {
  entityId: number;
  threadId: string;
  /** The customer's message the run was started for. */
  messageId: string;
  now: Date;
}

/** Why a run reads no further: nothing for the assistant to draft on this chat now. */
export type ConciergeSkip =
  /** The run cannot read the chat (it is not of the company, or the binding failed closed). */
  | 'no_thread'
  /** People answer the chat. */
  | 'with_people'
  /** The number stopped WhatsApp messages, or was removed. */
  | 'opted_out'
  /** The chat has no customer yet: people pick the right one first. */
  | 'no_customer'
  /** The customer's 24 hours are over: only a template may go, which a person picks. */
  | 'window_closed'
  /** A person already replied to the customer's newest message. */
  | 'answered'
  /** A newer message from the customer came since: its own run answers both. */
  | 'superseded';

export type ConciergeRead =
  | { kind: 'skip'; skip: ConciergeSkip }
  | {
      kind: 'facts';
      facts: ConciergeRunFacts;
      /** The customer's words the run answers, as stored (a file's caption), or null. */
      answering: string | null;
    };

/** One chat message as the run reads it. */
interface MessageRow {
  id: string;
  direction: string;
  kind: string;
  body: string | null;
  createdAt: Date;
}

/**
 * The chat's messages, oldest first, as the prompt reads them: the customer's text as stored
 * (masked, Devanagari kept as received), the business's text with its amounts masked (a person may
 * have typed a price), a template or a file by a word.
 */
export function messageLines(rows: readonly MessageRow[], now: Date): ConciergeMessageLine[] {
  return rows.flatMap((r): ConciergeMessageLine[] => {
    const direction = r.direction === 'inbound' ? 'inbound' : 'outbound';
    const minutesAgo = Math.max(0, Math.floor((now.getTime() - r.createdAt.getTime()) / 60_000));
    if (r.kind === 'template' || r.kind === 'system') {
      return [{ direction, minutesAgo, text: 'a WhatsApp template from the business' }];
    }
    const words = r.body?.trim() ?? '';
    if (r.kind === 'media') {
      return [
        {
          direction,
          minutesAgo,
          text: words === '' ? 'a picture or file' : `a picture or file, with the words: ${words}`,
        },
      ];
    }
    if (words === '') return [];
    return [{ direction, minutesAgo, text: direction === 'outbound' ? maskAmounts(words) : words }];
  });
}

/**
 * What one run of the WhatsApp Concierge reads, as the agent itself in a run bound to the chat
 * (`app.agent_thread_id`), under its own grants and row security (docs/03-roadmap-appendix/
 * phase2.md §7.2): the chat (who answers it, its window, its opt-out), its last messages, its
 * customer's name, the lead's segment, stage and recorded facts, the lead's open callbacks, the
 * company's own numbers and the approved `customer` directives. Nothing else: no other customer,
 * no note, no price list, no cost. A chat with nothing to draft now (people answer it, it has no
 * customer, a person already replied, a newer message came) is a skip, read no further.
 */
export async function readConciergeFacts(ctx: Ctx, job: ConciergeJob): Promise<ConciergeRead> {
  const { tx } = ctx;
  const d = AGENT_DEFAULTS.concierge;
  const t = schema.whatsappThreads;
  const [thread] = await tx
    .select({
      accountId: t.accountId,
      opportunityId: t.opportunityId,
      handledBy: t.handledBy,
      needsReply: t.needsReply,
      windowOpenUntil: t.windowOpenUntil,
      optedOut: sql<boolean>`app.whatsapp_thread_opted_out(${t.id})`,
      number: t.waId,
    })
    .from(t)
    .where(and(eq(t.id, job.threadId), eq(t.entityId, job.entityId)))
    .limit(1);
  if (thread === undefined) return { kind: 'skip', skip: 'no_thread' };
  if (thread.handledBy !== 'assistant') return { kind: 'skip', skip: 'with_people' };
  if (thread.optedOut || thread.number === null) return { kind: 'skip', skip: 'opted_out' };
  if (thread.accountId === null) return { kind: 'skip', skip: 'no_customer' };
  if (thread.windowOpenUntil === null || thread.windowOpenUntil <= job.now) {
    return { kind: 'skip', skip: 'window_closed' };
  }
  if (!thread.needsReply) return { kind: 'skip', skip: 'answered' };

  const m = schema.whatsappMessages;
  const rows = (
    await tx
      .select({
        id: m.id,
        direction: m.direction,
        kind: m.kind,
        body: m.bodyMasked,
        createdAt: m.createdAt,
      })
      .from(m)
      .where(and(eq(m.threadId, job.threadId), eq(m.entityId, job.entityId)))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(d.messagesRead)
  ).reverse();
  const newestInbound = rows.filter((r) => r.direction === 'inbound').at(-1);
  if (newestInbound?.id !== job.messageId) return { kind: 'skip', skip: 'superseded' };

  const a = schema.accounts;
  const [account] = await tx
    .select({ name: a.name })
    .from(a)
    .where(eq(a.id, thread.accountId))
    .limit(1);

  let lead: ConciergeRunFacts['lead'] = null;
  let ownerId: string | null = null;
  let opportunityId: string | null = null;
  const current: Partial<Record<CopilotFact, number | null>> = {};
  let callbacks: { dueAt: Date }[] = [];
  if (thread.opportunityId !== null) {
    const o = schema.opportunities;
    const p = schema.pipelines;
    const st = schema.pipelineStages;
    const [row] = await tx
      .select({
        id: o.id,
        ownerId: o.ownerId,
        pipelineName: p.name,
        segment: p.segment,
        stageName: st.name,
      })
      .from(o)
      .innerJoin(p, eq(p.id, o.pipelineId))
      .innerJoin(st, eq(st.id, o.stageId))
      .where(
        and(
          eq(o.id, thread.opportunityId),
          eq(o.entityId, job.entityId),
          eq(o.state, 'open'),
          isNull(o.archivedAt),
        ),
      )
      .limit(1);
    if (row !== undefined) {
      opportunityId = row.id;
      ownerId = row.ownerId;
      lead = { segment: row.segment, pipelineName: row.pipelineName, stageName: row.stageName };
      const lq = schema.leadQualifications;
      const [q] = await tx
        .select({
          pumpDepthFt: lq.pumpDepthFt,
          requiredHp: lq.requiredHp,
          monthlyBillRupees: lq.monthlyBillRupees,
          roofAreaSqFt: lq.roofAreaSqFt,
          sanctionedLoadKw: lq.sanctionedLoadKw,
        })
        .from(lq)
        .where(eq(lq.opportunityId, row.id))
        .limit(1);
      for (const fact of COPILOT_FACTS) {
        const value = q?.[fact];
        current[fact] = value === null || value === undefined ? null : Number(value);
      }
      const k = schema.tasks;
      callbacks = await tx
        .select({ dueAt: k.dueAt })
        .from(k)
        .where(
          and(
            eq(k.opportunityId, row.id),
            eq(k.entityId, job.entityId),
            eq(k.kind, 'callback'),
            eq(k.state, 'open'),
          ),
        )
        .orderBy(asc(k.dueAt))
        .limit(5);
    }
  }

  const numbers = (await tx.execute(sql`
    select number_e164 from entity_channels
     where entity_id = ${job.entityId} and is_active`)) as unknown as { number_e164: string }[];

  const directives = (
    await approvedPlaybook(ctx, { audiences: ['customer'], limit: d.directivesRead })
  ).directives.map((r, i) => ({
    label: `D${String(i + 1)}`,
    type: r.type,
    title: r.title,
    text: r.text,
  }));

  return {
    kind: 'facts',
    answering: newestInbound.body,
    facts: {
      entityId: job.entityId,
      threadId: job.threadId,
      accountId: thread.accountId,
      customerName: account?.name ?? null,
      opportunityId,
      ownerId,
      now: job.now,
      lead,
      current,
      callbacks,
      directives,
      messages: messageLines(rows, job.now),
      companyNumbers: numbers.map((n) => n.number_e164),
    },
  };
}
