import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';

/**
 * Customer loans and the company's lenders (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08).
 * A loan belongs to one order of its company and customer; it is recorded and moved on with
 * `crm.account.write` (`crm.loan.create`, `.sanction`, `.disburse`, `.reject`) and holds back what
 * its gates name until it reaches a state. Amounts here are plain customer figures, behind no cost
 * permission.
 */

/** The `customer-loan` machine's states (`customer_loans.state`). */
export const CUSTOMER_LOAN_STATES = ['applied', 'sanctioned', 'disbursed', 'rejected'] as const;
export const CustomerLoanStateSchema = z.enum(CUSTOMER_LOAN_STATES);
export type CustomerLoanState = z.infer<typeof CustomerLoanStateSchema>;

/** The states in which a loan is its order's one active loan (`customer_loans_active_unique`). */
export const ACTIVE_LOAN_STATES = [
  'applied',
  'sanctioned',
  'disbursed',
] as const satisfies readonly CustomerLoanState[];

/** What the dispatch waits for: the disbursal (the default), the sanction, or nothing. */
export const LOAN_DISPATCH_GATES = ['disbursed', 'sanctioned', 'none'] as const;
export const LoanDispatchGateSchema = z.enum(LOAN_DISPATCH_GATES);
export type LoanDispatchGate = z.infer<typeof LoanDispatchGateSchema>;

/** What a payment milestone waits for (Phase 5). */
export const LOAN_MILESTONE_GATES = ['sanctioned', 'disbursed'] as const;

/** The most payment milestones one loan may hold back. */
export const LOAN_MILESTONE_GATES_MAX = 20;

/** A payment milestone's key as Phase 5 names it: lower-case words joined by underscores. */
export const LoanMilestoneKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/**
 * What a loan holds back until which state (`customer_loans.gates_json`): the order's dispatch,
 * on disbursal unless chosen otherwise, and, from Phase 5, payment milestones by key.
 */
export const LoanGatesSchema = z
  .object({
    dispatch: LoanDispatchGateSchema.default('disbursed'),
    milestones: z
      .record(LoanMilestoneKeySchema, z.enum(LOAN_MILESTONE_GATES))
      .refine((m) => Object.keys(m).length <= LOAN_MILESTONE_GATES_MAX, {
        message: `at most ${String(LOAN_MILESTONE_GATES_MAX)} milestones`,
      })
      .optional(),
  })
  .strict();
export type LoanGates = z.infer<typeof LoanGatesSchema>;

/** A gate's answer (`app.order_loan_gate()`): nothing held back, still waiting, or released. */
export const LOAN_GATE_ANSWERS = ['none', 'pending', 'met'] as const;
export const LoanGateAnswerSchema = z.enum(LOAN_GATE_ANSWERS);
export type LoanGateAnswer = z.infer<typeof LoanGateAnswerSchema>;

/**
 * An order's loan gates as `app.order_loan_gate()` answers them: the active loan, if any, and per
 * gate whether it holds back. J8's dispatch guard reads `dispatch`; Phase 5 reads `milestones`.
 */
export const OrderLoanGateDto = z
  .object({
    loanId: IdSchema.nullable(),
    loanState: CustomerLoanStateSchema.nullable(),
    dispatch: LoanGateAnswerSchema,
    milestones: z.record(LoanMilestoneKeySchema, LoanGateAnswerSchema),
  })
  .strict();
export type OrderLoanGateDto = z.infer<typeof OrderLoanGateDto>;

export const LENDER_NAME_MIN = 2;
export const LENDER_NAME_MAX = 120;
export const LOAN_REFERENCE_MAX = 60;
export const LOAN_REJECTED_REASON_MAX = 300;

const LenderNameSchema = z.string().trim().min(LENDER_NAME_MIN).max(LENDER_NAME_MAX);
/**
 * The lender's own reference for the application or the loan account: letters and digits, with
 * `/`, `-`, `_` or `.` between them and no spaces, so it is a code and never a note (it is kept
 * whole, as a long number by design, `unmaskedFields`).
 */
