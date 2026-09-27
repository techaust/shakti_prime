/**
 * Runs once when a server instance starts. A hosted deployment with an unsafe configuration
 * refuses to start here, before it serves anything (AUDIT M8), instead of on the first sign-in.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertProductionConfig, hostedRuntime } = await import('./auth/deps');
  if (hostedRuntime()) assertProductionConfig();
}
