'use server';

import { DomainError, SetPriceInput, type PriceListItemDto } from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import { runCommand, setPrice as setPriceCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';
import { parseInput, requestId } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
export async function setPrice(rawInput: unknown): Promise<PriceListItemDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(SetPriceInput, rawInput);
  return withRequestContext(principal, { requestId: await requestId() }, (context) =>
    runCommand(setPriceCommand, { context }, input),
  );
}
