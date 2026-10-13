import { CreateLeadInput, DomainError, TakenEnquiryDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { createLead } from './create-lead';
import { routeEnquiry } from './route-enquiry';

/** The refusal of a lead for a customer a colleague looks after in the company. */
function heldByColleague(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.code === 'conflict' &&
    error.details?.reason === 'customer_held_by_colleague'
  );
}

/**
 * `crm.enquiry.take`: an enquiry a person types in (the lead and walk-in forms). It is
 * `crm.lead.create`, except that a lead refused because a colleague looks after the customer in the
 * company (`customer_held_by_colleague`) goes to that colleague as routed work through
 * `crm.enquiry.route` (PRD RPT-04 criterion 2), in the same transaction: the attempt runs in a
 * savepoint, so the refusal takes back only the lead and its records, and the routing commits with
 * nothing else. Each inner command keeps its own guard, audit row and events. An import row and an
 * agent still use `crm.lead.create`, where the refusal stands. For people only, as routing is.
 */
export const takeEnquiry = defineCommand({
  name: 'crm.enquiry.take',
  permission: 'crm.lead.write',
  minScope: 'own',
  // What both inner commands need: a lead creates or attaches a customer (ADR 0008, AUDIT L9).
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  peopleOnly: true,
  input: CreateLeadInput,
  output: TakenEnquiryDto,
  // The inner commands record the change; this one adds nothing of its own.
  auditFields: [],
  async handler(ctx, input) {
    try {
      return await ctx.savepoint((sp) => ctx.run(createLead, input, { tx: sp }));
    } catch (error) {
      if (!heldByColleague(error)) throw error;
    }
    const route =
      input.existingAccountId === undefined
        ? { entityId: input.entityId, pipelineKey: input.pipelineKey, phone: input.contact?.phone }
        : {
            entityId: input.entityId,
            pipelineKey: input.pipelineKey,
            existingAccountId: input.existingAccountId,
          };
    return ctx.run(routeEnquiry, route);
  },
});
