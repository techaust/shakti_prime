'use server';

// The handover of qualified leads (docs/03-roadmap-appendix/phase1.md §8.2): the Lead converters page, a
// person's own presence, and moving a leaving caller's leads.

import {
  CallerCompanyInput,
  ReassignAllInput,
  SetCallerProfileInput,
  SetPresenceInput,
  type CallerPresence,
  type CallerProfileDto,
  type CallerProfilePersonDto,
  type ReassignAllDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  listCallerProfiles as listQuery,
  loadOwnPresence as presenceQuery,
  reassignAllLeads as reassignCommand,
  setCallerProfile as setProfileCommand,
  setPresence as setPresenceCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

async function change<T>(
  action: string,
  schema: Schema<unknown>,
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
      { requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

/** The people one company's manager sets up, each with their profile. */
export async function listCallerProfiles(
  rawInput: unknown,
): Promise<ActionResult<CallerProfilePersonDto[]>> {
  return toResult('listCallerProfiles', async () => {
    const principal = await signedIn();
    const input = parseInput(CallerCompanyInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listQuery(context, input), {
      name: 'listCallerProfiles',
    });
  });
}

/** The caller's own presence in one company. */
export async function ownPresence(rawInput: unknown): Promise<ActionResult<CallerPresence>> {
  return toResult('ownPresence', async () => {
    const principal = await signedIn();
    const input = parseInput(CallerCompanyInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => presenceQuery(context, input), {
      name: 'ownPresence',
    });
  });
}

/** Saves a person's part in the handover: converter or not, their cap, languages and business lines. */
export async function saveCallerProfile(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CallerProfileDto>> {
  return change(
    'saveCallerProfile',
    SetCallerProfileInput,
    setProfileCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Sets the caller's own presence in one company. */
export async function savePresence(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CallerProfileDto>> {
  return change('savePresence', SetPresenceInput, setPresenceCommand, rawInput, idempotencyKey);
}

/** Moves every open and nurtured lead of a leaving caller to one person, or in turn to converters. */
export async function reassignAllLeads(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReassignAllDto>> {
  return change('reassignAllLeads', ReassignAllInput, reassignCommand, rawInput, idempotencyKey);
}
