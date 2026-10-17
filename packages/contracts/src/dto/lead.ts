import { z } from 'zod';
import { AccountTypeSchema, OpportunityStateSchema } from '../crm/enums';
import { ScoreReasonSchema } from '../commands/crm/config';
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
    /** Why the lead has its score (CRM-06); empty at the base. */
    scoreReasons: z.array(ScoreReasonSchema),
    scoreChangedAt: z.iso.datetime().nullable(),
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

/**
 * Who last changed a lead's score (CRM-06): a person, by name, or the overnight rescoring that
 * brings every open lead up to date with the rules (`system:workers`).
 */
export const ScoreChangerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), name: z.string() }).strict(),
  z.object({ kind: z.literal('overnight') }).strict(),
]);
export type ScoreChanger = z.infer<typeof ScoreChangerSchema>;

/** A lead in the leads list: the lead, and who last changed its score (null when no one has). */
export const LeadListItemDto = LeadDto.extend({
  scoreChangedBy: ScoreChangerSchema.nullable(),
  /** The contact's number is on the do-not-disturb list, so the list offers no call link. */
  phoneIsDnd: z.boolean(),
  /**
   * A contact of the customer withdrew consent to calls and gave none since, as Account 360 and
   * the call queue read it (`callConsentWithdrawnSql`), so the list offers no call link.
   */
  callConsentWithdrawn: z.boolean(),
}).strict();
export type LeadListItemDto = z.infer<typeof LeadListItemDto>;
