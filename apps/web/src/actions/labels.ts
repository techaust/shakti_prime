'use server';

import {
  PrintLabelsInput,
  ReprintLabelsInput,
  ResolveScannedCodeInput,
  type LabelSheetDto,
  type ScannedCodeDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  printLabels as printLabelsCommand,
  reprintLabels as reprintLabelsCommand,
  resolveScannedCode as resolveScannedCodeQuery,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Q1 labels (docs/03-roadmap-appendix/phase3.md §7.4): a sheet of QR labels asked for in a request
// narrowed to the company named; the render worker prints it, and the screen waits for the
// sheet's file (`fileStatus`, `openFile`). The scan field's `resolve(code)` reads a scanned label
// under the caller's own policies.

async function sheetCommand(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<LabelSheetDto>> {
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
    )) as LabelSheetDto;
  });
}

/** Print labels: serials of the company or the group's bins (a hub's, or one). */
export async function printLabels(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LabelSheetDto>> {
  return sheetCommand(
    'printLabels',
    PrintLabelsInput,
    printLabelsCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Print labels again, with why. */
export async function reprintLabels(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LabelSheetDto>> {
  return sheetCommand(
    'reprintLabels',
    ReprintLabelsInput,
    reprintLabelsCommand,
    rawInput,
    idempotencyKey,
  );
}

/**
 * What a scanned code names: a serial or bin the caller may read, `unknown` or `not_ours`. The
 * scan field (U2) takes it as its `resolve(code)`; nothing is opened for an unknown or foreign code.
 */
export async function resolveScannedCode(rawCode: unknown): Promise<ActionResult<ScannedCodeDto>> {
  return toResult('resolveScannedCode', async () => {
    const principal = await signedIn();
    const input = parseInput(ResolveScannedCodeInput, { code: rawCode });
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => resolveScannedCodeQuery(context, input),
      { name: 'resolveScannedCode' },
    );
  });
}
