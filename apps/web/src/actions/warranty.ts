'use server';

import {
  GetWarrantyClaimInput,
  IdentifyWarrantySerialInput,
  ListClaimSerialsInput,
  ListWarrantyClaimsInput,
  RaiseWarrantyClaimInput,
  RaiseWarrantyRmaInput,
  RejectWarrantyClaimInput,
  ReplaceWarrantyInput,
  SettleWarrantyClaimInput,
  type ClaimSerialListDto,
  type WarrantyClaimChangedDto,
  type WarrantyClaimCostsDto,
  type WarrantyClaimDto,
  type WarrantyClaimPageDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  getWarrantyClaim as getWarrantyClaimQuery,
  identifyWarrantySerial as identifyWarrantySerialCommand,
  listClaimSerials as listClaimSerialsQuery,
  listWarrantyClaims as listWarrantyClaimsQuery,
  raiseWarrantyClaim as raiseWarrantyClaimCommand,
  raiseWarrantyRma as raiseWarrantyRmaCommand,
  replaceWarranty as replaceWarrantyCommand,
  readWarrantyClaimCosts as readWarrantyClaimCostsQuery,
  rejectWarrantyClaim as rejectWarrantyClaimCommand,
  settleWarrantyClaim as settleWarrantyClaimCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for R3's warranty screens: parse → a request narrowed to the
// claim's company → command or query → DTO. No answer carries a cost but the costs read, which
// asks for finance.cost.read itself.

async function claimCommand(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
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
    )) as WarrantyClaimChangedDto;
  });
}

/** Raise a claim on a customer, or on a serial delivered to one. */
export async function raiseWarrantyClaim(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
  return claimCommand(
    'raiseWarrantyClaim',
    RaiseWarrantyClaimInput,
    raiseWarrantyClaimCommand,
    rawInput,
    idempotencyKey,
  );
}

/** The failed serial, in warranty by its date in India. */
export async function identifyWarrantySerial(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
  return claimCommand(
    'identifyWarrantySerial',
    IdentifyWarrantySerialInput,
    identifyWarrantySerialCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Reject a claim with why. */
export async function rejectWarrantyClaim(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
  return claimCommand(
    'rejectWarrantyClaim',
    RejectWarrantyClaimInput,
    rejectWarrantyClaimCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Give a replacement from stock, and take the failed serial back when it has come. */
export async function replaceWarranty(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
  return claimCommand(
    'replaceWarranty',
    ReplaceWarrantyInput,
    replaceWarrantyCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Send the failed serial to its supplier with their return reference. */
export async function raiseWarrantyRma(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
  return claimCommand(
    'raiseWarrantyRma',
    RaiseWarrantyRmaInput,
    raiseWarrantyRmaCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Close a claim with the supplier's credit. */
export async function settleWarrantyClaim(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<WarrantyClaimChangedDto>> {
  return claimCommand(
    'settleWarrantyClaim',
    SettleWarrantyClaimInput,
    settleWarrantyClaimCommand,
    rawInput,
    idempotencyKey,
  );
}

/** A company's claims, by state. */
export async function listWarrantyClaims(
  rawInput: unknown,
): Promise<ActionResult<WarrantyClaimPageDto>> {
  return toResult('listWarrantyClaims', async () => {
    const principal = await signedIn();
    const input = parseInput(ListWarrantyClaimsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listWarrantyClaimsQuery(context, input),
      { name: 'listWarrantyClaims' },
    );
  });
}

/** One claim's sheet. */
export async function getWarrantyClaim(rawInput: unknown): Promise<ActionResult<WarrantyClaimDto>> {
  return toResult('getWarrantyClaim', async () => {
    const principal = await signedIn();
    const input = parseInput(GetWarrantyClaimInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getWarrantyClaimQuery(context, input),
      { name: 'getWarrantyClaim' },
    );
  });
}

/** The customer's delivered serials, for a claim to identify one. */
export async function listClaimSerials(
  rawInput: unknown,
): Promise<ActionResult<ClaimSerialListDto>> {
  return toResult('listClaimSerials', async () => {
    const principal = await signedIn();
    const input = parseInput(ListClaimSerialsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listClaimSerialsQuery(context, input),
      { name: 'listClaimSerials' },
    );
  });
}

/** A claim's costs (`finance.cost.read`). */
export async function readWarrantyClaimCosts(
  rawInput: unknown,
): Promise<ActionResult<WarrantyClaimCostsDto>> {
  return toResult('readWarrantyClaimCosts', async () => {
    const principal = await signedIn();
    const input = parseInput(GetWarrantyClaimInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => readWarrantyClaimCostsQuery(context, input),
      { name: 'readWarrantyClaimCosts' },
    );
  });
}
