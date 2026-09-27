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
    /** The customer's owner contact; null only while none is recorded (AUDIT M20). */
    contact: z
      .object({
        id: IdSchema,
        name: z.string(),
        phone: E164Schema.nullable(),
      })
      .strict()
      .nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type LeadDto = z.infer<typeof LeadDto>;

/** What an opportunity command answers: the lead's position after the change. Strict. */
export const OpportunityDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    pipelineId: IdSchema,
    stageId: IdSchema,
    state: OpportunityStateSchema,
    stateChangedAt: z.iso.datetime(),
    ownerId: IdSchema.nullable(),
    teamId: IdSchema.nullable(),
    lockedUntil: z.iso.datetime().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type OpportunityDto = z.infer<typeof OpportunityDto>;
