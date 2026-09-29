'use server';

import {
  ArchiveStageInput,
  ConfigScopeInput,
  CreateStageInput,
  ReorderStagesInput,
  SetDispositionsInput,
  SetScoreRulesInput,
  UpdatePipelineInput,
  UpdateStageInput,
  type DispositionListDto,
  type LeadSourceDto,
  type PipelineSettingsDto,
  type PipelineSettingsViewDto,
  type ScoreRuleDto,
  type ScoreRuleListDto,
  type StageSettingsDto,
  type StageSettingsListDto,
} from '@shakti/contracts';
import {
  archiveStage as archiveStageCommand,
  createStage as createStageCommand,
  executeCommand,
  executeQuery,
  listDispositions as listDispositionsQuery,
  listLeadSources,
  listPipelineSettings,
  listScoreRules as listScoreRulesQuery,
  reorderStages as reorderStagesCommand,
  setDispositions as setDispositionsCommand,
  setScoreRules as setScoreRulesCommand,
  updatePipeline as updatePipelineCommand,
  updateStage as updateStageCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

/**
 * The pipelines settings page (docs/design/phase1.md §6.6). Thin wrappers (docs/API.md §4):
 * parse → request context → command or query → DTO. A group-wide change is made in the request
 * the person is viewing; the command refuses it unless that request acts for every company.
 */

/** The pipelines with their stages, and the lead sources a score rule may name. */
export async function pipelineSettings(): Promise<
  ActionResult<{ pipelines: PipelineSettingsViewDto[]; sources: LeadSourceDto[] }>
> {
  return toResult('pipelineSettings', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      async (context) => ({
        pipelines: await listPipelineSettings(context),
        sources: await listLeadSources(context),
      }),
      { name: 'pipelineSettings' },
    );
  });
}

/** The call outcomes of one scope. */
export async function listDispositions(
  rawInput: unknown,
): Promise<ActionResult<DispositionListDto>> {
  return toResult('listDispositions', async () => {
    const principal = await signedIn();
    const input = parseInput(ConfigScopeInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listDispositionsQuery(context, input),
      {
        name: 'listDispositions',
      },
    );
  });
}

/** The score rules of one scope. */
export async function listScoreRules(rawInput: unknown): Promise<ActionResult<ScoreRuleDto[]>> {
  return toResult('listScoreRules', async () => {
    const principal = await signedIn();
    const input = parseInput(ConfigScopeInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listScoreRulesQuery(context, input),
      {
        name: 'listScoreRules',
      },
    );
  });
}

async function settingsCommand<I, O>(
  action: string,
  schema: Schema<I>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<O>> {
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
    )) as O;
  });
}

export async function updatePipeline(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PipelineSettingsDto>> {
  return settingsCommand(
    'updatePipeline',
    UpdatePipelineInput,
    updatePipelineCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function createStage(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StageSettingsDto>> {
  return settingsCommand(
    'createStage',
    CreateStageInput,
    createStageCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function updateStage(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StageSettingsDto>> {
  return settingsCommand(
    'updateStage',
    UpdateStageInput,
    updateStageCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function reorderStages(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StageSettingsListDto>> {
  return settingsCommand(
    'reorderStages',
    ReorderStagesInput,
    reorderStagesCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function archiveStage(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<StageSettingsDto>> {
  return settingsCommand(
    'archiveStage',
    ArchiveStageInput,
    archiveStageCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function setDispositions(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DispositionListDto>> {
  return settingsCommand(
    'setDispositions',
    SetDispositionsInput,
    setDispositionsCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function setScoreRules(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ScoreRuleListDto>> {
  return settingsCommand(
    'setScoreRules',
    SetScoreRulesInput,
    setScoreRulesCommand,
    rawInput,
    idempotencyKey,
  );
}
