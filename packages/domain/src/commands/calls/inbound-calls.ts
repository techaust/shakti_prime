import {
  DomainError,
  InboundCallRecordDto,
  InboundCallSeriesSchema,
  newId,
  RecordInboundCallInput,
  type InboundCallSeries,
  type LeadIngestResultDto,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { ingestIdempotencyKey } from '../../crm/ingest-map';
import { nextCallingWindowStart } from '../../telecom/dial-policy';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { ingestLead } from '../crm/ingest-lead';
import { assertEntityInScope } from '../imports/shared';

// Inbound calls (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05 and CRM-01): what the platform
// records when Exotel's Passthru applet passes a customer's call to a company's IVR or missed-call
// number through. It runs as `system:workers` with the platform-only `calls.process` (and, for a
// missed call, I1's `crm.ingest.run`), and reads and writes only through the definers that check
// them (DATABASE §4.1): never through a person's `crm.*` grant (ADR 0020).

/** One active IVR or missed-call line of a company with the number a call was made to. */
export interface InboundCallLine {
  entityId: number;
  series: InboundCallSeries;
}

/**
 * The companies' IVR and missed-call lines with this number (`app.inbound_call_lines()`), for the
 * platform before it knows the call's company. Several when companies share a number.
 */
export async function inboundCallLines(
  ctx: Pick<RequestContext, 'tx'>,
  numberE164: string,
): Promise<InboundCallLine[]> {
  const rows = (await ctx.tx.execute(
    sql`select entity_id, channel from app.inbound_call_lines(${numberE164}::text)`,
  )) as unknown as { entity_id: number; channel: string }[];
  return rows.map((r) => ({
    entityId: r.entity_id,
    series: InboundCallSeriesSchema.parse(r.channel),
  }));
}

/** The company's customers holding the number, ids only, oldest relationship first. */
async function matchCustomers(
  ctx: CommandContext,
  entityId: number,
  phone: string,
): Promise<string[]> {
  const rows = (await ctx.tx.execute(
    sql`select account_id from app.inbound_call_customers(${entityId}::smallint, ${phone}::text)`,
  )) as unknown as { account_id: string }[];
  return rows.map((r) => r.account_id);
}

/** The one person of the company whose own dial phone the IVR rings, or null. */
async function answerer(
  ctx: CommandContext,
  entityId: number,
  dialWhom: string | undefined,
): Promise<string | null> {
  if (dialWhom === undefined) return null;
  const [row] = (await ctx.tx.execute(
    sql`select app.inbound_call_answerer(${entityId}::smallint, ${dialWhom}::text) as user_id`,
  )) as unknown as { user_id: string | null }[];
  return row?.user_id ?? null;
}

/**
 * When a missed call's callback falls due: now, inside calling hours (09:00 to 21:00 IST), else at
 * the next opening. Pure; the definer checks the hours again.
 */
export function missedCallCallbackDue(now: Date): Date {
  return nextCallingWindowStart(now);
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/**
 * `calls.inbound_call.record` (`calls.process`): one customer's call passed through by Exotel, on
 * the line of the company the dialled number names, keyed on the provider's id (`CallSid`), so a
 * repeated delivery changes nothing (`repeat`) and an id another company's call holds records
 * nothing (`other_company`).
 * - On the IVR line: the call is recorded ringing with the person the IVR rings (the one person of
 *   the company whose own dial phone is `dialWhom`), and the company's customers holding the
 *   caller's number are matched (none, one or several; never another company's). When it rings a
 *   person, `calls.inbound.ringing` names them and the customers, for the screen-pop.
 * - On the missed-call line: I1's `crm.lead.ingest` (channel `missed_call`) makes or joins the lead
 *   for the number, run in this transaction with the call's own key, then the call is recorded
 *   unanswered on that lead with a callback for the lead's owner due now inside calling hours, else
 *   at the next opening; `calls.missed.recorded` tells the owner.
 * The number is never stored on the call nor audited.
 */
export const recordInboundCall = defineCommand({
  name: 'calls.inbound_call.record',
  permission: 'calls.process',
  minScope: 'entity',
  // A missed call's lead is made or joined by I1's intake, which scores a new lead.
  alsoRequires: [
    { permission: 'crm.ingest.run', minScope: 'entity' },
    { permission: 'crm.score.refresh', minScope: 'entity' },
  ],
  input: RecordInboundCallInput,
  output: InboundCallRecordDto,
  auditFields: ['inboundLine', 'customersMatched', 'personRung', 'dueAt'],
  auditWhen: 'changed',
  unmaskedFields: [
    // The provider's own id of the call (Exotel's CallSid), a long string of letters and digits.
    'callSid',
  ],
  // The audit row keeps the line and the provider's id, never the numbers.
  auditInput: (input) => ({
    entityId: input.entityId,
    series: input.series,
    callSid: input.callSid,
  }),
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const entityId = input.entityId;
    const startedAt = input.startedAt ?? ctx.now.toISOString();
    const empty: Omit<InboundCallRecordDto, 'providerCallId' | 'outcome'> = {
      entityId,
      series: input.series,
      answererId: null,
      accountIds: [],
      leadId: null,
      ownerId: null,
      taskId: null,
      taskDueAt: null,
    };
    const [seen] = (await ctx.tx.execute(
      sql`select id, entity_id from app.inbound_call_by_sid(${input.callSid}::text)`,
    )) as unknown as { id: string; entity_id: number }[];
    if (seen !== undefined) {
      return {
        ...empty,
        providerCallId: seen.entity_id === entityId ? seen.id : null,
        outcome: seen.entity_id === entityId ? ('repeat' as const) : ('other_company' as const),
      };
    }
    const id = newId();

    if (input.series === 'ivr') {
      const accountIds = await matchCustomers(ctx, entityId, input.from);
      const answererId = await answerer(ctx, entityId, input.dialWhom);
      const [row] = (await ctx.tx.execute(
        sql`select outcome, provider_call_id
              from app.record_inbound_call(${entityId}::smallint, ${id}::uuid,
                                           ${input.callSid}::text, ${answererId}::uuid,
                                           ${startedAt}::timestamptz)`,
      )) as unknown as { outcome: 'recorded' | 'repeat'; provider_call_id: string }[];
      if (row === undefined) throw new DomainError('internal', 'the inbound call answered no row');
      if (row.outcome === 'repeat') {
        return { ...empty, providerCallId: row.provider_call_id, outcome: 'repeat' as const };
      }
      ctx.audit({
        aggregateType: 'provider_call',
        aggregateId: row.provider_call_id,
        entityId,
        after: {
          inboundLine: 'ivr',
          customersMatched: accountIds.length,
          personRung: answererId !== null,
        },
      });
      if (answererId !== null) {
        ctx.emit({
          type: 'calls.inbound.ringing',
          entityId,
          aggregateType: 'provider_call',
          aggregateId: row.provider_call_id,
          payload: { userId: answererId, accountIds },
        });
      }
      return {
        ...empty,
        providerCallId: row.provider_call_id,
        outcome: 'recorded' as const,
        answererId,
        accountIds,
      };
    }

    // A missed call: the lead first, then the call on it and its callback.
    const lead: LeadIngestResultDto = await ctx.run(
      ingestLead,
      {
        entityId,
        channel: 'missed_call',
        // The same pipeline an unknown number's WhatsApp message starts in; the callers move it on.
        pipelineKey: WORKSHOP_DEFAULTS.whatsapp.leadPipelineKey,
        externalId: input.callSid,
        contact: { phone: input.from },
      },
      { idempotencyKey: ingestIdempotencyKey('missed_call', input.callSid) },
    );
    const due = missedCallCallbackDue(ctx.now);
    const [row] = (await ctx.tx.execute(
      sql`select outcome, provider_call_id, owner_id, task_id, due_at
            from app.record_missed_call(${entityId}::smallint, ${id}::uuid,
                                        ${input.callSid}::text, ${lead.leadId}::uuid,
                                        ${lead.contactPhoneId}::uuid, ${startedAt}::timestamptz,
                                        ${due.toISOString()}::timestamptz)`,
    )) as unknown as {
      outcome: 'recorded' | 'repeat';
      provider_call_id: string;
      owner_id: string | null;
      task_id: string | null;
      due_at: Date | string | null;
    }[];
    if (row === undefined) throw new DomainError('internal', 'the missed call answered no row');
    if (row.outcome === 'repeat') {
      return { ...empty, providerCallId: row.provider_call_id, outcome: 'repeat' as const };
    }
    const taskDueAt = iso(row.due_at);
    ctx.audit({
      aggregateType: 'provider_call',
      aggregateId: row.provider_call_id,
      entityId,
      after: {
        inboundLine: 'missed_call',
        opportunityId: lead.leadId,
        taskId: row.task_id,
        dueAt: taskDueAt,
      },
    });
    ctx.emit({
      type: 'calls.missed.recorded',
      entityId,
      aggregateType: 'provider_call',
      aggregateId: row.provider_call_id,
      payload: { opportunityId: lead.leadId, ownerId: row.owner_id, taskId: row.task_id },
    });
    return {
      ...empty,
      providerCallId: row.provider_call_id,
      outcome: 'recorded' as const,
      accountIds: [lead.accountId],
      leadId: lead.leadId,
      ownerId: row.owner_id,
      taskId: row.task_id,
      taskDueAt,
    };
  },
});
