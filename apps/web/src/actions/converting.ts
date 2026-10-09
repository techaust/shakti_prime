'use server';

import { ConvertingBoardInput, type ConvertingBoardDto } from '@shakti/contracts';
import { executeQuery, loadConvertingBoard as loadConvertingBoardQuery } from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { parseInput, requestMeta, signedIn } from './support';

/**
 * The Lead Converter workspace's board (`/converting`, PRD TEL-03): the converter's open leads with
 * the next-best-action list the rules make from them (docs/06-api.md §4). The calls, sizings and
 * quotes the workspace makes go through the actions of the calling, sizing and quote screens.
 */
export async function loadConvertingBoard(
  rawInput: unknown,
): Promise<ActionResult<ConvertingBoardDto>> {
  return toResult('loadConvertingBoard', async () => {
    const principal = await signedIn();
    const input = parseInput(ConvertingBoardInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => loadConvertingBoardQuery(context, input),
      { name: 'loadConvertingBoard' },
    );
  });
}
