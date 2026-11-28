import { z } from 'zod';
import { MoneySchema, SignedMoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { ProjectPersonDto } from './reads';

/**
 * A project's labour, contractor and other direct charges (J6, docs/03-roadmap-appendix/phase4.md
 * §7.3, PRD PRJ-05). Restricted: every schema here is read and written only with
 * `finance.cost.read`, and none of these values goes into an event, an audit value, a notice, an
 * export or an agent's input.
 */

/** `project_cost_lines.kind`. A contractor's charge names the contractor (a vendor). */
export const CostLineKindSchema = z.enum(['labour', 'contractor', 'other_direct']);
export type CostLineKind = z.infer<typeof CostLineKindSchema>;

/** A charge's quantity: above zero, at most three decimals (days, hours, metres, a lump sum). */
export const CostQuantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/)
  .refine((q) => Number(q) > 0, { message: 'above zero' });
export type CostQuantity = z.infer<typeof CostQuantitySchema>;

/** A reversal's quantity, the charge's negated. */
export const SignedCostQuantitySchema = z.string().regex(/^-?\d{1,9}\.\d{3}$/);

/** `projects.cost.add`: a charge on a project. The amount is the quantity times the rate. */
export const AddCostLineInput = z
  .object({
    entityId: EntityIdSchema,
    projectId: IdSchema,
    kind: CostLineKindSchema,
    /** The contractor, for a contractor's charge only. */
    vendorId: IdSchema.nullable().default(null),
    quantity: CostQuantitySchema,
    rate: MoneySchema.refine((r) => r !== '0.00', { message: 'above zero' }),
    note: z.string().trim().min(1).max(300).nullable().default(null),
  })
  .strict()
  .refine((v) => (v.kind === 'contractor') === (v.vendorId !== null), {
    message: 'a contractor’s charge names the contractor, and only it',
    path: ['vendorId'],
  });
export type AddCostLineInput = z.input<typeof AddCostLineInput>;

/** `projects.cost.reverse`: a line taken back by a reversal line, once. */
export const ReverseCostLineInput = z
  .object({
    entityId: EntityIdSchema,
    lineId: IdSchema,
    note: z.string().trim().min(1).max(300).nullable().default(null),
  })
  .strict();
export type ReverseCostLineInput = z.input<typeof ReverseCostLineInput>;

/** A cost line as a holder of `finance.cost.read` reads it. Strict: nothing beyond it leaves. */
export const CostLineDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    projectId: IdSchema,
    kind: CostLineKindSchema,
    vendorId: IdSchema.nullable(),
    vendorName: z.string().nullable(),
    quantity: SignedCostQuantitySchema,
    rate: MoneySchema,
    amount: SignedMoneySchema,
    note: z.string().nullable(),
    reversesId: IdSchema.nullable(),
    /** The reversal that took this line back, if any. */
    reversedById: IdSchema.nullable(),
    createdAt: z.iso.datetime(),
    createdBy: IdSchema,
  })
  .strict();
export type CostLineDto = z.infer<typeof CostLineDto>;

/** The project page's Costs tab. */
export const ProjectCostsInput = z
  .object({ entityId: EntityIdSchema, projectId: IdSchema })
  .strict();
export type ProjectCostsInput = z.input<typeof ProjectCostsInput>;

export const ProjectCostsDto = z
  .object({
    lines: z.array(CostLineDto),
    /** Every line added up, reversals included. */
    total: SignedMoneySchema,
    /** Whoever added a line, by id. */
    people: z.array(ProjectPersonDto),
  })
  .strict();
export type ProjectCostsDto = z.infer<typeof ProjectCostsDto>;

/** The contractors a charge may name: the active vendors of kind contractor. */
export const ContractorsInput = z.object({ entityId: EntityIdSchema }).strict();
export type ContractorsInput = z.input<typeof ContractorsInput>;

export const ContractorsDto = z
  .object({ contractors: z.array(z.object({ id: IdSchema, name: z.string() }).strict()) })
  .strict();
export type ContractorsDto = z.infer<typeof ContractorsDto>;
