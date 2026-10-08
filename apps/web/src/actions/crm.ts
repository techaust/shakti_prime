'use server';

import {
  AddNoteInput,
  ArchiveTagInput,
  AssignOpportunityInput,
  CancelTaskInput,
  CompleteTaskInput,
  CreateLeadInput,
  CreateTagInput,
  CreateTaskInput,
  DomainError,
  type RoutedEnquiryDto,
  LeadTagInput,
  ListCustomersInput,
  ListMyTasksInput,
  ListTimelineInput,
  LoadAccount360Input,
  RecordConsentInput,
  RescheduleTaskInput,
  UpdateAccountInput,
  UpdateContactInput,
  UpsertSiteInput,
  WithdrawConsentInput,
  type Account360Dto,
  type CreateLeadResultDto,
  type ConsentDto,
  type CustomerChangeDto,
  type CustomerPageDto,
  type LeadTagDto,
  type MyTaskPageDto,
  type NoteDto,
  type TagDto,
  type TaskDto,
  type TimelinePageDto,
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
  type LeadSourceDto,
  type OpportunityDto,
  type PipelineDto,
} from '@shakti/contracts';
import {
  addNote as addNoteCommand,
  archiveTag as archiveTagCommand,
  cancelTask as cancelTaskCommand,
  completeTask as completeTaskCommand,
  createTag as createTagCommand,
  createTask as createTaskCommand,
  listCustomers as listCustomersQuery,
  listMyTasks as listMyTasksQuery,
  listTimeline as listTimelineQuery,
  loadAccount360 as loadAccount360Query,
  recordConsent as recordConsentCommand,
  rescheduleTask as rescheduleTaskCommand,
  tagLead as tagLeadCommand,
  untagLead as untagLeadCommand,
  updateAccount as updateAccountCommand,
  updateContact as updateContactCommand,
  upsertSite as upsertSiteCommand,
  withdrawConsent as withdrawConsentCommand,
  assignOpportunity as assignOpportunityCommand,
  createLead as createLeadCommand,
  routeEnquiry as routeEnquiryCommand,
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
 * Thin wrapper (docs/06-api.md §4): parse → request context → command → DTO. The request is
 * narrowed to the company the lead is for, so a person viewing All companies acts with their
 * team in that company (AUDIT M24, `withRequestContext`).
 */
export async function createLead(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CreateLeadResultDto>> {
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

/**
 * The lead and walk-in forms' save: `createLead`, except that a lead refused because a colleague
 * looks after the customer in the company (`customer_held_by_colleague`) is passed to that
 * colleague (PRD RPT-04 criterion 2). The refusal rolled its transaction back, so
 * `crm.enquiry.route` runs in a fresh one, and the form says, by name, who the enquiry went to
 * (`outcome: 'routed'`). An import row is still refused, as it was.
 */
export async function takeEnquiry(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CreateLeadResultDto | RoutedEnquiryDto>> {
  return toResult('takeEnquiry', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateLeadInput, rawInput);
    const meta = await requestMeta();
    const scope = { entityIds: [input.entityId], requestId: meta.requestId };
    try {
      return await executeCommand(
        principal,
        scope,
        createLeadCommand,
        input,
        commandOptions(meta, idempotencyKey),
      );
    } catch (error) {
      if (!heldByColleague(error)) throw error;
      return executeCommand(
        principal,
        scope,
        routeEnquiryCommand,
        input.existingAccountId === undefined
          ? {
              entityId: input.entityId,
              pipelineKey: input.pipelineKey,
              phone: input.contact?.phone,
            }
          : {
              entityId: input.entityId,
              pipelineKey: input.pipelineKey,
              existingAccountId: input.existingAccountId,
            },
        commandOptions(meta, idempotencyKey),
      );
    }
  });
}

/** The refusal of a lead for a customer a colleague looks after in the company. */
function heldByColleague(error: unknown): boolean {
  return (
    error instanceof DomainError &&
    error.code === 'conflict' &&
    error.details?.reason === 'customer_held_by_colleague'
  );
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
 * The leads board of one pipeline (docs/08-design-system.md §6). A board for one company is read with the
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

/**
 * A change made from Account 360 or the customers list: the request is narrowed to the company
 * the change is for, as the lead actions are, and the form's idempotency key goes with it.
 */
async function companyAction<T>(
  action: string,
  schema: Schema<{ entityId: number }>,
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
      { entityIds: [input.entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

/** The customers the caller reads in the companies being viewed, by name, a page at a time. */
export async function listCustomers(rawInput: unknown): Promise<ActionResult<CustomerPageDto>> {
  return toResult('listCustomers', async () => {
    const principal = await signedIn();
    const input = parseInput(ListCustomersInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listCustomersQuery(context, input), {
      name: 'listCustomers',
    });
  });
}

/** Account 360: one customer as a company of the request deals with them. */
export async function loadAccount360(rawInput: unknown): Promise<ActionResult<Account360Dto>> {
  return toResult('loadAccount360', async () => {
    const principal = await signedIn();
    const input = parseInput(LoadAccount360Input, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => loadAccount360Query(context, input),
      {
        name: 'loadAccount360',
      },
    );
  });
}

/** The next page of a customer's timeline in one company, or of one lead's. */
export async function listTimeline(rawInput: unknown): Promise<ActionResult<TimelinePageDto>> {
  return toResult('listTimeline', async () => {
    const principal = await signedIn();
    const input = parseInput(ListTimelineInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listTimelineQuery(context, input),
      { name: 'listTimeline' },
    );
  });
}

/** The caller's open tasks, soonest due first. */
export async function listMyTasks(rawInput: unknown): Promise<ActionResult<MyTaskPageDto>> {
  return toResult('listMyTasks', async () => {
    const principal = await signedIn();
    const input = parseInput(ListMyTasksInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listMyTasksQuery(context, input), {
      name: 'listMyTasks',
    });
  });
}

/** Adds a callback, follow-up, nurture or review task on a lead. */
export async function createTask(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TaskDto>> {
  return companyAction('createTask', CreateTaskInput, createTaskCommand, rawInput, idempotencyKey);
}

/** Marks an open task done. */
export async function completeTask(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TaskDto>> {
  return companyAction(
    'completeTask',
    CompleteTaskInput,
    completeTaskCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Moves an open task to another time. */
export async function rescheduleTask(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TaskDto>> {
  return companyAction(
    'rescheduleTask',
    RescheduleTaskInput,
    rescheduleTaskCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Cancels an open task. */
export async function cancelTask(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TaskDto>> {
  return companyAction('cancelTask', CancelTaskInput, cancelTaskCommand, rawInput, idempotencyKey);
}

/** Makes a tag for one company, or for the whole group in All companies mode. */
export async function createTag(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TagDto>> {
  return toResult('createTag', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateTagInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      input.entityId === null
        ? { requestId: meta.requestId }
        : { entityIds: [input.entityId], requestId: meta.requestId },
      createTagCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Takes a tag off the list of tags to choose; the leads that carry it keep it. */
export async function archiveTag(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TagDto>> {
  return toResult('archiveTag', async () => {
    const principal = await signedIn();
    const input = parseInput(ArchiveTagInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      archiveTagCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Puts a tag on a lead. */
export async function tagLead(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeadTagDto>> {
  return companyAction('tagLead', LeadTagInput, tagLeadCommand, rawInput, idempotencyKey);
}

/** Takes a tag off a lead. */
export async function untagLead(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeadTagDto>> {
  return companyAction('untagLead', LeadTagInput, untagLeadCommand, rawInput, idempotencyKey);
}

/** Changes the customer's name, type, GSTIN or billing state code. */
export async function updateAccount(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerChangeDto>> {
  return companyAction(
    'updateAccount',
    UpdateAccountInput,
    updateAccountCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Changes a contact of the customer and their numbers. */
export async function updateContact(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerChangeDto>> {
  return companyAction(
    'updateContact',
    UpdateContactInput,
    updateContactCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Adds a site of the customer, or changes one. */
export async function upsertSite(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerChangeDto>> {
  return companyAction('upsertSite', UpsertSiteInput, upsertSiteCommand, rawInput, idempotencyKey);
}

/** Adds a note to the customer's timeline, or to one of their leads. */
export async function addNote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<NoteDto>> {
  return companyAction('addNote', AddNoteInput, addNoteCommand, rawInput, idempotencyKey);
}

/** Records a consent a contact of the customer gave. */
export async function recordConsent(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ConsentDto>> {
  return companyAction(
    'recordConsent',
    RecordConsentInput,
    recordConsentCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Withdraws a consent; a withdrawal stands. */
export async function withdrawConsent(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ConsentDto>> {
  return companyAction(
    'withdrawConsent',
    WithdrawConsentInput,
    withdrawConsentCommand,
    rawInput,
    idempotencyKey,
  );
}
