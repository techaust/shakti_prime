'use server';

import {
  ArchiveStageInput,
  ConfigScopeInput,
  CreateStageInput,
  ListReferralPartnersInput,
  ReorderStagesInput,
  SetCommissionRuleInput,
  SetDispositionsInput,
  SetReferralPartnerInput,
  SetScoreRulesInput,
  UpdatePipelineInput,
  UpdateStageInput,
  type CommissionRuleDto,
  type CommissionRuleRowDto,
  type DispositionListDto,
  type LeadSourceDto,
  type PipelineSettingsDto,
  type PipelineSettingsViewDto,
  type ReferralPartnerDto,
  type ReferralPartnerPageDto,
  type ReferralPartnerRowDto,
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
  listCodedReferralPartners as listCodedReferralPartnersQuery,
  listCommissionRules as listCommissionRulesQuery,
  listDispositions as listDispositionsQuery,
  listLeadSources,
  listPipelineSettings,
  listReferralPartners as listReferralPartnersQuery,
  listScoreRules as listScoreRulesQuery,
  reorderStages as reorderStagesCommand,
  setCommissionRule as setCommissionRuleCommand,
  setDispositions as setDispositionsCommand,
  setReferralPartner as setReferralPartnerCommand,
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

/** One page of the referral partners, by name. */
export async function listReferralPartners(
  rawInput: unknown,
): Promise<ActionResult<ReferralPartnerPageDto>> {
  return toResult('listReferralPartners', async () => {
    const principal = await signedIn();
    const input = parseInput(ListReferralPartnersInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listReferralPartnersQuery(context, input),
      { name: 'listReferralPartners' },
    );
  });
}

/** Every referral partner with a code, for the commission form. */
export async function listCodedReferralPartners(): Promise<ActionResult<ReferralPartnerRowDto[]>> {
  return toResult('listCodedReferralPartners', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listCodedReferralPartnersQuery(context),
      { name: 'listCodedReferralPartners' },
    );
  });
}

/** The live commission rules, the default's and each partner's. */
export async function listCommissionRules(): Promise<ActionResult<CommissionRuleRowDto[]>> {
  return toResult('listCommissionRules', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listCommissionRulesQuery(context), {
      name: 'listCommissionRules',
    });
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

export async function setReferralPartner(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReferralPartnerDto>> {
  return settingsCommand(
    'setReferralPartner',
    SetReferralPartnerInput,
    setReferralPartnerCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function setCommissionRule(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CommissionRuleDto>> {
  return settingsCommand(
    'setCommissionRule',
    SetCommissionRuleInput,
    setCommissionRuleCommand,
    rawInput,
    idempotencyKey,
  );
}
