'use server';

import {
  AssignOpportunityInput,
  CreateLeadInput,
  ListBoardLeadsInput,
  ListBoardStageLeadsInput,
  ListLeadAssigneesInput,
  ListLeadsInput,
  LoseOpportunityInput,
  MoveOpportunityStageInput,
  NurtureOpportunityInput,
  ReopenOpportunityInput,
  WinOpportunityInput,
  type BoardStagePageDto,
  type LeadAssigneeDto,
  type LeadBoardDto,
  type LeadDto,
  type LeadSourceDto,
  type OpportunityDto,
  type PipelineDto,
} from '@shakti/contracts';
import {
  assignOpportunity as assignOpportunityCommand,
  createLead as createLeadCommand,
  executeCommand,
  executeQuery,
  listBoardLeads as listBoardLeadsQuery,
  listBoardStageLeads as listBoardStageLeadsQuery,
  listLeadAssignees as listLeadAssigneesQuery,
  listLeadSources,
  listLeads as listLeadsQuery,
  listPipelines,
  loseOpportunity as loseOpportunityCommand,
  moveOpportunityStage as moveOpportunityStageCommand,
  nurtureOpportunity as nurtureOpportunityCommand,
  reopenOpportunity as reopenOpportunityCommand,
  winOpportunity as winOpportunityCommand,
  type AnyCommand,
  type LeadPage,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

/**
 * Thin wrapper (docs/API.md §4): parse → request context → command → DTO. The request is
 * narrowed to the company the lead is for, so a person viewing All companies acts with their
 * team in that company (AUDIT M24, `withRequestContext`).
 */
export async function createLead(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeadDto>> {
  return toResult('createLead', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateLeadInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      createLeadCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Leads the caller can see, newest change first or in `sort`; the next page after `cursor`. */
export async function listLeads(rawInput: unknown): Promise<ActionResult<LeadPage>> {
  return toResult('listLeads', async () => {
    const principal = await signedIn();
    const input = parseInput(ListLeadsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listLeadsQuery(context, input), {
      name: 'listLeads',
    });
  });
}

/**
 * The leads board of one pipeline (DESIGN.md §6). A board for one company is read with the
 * request narrowed to it, so a team lead viewing All companies sees their team there (AUDIT M24).
 */
export async function listBoardLeads(rawInput: unknown): Promise<ActionResult<LeadBoardDto>> {
  return toResult('listBoardLeads', async () => {
    const principal = await signedIn();
    const input = parseInput(ListBoardLeadsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => listBoardLeadsQuery(context, input),
      { name: 'listBoardLeads' },
    );
  });
}

/**
 * The next cards of one stage of the board (its "Load more"), after the cursor the board or the
 * previous page gave, read with the request narrowed to the board's company as the board is.
 */
export async function listBoardStageLeads(
  rawInput: unknown,
): Promise<ActionResult<BoardStagePageDto>> {
  return toResult('listBoardStageLeads', async () => {
    const principal = await signedIn();
    const input = parseInput(ListBoardStageLeadsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => listBoardStageLeadsQuery(context, input),
      { name: 'listBoardStageLeads' },
    );
  });
}

/** The people a lead in one company can be handed to, for the board's Assign dialog. */
export async function listLeadAssignees(
  rawInput: unknown,
): Promise<ActionResult<LeadAssigneeDto[]>> {
  return toResult('listLeadAssignees', async () => {
    const principal = await signedIn();
    const input = parseInput(ListLeadAssigneesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listLeadAssigneesQuery(context, input),
      { name: 'listLeadAssignees' },
    );
  });
}

/** The lead form's choices and the stage names of the leads list. */
export async function leadFormOptions(): Promise<
  ActionResult<{ pipelines: PipelineDto[]; sources: LeadSourceDto[] }>
> {
  return toResult('leadFormOptions', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      async (context) => ({
        pipelines: await listPipelines(context),
        sources: await listLeadSources(context),
      }),
      { name: 'leadFormOptions' },
    );
  });
}

/**
 * One lead's move through the opportunity machine (design §7.2), narrowed to the lead's company
 * like `createLead`. Each form sends its own idempotency key, so a double click moves it once.
 */
async function opportunityAction(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<OpportunityDto>> {
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
    )) as OpportunityDto;
  });
}

/** Moves a lead to another open stage of its pipeline. */
export async function moveOpportunityStage(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<OpportunityDto>> {
  return opportunityAction(
    'moveOpportunityStage',
    MoveOpportunityStageInput,
    moveOpportunityStageCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Hands a lead to a person who works on leads in its company. */
export async function assignOpportunity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<OpportunityDto>> {
  return opportunityAction(
    'assignOpportunity',
    AssignOpportunityInput,
    assignOpportunityCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Parks a lead to follow up later, with the reason. */
export async function nurtureOpportunity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<OpportunityDto>> {
  return opportunityAction(
    'nurtureOpportunity',
    NurtureOpportunityInput,
    nurtureOpportunityCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Opens a parked lead again, or a lost one within the reopen window. */
export async function reopenOpportunity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<OpportunityDto>> {
  return opportunityAction(
    'reopenOpportunity',
    ReopenOpportunityInput,
    reopenOpportunityCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Marks a lead won; refused until quotes and orders exist (Phase 1). */
export async function winOpportunity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<OpportunityDto>> {
  return opportunityAction(
    'winOpportunity',
    WinOpportunityInput,
    winOpportunityCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Closes a lead without a sale, with the reason. */
export async function loseOpportunity(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<OpportunityDto>> {
  return opportunityAction(
    'loseOpportunity',
    LoseOpportunityInput,
    loseOpportunityCommand,
    rawInput,
    idempotencyKey,
  );
}
