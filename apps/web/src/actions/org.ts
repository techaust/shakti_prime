'use server';

import { DomainError, UpdateEntityInput, type EntityDto } from '@shakti/contracts';
import { executeCommand, updateEntity as updateEntityCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';
import { commandOptions, parseInput, requestMeta } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. No business logic here. */
export async function updateEntity(rawInput: unknown): Promise<EntityDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(UpdateEntityInput, rawInput);
  const meta = await requestMeta();
  return executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: meta.requestId },
    updateEntityCommand,
    input,
    commandOptions(meta),
  );
}
