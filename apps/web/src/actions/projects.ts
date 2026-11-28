'use server';

import {
  AccountProjectsInput,
  AssignProjectInput,
  CompleteMilestoneInput,
  CreateProjectInput,
  GetProjectInput,
  ListProjectsInput,
  OrderProjectInput,
  ProjectFiltersInput,
  ProjectPeopleInput,
  ProjectReasonInput,
  ProjectRefInput,
  ProjectTemplatesInput,
  PublishProjectTemplateInput,
  type OrderProjectDto,
  type ProjectDto,
  type ProjectFiltersDto,
  type ProjectPageDto,
  type ProjectPeopleDto,
  type ProjectRowDto,
  type ProjectTemplateDto,
  type ProjectTemplatesDto,
  type ProjectViewDto,
} from '@shakti/contracts';
import {
  accountProjects as accountProjectsQuery,
  assignProject as assignProjectCommand,
  cancelProject as cancelProjectCommand,
  completeMilestone as completeMilestoneCommand,
  completeProject as completeProjectCommand,
  createProject as createProjectCommand,
  executeCommand,
  executeQuery,
  getProject as getProjectQuery,
  holdProject as holdProjectCommand,
  listProjectFilters as listProjectFiltersQuery,
  listProjectPeople as listProjectPeopleQuery,
  listProjects as listProjectsQuery,
  listProjectTemplates as listProjectTemplatesQuery,
  orderProject as orderProjectQuery,
  publishProjectTemplate as publishProjectTemplateCommand,
  resumeProject as resumeProjectCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for J1's project screens: parse → request context → command or
// query → DTO, each in a request narrowed to the company the input names.

async function companyCommand<T>(
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

export async function listProjects(rawInput: unknown): Promise<ActionResult<ProjectPageDto>> {
  return toResult('listProjects', async () => {
    const principal = await signedIn();
    const input = parseInput(ListProjectsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listProjectsQuery(context, input),
      { name: 'listProjects' },
    );
  });
}

export async function listProjectFilters(
  rawInput: unknown,
): Promise<ActionResult<ProjectFiltersDto>> {
  return toResult('listProjectFilters', async () => {
    const principal = await signedIn();
    const input = parseInput(ProjectFiltersInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listProjectFiltersQuery(context, input),
      { name: 'listProjectFilters' },
    );
  });
}

export async function getProject(rawInput: unknown): Promise<ActionResult<ProjectViewDto>> {
  return toResult('getProject', async () => {
    const principal = await signedIn();
    const input = parseInput(GetProjectInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getProjectQuery(context, input),
      { name: 'getProject' },
    );
  });
}

export async function accountProjects(rawInput: unknown): Promise<ActionResult<ProjectRowDto[]>> {
  return toResult('accountProjects', async () => {
    const principal = await signedIn();
    const input = parseInput(AccountProjectsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => accountProjectsQuery(context, input),
      { name: 'accountProjects' },
    );
  });
}

export async function orderProject(rawInput: unknown): Promise<ActionResult<OrderProjectDto>> {
  return toResult('orderProject', async () => {
    const principal = await signedIn();
    const input = parseInput(OrderProjectInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => orderProjectQuery(context, input),
      { name: 'orderProject' },
    );
  });
}

export async function listProjectTemplates(
  rawInput: unknown,
): Promise<ActionResult<ProjectTemplatesDto>> {
  return toResult('listProjectTemplates', async () => {
    const principal = await signedIn();
    const input = parseInput(ProjectTemplatesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listProjectTemplatesQuery(context, input),
      { name: 'listProjectTemplates' },
    );
  });
}

export async function listProjectPeople(
  rawInput: unknown,
): Promise<ActionResult<ProjectPeopleDto>> {
  return toResult('listProjectPeople', async () => {
    const principal = await signedIn();
    const input = parseInput(ProjectPeopleInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listProjectPeopleQuery(context, input),
      { name: 'listProjectPeople' },
    );
  });
}

export async function createProject(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'createProject',
    CreateProjectInput,
    createProjectCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function completeMilestone(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'completeMilestone',
    CompleteMilestoneInput,
    completeMilestoneCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function holdProject(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'holdProject',
    ProjectReasonInput,
    holdProjectCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function resumeProject(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'resumeProject',
    ProjectRefInput,
    resumeProjectCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function completeProject(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'completeProject',
    ProjectRefInput,
    completeProjectCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function cancelProject(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'cancelProject',
    ProjectReasonInput,
    cancelProjectCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function assignProject(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectDto>> {
  return companyCommand(
    'assignProject',
    AssignProjectInput,
    assignProjectCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function publishProjectTemplate(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProjectTemplateDto>> {
  return companyCommand(
    'publishProjectTemplate',
    PublishProjectTemplateInput,
    publishProjectTemplateCommand,
    rawInput,
    idempotencyKey,
  );
}
