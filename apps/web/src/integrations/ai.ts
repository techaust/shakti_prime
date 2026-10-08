import {
  createAiProvider,
  fakeModelTransport,
  jsonLogger,
  vendorTransports,
  type AiProvider,
} from '@shakti/domain';
import { defaultAuthDeps, hostedRuntime } from '../auth/deps';

let provider: AiProvider | undefined;

/**
 * The provider wrapper of the web runtime (ADR 0011): Claude and Voyage when their keys are set,
 * with the shared store for the breaker and the daily spend. Both keys are optional, so a hosted
 * runtime starts without them; until the owner sets one, the wrapper answers unavailable and
 * nothing calls out. Built on first use, so no route module reads a key at import time.
 */
export function aiProvider(): AiProvider {
  provider ??= createAiProvider({
    ...transports(),
    keyValue: defaultAuthDeps().keyValue,
    logger: jsonLogger(),
  });
  return provider;
}

/**
 * The vendors the keys allow; on a developer's machine or a journey's local run with
 * `AI_TRANSPORT=fake`, the fake transport instead (its embeddings put texts that share words close
 * together, and its model answers with nothing), so the Knowledge Vault can be tried end to end
 * without a key. A hosted runtime never uses it, and refuses to start with it set
 * (`productionConfigProblems()`).
 */
function transports(): ReturnType<typeof vendorTransports> {
  if (process.env.AI_TRANSPORT === 'fake' && !hostedRuntime()) {
    const fake = fakeModelTransport();
    return { claude: fake, voyage: fake };
  }
  return vendorTransports(process.env);
}
