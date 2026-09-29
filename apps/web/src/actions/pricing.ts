'use server';

import {
  ApprovePriceListInput,
  CreatePriceListInput,
  SetPriceInput,
  type KitPricePageDto,
  type PriceChangePageDto,
  type PriceListDto,
  type PriceListItemDto,
  type PricePageDto,
} from '@shakti/contracts';
import {
  approvePriceList as approvePriceListCommand,
  createPriceList as createPriceListCommand,
  executeCommand,
  executeQuery,
  listKitPrices as listKitPricesQuery,
  listPriceChanges as listPriceChangesQuery,
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
    return executeQuery(principal, { requestId }, (context) => listPriceListsQuery(context), {
      name: 'listPriceLists',
    });
  });
}

/** Price Master: the items of one list with their selling price, a page at a time. */
export async function listPrices(rawInput: unknown): Promise<ActionResult<PricePageDto>> {
  return toResult('listPrices', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listPricesQuery(context, rawInput), {
      name: 'listPrices',
    });
  });
}

/** A draft price list for a tier, from a date, holding a copy of the live prices. */
export async function createPriceList(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PriceListDto>> {
  return toResult('createPriceList', async () => {
    const principal = await signedIn();
    const input = parseInput(CreatePriceListInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      createPriceListCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** A draft becomes its tier's list from its start date. */
export async function approvePriceList(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PriceListDto>> {
  return toResult('approvePriceList', async () => {
    const principal = await signedIn();
    const input = parseInput(ApprovePriceListInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      approvePriceListCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Price Master › Kits: the kits of one list with their selling price, a page at a time. */
export async function listKitPrices(rawInput: unknown): Promise<ActionResult<KitPricePageDto>> {
  return toResult('listKitPrices', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listKitPricesQuery(context, rawInput),
      { name: 'listKitPrices' },
    );
  });
}

/** The price history of one item or kit, newest first. */
export async function listPriceChanges(
  rawInput: unknown,
): Promise<ActionResult<PriceChangePageDto>> {
  return toResult('listPriceChanges', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listPriceChangesQuery(context, rawInput),
      { name: 'listPriceChanges' },
    );
  });
}
