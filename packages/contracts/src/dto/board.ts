import { z } from 'zod';
import { OpportunityStateSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';

/** How the SLA dot on a lead card reads (DESIGN.md §2.4): on time, due soon, or late. */
export const SlaStatusSchema = z.enum(['ok', 'warn', 'breach']);
export type SlaStatus = z.infer<typeof SlaStatusSchema>;

/**
 * The leads board of one pipeline (DESIGN.md §6, Kanban board): which company, which pipeline
 * and which statuses. Open leads only unless the caller asks for others.
 */
export const ListBoardLeadsInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    pipelineKey: z.string().min(1).max(64),
    states: z
      .array(OpportunityStateSchema)
      .min(1)
      .max(4)
      .refine((s) => new Set(s).size === s.length, 'each status once')
      .default(['open']),
  })
  .strict();
export type ListBoardLeadsInput = z.input<typeof ListBoardLeadsInput>;

/**
 * One card on the board: only what the card shows and what its menu needs. Never a phone
 * number, a price or a cost (AGENTS.md §5).
 */
export const BoardLeadDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    stageId: IdSchema,
    state: OpportunityStateSchema,
    customerName: z.string(),
    village: z.string().nullable(),
    ownerId: IdSchema.nullable(),
    ownerName: z.string().nullable(),
    /** When the lead last changed status (opened, parked, reopened, won or lost). */
    stateChangedAt: z.iso.datetime(),
    /** Null while no SLA rule covers the lead; the card then shows no dot. */
    sla: SlaStatusSchema.nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type BoardLeadDto = z.infer<typeof BoardLeadDto>;

/**
 * The board: the pipeline, how many leads each stage holds under the filter, and the cards,
 * newest change first, at most `perStage` of them in any one stage.
 */
export const LeadBoardDto = z
  .object({
    pipelineId: IdSchema,
    counts: z.array(z.object({ stageId: IdSchema, count: z.number().int().min(0) }).strict()),
    perStage: z.number().int().min(1),
    items: z.array(BoardLeadDto),
  })
  .strict();
export type LeadBoardDto = z.infer<typeof LeadBoardDto>;

/** Who a lead can be handed to, in one company. */
export const ListLeadAssigneesInput = z.object({ entityId: EntityIdSchema }).strict();
export type ListLeadAssigneesInput = z.infer<typeof ListLeadAssigneesInput>;

/** A person who works on leads in the company, as the Assign dialog lists them. */
export const LeadAssigneeDto = z
  .object({ id: IdSchema, name: z.string(), teamId: IdSchema.nullable() })
  .strict();
export type LeadAssigneeDto = z.infer<typeof LeadAssigneeDto>;
