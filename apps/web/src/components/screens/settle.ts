import type { ActionResult } from '../../actions/result';

/**
 * Waits for a server action's answer. An action never throws (it answers an `ActionResult`), so a
 * rejected call means the answer never arrived: the connection dropped, or the deployment changed
 * under an open page. That is shown as the catalogue's `internal` sentence in place of the
 * screen's error boundary, and the person can try again.
 */
export async function settle<T>(call: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: 'internal' };
  }
}
