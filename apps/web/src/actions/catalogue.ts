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
  checkPermission,
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

export async function createItem(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDetailDto>> {
  return toResult('createItem', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateItemInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      createItemCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function updateItem(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDetailDto>> {
  return toResult('updateItem', async () => {
    const principal = await signedIn();
    const input = parseInput(UpdateItemInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      updateItemCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function archiveItem(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDto>> {
  return toResult('archiveItem', async () => {
    const principal = await signedIn();
    const input = parseInput(ArchiveItemInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      archiveItemCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function setPumpCurve(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemDetailDto>> {
  return toResult('setPumpCurve', async () => {
    const principal = await signedIn();
    const input = parseInput(SetPumpCurveInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setPumpCurveCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function createKit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KitDetailDto>> {
  return toResult('createKit', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateKitInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      createKitCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function updateKit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KitDetailDto>> {
  return toResult('updateKit', async () => {
    const principal = await signedIn();
    const input = parseInput(UpdateKitInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      updateKitCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function archiveKit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<KitDetailDto>> {
  return toResult('archiveKit', async () => {
    const principal = await signedIn();
    const input = parseInput(ArchiveKitInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      archiveKitCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Catalogue › Items: a page of the catalogue, sorted and filtered on the server. */
export async function listItems(rawInput: unknown): Promise<ActionResult<ItemPageDto>> {
  return toResult('listItems', async () => {
    const principal = await signedIn();
    // The catalogue screen opens with pricing.read; its reads ask for the same (docs/SECURITY.md §3.2).
    checkPermission(principal, 'pricing.read', 'entity');
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
    // The catalogue screen opens with pricing.read; its reads ask for the same (docs/SECURITY.md §3.2).
    checkPermission(principal, 'pricing.read', 'entity');
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
    // The catalogue screen opens with pricing.read; its reads ask for the same (docs/SECURITY.md §3.2).
    checkPermission(principal, 'pricing.read', 'entity');
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
    // The catalogue screen opens with pricing.read; its reads ask for the same (docs/SECURITY.md §3.2).
    checkPermission(principal, 'pricing.read', 'entity');
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => getKitQuery(context, rawInput), {
      name: 'getKit',
    });
  });
}
