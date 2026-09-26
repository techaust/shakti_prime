import { z } from 'zod';
import { AccountTypeSchema, OpportunityStateSchema } from '../crm/enums';
import { E164Schema } from '../crm/phone';
import { EntityIdSchema, IdSchema } from '../ids';

/** A lead as callers see it: the opportunity with its account and primary contact. Strict. */
export const LeadDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    pipelineId: IdSchema,
    stageId: IdSchema,
    state: OpportunityStateSchema,
    score: z.number().int(),
    ownerId: IdSchema.nullable(),
    teamId: IdSchema.nullable(),
    siteId: IdSchema.nullable(),
    account: z
      .object({
        id: IdSchema,
        type: AccountTypeSchema,
        name: z.string(),
      })
      .strict(),
    contact: z
      .object({
        id: IdSchema,
        name: z.string(),
        phone: E164Schema,
      })
      .strict(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type LeadDto = z.infer<typeof LeadDto>;
