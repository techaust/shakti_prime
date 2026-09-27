'use server';

import { DomainError, SetPriceInput, type PriceListItemDto } from '@shakti/contracts';
import { executeCommand, setPrice as setPriceCommand } from '@shakti/domain';
import { currentPrincipal } from '../auth/current-principal';
import { commandOptions, parseInput, requestMeta } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
export async function setPrice(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<PriceListItemDto> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  const input = parseInput(SetPriceInput, rawInput);
  const meta = await requestMeta();
  return executeCommand(
    principal,
    { requestId: meta.requestId },
    setPriceCommand,
    input,
    commandOptions(meta, idempotencyKey),
  );
}
