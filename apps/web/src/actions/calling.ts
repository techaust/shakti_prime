'use server';

import {
  DialNumberInput,
  ListCallQueueInput,
  ListTeamQueuesInput,
  LoadCallLeadInput,
  LogCallInput,
  SearchCallLeadsInput,
  type CallLeadDto,
  type CallQueuePageDto,
  type DialNumberDto,
  type LeadSearchHitDto,
  type LogCallResultDto,
  type TeamQueueDto,
} from '@shakti/contracts';
import {
  dialNumber as dialNumberQuery,
  executeCommand,
  executeQuery,
  listCallQueue as listCallQueueQuery,
  listTeamQueues as listTeamQueuesQuery,
  loadCallLead as loadCallLeadQuery,
  logCall as logCallCommand,
  searchLeads,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, signedInIn, testNow } from './support';

/** The leads the workspace's search shows: a short list the eye takes in. */
const SEARCH_HITS = 8;

/**
 * The Cold Caller workspace (`/calling`, docs/03-roadmap-appendix/phase1.md §7.2): thin wrappers (docs/06-api.md
 * §4) over the calling queries and `calls.log`. A read or a call of one lead is narrowed to the
 * lead's company, so the caller acts with their team there (AUDIT M24).
 */

/** A caller's queue, or a team member's for a team lead, a page at a time. */
export async function listCallQueue(rawInput: unknown): Promise<ActionResult<CallQueuePageDto>> {
  return toResult('listCallQueue', async () => {
    const principal = await signedIn();
    const input = parseInput(ListCallQueueInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => listCallQueueQuery(context, input),
      { name: 'listCallQueue' },
    );
  });
}

/** The lead open in the workspace. */
export async function loadCallLead(rawInput: unknown): Promise<ActionResult<CallLeadDto>> {
  return toResult('loadCallLead', async () => {
    const principal = await signedIn();
    const input = parseInput(LoadCallLeadInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadCallLeadQuery(context, input),
      { name: 'loadCallLead' },
    );
  });
}

/** The number to dial (`D`), only inside calling hours. */
export async function dialNumber(rawInput: unknown): Promise<ActionResult<DialNumberDto>> {
  return toResult('dialNumber', async () => {
    const principal = await signedIn();
    const input = parseInput(DialNumberInput, rawInput);
    const { requestId } = await requestMeta();
    const now = await testNow();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => dialNumberQuery(context, input, now),
      { name: 'dialNumber' },
    );
  });
}

/** The workspace's search (`/`): the caller's leads by name, village or phone. */
export async function searchCallLeads(
  rawInput: unknown,
): Promise<ActionResult<LeadSearchHitDto[]>> {
  return toResult('searchCallLeads', async () => {
    const principal = await signedIn();
    const { q } = parseInput(SearchCallLeadsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => searchLeads(context, { q, limit: SEARCH_HITS }),
      { name: 'searchCallLeads' },
    );
  });
}

/** The team lead's view: each caller of the team and their queue. */
export async function listTeamQueues(rawInput: unknown): Promise<ActionResult<TeamQueueDto[]>> {
  return toResult('listTeamQueues', async () => {
    const input = parseInput(ListTeamQueuesInput, rawInput);
    const principal =
      input.entityId === undefined ? await signedIn() : await signedInIn(input.entityId);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => listTeamQueuesQuery(context, input),
      { name: 'listTeamQueues' },
    );
  });
}

/** `calls.log`: the call the caller just made, with its outcome. */
export async function logCall(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LogCallResultDto>> {
  return toResult('logCall', async () => {
    const principal = await signedIn();
    const input = parseInput(LogCallInput, rawInput);
    const meta = await requestMeta();
    const now = await testNow();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      logCallCommand,
      input,
      { ...commandOptions(meta, idempotencyKey), ...(now === undefined ? {} : { now }) },
    );
  });
}