export const LoanReferenceSchema = z
  .string()
  .trim()
  .max(LOAN_REFERENCE_MAX)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/);

/** An amount above zero: a loan of nothing is not a loan. */
const LoanAmountSchema = MoneySchema.refine((v) => /[1-9]/.test(v), {
  message: 'the amount is above zero',
});

/**
 * `crm.loan.create`: a loan applied for on an order, from a lender of the company's list or,
 * while the list is empty, a lender's name typed once.
 */
export const CreateCustomerLoanInput = z
  .object({
    entityId: EntityIdSchema,
    orderId: IdSchema,
    lenderId: IdSchema.nullable().optional(),
    lenderName: LenderNameSchema.nullable().optional(),
    amount: LoanAmountSchema,
    reference: LoanReferenceSchema.nullable().optional(),
    gates: LoanGatesSchema.default({ dispatch: 'disbursed' }),
  })
  .strict()
  .refine((v) => ((v.lenderId ?? null) === null) !== ((v.lenderName ?? null) === null), {
    message: 'a lender from the list or a typed name, one of the two',
    path: ['lenderId'],
  });
export type CreateCustomerLoanInput = z.input<typeof CreateCustomerLoanInput>;

/**
 * `crm.loan.sanction`: the lender sanctioned the loan for an amount, which the machine's guard
 * requires above zero (`loan_amount_missing`).
 */
export const SanctionCustomerLoanInput = z
  .object({
    entityId: EntityIdSchema,
    loanId: IdSchema,
    sanctionedAmount: MoneySchema,
    reference: LoanReferenceSchema.nullable().optional(),
  })
  .strict();
export type SanctionCustomerLoanInput = z.input<typeof SanctionCustomerLoanInput>;

/** `crm.loan.disburse`: the lender paid out the sanctioned loan. */
export const DisburseCustomerLoanInput = z
  .object({
    entityId: EntityIdSchema,
    loanId: IdSchema,
    reference: LoanReferenceSchema.nullable().optional(),
  })
  .strict();
export type DisburseCustomerLoanInput = z.input<typeof DisburseCustomerLoanInput>;

/** `crm.loan.reject`: the lender turned the loan down, with the reason they gave. */
export const RejectCustomerLoanInput = z
  .object({
    entityId: EntityIdSchema,
    loanId: IdSchema,
    reason: z.string().trim().min(1).max(LOAN_REJECTED_REASON_MAX),
  })
  .strict();
export type RejectCustomerLoanInput = z.input<typeof RejectCustomerLoanInput>;

/** One loan as the order's Loan tab and Account 360 show it. */
export const CustomerLoanDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    accountId: IdSchema,
    salesOrderId: IdSchema,
    lenderId: IdSchema.nullable(),
    /** The lender's name: from the list, or as typed. */
    lenderName: z.string(),
    amount: MoneySchema,
    state: CustomerLoanStateSchema,
    stateChangedAt: z.iso.datetime(),
    sanctionedAmount: MoneySchema.nullable(),
    sanctionedAt: z.iso.datetime().nullable(),
    disbursedAt: z.iso.datetime().nullable(),
    reference: z.string().nullable(),
    rejectedReason: z.string().nullable(),
    gates: LoanGatesSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type CustomerLoanDto = z.infer<typeof CustomerLoanDto>;

/** One lender of a company's list (Settings › Lenders). */
export const LenderDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    name: z.string(),
    isActive: z.boolean(),
  })
  .strict();
export type LenderDto = z.infer<typeof LenderDto>;

/** `crm.lender.create`: a lender added to a company's list. */
export const CreateLenderInput = z
  .object({ entityId: EntityIdSchema, name: LenderNameSchema })
  .strict();
export type CreateLenderInput = z.input<typeof CreateLenderInput>;

/** `crm.lender.update`: a lender renamed, switched off or on again. */
export const UpdateLenderInput = z
  .object({
    entityId: EntityIdSchema,
    lenderId: IdSchema,
    name: LenderNameSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.isActive !== undefined, {
    message: 'a new name or a new state',
    path: ['name'],
  });
export type UpdateLenderInput = z.input<typeof UpdateLenderInput>;
