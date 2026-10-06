import { z } from 'zod';
import { SizingKindSchema } from '../crm/sizing';
import { OpportunityStateSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';

/** How the SLA dot on a lead card reads (docs/08-design-system.md §2.4): on time, due soon, or late. */
export const SlaStatusSchema = z.enum(['ok', 'warn', 'breach']);
export type SlaStatus = z.infer<typeof SlaStatusSchema>;

/** How many cards a stage shows at first, and how many each "Load more" adds (docs/08-design-system.md §6). */
export const BOARD_PAGE_SIZE = 100;

/** Which company, which pipeline and which statuses a board shows. */
const boardFilter = {
  entityId: EntityIdSchema.optional(),
  pipelineKey: z.string().min(1).max(64),
  states: z
    .array(OpportunityStateSchema)
    .min(1)
    .max(4)
    .refine((s) => new Set(s).size === s.length, 'each status once')
    .default(['open']),
  /** Cards per stage; the screens leave it at `BOARD_PAGE_SIZE`. */
  limit: z.number().int().min(1).max(BOARD_PAGE_SIZE).default(BOARD_PAGE_SIZE),
};

/**
 * The leads board of one pipeline (docs/08-design-system.md §6, Kanban board): which company, which pipeline
 * and which statuses. Open leads only unless the caller asks for others.
 */
export const ListBoardLeadsInput = z.object(boardFilter).strict();
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
    /** The lead's customer, whose Account 360 the card opens. */
    accountId: IdSchema,
    customerName: z.string(),
    village: z.string().nullable(),
    ownerId: IdSchema.nullable(),
    ownerName: z.string().nullable(),
    /** When the lead last changed status (opened, parked, reopened, won or lost). */
    stateChangedAt: z.iso.datetime(),
    /** Null while no SLA rule covers the lead; the card then shows no dot. */
    sla: SlaStatusSchema.nullable(),
    /** When the lead entered its stage: its last stage move, else when it was made. */
    stageSince: z.iso.datetime(),
    /**
     * The size of the lead's newest sizing from today's engine: a pump's standard HP, or a rooftop
     * system's kWp; null when the lead has none.
     */
    size: z
      .object({ kind: SizingKindSchema, hp: z.number().nullable(), kwp: z.number().nullable() })
      .strict()
      .nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type BoardLeadDto = z.infer<typeof BoardLeadDto>;

/** Where the next page of one stage starts, for a stage that holds more cards than it shows. */
export const BoardStageCursorDto = z.object({ stageId: IdSchema, cursor: z.string() }).strict();
export type BoardStageCursorDto = z.infer<typeof BoardStageCursorDto>;

/**
 * The board: the pipeline, how many leads each stage holds under the filter, and the cards,
 * newest change first, at most `perStage` of them in any one stage; `more` names each stage
 * with cards past those and where its next page starts.
 */
export const LeadBoardDto = z
  .object({
    pipelineId: IdSchema,
    counts: z.array(z.object({ stageId: IdSchema, count: z.number().int().min(0) }).strict()),
    perStage: z.number().int().min(1),
    items: z.array(BoardLeadDto),
    more: z.array(BoardStageCursorDto),
  })
  .strict();
export type LeadBoardDto = z.infer<typeof LeadBoardDto>;

/**
 * The next page of one stage of a board ("Load more" at the foot of a column): the same filter as
 * the board, the stage, and the cursor the board or the previous page gave for it.
 */
export const ListBoardStageLeadsInput = z
  .object({ ...boardFilter, stageId: IdSchema, cursor: z.string().min(1).max(512) })
  .strict();
export type ListBoardStageLeadsInput = z.input<typeof ListBoardStageLeadsInput>;

/** One more page of a stage's cards, older than those already shown, and where the next starts. */
export const BoardStagePageDto = z
  .object({ stageId: IdSchema, items: z.array(BoardLeadDto), nextCursor: z.string().nullable() })
  .strict();
export type BoardStagePageDto = z.infer<typeof BoardStagePageDto>;

/** Who a lead can be handed to, in one company. */
export const ListLeadAssigneesInput = z.object({ entityId: EntityIdSchema }).strict();
export type ListLeadAssigneesInput = z.infer<typeof ListLeadAssigneesInput>;

/** A person who works on leads in the company, as the Assign dialog lists them. */
export const LeadAssigneeDto = z
  .object({ id: IdSchema, name: z.string(), teamId: IdSchema.nullable() })
  .strict();
export type LeadAssigneeDto = z.infer<typeof LeadAssigneeDto>;
