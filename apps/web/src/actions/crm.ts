'use server';

import { CreateLeadInput, DomainError, type LeadDto } from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import { createLead as createLeadCommand, runCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
export async function createLead(rawInput: unknown): Promise<LeadDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = CreateLeadInput.parse(rawInput);
  return withRequestContext(principal, { entityIds: [input.entityId] }, (context) =>
    runCommand(createLeadCommand, { context }, input),
  );
}
