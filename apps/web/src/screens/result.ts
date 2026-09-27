import type { ActionResult } from '../actions/result';
import type { CommandFailure } from '../components/screens/use-command';

/** The first failed answer among a page's reads, as the failure message shows it. */
export function firstFailure(
  ...results: readonly ActionResult<unknown>[]
): CommandFailure | undefined {
  for (const result of results) {
    if (!result.ok) {
      return { error: result.error, reference: result.reference, field: result.field, attempt: 0 };
    }
  }
  return undefined;
}
