'use server';

import { UpdateEntityInput, type EntityDto } from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  listEntities as listEntitiesQuery,
  updateEntity as updateEntityCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. No business logic here. */
export async function updateEntity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<EntityDto>> {
  return toResult('updateEntity', async () => {
    const principal = await signedIn();
    const input = parseInput(UpdateEntityInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      updateEntityCommand,
      input,
      commandOptions(meta, idempotencyKey),
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
