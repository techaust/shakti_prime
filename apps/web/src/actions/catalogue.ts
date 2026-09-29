'use server';

import {
  ArchiveItemInput,
  ArchiveKitInput,
  CreateItemInput,
  CreateKitInput,
  ListItemsInput,
  SetPumpCurveInput,
  UpdateItemInput,
  UpdateKitInput,
  type ItemDetailDto,
  type ItemDto,
  type ItemPageDto,
  type KitDetailDto,
  type KitPageDto,
} from '@shakti/contracts';
import {
  archiveItem as archiveItemCommand,
  archiveKit as archiveKitCommand,
  createItem as createItemCommand,
  createKit as createKitCommand,
  executeCommand,
  executeQuery,
  getItem as getItemQuery,
  getKit as getKitQuery,
  listItems as listItemsQuery,
  listKits as listKitsQuery,
  setPumpCurve as setPumpCurveCommand,
  updateItem as updateItemCommand,
  updateKit as updateKitCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

// Thin wrappers (docs/API.md §4): parse → request context → command or query → DTO. The
// catalogue is shared by every company; the commands check `catalogue.write`.

type AnyCommandInput =
  | typeof CreateItemInput
  | typeof UpdateItemInput
  | typeof ArchiveItemInput
  | typeof CreateKitInput
  | typeof UpdateKitInput
  | typeof ArchiveKitInput
  | typeof SetPumpCurveInput;

async function run<T>(
  name: string,
  schema: AnyCommandInput,
  command: Parameters<typeof executeCommand>[2],
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(name, async () => {
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

export async function createItem(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDetailDto>> {
  return run('createItem', CreateItemInput, createItemCommand, rawInput, idempotencyKey);
}

export async function updateItem(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDetailDto>> {
  return run('updateItem', UpdateItemInput, updateItemCommand, rawInput, idempotencyKey);
}

export async function archiveItem(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDto>> {
  return run('archiveItem', ArchiveItemInput, archiveItemCommand, rawInput, idempotencyKey);
}

export async function setPumpCurve(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDetailDto>> {
  return run('setPumpCurve', SetPumpCurveInput, setPumpCurveCommand, rawInput, idempotencyKey);
}

export async function createKit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KitDetailDto>> {
  return run('createKit', CreateKitInput, createKitCommand, rawInput, idempotencyKey);
}

export async function updateKit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KitDetailDto>> {
  return run('updateKit', UpdateKitInput, updateKitCommand, rawInput, idempotencyKey);
}

export async function archiveKit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KitDetailDto>> {
  return run('archiveKit', ArchiveKitInput, archiveKitCommand, rawInput, idempotencyKey);
}

/** Catalogue › Items: a page of the catalogue, sorted and filtered on the server. */
export async function listItems(rawInput: unknown): Promise<ActionResult<ItemPageDto>> {
  return toResult('listItems', async () => {
    const principal = await signedIn();
    const input = parseInput(ListItemsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listItemsQuery(context, input), {
      name: 'listItems',
    });
  });
}

/** Catalogue › Kits: a page of kits. */
export async function listKits(rawInput: unknown): Promise<ActionResult<KitPageDto>> {
  return toResult('listKits', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listKitsQuery(context, rawInput), {
      name: 'listKits',
    });
  });
}

/** The item sheet. */
export async function getItem(rawInput: unknown): Promise<ActionResult<ItemDetailDto>> {
  return toResult('getItem', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => getItemQuery(context, rawInput), {
      name: 'getItem',
    });
  });
}

/** The kit sheet. */
export async function getKit(rawInput: unknown): Promise<ActionResult<KitDetailDto>> {
  return toResult('getKit', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => getKitQuery(context, rawInput), {
      name: 'getKit',
    });
  });
}
