'use server';

import { DomainError, UpdateEntityInput, type EntityDto } from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import { runCommand, updateEntity as updateEntityCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. No business logic here. */
export async function updateEntity(rawInput: unknown): Promise<EntityDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = UpdateEntityInput.parse(rawInput);
  return withRequestContext(principal, { entityIds: [input.entityId] }, (context) =>
    runCommand(updateEntityCommand, { context }, input),
  );
}
