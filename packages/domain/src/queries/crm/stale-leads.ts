import {
  AnonymiseStaleLeadsInput,
  DomainError,
  StaleLeadCountDto,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { checkPermission } from '../../command/run-command';
import { readStaleWindow } from '../../commands/crm/anonymise-stale-leads';

/**
 * The dry run of `crm.lead.anonymise` for the cutover rehearsal: one batch of one company's
 * leads, counted as the job would find them, with nothing changed. Read-only, through
 * `app.stale_leads()` alone, by a principal holding `crm.retention.run`.
 */
export async function countStaleLeads(
  ctx: Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>,
  rawInput: AnonymiseStaleLeadsInput,
): Promise<StaleLeadCountDto> {
  const input = AnonymiseStaleLeadsInput.parse(rawInput);
  checkPermission(ctx.principal, 'crm.retention.run', 'entity');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: input.entityId,
    });
  }
  const window = await readStaleWindow(ctx.tx, input.entityId, input.after);
  return StaleLeadCountDto.parse({
    entityId: input.entityId,
    examined: window.examined,
    stale: window.stale.length,
    next: window.next,
  });
}
