import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { SegmentSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { CalendarDateSchema, PercentSchema } from '../tax/engine';

/**
 * Payment milestones and their templates (docs/03-roadmap-appendix/phase5.md §5, §6.1, question
 * 6 (a)). A template is per company and segment, published by an Executive as a new version; an
 * order's milestones are planned from the version current when it was confirmed and keep it.
 */

/** When a milestone falls due: on confirmation, before dispatch, on installation, or days after the invoice. */
export const MILESTONE_DUE_RULES = [
  'on_confirmation',
  'before_dispatch',
  'on_installation',
  'days_after_invoice',
] as const;
export const MilestoneDueRuleSchema = z.enum(MILESTONE_DUE_RULES);
export type MilestoneDueRule = z.infer<typeof MilestoneDueRuleSchema>;

/**
 * Whether a customer loan may hold a milestone back: `customer_loan` milestones wait while the
 * order's loan answers `pending` for their key (`app.order_loan_gate()`, J2); `none` never wait.
 */
export const MILESTONE_LOAN_GATES = ['none', 'customer_loan'] as const;
export const MilestoneLoanGateSchema = z.enum(MILESTONE_LOAN_GATES);
export type MilestoneLoanGate = z.infer<typeof MilestoneLoanGateSchema>;

/** The `payment-milestone` machine's states (`payment_milestones.state`). */
export const PAYMENT_MILESTONE_STATES = ['pending', 'due', 'part_paid', 'paid', 'waived'] as const;
export const PaymentMilestoneStateSchema = z.enum(PAYMENT_MILESTONE_STATES);
export type PaymentMilestoneState = z.infer<typeof PaymentMilestoneStateSchema>;

/** The states in which a milestone still waits for money. */
export const OPEN_MILESTONE_STATES = [
  'pending',
  'due',
  'part_paid',
] as const satisfies readonly PaymentMilestoneState[];

/**
 * A milestone's key, as a customer loan names it in its gates (J2's `LoanMilestoneKeySchema`):
 * lower-case words joined by underscores.
 */
export const MilestoneKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const MILESTONE_LABEL_MIN = 2;
export const MILESTONE_LABEL_MAX = 60;
export const MILESTONE_STEPS_MAX = 10;
export const MILESTONE_DUE_DAYS_MAX = 365;

/**
 * One step of a template: a share of the order's total (`percent`) or a fixed amount, when it
 * falls due, and whether a loan may hold it back. `dueDays` is given only for `days_after_invoice`.
 */
export const MilestoneStepSchema = z
  .object({
    key: MilestoneKeySchema,
    label: z.string().trim().min(MILESTONE_LABEL_MIN).max(MILESTONE_LABEL_MAX),
    percent: PercentSchema.nullable(),
    amount: MoneySchema.nullable(),
    dueRule: MilestoneDueRuleSchema,
    dueDays: z.number().int().min(1).max(MILESTONE_DUE_DAYS_MAX).nullable(),
    loanGate: MilestoneLoanGateSchema,
  })
  .strict()
  .refine((s) => (s.percent === null) !== (s.amount === null), {
    message: 'a step is a percentage or an amount',
    path: ['percent'],
  })
  .refine((s) => s.percent === null || Number(s.percent) > 0, {
    message: 'a percentage above zero',
    path: ['percent'],
  })
  .refine((s) => s.amount === null || Number(s.amount) > 0, {
    message: 'an amount above zero',
    path: ['amount'],
  })
  .refine((s) => (s.dueRule === 'days_after_invoice') === (s.dueDays !== null), {
    message: 'days are given for a payment due after the invoice, and only for it',
    path: ['dueDays'],
  });
export type MilestoneStep = z.infer<typeof MilestoneStepSchema>;

/** Hundredths of a percent, so `33.33` + `33.33` + `33.34` sums exactly. */
const hundredths = (percent: string): number => Math.round(Number(percent) * 100);

/**
 * A template's steps: one to ten, keys unique, the last a percentage, and the percentages summing
 * to exactly 100 (the fixed amounts come off the total first, and the percentages share the rest).
 */
export const MilestoneStepsSchema = z
  .array(MilestoneStepSchema)
  .min(1)
  .max(MILESTONE_STEPS_MAX)
  .refine((steps) => new Set(steps.map((s) => s.key)).size === steps.length, {
    message: 'each step has its own key',
  })
  .refine((steps) => steps.at(-1)?.percent !== null, {
    message: 'the last step is a percentage, which takes what is left',
  })
  .refine(
    (steps) => steps.reduce((sum, s) => sum + (s.percent === null ? 0 : hundredths(s.percent)), 0) === 10000,
    { message: 'the percentages add up to 100' },
  );
export type MilestoneSteps = z.infer<typeof MilestoneStepsSchema>;

/** `finance.milestone_template.publish`: a new version of a company's terms for a segment. */
export const PublishMilestoneTemplateInput = z
  .object({ entityId: EntityIdSchema, segment: SegmentSchema, steps: MilestoneStepsSchema })
  .strict();
export type PublishMilestoneTemplateInput = z.input<typeof PublishMilestoneTemplateInput>;

/** One published version of a company's terms for a segment. */
export const MilestoneTemplateDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    segment: SegmentSchema,
    version: z.number().int().min(1),
    steps: z.array(MilestoneStepSchema),
    publishedAt: z.iso.datetime(),
    publishedByName: z.string().nullable(),
  })
  .strict();
