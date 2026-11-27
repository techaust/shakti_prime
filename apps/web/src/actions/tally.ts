'use server';

// TC2 Admin › Integrations › Tally and Tally checks (docs/03-roadmap-appendix/phase5.md §6.3).
// Thin wrappers (docs/06-api.md §4): parse → request context → command or query → DTO. A
// connector's key is made here, sealed by the command, and answered once, for the Executive to
// type into the connector's setup on the office computer; it is never stored in the clear.

import {
  MapTallyCompanyInput,
  RegisterTallyConnectorRequest,
  RotateTallyConnectorRequest,
  TallyConnectorIdInput,
  TallySnapshotConfirmInput,
  UnmapTallyCompanyInput,
  type HeldTallySnapshotDto,
  type TallyConnectorDto,
  type TallySnapshotConfirmDto,
} from '@shakti/contracts';
import {
  confirmTallySnapshot as confirmTallySnapshotCommand,
  executeCommand,
  executeQuery,
  listHeldTallySnapshots as listHeldTallySnapshotsQuery,
  listTallyConnectors as listTallyConnectorsQuery,
  mapTallyCompany as mapTallyCompanyCommand,
  newConnectorKey,
  registerTallyConnector as registerTallyConnectorCommand,
  retireTallyConnectorKey as retireTallyConnectorKeyCommand,
  revokeTallyConnector as revokeTallyConnectorCommand,
  rotateTallyConnectorKey as rotateTallyConnectorKeyCommand,
  unmapTallyCompany as unmapTallyCompanyCommand,
} from '@shakti/domain';
import { fieldCipher } from '../crypto/kms-cipher';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** A connector with the key made for it, shown once. */
export interface TallyConnectorWithKey {
  connector: TallyConnectorDto;
  key: string;
}

/** Every connector, with the companies of the caller's request mapped to it. */
export async function listTallyConnectors(): Promise<ActionResult<TallyConnectorDto[]>> {
  return toResult('listTallyConnectors', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: principal.entityIds, requestId },
      (ctx) => listTallyConnectorsQuery(ctx),
      { name: 'listTallyConnectors' },
    );
  });
}

/** Registers a connector: its key is made here and answered once. */
export async function registerTallyConnector(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallyConnectorWithKey>> {
  return toResult('registerTallyConnector', async () => {
    const principal = await signedIn();
    const input = parseInput(RegisterTallyConnectorRequest, rawInput);
    const meta = await requestMeta();
    const made = newConnectorKey();
    const cipher = fieldCipher();
    const connector = await executeCommand(
      principal,
      { entityIds: principal.entityIds, requestId: meta.requestId },
      registerTallyConnectorCommand,
      { name: input.name, key: made.key },
      {
        ...commandOptions(meta, idempotencyKey),
        ...(cipher === undefined ? {} : { fieldCipher: cipher }),
      },
    );
    return { connector, key: made.key };
  });
}

/** Makes the connector a new key, valid beside the current one until that is retired. */
export async function rotateTallyConnectorKey(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallyConnectorWithKey>> {
  return toResult('rotateTallyConnectorKey', async () => {
    const principal = await signedIn();
    const input = parseInput(RotateTallyConnectorRequest, rawInput);
    const meta = await requestMeta();
    const made = newConnectorKey();
    const cipher = fieldCipher();
    const connector = await executeCommand(
      principal,
      { entityIds: principal.entityIds, requestId: meta.requestId },
      rotateTallyConnectorKeyCommand,
      { connectorId: input.connectorId, key: made.key },
      {
        ...commandOptions(meta, idempotencyKey),
        ...(cipher === undefined ? {} : { fieldCipher: cipher }),
      },
    );
    return { connector, key: made.key };
  });
}

export async function mapTallyCompany(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallyConnectorDto>> {
  return toResult('mapTallyCompany', async () => {
    const principal = await signedIn();
    const input = parseInput(MapTallyCompanyInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: principal.entityIds, requestId: meta.requestId },
      mapTallyCompanyCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function unmapTallyCompany(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallyConnectorDto>> {
  return toResult('unmapTallyCompany', async () => {
    const principal = await signedIn();
    const input = parseInput(UnmapTallyCompanyInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: principal.entityIds, requestId: meta.requestId },
      unmapTallyCompanyCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function retireTallyConnectorKey(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallyConnectorDto>> {
  return toResult('retireTallyConnectorKey', async () => {
    const principal = await signedIn();
    const input = parseInput(TallyConnectorIdInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: principal.entityIds, requestId: meta.requestId },
      retireTallyConnectorKeyCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function revokeTallyConnector(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallyConnectorDto>> {
  return toResult('revokeTallyConnector', async () => {
    const principal = await signedIn();
    const input = parseInput(TallyConnectorIdInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: principal.entityIds, requestId: meta.requestId },
      revokeTallyConnectorCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Tally checks: the snapshots of the caller's companies held over their limits. */
export async function listHeldTallySnapshots(): Promise<ActionResult<HeldTallySnapshotDto[]>> {
  return toResult('listHeldTallySnapshots', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: principal.entityIds, requestId },
      (ctx) => listHeldTallySnapshotsQuery(ctx),
      { name: 'listHeldTallySnapshots' },
    );
  });
}

/** Accounts confirm a held snapshot: the records it found gone in Tally are marked removed. */
export async function confirmTallySnapshot(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TallySnapshotConfirmDto>> {
  return toResult('confirmTallySnapshot', async () => {
    const principal = await signedIn();
    const input = parseInput(TallySnapshotConfirmInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      confirmTallySnapshotCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
