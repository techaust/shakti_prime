'use server';

// The WhatsApp Concierge's draft line and shadow report (docs/03-roadmap-appendix/phase2.md §7.2).
// A draft is sent, edited or discarded through the Agent Inbox's own actions (`agents.ts`).

import {
  ConciergeDraftInput,
  ShadowReportInput,
  ShadowSampleInput,
  type ConciergeDraftDto,
  type ConciergeReportDto,
  type ShadowSampleDto,
} from '@shakti/contracts';
import {
  executeQuery,
  loadConciergeDraft as loadConciergeDraftQuery,
  loadConciergeReport as loadConciergeReportQuery,
  loadConciergeSample as loadConciergeSampleQuery,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { parseInput, requestMeta, signedIn } from './support';

/** The assistant's undecided reply on one chat, in the viewer's own Agent Inbox, if any. */
export async function loadConciergeDraft(
  rawInput: unknown,
): Promise<ActionResult<ConciergeDraftDto>> {
  return toResult('loadConciergeDraft', async () => {
    const principal = await signedIn();
    const input = parseInput(ConciergeDraftInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadConciergeDraftQuery(context, input),
      { name: 'loadConciergeDraft' },
    );
  });
}

/** The Concierge's shadow report of one company and period, in a request for that company. */
export async function conciergeReport(
  rawInput: unknown,
): Promise<ActionResult<ConciergeReportDto>> {
  return toResult('conciergeReport', async () => {
    const principal = await signedIn();
    const input = parseInput(ShadowReportInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadConciergeReportQuery(context, input),
      { name: 'conciergeReport' },
    );
  });
}

/**
 * The Concierge's review sample of one company and period (G2 shadow review pack), in a request for
 * that company: read-only, at most 50 pairs.
 */
export async function conciergeSample(rawInput: unknown): Promise<ActionResult<ShadowSampleDto>> {
  return toResult('conciergeSample', async () => {
    const principal = await signedIn();
    const input = parseInput(ShadowSampleInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadConciergeSampleQuery(context, input),
      { name: 'conciergeSample' },
    );
  });
}
