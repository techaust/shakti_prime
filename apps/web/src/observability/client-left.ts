/**
 * The errors a page's render ends with when the browser goes away while it loads: React's own
 * when the response stream closes under it, and Next's `ResponseAborted` when Next sees the close
 * first. Neither is a fault of the app, so they are logged below error level and never reported.
 */
const CLIENT_LEFT_MESSAGE = 'The destination stream closed early.';
const CLIENT_LEFT_NAME = 'ResponseAborted';

/** How deep a chain of causes is followed. */
const MAX_CAUSES = 5;

/**
 * Whether `error`, or an error it was raised from (`cause`), is only the browser leaving: every
 * other error, a stream error with another message among them, is the app's and stays an error.
 */
export function clientLeft(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSES; depth += 1) {
    if (!(current instanceof Error)) return false;
    if (current.name === CLIENT_LEFT_NAME || current.message === CLIENT_LEFT_MESSAGE) return true;
    current = current.cause;
  }
  return false;
}
