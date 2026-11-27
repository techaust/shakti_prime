import {
  DomainError,
  MilestoneDueRuleSchema,
  MilestoneLoanGateSchema,
  OrderRefInput,
  RefreshMilestonesOutcome,
  SettleCancelledOrderOutcome,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { milestoneDueOn, milestoneLoanAnswer, type OrderLoan } from '../../finance/plan-milestones';
import { istCalendarDate } from '../../numbering/financial-year';
import { transition, type Actor } from '../../state-machines/define-machine';
import { paymentMilestoneMachine } from '../../state-machines/machines/payment-milestone';
import { proformaMachine } from '../../state-machines/machines/proforma';
import { requireEntity } from '../crm/opportunity-shared';

/** What `app.cancel_order_finance()` answers for a cancelled order of the request. */
const CancelledFinance = z
  .object({
    entityId: z.number().int(),
    proformaId: z.string().nullable(),
    milestones: z.number().int().min(0),
  })
  .nullable();

/**
 * `finance.order.settle_cancelled` (docs/03-roadmap-appendix/phase5.md §6.1, the review of
 * 27-11-2026, finding 6): the platform, on `sales.order.cancelled`, cancels the order's live
 * proforma with the order's own reason and its payments still waiting for money, through
 * `app.cancel_order_finance()`; the proforma is printed again with "Cancelled" across it. A
 * delivery repeated, or for an order with neither, changes nothing and leaves no audit row.
 */
export const settleCancelledOrder = defineCommand({
  name: 'finance.order.settle_cancelled',
  permission: 'finance.milestones.process',
  minScope: 'entity',
  input: OrderRefInput,
  output: SettleCancelledOrderOutcome,
  auditFields: ['state', 'cancelReason', 'milestonesCancelled'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const actor: Actor = { kind: 'system', job: 'finance.order.settle_cancelled' };
    const [row] = (await ctx.tx.execute(
      sql`select app.cancel_order_finance(${input.orderId}::uuid) as done`,
    )) as unknown as { done: unknown }[];
    const done = CancelledFinance.parse(row?.done ?? null);
    if (done === null) return { proformaId: null, milestones: 0 };
    if (done.proformaId !== null) {
      // The definer moved an issued proforma; the machine allows the platform that move.
      transition(proformaMachine, { state: 'issued', orderState: 'cancelled' }, 'cancel', {
        actor,
        now: ctx.now,
        params: { reason: 'order cancelled' },
      });
      ctx.audit({
        aggregateType: 'proforma',
        aggregateId: done.proformaId,
        entityId: done.entityId,
        before: { state: 'issued' },
        after: { state: 'cancelled' },
      });
      ctx.emit({
        type: 'finance.proforma.cancelled',
        entityId: done.entityId,
        aggregateType: 'proforma',
        aggregateId: done.proformaId,
        payload: { orderId: input.orderId },
      });
      ctx.emit({
        type: 'print.document.requested',
        entityId: done.entityId,
        aggregateType: 'proforma',
        aggregateId: done.proformaId,
        payload: { documentType: 'proforma', documentId: done.proformaId, version: 2 },
      });
    }
    if (done.milestones > 0) {
      transition(
        paymentMilestoneMachine,
        { state: 'pending', ruleMet: false, loanGate: 'none' },
        'cancel',
        { actor, now: ctx.now, params: {} },
      );
      ctx.audit({
        aggregateType: 'sales_order',
        aggregateId: input.orderId,
        entityId: done.entityId,
        after: { milestonesCancelled: done.milestones },
      });
    }
    return { proformaId: done.proformaId, milestones: done.milestones };
  },
});

/** What `app.order_waiting_milestones()` answers: the order's waiting payments. */
const WaitingMilestones = z
  .object({
    confirmedOn: z.string().nullable(),
    milestones: z.array(
      z.object({
        id: z.string(),
        entityId: z.number().int(),
        key: z.string(),
        dueRule: MilestoneDueRuleSchema,
        dueDays: z.number().int().nullable(),
        loanGate: MilestoneLoanGateSchema,
      }),
    ),
  })
  .nullable();

/** What `app.order_loan_gate()` (J2) tells a milestone: the loan's state and the waiver. */
const LoanGate = z
  .object({
    loanState: z.enum(['applied', 'sanctioned', 'disbursed', 'rejected']).nullable(),
    waived: z.boolean(),
  })
  .nullable();

async function orderLoan(ctx: CommandContext, orderId: string): Promise<OrderLoan> {
  const [row] = (await ctx.tx.execute(
    sql`select app.order_loan_gate(${orderId}::uuid) as gate`,
  )) as unknown as { gate: unknown }[];
  const gate = LoanGate.parse(row?.gate ?? null);
  return gate === null ? { loanState: null, waived: false } : gate;
}

/**
 * `finance.milestone.refresh` (the review of 27-11-2026, finding 4): the platform, when an
 * order's customer loan moves (J2's sanction, payout and waiver events), brings due each waiting
 * payment whose rule's moment has come and whose loan no longer holds it back
 * (`milestoneLoanAnswer()`), through the machine's `fall_due` and `app.milestones_fall_due()`.
 * A delivery repeated changes nothing and leaves no audit row.
 */
export const refreshMilestones = defineCommand({
  name: 'finance.milestone.refresh',
  permission: 'finance.milestones.process',
  minScope: 'entity',
  input: OrderRefInput,
  output: RefreshMilestonesOutcome,
  auditFields: ['state', 'dueOn'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [row] = (await ctx.tx.execute(
      sql`select app.order_waiting_milestones(${input.orderId}::uuid) as waiting`,
    )) as unknown as { waiting: unknown }[];
    const waiting = WaitingMilestones.parse(row?.waiting ?? null);
    if (waiting === null || waiting.milestones.length === 0) return { fellDue: 0 };
    const gated = waiting.milestones.some((m) => m.loanGate !== 'none');
    const loan: OrderLoan = gated
      ? await orderLoan(ctx, input.orderId)
      : { loanState: null, waived: false };
    const today = istCalendarDate(ctx.now);
    const moments = {
      confirmedOn: waiting.confirmedOn,
      readyToDispatchOn: null,
      installedOn: null,
      invoicedOn: null,
    };
    const actor: Actor = { kind: 'system', job: 'finance.milestone.refresh' };
    const byDay = new Map<string, { id: string; entityId: number }[]>();
    for (const m of waiting.milestones) {
      const dueOn = milestoneDueOn(m.dueRule, m.dueDays, moments, today);
      const answer = milestoneLoanAnswer(m.loanGate, loan);
      if (dueOn === null || answer === 'pending') continue;
      transition(
        paymentMilestoneMachine,
        { state: 'pending', ruleMet: true, loanGate: answer },
        'fall_due',
        { actor, now: ctx.now, params: {} },
      );
      byDay.set(dueOn, [...(byDay.get(dueOn) ?? []), { id: m.id, entityId: m.entityId }]);
    }
    let fellDue = 0;
    for (const [dueOn, rows] of byDay) {
      const ids = rows.map((r) => r.id);
      const [moved] = (await ctx.tx.execute(
        sql`select app.milestones_fall_due(${input.orderId}::uuid, ${`{${ids.join(',')}}`}::uuid[],
                                            ${dueOn}::date) as n`,
      )) as unknown as { n: number }[];
      if (moved?.n !== ids.length) {
        throw new DomainError('conflict', 'a payment moved while it was brought due', {
          reason: 'concurrent_change',
        });
      }
      for (const r of rows) {
        ctx.audit({
          aggregateType: 'payment_milestone',
          aggregateId: r.id,
          entityId: r.entityId,
          before: { state: 'pending' },
          after: { state: 'due', dueOn },
        });
      }
      fellDue += ids.length;
    }
    return { fellDue };
  },
});