export type MilestoneTemplateDto = z.infer<typeof MilestoneTemplateDto>;

/** `finance.milestone.plan`: plan an order's milestones from its company's current terms. */
export const PlanMilestonesInput = z
  .object({ entityId: EntityIdSchema, orderId: IdSchema })
  .strict();
export type PlanMilestonesInput = z.input<typeof PlanMilestonesInput>;

export const MILESTONE_WAIVE_REASON_MAX = 300;

/** `finance.milestone.waive`: the Executive lets a milestone go unpaid, and says why. */
export const WaiveMilestoneInput = z
  .object({
    entityId: EntityIdSchema,
    milestoneId: IdSchema,
    reason: z.string().trim().min(1).max(MILESTONE_WAIVE_REASON_MAX),
  })
  .strict();
export type WaiveMilestoneInput = z.input<typeof WaiveMilestoneInput>;

/** One milestone of an order, as the Payments tab shows it. */
export const PaymentMilestoneDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    orderId: IdSchema,
    seq: z.number().int().min(1),
    key: MilestoneKeySchema,
    label: z.string(),
    percent: PercentSchema.nullable(),
    amount: MoneySchema,
    paidAmount: MoneySchema,
    dueRule: MilestoneDueRuleSchema,
    dueDays: z.number().int().nullable(),
    loanGate: MilestoneLoanGateSchema,
    state: PaymentMilestoneStateSchema,
    /** The day it fell due, in IST; null while it waits. */
    dueOn: CalendarDateSchema.nullable(),
    waivedAt: z.iso.datetime().nullable(),
    waivedByName: z.string().nullable(),
    waiveReason: z.string().nullable(),
  })
  .strict();
export type PaymentMilestoneDto = z.infer<typeof PaymentMilestoneDto>;

/** What `finance.milestone.plan` answers: the order's milestones and the version they came from. */
export const PlannedMilestonesDto = z
  .object({
    orderId: IdSchema,
    /** The template version planned from; null when the company had none and the named default was used. */
    templateVersion: z.number().int().min(1).nullable(),
    milestones: z.array(PaymentMilestoneDto),
  })
  .strict();
export type PlannedMilestonesDto = z.infer<typeof PlannedMilestonesDto>;

/**
 * Whether an order may leave on dispatch as far as its payments go (`app.order_dispatch_payment_gate()`):
 * `open` while a `before_dispatch` milestone is neither paid nor waived (D2's `depart` refuses with
 * `payment_milestone_open`), `clear` otherwise.
 */
export const DISPATCH_PAYMENT_GATES = ['clear', 'open'] as const;
export const DispatchPaymentGateSchema = z.enum(DISPATCH_PAYMENT_GATES);
export type DispatchPaymentGate = z.infer<typeof DispatchPaymentGateSchema>;
