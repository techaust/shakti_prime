import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { OpportunityStateSchema, SegmentSchema, TaskKindSchema } from '../crm/enums';
import { SizingKindSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';
import { QuoteStateSchema } from './quote';

/**
 * The Lead Converter workspace (`/converting`, PRD TEL-03, docs/03-roadmap-appendix/phase1.md §9): the
 * converter's open leads with the few facts the next-best-action rules read, and the list those
 * rules make. Never a phone number, a cost or a margin.
 */

/** The most leads the board reads at once; a converter works far fewer. */
export const CONVERTING_BOARD_LIMIT = 200;

/** Whose leads and which company: the caller's own unless a team lead names a colleague. */
export const ConvertingBoardInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    /** A member of the caller's team (needs `calls.log` at team scope or wider). */
    ownerId: IdSchema.optional(),
  })
  .strict();
export type ConvertingBoardInput = z.input<typeof ConvertingBoardInput>;

/** Whether the lead's newest sizing was made by today's engine, an older one, or not at all. */
export const ConvertingSizingStateSchema = z.enum(['none', 'stale', 'current']);
export type ConvertingSizingState = z.infer<typeof ConvertingSizingStateSchema>;

/** The lead's newest live quote (a draft or a sent one), or its newest quote of any state. */
export const ConvertingQuoteDto = z
  .object({
    id: IdSchema,
    quoteNo: z.string(),
    state: QuoteStateSchema,
    /** End of the last valid day, in IST. */
    validUntil: z.iso.datetime(),
    grandTotal: MoneySchema,
  })
  .strict();
export type ConvertingQuoteDto = z.infer<typeof ConvertingQuoteDto>;

/** An order of the lead that the dealer credit check holds. */
export const ConvertingOrderDto = z
  .object({
    id: IdSchema,
    soNo: z.string(),
    heldAt: z.iso.datetime(),
    grandTotal: MoneySchema,
  })
  .strict();
export type ConvertingOrderDto = z.infer<typeof ConvertingOrderDto>;

/** One lead on the converter's board, with the facts the rules read. */
export const ConvertingLeadDto = z
  .object({
    opportunityId: IdSchema,
    entityId: EntityIdSchema,
    accountId: IdSchema,
    customerName: z.string(),
    village: z.string().nullable(),
    segment: SegmentSchema,
    pipelineName: z.string(),
    stageId: IdSchema,
    /** The stage's key, which the same stage of every pipeline shares. */
    stageKey: z.string(),
    stageName: z.string(),
    stagePosition: z.number().int(),
    /** The lead's stage is Qualified or past it, so a quote is the next thing it needs. */
    needsQuote: z.boolean(),
    state: OpportunityStateSchema,
    score: z.number().int(),
    stageSince: z.iso.datetime(),
    /** The owner's earliest open callback, due or not; null when none is set. */
    nextCall: z.object({ kind: TaskKindSchema, dueAt: z.iso.datetime() }).strict().nullable(),
    sizing: ConvertingSizingStateSchema,
    /** A pump's standard HP or a rooftop system's kWp, from today's engine; null without one. */
    size: z
      .object({ kind: SizingKindSchema, hp: z.number().nullable(), kwp: z.number().nullable() })
      .strict()
      .nullable(),
    quote: ConvertingQuoteDto.nullable(),
    heldOrder: ConvertingOrderDto.nullable(),
  })
  .strict();
export type ConvertingLeadDto = z.infer<typeof ConvertingLeadDto>;

/** Why a lead is on the next-best-action list, most urgent kind first. */
export const NextActionRuleSchema = z.enum([
  'callback_due',
  'quote_expiring',
  'order_held',
  'sizing_missing',
]);
export type NextActionRule = z.infer<typeof NextActionRuleSchema>;

/** The part of the lead's workspace a row opens. */
export const ConvertingPanelSchema = z.enum(['calls', 'sizing', 'quote', 'order']);
export type ConvertingPanel = z.infer<typeof ConvertingPanelSchema>;

/** One row of the list: a lead, the rule that put it there, and the time the rule is about. */
export const NextActionDto = z
  .object({
    opportunityId: IdSchema,
    entityId: EntityIdSchema,
    customerName: z.string(),
    rule: NextActionRuleSchema,
    panel: ConvertingPanelSchema,
    /** The callback's due time, the quote's last day or the hold's time; null for a missing sizing. */
    at: z.iso.datetime().nullable(),
  })
  .strict();
export type NextActionDto = z.infer<typeof NextActionDto>;

/** The converter's board and the list the rules make from it, read as of one moment. */
export const ConvertingBoardDto = z
  .object({
    asOf: z.iso.datetime(),
    leads: z.array(ConvertingLeadDto),
    actions: z.array(NextActionDto),
    /** More leads than the board reads; the newest changes are shown. */
    truncated: z.boolean(),
  })
  .strict();
export type ConvertingBoardDto = z.infer<typeof ConvertingBoardDto>;
