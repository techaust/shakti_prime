'use server';

import {
  ExtendReservationInput,
  ListItemBackordersInput,
  ListReservationsInput,
  MoveReservationInput,
  PreviewLineAvailabilityInput,
  ReadLineAvailabilityInput,
  ReleaseReservationInput,
  type BackorderListDto,
  type LineAvailabilityDto,
  type ReservationChangedDto,
  type ReservationListDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  extendReservation as extendReservationCommand,
  listItemBackorders as listItemBackordersQuery,
  listReservations as listReservationsQuery,
  moveReservation as moveReservationCommand,
  previewLineAvailability as previewLineAvailabilityQuery,
  readLineAvailability as readLineAvailabilityQuery,
  releaseReservation as releaseReservationCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for H2's availability and reservations: parse → a request
// narrowed to the company named → command or query → DTO. A caller without
// `inventory.stock.read` gets the availability shape with no count.

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

/** A quote's or an order's availability per line. */
export async function getLineAvailability(
  rawInput: unknown,
): Promise<ActionResult<LineAvailabilityDto>> {
  return toResult('getLineAvailability', async () => {
    const principal = await signedIn();
    const input = parseInput(ReadLineAvailabilityInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => readLineAvailabilityQuery(context, input),
      { name: 'getLineAvailability' },
    );
  });
}

/** The quote builder's lines' availability before the quote is made. */
export async function previewLineAvailability(
  rawInput: unknown,
): Promise<ActionResult<LineAvailabilityDto>> {
  return toResult('previewLineAvailability', async () => {
    const principal = await signedIn();
    const input = parseInput(PreviewLineAvailabilityInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => previewLineAvailabilityQuery(context, input),
      { name: 'previewLineAvailability' },
    );
  });
}

/** The active holds of an order or of an item in a company (`inventory.stock.read`). */
export async function listReservations(
  rawInput: unknown,
): Promise<ActionResult<ReservationListDto>> {
  return toResult('listReservations', async () => {
    const principal = await signedIn();
    const input = parseInput(ListReservationsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listReservationsQuery(context, input),
      { name: 'listReservations' },
    );
  });
}

/** An item's backorders in a company, in queue order (`inventory.stock.read`). */
export async function listItemBackorders(
  rawInput: unknown,
): Promise<ActionResult<BackorderListDto>> {
  return toResult('listItemBackorders', async () => {
    const principal = await signedIn();
    const input = parseInput(ListItemBackordersInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listItemBackordersQuery(context, input),
      { name: 'listItemBackorders' },
    );
  });
}

/** Hold a reservation longer, once, with why. */
export async function extendReservation(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReservationChangedDto>> {
  return companyCommand(
    'extendReservation',
    ExtendReservationInput,
    extendReservationCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Free a reservation's stock by hand, with why. */
export async function releaseReservation(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReservationChangedDto>> {
  return companyCommand(
    'releaseReservation',
    ReleaseReservationInput,
    releaseReservationCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Hold the same quantity in another hub instead. */
export async function moveReservation(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReservationChangedDto>> {
  return companyCommand(
    'moveReservation',
    MoveReservationInput,
    moveReservationCommand,
    rawInput,
    idempotencyKey,
  );
}
