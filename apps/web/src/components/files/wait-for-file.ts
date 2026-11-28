'use client';

import { fileStatus } from '../../actions/files';
import { settle } from '../screens/settle';

/** How often a screen asks whether a printed file is ready, and for how long. */
const POLL_MS = 2_000;
const POLL_LIMIT_MS = 90_000;

/**
 * Asks for a file the render worker prints (a proof page, a sheet of labels) until it is ready
 * (`ready`), or `slow` when it has not come within the limit: a page the worker could not print
 * waits as a held update on Integration health, and the person can close the dialog and try again.
 * It stops asking once `stillOpen` says the dialog is closed.
 */
export async function waitForFile(
  fileId: string,
  stillOpen: () => boolean,
): Promise<'ready' | 'slow'> {
  const started = Date.now();
  for (;;) {
    if (!stillOpen()) return 'slow';
    const result = await settle(() => fileStatus(fileId));
    if (result.ok && result.data.status === 'ready') return 'ready';
    if (Date.now() - started >= POLL_LIMIT_MS) return 'slow';
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}
