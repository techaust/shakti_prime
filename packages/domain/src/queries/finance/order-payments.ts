import {
  DispatchPaymentGateSchema,
  DomainError,
  hasGrant,
  OrderPaymentsDto,
  OrderPaymentsInput,
  PaymentTermsDto,
  PaymentTermsInput,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { PROFORMA_ORDER_STATES } from '../../state-machines/machines/proforma';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { parseQueryInput } from '../parse-input';
import { readMilestoneTemplates, readOrderMilestones, readOrderProformas } from './finance-dto';

/**
 * The order page's Payments tab (docs/03-roadmap-appendix/phase5.md §6.1), for a holder of
 * `finance.read`: the order's milestones and proformas as row security lets the caller read them
 * (over the order's lead or dealer relationship), whether its dispatch waits for a payment
 * (`app.order_dispatch_payment_gate()`), and what the caller may do now. `forbidden` without
 * `finance.read`, so the page shows the order without the tab; `order_missing` for an order the
 * caller does not read.
 */
export async function readOrderPayments(
  ctx: RequestContext,
  raw: unknown,
): Promise<OrderPaymentsDto> {
  const input = parseQueryInput(OrderPaymentsInput, raw, 'finance.order_payments');
  const grants = ctx.principal.permissions;
  if (!hasGrant(grants, 'finance.read', 'own')) {
    throw new DomainError('forbidden', 'finance.read is required');
  }
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const so = schema.salesOrders;
  const [order] = await ctx.tx
    .select({ state: so.state, planFailure: so.paymentPlanFailure })
    .from(so)
    .where(and(eq(so.id, input.orderId), eq(so.entityId, input.entityId)))
    .limit(1);
  if (!order) {
    throw new DomainError('not_found', `order ${input.orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  const [milestones, proformas, gateRows] = await Promise.all([
    readOrderMilestones(ctx, input.entityId, input.orderId),
    readOrderProformas(ctx, input.entityId, input.orderId),
    ctx.tx.execute(
      sql`select app.order_dispatch_payment_gate(${input.orderId}::uuid) as gate`,
    ) as unknown as Promise<{ gate: string | null }[]>,
  ]);
  const confirmed = PROFORMA_ORDER_STATES.includes(order.state);
  const live = proformas.some((p) => p.state === 'issued');
  return OrderPaymentsDto.parse({
    entityId: input.entityId,
    orderId: input.orderId,
    milestones,
    proformas,
    dispatchGate: DispatchPaymentGateSchema.parse(gateRows[0]?.gate ?? 'clear'),
    planFailure: milestones.length === 0 ? order.planFailure : null,
    canIssue: confirmed && !live && hasGrant(grants, 'finance.proforma.write', 'entity'),
    canCancelProforma: live && hasGrant(grants, 'finance.proforma.write', 'entity'),
    canPlan:
      confirmed && milestones.length === 0 && hasGrant(grants, 'finance.payment.write', 'entity'),
    canWaive: hasGrant(grants, 'finance.payment.write', 'all'),
  });
}

/**
 * Settings › Payment terms (docs/03-roadmap-appendix/phase5.md §6.1, question 6 (a)): one
 * company's published terms, newest version first per segment, and the standard terms, for the
 * Executive who publishes them (`finance.payment.write` for every company).
 */
export async function listPaymentTerms(
  ctx: RequestContext,
  raw: unknown,
): Promise<PaymentTermsDto> {
  const input = parseQueryInput(PaymentTermsInput, raw, 'finance.payment_terms');
  if (!hasGrant(ctx.principal.permissions, 'finance.payment.write', 'all')) {
    throw new DomainError('forbidden', 'finance.payment.write for every company is required');
  }
  return PaymentTermsDto.parse({
    entityId: input.entityId,
    templates: await readMilestoneTemplates(ctx, input.entityId),
    defaultSteps: WORKSHOP_DEFAULTS.finance.milestoneSteps,
  });
}
