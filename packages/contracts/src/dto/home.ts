import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';

const count = z.number().int().min(0);

/** The caller's queue in one company, with the calls they logged today (the caller's home). */
export const CallerHomeDto = z
  .object({
    entityId: EntityIdSchema,
    /** Leads waiting in the queue, those due now and first calls that are late. */
    waiting: count,
    due: count,
    late: count,
    callsToday: count,
  })
  .strict();
export type CallerHomeDto = z.infer<typeof CallerHomeDto>;

/** One stage of a pipeline and the open leads in it. */
export const StageCountDto = z
  .object({ stageId: IdSchema, stageName: z.string(), position: z.number().int(), leads: count })
  .strict();
export type StageCountDto = z.infer<typeof StageCountDto>;

/** A pipeline's open leads by stage in one company (the General Manager's and Executive's homes). */
export const PipelineStagesDto = z
  .object({
    entityId: EntityIdSchema,
    pipelineId: IdSchema,
    pipelineName: z.string(),
    stages: z.array(StageCountDto),
  })
  .strict();
export type PipelineStagesDto = z.infer<typeof PipelineStagesDto>;

/**
 * First calls past the limit a pipeline sets in one company (the General Manager's home): leads
 * still waiting for their first call after the limit, and first calls made late in the last 30
 * days. `limitSet` is false when no pipeline of the company has a limit.
 */
export const ResponseTimeDto = z
  .object({
    entityId: EntityIdSchema,
    limitSet: z.boolean(),
    waitingPastLimit: count,
    calledLate: count,
  })
  .strict();
export type ResponseTimeDto = z.infer<typeof ResponseTimeDto>;

/** Quotes and orders of one company this month (the Executive's home). Never a margin. */
export const SalesHomeDto = z
  .object({
    entityId: EntityIdSchema,
    quotesSent: count,
    quotesAccepted: count,
    ordersConfirmed: count,
    ordersValue: MoneySchema,
  })
  .strict();
export type SalesHomeDto = z.infer<typeof SalesHomeDto>;

/** Dealer credit in one company (Accounts' home). */
export const CreditHomeDto = z
  .object({
    entityId: EntityIdSchema,
    heldOrders: count,
    dealersOverLimit: count,
    overdueInvoices: count,
  })
  .strict();
export type CreditHomeDto = z.infer<typeof CreditHomeDto>;
