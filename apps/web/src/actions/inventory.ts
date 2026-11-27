'use server';

import {
  AdjustStockInput,
  ArchiveBinInput,
  ArchiveHubInput,
  CreateBinInput,
  CreateHubInput,
  GetSerialInput,
  GetStockCardInput,
  ListHubsInput,
  ListStockBalancesInput,
  ReadStockValuationInput,
  ReverseStockInput,
  TransferStockInput,
  UpdateBinInput,
  UpdateHubInput,
  type BinDto,
  type HubDto,
  type HubListDto,
  type SerialDto,
  type StockBalancePageDto,
  type StockCardDto,
  type StockMovedDto,
  type StockValuationDto,
} from '@shakti/contracts';
import {
  adjustStock as adjustStockCommand,
  archiveBin as archiveBinCommand,
  archiveHub as archiveHubCommand,
  createBin as createBinCommand,
  createHub as createHubCommand,
  executeCommand,
  executeQuery,
  getSerial as getSerialQuery,
  getStockCard as getStockCardQuery,
  listHubs as listHubsQuery,
  listStockBalances as listStockBalancesQuery,
  readStockValuation as readStockValuationQuery,
  reverseStock as reverseStockCommand,
  transferStock as transferStockCommand,
  updateBin as updateBinCommand,
  updateHub as updateHubCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for H1's stock screens: parse → request context → command or
// query → DTO. Hubs and bins are the group's, so their commands run in the caller's own request;
// stock commands and reads run in a request narrowed to the company named.

/** A hub or bin command, in the caller's request (the group's data). */
async function groupCommand<T>(
  action: string,
  schema: Schema<unknown>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

/** A stock command, in a request narrowed to its company. */
async function companyCommand<T>(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

export async function createHub(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<HubDto>> {
  return groupCommand('createHub', CreateHubInput, createHubCommand, rawInput, idempotencyKey);
}

export async function updateHub(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<HubDto>> {
  return groupCommand('updateHub', UpdateHubInput, updateHubCommand, rawInput, idempotencyKey);
}

export async function archiveHub(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<HubDto>> {
  return groupCommand('archiveHub', ArchiveHubInput, archiveHubCommand, rawInput, idempotencyKey);
}

export async function createBin(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<BinDto>> {
  return groupCommand('createBin', CreateBinInput, createBinCommand, rawInput, idempotencyKey);
}

export async function updateBin(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<BinDto>> {
  return groupCommand('updateBin', UpdateBinInput, updateBinCommand, rawInput, idempotencyKey);
}

export async function archiveBin(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<BinDto>> {
  return groupCommand('archiveBin', ArchiveBinInput, archiveBinCommand, rawInput, idempotencyKey);
}

/** Move stock between two bins of one hub. */
export async function transferStock(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockMovedDto>> {
  return companyCommand(
    'transferStock',
    TransferStockInput,
    transferStockCommand,
    rawInput,
    idempotencyKey,
  );
}

/** A gain, loss or damage in one bin, with why. */
export async function adjustStock(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockMovedDto>> {
  return companyCommand(
    'adjustStock',
    AdjustStockInput,
    adjustStockCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Undo a movement made in error, within the reversal window. */
export async function reverseStock(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockMovedDto>> {
  return companyCommand(
    'reverseStock',
    ReverseStockInput,
    reverseStockCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Every hub with its bins, for the stock screens and `/inventory/hubs`. */
export async function listHubs(rawInput: unknown): Promise<ActionResult<HubListDto>> {
  return toResult('listHubs', async () => {
    const principal = await signedIn();
    const input = parseInput(ListHubsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listHubsQuery(context, input), {
      name: 'listHubs',
    });
  });
}

/** One company's balances, by hub, bin and item. */
export async function listStockBalances(
  rawInput: unknown,
): Promise<ActionResult<StockBalancePageDto>> {
  return toResult('listStockBalances', async () => {
    const principal = await signedIn();
    const input = parseInput(ListStockBalancesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listStockBalancesQuery(context, input),
      { name: 'listStockBalances' },
    );
  });
}

/** An item's stock card in one company. */
export async function getStockCard(rawInput: unknown): Promise<ActionResult<StockCardDto>> {
  return toResult('getStockCard', async () => {
    const principal = await signedIn();
    const input = parseInput(GetStockCardInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getStockCardQuery(context, input),
      { name: 'getStockCard' },
    );
  });
}

/** A serial and its history. */
export async function getSerial(rawInput: unknown): Promise<ActionResult<SerialDto>> {
  return toResult('getSerial', async () => {
    const principal = await signedIn();
    const input = parseInput(GetSerialInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getSerialQuery(context, input),
      { name: 'getSerial' },
    );
  });
}

/** The stock valuation at a date (`finance.cost.read`). */
export async function readStockValuation(
  rawInput: unknown,
): Promise<ActionResult<StockValuationDto>> {
  return toResult('readStockValuation', async () => {
    const principal = await signedIn();
    const input = parseInput(ReadStockValuationInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => readStockValuationQuery(context, input),
      { name: 'readStockValuation' },
    );
  });
}
