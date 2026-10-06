import { createAiProvider, jsonLogger, vendorTransports, type AiProvider } from '@shakti/domain';
import { defaultAuthDeps } from '../auth/deps';

let provider: AiProvider | undefined;

/**
 * The provider wrapper of the web runtime (ADR 0011): Claude and Voyage when their keys are set,
 * with the shared store for the breaker and the daily spend. Both keys are optional, so a hosted
 * runtime starts without them; until the owner sets one, the wrapper answers unavailable and
 * nothing calls out. Built on first use, so no route module reads a key at import time.
 */
export function aiProvider(): AiProvider {
  provider ??= createAiProvider({
    ...vendorTransports(process.env),
    keyValue: defaultAuthDeps().keyValue,
    logger: jsonLogger(),
  });
  return provider;
}
