'use server';

import {
  ArchiveEntityChannelInput,
  DomainError,
  ListEntityChannelsInput,
  ReadBankDetailsInput,
  SetEntityChannelInput,
  type EntityChannelDto,
  RequestPrintProofInput,
  UpdateEntityInput,
  type EntityBankDetailsDto,
  type EntityDto,
  type PrintProofDto,
} from '@shakti/contracts';
import {
  archiveEntityChannel as archiveEntityChannelCommand,
  executeCommand,
  executeQuery,
  listEntityChannels as listEntityChannelsQuery,
  setEntityChannel as setEntityChannelCommand,
  listEntities as listEntitiesQuery,
  readEntityBankDetails,
  requestPrintProof as requestPrintProofCommand,
  updateEntity as updateEntityCommand,
} from '@shakti/domain';
import { fieldCipher } from '../crypto/kms-cipher';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** Thin wrapper (docs/06-api.md §4): parse → request context → command → DTO. No business logic here. */
export async function updateEntity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EntityDto>> {
  return toResult('updateEntity', async () => {
    const principal = await signedIn();
    const input = parseInput(UpdateEntityInput, rawInput);
    const meta = await requestMeta();
    const cipher = fieldCipher();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      updateEntityCommand,
      input,
      {
        ...commandOptions(meta, idempotencyKey),
        ...(cipher === undefined ? {} : { fieldCipher: cipher }),
      },
    );
  });
}

/** Settings › Companies: the companies the caller can see. */
export async function listEntities(): Promise<ActionResult<EntityDto[]>> {
  return toResult('listEntities', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, listEntitiesQuery, { name: 'listEntities' });
  });
}

/**
 * Settings › Companies, Bank account: the company's account in clear, for the Executive changing
 * it (docs/07-security.md §5). Anyone else is refused, by the query and by the database.
 */
export async function readCompanyBankDetails(
  rawInput: unknown,
): Promise<ActionResult<EntityBankDetailsDto>> {
  return toResult('readCompanyBankDetails', async () => {
    const principal = await signedIn();
    const input = parseInput(ReadBankDetailsInput, rawInput);
    const { requestId } = await requestMeta();
    const cipher = fieldCipher();
    if (cipher === undefined) {
      throw new DomainError('integration_unavailable', 'no field cipher on this runtime');
    }
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => readEntityBankDetails(ctx, cipher, input.entityId),
      { name: 'readCompanyBankDetails' },
    );
  });
}

/**
 * Settings › Companies, Print a proof page: the render worker prints the company's letterhead,
 * logo, address, GSTIN and bank account on one page. Without a queue the page is printed before
 * this answers; with one, the screen waits for the proof's file.
 */
export async function requestPrintProof(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PrintProofDto>> {
  return toResult('requestPrintProof', async () => {
    const principal = await signedIn();
    const input = parseInput(RequestPrintProofInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      requestPrintProofCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Settings › Companies › Channels: a company's numbers in use, for the Executive setting them. */
export async function listEntityChannels(
  rawInput: unknown,
): Promise<ActionResult<EntityChannelDto[]>> {
  return toResult('listEntityChannels', async () => {
    const principal = await signedIn();
    const input = parseInput(ListEntityChannelsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => listEntityChannelsQuery(ctx, input),
      { name: 'listEntityChannels' },
    );
  });
}

/** Settings › Companies › Channels: an Executive sets a company's number on one channel. */
export async function setEntityChannel(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EntityChannelDto>> {
  return toResult('setEntityChannel', async () => {
    const principal = await signedIn();
    const input = parseInput(SetEntityChannelInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setEntityChannelCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Settings › Companies › Channels: an Executive takes a company's number out of use. */
export async function archiveEntityChannel(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EntityChannelDto>> {
  return toResult('archiveEntityChannel', async () => {
    const principal = await signedIn();
    const input = parseInput(ArchiveEntityChannelInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      archiveEntityChannelCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
