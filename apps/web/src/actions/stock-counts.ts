'use server';

import {
  CancelStockCountInput,
  EntityIdSchema,
  GetStockCountInput,
  ListStockCountsInput,
  PostStockCountInput,
  RecordStockCountInput,
  RecountStockCountInput,
  StartStockCountInput,
  SubmitStockCountInput,
  type StockCountDto,
  type StockCountPageDto,
  type StockCountPostedDto,
  type StockCountReviewDto,
  type StockCountSheetDto,
} from '@shakti/contracts';
import {
  cancelStockCount as cancelCommand,
  executeCommand,
  executeQuery,
  getStockCountReview as getReviewQuery,
  getStockCountSheet as getSheetQuery,
  listStockCounts as listQuery,
  postStockCount as postCommand,
  recordStockCount as recordCommand,
  recountStockCount as recountCommand,
  startStockCount as startCommand,
  submitStockCount as submitCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for H3's stock count screens. Every call runs in a request
// narrowed to the count's company, which the screen names beside the input; the commands and
// definers check the count belongs to it. Nothing here carries an expected quantity to a counter:
// the sheet's answer has no field for one, and only the review (`inventory.stock.adjust`) does.

/** The company a count call names beside its input, `{ entityId, ...input }`, split apart. */
function companyAndInput(raw: unknown): { company: unknown; rest: unknown } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { company: undefined, rest: raw };
  }
  const { entityId, ...rest } = raw as Record<string, unknown>;
  return { company: entityId, rest };
}

/** A count command, in a request narrowed to the company named beside its input. */
async function countCommand<T>(
  action: string,
  schema: Schema<unknown>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const { company, rest } = companyAndInput(rawInput);
    const entityId = parseInput(EntityIdSchema, company);
    const input = parseInput(schema, rest);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { entityIds: [entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

/** Start a count of one company's stock in a hub. */
export async function startStockCount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockCountDto>> {
  return toResult('startStockCount', async () => {
    const principal = await signedIn();
    const input = parseInput(StartStockCountInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      startCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** A counter's count of one item in one bin. */
export async function recordStockCount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockCountDto>> {
  return countCommand(
    'recordStockCount',
    RecordStockCountInput,
    recordCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Ask for an item in a bin again. */
export async function recountStockCount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockCountDto>> {
  return countCommand(
    'recountStockCount',
    RecountStockCountInput,
    recountCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Send a count for review. */
export async function submitStockCount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockCountDto>> {
  return countCommand(
    'submitStockCount',
    SubmitStockCountInput,
    submitCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Post a reviewed count: each variance becomes a stock movement. */
export async function postStockCount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockCountPostedDto>> {
  return countCommand(
    'postStockCount',
    PostStockCountInput,
    postCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Cancel a count before it posts. */
export async function cancelStockCount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StockCountDto>> {
  return countCommand(
    'cancelStockCount',
    CancelStockCountInput,
    cancelCommand,
    rawInput,
    idempotencyKey,
  );
}

/** One company's counts, by state. */
export async function listStockCounts(rawInput: unknown): Promise<ActionResult<StockCountPageDto>> {
  return toResult('listStockCounts', async () => {
    const principal = await signedIn();
    const input = parseInput(ListStockCountsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listQuery(context, input),
      { name: 'listStockCounts' },
    );
  });
}

/** The counting screen: bins, items and what was entered, never what the ledger expects. */
export async function getStockCountSheet(
  entityId: unknown,
  rawInput: unknown,
): Promise<ActionResult<StockCountSheetDto>> {
  return toResult('getStockCountSheet', async () => {
    const principal = await signedIn();
    const company = parseInput(EntityIdSchema, entityId);
    const input = parseInput(GetStockCountInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [company], requestId },
      (context) => getSheetQuery(context, input),
      { name: 'getStockCountSheet' },
    );
  });
}

/** The review (`inventory.stock.adjust`): variances, the movements during the count, values. */
export async function getStockCountReview(
  entityId: unknown,
  rawInput: unknown,
): Promise<ActionResult<StockCountReviewDto>> {
  return toResult('getStockCountReview', async () => {
    const principal = await signedIn();
    const company = parseInput(EntityIdSchema, entityId);
    const input = parseInput(GetStockCountInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [company], requestId },
      (context) => getReviewQuery(context, input),
      { name: 'getStockCountReview' },
    );
  });
}
