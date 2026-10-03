'use server';

import {
  LatestSizingInput,
  RecordSizingInput,
  type SizingDto,
  type SizingPumpDto,
  type StaleSizingDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  latestSizing,
  listSizingPumps,
  recordSizing as recordSizingCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Records a pump or rooftop sizing of a lead (docs/design/phase1.md §6.7). The server works out
 * the result from the measurements; the request is narrowed to the lead's company.
 */
export async function recordSizing(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<SizingDto>> {
  return toResult('recordSizing', async () => {
    const principal = await signedIn();
    const input = parseInput(RecordSizingInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      recordSizingCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/**
 * What the sizing panel opens with: the lead's newest pump and rooftop sizings (or that one must
 * be sized again, when an older engine recorded it) and the pumps.
 */
export interface SizingPanelData {
  pump: SizingDto | StaleSizingDto | null;
  rooftop: SizingDto | StaleSizingDto | null;
  pumps: SizingPumpDto[];
}

export async function sizingPanelData(rawInput: unknown): Promise<ActionResult<SizingPanelData>> {
  return toResult('sizingPanelData', async () => {
    const principal = await signedIn();
    const input = parseInput(LatestSizingInput.omit({ kind: true }), rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      async (context) => ({
        pump: await latestSizing(context, { ...input, kind: 'pump' }),
        rooftop: await latestSizing(context, { ...input, kind: 'rooftop' }),
        pumps: await listSizingPumps(context),
      }),
      { name: 'sizingPanelData' },
    );
  });
}
