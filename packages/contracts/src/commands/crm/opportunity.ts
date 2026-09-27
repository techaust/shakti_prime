import { z } from 'zod';
import { OpportunityLostReasonSchema, OpportunityNurtureReasonSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The opportunity commands (docs/design/backend-weeks-3-5.md §7.2). Each names the lead and the
 * company it belongs to, so the request is narrowed to that company and the caller acts with
 * their team there.
 */
const Lead = {
  entityId: EntityIdSchema,
  opportunityId: IdSchema,
};

/** `crm.opportunity.stage.move`: to another open stage of the lead's pipeline. */
export const MoveOpportunityStageInput = z.object({ ...Lead, stageId: IdSchema }).strict();
export type MoveOpportunityStageInput = z.infer<typeof MoveOpportunityStageInput>;

/** `crm.opportunity.assign`: to a person who works on leads in the lead's company. */
export const AssignOpportunityInput = z.object({ ...Lead, ownerId: IdSchema }).strict();
export type AssignOpportunityInput = z.infer<typeof AssignOpportunityInput>;

/** `crm.opportunity.nurture`: parked on the nurture cadence, with the reason. */
export const NurtureOpportunityInput = z
  .object({ ...Lead, reasonCode: OpportunityNurtureReasonSchema })
  .strict();
export type NurtureOpportunityInput = z.infer<typeof NurtureOpportunityInput>;

/** `crm.opportunity.reopen`: a nurtured lead, or a lost one within the reopen window. */
export const ReopenOpportunityInput = z.object(Lead).strict();
export type ReopenOpportunityInput = z.infer<typeof ReopenOpportunityInput>;

/** `crm.opportunity.win`: needs an accepted quote or a confirmed order (Phase 1). */
export const WinOpportunityInput = z.object(Lead).strict();
export type WinOpportunityInput = z.infer<typeof WinOpportunityInput>;

/** `crm.opportunity.lose`: closed without a sale, with the reason. */
export const LoseOpportunityInput = z
  .object({ ...Lead, reasonCode: OpportunityLostReasonSchema })
  .strict();
export type LoseOpportunityInput = z.infer<typeof LoseOpportunityInput>;
