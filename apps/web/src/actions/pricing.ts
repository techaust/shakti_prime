'use server';

import {
  SetPriceInput,
  type PriceListDto,
  type PriceListItemDto,
  type PriceRowDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  listPriceLists as listPriceListsQuery,
  listPrices as listPricesQuery,
  setPrice as setPriceCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
export async function setPrice(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PriceListItemDto>> {
  return toResult('setPrice', async () => {
    const principal = await signedIn();
    const input = parseInput(SetPriceInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setPriceCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Price Master: the price lists the caller can read. */
export async function listPriceLists(): Promise<ActionResult<PriceListDto[]>> {
  return toResult('listPriceLists', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listPriceListsQuery(context));
  });
}

/** Price Master: the items of one list with their selling price. */
export async function listPrices(rawInput: unknown): Promise<ActionResult<PriceRowDto[]>> {
  return toResult('listPrices', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listPricesQuery(context, rawInput));
  });
}
