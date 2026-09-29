import { DomainError } from '@shakti/contracts';
import type { CommandContext } from '../../command/context';

/**
 * The company an event about a shared catalogue row is filed under: the one the request acts
 * for, else the first in scope. The payload carries only ids and codes either way.
 */
export function eventEntity(ctx: CommandContext): number {
  const entityId = ctx.activeEntityId ?? ctx.entityIds[0];
  if (entityId === undefined) {
    throw new DomainError('forbidden', 'no entity in the request scope');
  }
  return entityId;
}
