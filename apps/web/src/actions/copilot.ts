'use server';

// The Caller Co-pilot's panel and shadow report (docs/03-roadmap-appendix/phase2.md §7.3).

import {
  CopilotPanelInput,
  RequestCopilotBriefInput,
  ShadowReportInput,
  type CopilotPanelDto,
  type CopilotReportDto,
  type RequestCopilotBriefDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  loadCopilotPanel as loadCopilotPanelQuery,
  loadCopilotReport as loadCopilotReportQuery,
  requestCopilotBrief as requestCopilotBriefCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** The Co-pilot panel of one lead the caller reads, in a request for its company. */
export async function loadCopilotPanel(rawInput: unknown): Promise<ActionResult<CopilotPanelDto>> {
  return toResult('loadCopilotPanel', async () => {
    const principal = await signedIn();
    const input = parseInput(CopilotPanelInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadCopilotPanelQuery(context, input),
      { name: 'loadCopilotPanel' },
    );
  });
}

/** Ask the Co-pilot for a brief on a lead the caller reads, at most once an hour per lead. */
export async function requestCopilotBrief(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<RequestCopilotBriefDto>> {
  return toResult('requestCopilotBrief', async () => {
    const principal = await signedIn();
    const input = parseInput(RequestCopilotBriefInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      requestCopilotBriefCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** The Co-pilot's shadow report of one company and period, in a request for that company. */
export async function copilotReport(rawInput: unknown): Promise<ActionResult<CopilotReportDto>> {
  return toResult('copilotReport', async () => {
    const principal = await signedIn();
    const input = parseInput(ShadowReportInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadCopilotReportQuery(context, input),
      { name: 'copilotReport' },
    );
  });
}
