'use server';

import { CreateLeadInput, DomainError, type LeadDto } from '@shakti/contracts';
import { createLead as createLeadCommand, executeCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';
import { parseInput, requestId } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
export async function createLead(rawInput: unknown): Promise<LeadDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(CreateLeadInput, rawInput);
  return executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: await requestId() },
    createLeadCommand,
    input,
  );
}
