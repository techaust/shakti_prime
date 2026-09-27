'use server';

import {
  CreateLeadInput,
  ListLeadsInput,
  type LeadDto,
  type LeadSourceDto,
  type PipelineDto,
} from '@shakti/contracts';
import {
  createLead as createLeadCommand,
  executeCommand,
  executeQuery,
  listLeadSources,
  listLeads as listLeadsQuery,
  listPipelines,
  type LeadPage,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

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

/** Leads the caller can see, newest change first; the next page after `cursor`. */
export async function listLeads(rawInput: unknown): Promise<ActionResult<LeadPage>> {
  return toResult('listLeads', async () => {
    const principal = await signedIn();
    const input = parseInput(ListLeadsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) =>
      listLeadsQuery(
        context,
        input.cursor === undefined
          ? { limit: input.limit }
          : { limit: input.limit, cursor: input.cursor },
      ),
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
    return executeQuery(principal, { requestId }, async (context) => ({
      pipelines: await listPipelines(context),
      sources: await listLeadSources(context),
    }));
  });
}
