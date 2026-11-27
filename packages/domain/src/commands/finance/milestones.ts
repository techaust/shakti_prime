import {
  DomainError,
  MilestoneStepsSchema,
  newId,
  PaymentMilestoneDto,
  PlanConfirmedOutcome,
  PlanMilestonesInput,
  PlannedMilestonesDto,
  WaiveMilestoneInput,
  type MilestoneStep,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import {
  milestoneLoanAnswer,
  planMilestones,
  type OrderLoan,
  type PlannedMilestone,
} from '../../finance/plan-milestones';
import { istCalendarDate } from '../../numbering/financial-year';
import { readOrderMilestones } from '../../queries/finance/finance-dto';
import { transition, type Actor } from '../../state-machines/define-machine';
import {
  paymentMilestoneMachine,
  type PaymentMilestoneMachineState,
} from '../../state-machines/machines/payment-milestone';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { requireEntity } from '../crm/opportunity-shared';

/** What `app.order_milestone_facts()` answers for an order of the request. */
const MilestoneFacts = z.object({
  orderId: z.string(),
  entityId: z.number().int(),
  state: z.string(),
  grandTotal: z.string(),
  segment: z.string(),
  confirmedOn: z.string().nullable(),
  planned: z.boolean(),
  template: z.object({ id: z.string(), version: z.number().int(), steps: z.unknown() }).nullable(),
});
type MilestoneFacts = z.infer<typeof MilestoneFacts>;

/** What `app.order_loan_gate()` (J2) tells a milestone: the loan's state and the waiver. */
const LoanGate = z
  .object({
    loanState: z.enum(['applied', 'sanctioned', 'disbursed', 'rejected']).nullable(),
    waived: z.boolean(),
  })
  .nullable();

const NO_LOAN: OrderLoan = { loanState: null, waived: false };

/** The order states milestones are planned in: confirmed, and not closed or cancelled. */
const PLANNABLE: readonly string[] = [
  'confirmed',
  'partially_dispatched',
  'dispatched',
  'invoiced',
];

async function milestoneFacts(ctx: CommandContext, orderId: string): Promise<MilestoneFacts> {
  const [row] = (await ctx.tx.execute(
    sql`select app.order_milestone_facts(${orderId}::uuid) as facts`,
  )) as unknown as { facts: unknown }[];
  if (row?.facts === null || row?.facts === undefined) {
    throw new DomainError('not_found', `order ${orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  return MilestoneFacts.parse(row.facts);
}

/** The order's loan, read only when a step of the terms waits for one. */
async function orderLoan(
  ctx: CommandContext,
  orderId: string,
  steps: readonly MilestoneStep[],
): Promise<OrderLoan> {
  if (steps.every((s) => s.loanGate === 'none')) return NO_LOAN;
  const [row] = (await ctx.tx.execute(
    sql`select app.order_loan_gate(${orderId}::uuid) as gate`,
  )) as unknown as { gate: unknown }[];
  const gate = LoanGate.parse(row?.gate ?? null);
  return gate === null ? NO_LOAN : { loanState: gate.loanState, waived: gate.waived };
}

/** The plan as the machine allows it: each milestone planned, and brought due where its rule says. */
function checkMoves(
  planned: readonly PlannedMilestone[],
  loan: OrderLoan,
  actor: Actor,
  now: Date,
): void {
  for (const m of planned) {
    transition(paymentMilestoneMachine, { state: null, ruleMet: false, loanGate: 'none' }, 'plan', {
      actor,
      now,
      params: {},
    });
    if (m.state === 'due') {
      transition(
        paymentMilestoneMachine,
        {
          state: 'pending',
          ruleMet: true,
          loanGate: milestoneLoanAnswer(m.loanGate, loan),
        },
        'fall_due',
        { actor, now, params: {} },
      );
    }
  }
}

interface PlanResult {
  orderId: string;
  templateVersion: number | null;
  milestones: PaymentMilestoneDto[];
}

/** What `finance.milestones.planned` carries: counts and the version, never an amount. */
function plannedPayload(result: PlanResult) {
  return {
    count: result.milestones.length,
    dueCount: result.milestones.filter((m) => m.state === 'due').length,
    templateVersion: result.templateVersion,
  };
}

/**
 * Plans an order's milestones (docs/03-roadmap-appendix/phase5.md §6.1, question 6 (a)): from the
 * company's current terms for the order's segment, or the named default where it has published
 * none (`WORKSHOP_DEFAULTS.finance.milestoneSteps`); the split and where each starts are the
 * deterministic core's (`planMilestones()`), and `app.record_order_milestones()` writes them,
 * holding the rows to the terms and their sum to the order's total.
 */
async function planOrder(
  ctx: CommandContext,
  facts: MilestoneFacts,
  actor: Actor,
): Promise<PlanResult> {
  const steps: readonly MilestoneStep[] =
    facts.template === null
      ? WORKSHOP_DEFAULTS.finance.milestoneSteps
      : MilestoneStepsSchema.parse(facts.template.steps);
  const loan = await orderLoan(ctx, facts.orderId, steps);
  const planned = planMilestones(
    facts.grandTotal,
    steps,
    {
      confirmedOn: facts.confirmedOn,
      readyToDispatchOn: null,
      installedOn: null,
      invoicedOn: null,
    },
    loan,
    istCalendarDate(ctx.now),
  );
  checkMoves(planned, loan, actor, ctx.now);
  const rows = planned.map((m) => ({ id: newId(), ...m }));
  await ctx.tx.execute(
    sql`select app.record_order_milestones(${facts.orderId}::uuid, ${facts.template?.id ?? null}::uuid,
                                           ${JSON.stringify(rows)}::jsonb)`,
  );
  const milestones = rows.map((m, index) =>
    PaymentMilestoneDto.parse({
      id: m.id,
      entityId: facts.entityId,
      orderId: facts.orderId,
      seq: index + 1,
      key: m.key,
      label: m.label,
      percent: m.percent,
      amount: m.amount,
      paidAmount: '0.00',
      dueRule: m.dueRule,
      dueDays: m.dueDays,
      loanGate: m.loanGate,
      state: m.state,
      dueOn: m.dueOn,
      waivedAt: null,
      waivedByName: null,
      waiveReason: null,
    }),
  );
  for (const m of milestones) {
    ctx.audit({
      aggregateType: 'payment_milestone',
      aggregateId: m.id,
      entityId: facts.entityId,
      after: { label: m.label, milestoneAmount: m.amount, state: m.state, dueOn: m.dueOn },
    });
  }
  return { orderId: facts.orderId, templateVersion: facts.template?.version ?? null, milestones };
}

const PLAN_AUDIT_FIELDS = ['label', 'milestoneAmount', 'state', 'dueOn'];

/**
 * `finance.milestone.plan`: Accounts plan a confirmed order's milestones by hand, where the
 * platform has not (an order confirmed before the terms existed, or a planning that failed).
 * `milestones_already_planned` once it has them. People only.
 */
export const planMilestonesByHand = defineCommand({
  name: 'finance.milestone.plan',
  permission: 'finance.payment.write',
  minScope: 'entity',
  peopleOnly: true,
  input: PlanMilestonesInput,
  output: PlannedMilestonesDto,
  auditFields: PLAN_AUDIT_FIELDS,
  constraintReasons: {
    payment_milestones_order_seq_unique: 'milestones_already_planned',
    payment_milestones_order_key_unique: 'milestones_already_planned',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await milestoneFacts(ctx, input.orderId);
    if (facts.entityId !== input.entityId) {
      throw new DomainError('not_found', `order ${input.orderId} is not visible`, {
        reason: 'order_missing',
      });
    }
    if (!PLANNABLE.includes(facts.state)) {
      throw new DomainError('conflict', `order ${input.orderId} is not confirmed`, {
        reason: 'milestones_order_not_confirmed',
      });
    }
    if (facts.planned) {
      throw new DomainError('conflict', `order ${input.orderId} has its milestones`, {
        reason: 'milestones_already_planned',
      });
    }
    const result = await planOrder(ctx, facts, {
      kind: 'principal',
      principal: ctx.principal,
    });
    ctx.emit({
      type: 'finance.milestones.planned',
      entityId: facts.entityId,
      aggregateType: 'sales_order',
      aggregateId: facts.orderId,
      payload: plannedPayload(result),
    });
    return {
      ...result,
      milestones: await readOrderMilestones(ctx, input.entityId, input.orderId),
    };
  },
});

/**
 * `finance.milestone.plan_confirmed`: the platform plans a confirmed order's milestones when
 * `sales.order.confirmed` is delivered, as `system:workers` with the platform-only
 * `finance.milestones.process`, through the two definers alone. A delivery repeated, or one for an
 * order cancelled since, changes nothing and leaves no audit row.
 */
export const planConfirmedMilestones = defineCommand({
  name: 'finance.milestone.plan_confirmed',
  permission: 'finance.milestones.process',
  minScope: 'entity',
  input: PlanMilestonesInput,
  output: PlanConfirmedOutcome,
  auditFields: PLAN_AUDIT_FIELDS,
  auditWhen: 'changed',
  constraintReasons: {
    payment_milestones_order_seq_unique: 'milestones_already_planned',
    payment_milestones_order_key_unique: 'milestones_already_planned',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await milestoneFacts(ctx, input.orderId);
    if (facts.planned) return { outcome: 'already_planned' as const, count: 0 };
    if (!PLANNABLE.includes(facts.state)) return { outcome: 'not_confirmed' as const, count: 0 };
    const result = await planOrder(ctx, facts, {
      kind: 'system',
      job: 'finance.milestone.plan_confirmed',
    });
    ctx.emit({
      type: 'finance.milestones.planned',
      entityId: facts.entityId,
      aggregateType: 'sales_order',
      aggregateId: facts.orderId,
      payload: plannedPayload(result),
    });
    return { outcome: 'planned' as const, count: result.milestones.length };
  },
});

/**
 * `finance.milestone.waive` (docs/03-roadmap-appendix/phase5.md §6.1): the Executive lets a
 * milestone still waiting for money go, with a reason; a dispatch no longer waits for it. People
 * only.
 */
export const waiveMilestone = defineCommand({
  name: 'finance.milestone.waive',
  permission: 'finance.payment.write',
  minScope: 'all',
  peopleOnly: true,
  input: WaiveMilestoneInput,
  output: PaymentMilestoneDto,
  auditFields: ['state', 'waiveReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const m = schema.paymentMilestones;
    const [row] = await ctx.tx
      .select()
      .from(m)
      .where(and(eq(m.id, input.milestoneId), eq(m.entityId, input.entityId)))
      .for('update')
      .limit(1);
    if (!row) {
      throw new DomainError('not_found', `milestone ${input.milestoneId} is not visible`, {
        reason: 'milestone_missing',
      });
    }
    const waived = transition(
      paymentMilestoneMachine,
      { state: row.state as PaymentMilestoneMachineState, ruleMet: false, loanGate: 'none' },
      'waive',
      {
        actor: { kind: 'principal', principal: ctx.principal },
        now: ctx.now,
        params: { reason: input.reason },
      },
    );
    const done = await ctx.tx
      .update(m)
      .set({
        state: waived.to,
        waivedAt: ctx.now,
        waivedBy: ctx.principal.id,
        waiveReason: input.reason,
        updatedBy: ctx.principal.id,
      })
      .where(eq(m.id, row.id))
      .returning({ id: m.id });
    if (done.length !== 1) {
      throw new DomainError('forbidden', `milestone ${row.id} is outside the caller's scope`);
    }
    ctx.audit({
      aggregateType: 'payment_milestone',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: waived.to, waiveReason: input.reason },
    });
    ctx.emit({
      type: 'finance.milestone.waived',
      entityId: row.entityId,
      aggregateType: 'payment_milestone',
      aggregateId: row.id,
      payload: { orderId: row.salesOrderId },
    });
    const milestones = await readOrderMilestones(ctx, row.entityId, row.salesOrderId);
    const after = milestones.find((x) => x.id === row.id);
    if (!after) throw new DomainError('internal', `milestone ${row.id} was not read back`);
    return after;
  },
});
