'use server';

import {
  SetTargetInput,
  TargetsScreenInput,
  TeamProgressInput,
  type MyProgressDto,
  type TargetDto,
  type TargetsScreenDto,
  type TeamProgressDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  myProgress as myProgressQuery,
  setTarget as setTargetCommand,
  targetsScreen as targetsScreenQuery,
  teamProgress as teamProgressQuery,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, signedInIn } from './support';

/** A team lead, the GM or an Executive sets a caller's or a team's target. */
export async function setTarget(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TargetDto>> {
  return toResult('setTarget', async () => {
    const principal = await signedIn();
    const input = parseInput(SetTargetInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setTargetCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** What the Targets page of one company shows. */
export async function targetsScreen(rawInput: unknown): Promise<ActionResult<TargetsScreenDto>> {
  return toResult('targetsScreen', async () => {
    const principal = await signedIn();
    const input = parseInput(TargetsScreenInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => targetsScreenQuery(context, input),
      { name: 'targetsScreen' },
    );
  });
}

/** The signed-in person's targets and progress in each company given, as they act there. */
export async function myProgress(
  entityIds: readonly number[],
): Promise<ActionResult<MyProgressDto[]>> {
  return toResult('myProgress', async () => {
    const { requestId } = await requestMeta();
    const parts = await Promise.all(
      entityIds.map(async (entityId) => {
        const principal = await signedInIn(entityId);
        return executeQuery(
          principal,
          { entityIds: [entityId], requestId },
          (context) => myProgressQuery(context, {}),
          { name: 'myProgress' },
        );
      }),
    );
    return parts.flat();
  });
}

/**
 * A team lead's team progress and leaderboard for a period. A request for one company acts with
 * the caller's team there (AUDIT M24), which the database's team scope needs to count a team.
 */
export async function teamProgress(rawInput: unknown): Promise<ActionResult<TeamProgressDto[]>> {
  return toResult('teamProgress', async () => {
    const input = parseInput(TeamProgressInput, rawInput);
    const principal =
      input.entityId === undefined ? await signedIn() : await signedInIn(input.entityId);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => teamProgressQuery(context, input),
      { name: 'teamProgress' },
    );
  });
}
