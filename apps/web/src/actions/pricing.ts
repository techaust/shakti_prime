'use server';

import { DomainError, SetPriceInput, type PriceListItemDto } from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import { runCommand, setPrice as setPriceCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
export async function setPrice(rawInput: unknown): Promise<PriceListItemDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = SetPriceInput.parse(rawInput);
  return withRequestContext(principal, {}, (context) =>
    runCommand(setPriceCommand, { context }, input),
  );
}
