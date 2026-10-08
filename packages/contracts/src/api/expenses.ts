import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { DateOnlySchema } from './common';

/**
 * `POST /expenses` (docs/06-api.md §3.2, docs/01-blueprint.md §8.8): an expense claim with receipt
 * photos, allocated to a project or to overhead. Approval runs manager → Accounts on the web.
 */
export const EXPENSE_CATEGORIES = ['travel', 'fuel', 'food', 'site_purchase'] as const;
export const ExpenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

export const ExpenseLineInput = z
  .object({
    id: IdSchema,
    category: ExpenseCategorySchema,
    spentOn: DateOnlySchema,
    amount: MoneySchema,
    description: z.string().trim().min(2).max(200),
    /** `receipt` files already completed through `/files/:id/complete`. */
    receiptFileIds: z.array(IdSchema).min(1).max(5),
  })
  .strict();
export type ExpenseLineInput = z.infer<typeof ExpenseLineInput>;

export const CreateExpenseRequest = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    /** Null allocates the claim to overhead. */
    projectId: IdSchema.nullable(),
    lines: z.array(ExpenseLineInput).min(1).max(30),
  })
  .strict();
export type CreateExpenseRequest = z.infer<typeof CreateExpenseRequest>;

export const CreateExpenseResponse = z
  .object({
    id: IdSchema,
    state: z.literal('submitted'),
    total: MoneySchema,
    /** Lines above the policy limit for their category; the approver sees them flagged. */
    overLimitLineIds: z.array(IdSchema),
  })
  .strict();
export type CreateExpenseResponse = z.infer<typeof CreateExpenseResponse>;
