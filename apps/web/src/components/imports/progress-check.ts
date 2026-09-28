import type { ImportJobDto } from '@shakti/contracts';
import type { ActionResult } from '../../actions/result';
import { settle } from '../screens/settle';

/** What one look at a committing import found. */
export type ProgressCheck =
  | { kind: 'moving'; job: ImportJobDto }
  | { kind: 'finished'; job: ImportJobDto }
  | { kind: 'failed'; error: string; reference?: string | undefined };

/**
 * One look at how far adding has come, for the progress panel's loop: the job while it is still
 * committing, the job once it has moved on, or the failure to show when the answer was a failure
 * or never arrived (`settle`). The loop stops on anything but `moving`.
 */
export async function checkProgress(
  read: () => Promise<ActionResult<ImportJobDto>>,
): Promise<ProgressCheck> {
  const result = await settle(read);
  if (!result.ok) return { kind: 'failed', error: result.error, reference: result.reference };
  return result.data.state === 'committing'
    ? { kind: 'moving', job: result.data }
    : { kind: 'finished', job: result.data };
}
