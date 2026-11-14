import { commandOptions } from '../actions/support';
import { defaultAuthDeps } from '../auth/deps';
import { verifyTurnstile } from '../auth/turnstile';
import { logger } from '../log';
import type { IngestRouteDeps } from './routes';

/**
 * The ingest routes' real dependencies: the shared store for the per-key minute, Cloudflare's check
 * with the runtime's Turnstile secret (the companies' site widgets are the BOS's own), and the
 * outbox nudge after the lead commits. Without a secret the routes answer
 * `integration_unavailable` (the design's question 13).
 */
export function ingestRouteDeps(): IngestRouteDeps {
  const auth = defaultAuthDeps();
  return {
    keyValue: auth.keyValue,
    enabled: auth.turnstileSecretKey !== '',
    verifyTurnstile: (token, remoteIp) =>
      verifyTurnstile(token, {
        secretKey: auth.turnstileSecretKey,
        remoteIp,
        fetch: auth.fetch,
        logger,
      }),
    options: (meta) => commandOptions(meta),
    now: auth.now,
  };
}
