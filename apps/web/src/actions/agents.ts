'use server';

// The Agent Inbox and Admin › Agents (docs/03-roadmap-appendix/phase1.md §7.1).

import {
  EditInboxItemInput,
  InboxItemRefInput,
  ListInboxInput,
  SetAgentConfigInput,
  SetKillSwitchInput,
  ShadowReportInput,
  type AgentConfigDto,
  type AgentSettingsDto,
  type InboxCountDto,
  type InboxDecisionDto,
  type InboxItemDoneDto,
  type InboxPageDto,
  type ShadowReportDto,
} from '@shakti/contracts';
import {
  approveInboxItem as approveCommand,
  completeInboxItem as completeCommand,
  countInbox as countInboxQuery,
  dismissInboxItem as dismissCommand,
  editInboxItem as editCommand,
  executeCommand,
  executeQuery,
  listInbox as listInboxQuery,
  loadAgentSettings as loadAgentSettingsQuery,
  rejectInboxItem as rejectCommand,
  setAgentConfig as setAgentConfigCommand,
  setKillSwitch as setKillSwitchCommand,
  shadowReport as shadowReportQuery,
  type AnyCommand,
} from '@shakti/domain';
import { inboxCountKey, inboxCounts } from './inbox-count-cache';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

/** The caller's open inbox items in the companies being viewed, newest first, a page at a time. */
export async function listInbox(rawInput: unknown): Promise<ActionResult<InboxPageDto>> {
  return toResult('listInbox', async () => {
    const principal = await signedIn();
    const input = parseInput(ListInboxInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listInboxQuery(context, input), {
      name: 'listInbox',
    });
  });
}

/**
 * How many inbox items wait for the caller, for the count in the top bar: reused for a few seconds
 * per person and company scope, since every staff page reads it (`inbox-count-cache.ts`).
 */
export async function inboxCount(): Promise<ActionResult<InboxCountDto>> {
  return toResult('inboxCount', async () => {
    const principal = await signedIn();
    const key = inboxCountKey(principal.id, principal.entityIds);
    const kept = inboxCounts.get(key, Date.now());
    if (kept !== undefined) return { open: kept };
    const { requestId } = await requestMeta();
    const count = await executeQuery(
      principal,
      { requestId },
      (context) => countInboxQuery(context),
      { name: 'inboxCount' },
    );
    inboxCounts.set(key, count.open, Date.now());
    return count;
  });
}

/**
 * A decision on a suggestion, in a request narrowed to its company, so the command it runs acts
 * there as the person who decides.
 */
async function decide(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<InboxDecisionDto>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    const decision = (await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as InboxDecisionDto;
    // The top bar's count is read afresh for the person who decided.
    inboxCounts.forget(principal.id);
    return decision;
  });
}

/** Approve a suggestion that needs approval: it runs as proposed, as the person who approves. */
export async function approveSuggestion(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<InboxDecisionDto>> {
  return decide('approveSuggestion', InboxItemRefInput, approveCommand, rawInput, idempotencyKey);
}

/** Edit and approve: the suggestion runs with the fields the person changed. */
export async function editSuggestion(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<InboxDecisionDto>> {
  return decide('editSuggestion', EditInboxItemInput, editCommand, rawInput, idempotencyKey);
}

/** Reject: nothing runs. */
export async function rejectSuggestion(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<InboxDecisionDto>> {
  return decide('rejectSuggestion', InboxItemRefInput, rejectCommand, rawInput, idempotencyKey);
}

/** Dismiss a suggestion to act on yourself: nothing runs. */
export async function dismissSuggestion(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<InboxDecisionDto>> {
  return decide('dismissSuggestion', InboxItemRefInput, dismissCommand, rawInput, idempotencyKey);
}

/** The agents at the level being viewed: the company chosen, or the group. */
export async function agentSettings(): Promise<ActionResult<AgentSettingsDto>> {
  return toResult('agentSettings', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => loadAgentSettingsQuery(context), {
      name: 'agentSettings',
    });
  });
}

/**
 * The shadow report of one company and period (A1): the Triage agent's shadowed proposals beside
 * what people did, in a request for that company.
 */
export async function shadowReport(rawInput: unknown): Promise<ActionResult<ShadowReportDto>> {
  return toResult('shadowReport', async () => {
    const principal = await signedIn();
    const input = parseInput(ShadowReportInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => shadowReportQuery(context, input),
      { name: 'shadowReport' },
    );
  });
}

/** A setting for one company runs in a request for it; one for the group in one for every company. */
async function setting(
  action: string,
  schema: Schema<{ entityId: number | null }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<AgentConfigDto>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      input.entityId === null
        ? { requestId: meta.requestId }
        : { entityIds: [input.entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as AgentConfigDto;
  });
}

/** An agent's autonomy, for every action type or one, and its daily spend cap. */
export async function setAgentConfig(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<AgentConfigDto>> {
  return setting(
    'setAgentConfig',
    SetAgentConfigInput,
    setAgentConfigCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Stops every agent or one, or lets it run again. */
export async function setKillSwitch(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<AgentConfigDto>> {
  return setting(
    'setKillSwitch',
    SetKillSwitchInput,
    setKillSwitchCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Routed work the person has dealt with leaves their inbox. */
export async function completeRoutedWork(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<InboxItemDoneDto>> {
  return toResult('completeRoutedWork', async () => {
    const principal = await signedIn();
    const input = parseInput(InboxItemRefInput, rawInput);
    const meta = await requestMeta();
    const done = await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      completeCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
    inboxCounts.forget(principal.id);
    return done;
  });
}
