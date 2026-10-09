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
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** A team lead, the GM or an Executive sets a caller's or a team's target. */
export async function setTarget(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TargetDto>> {
  return toResult('setTarget', async () => {
    const principal = await signedIn();
    const input = parseInput(SetTargetInput, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setTargetCommand,
      input,
      commandOptions(meta, idempotencyKey),
    )) as TargetDto;
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

/** The signed-in person's targets and progress, per company of the request. */
export async function myProgress(): Promise<ActionResult<MyProgressDto[]>> {
  return toResult('myProgress', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => myProgressQuery(context, {}), {
      name: 'myProgress',
    });
  });
}

/** A team lead's team progress and leaderboard for a period. */
export async function teamProgress(rawInput: unknown): Promise<ActionResult<TeamProgressDto[]>> {
  return toResult('teamProgress', async () => {
    const principal = await signedIn();
    const input = parseInput(TeamProgressInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => teamProgressQuery(context, input), {
      name: 'teamProgress',
    });
  });
}
