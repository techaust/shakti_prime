import type { EmbeddingTransport, ModelTransport } from './transport';
import { anthropicTransport, voyageTransport } from './vendor-transports';

/**
 * The vendor transports the keys allow. No key is set on any environment until the owner adds
 * one, and both are optional: without `ANTHROPIC_API_KEY` (or `VOYAGE_API_KEY`) the provider
 * wrapper answers `integration_unavailable` and nothing calls out.
 */
export function vendorTransports(env: Readonly<Record<string, string | undefined>>): {
  claude: ModelTransport | undefined;
  voyage: EmbeddingTransport | undefined;
} {
  const claudeKey = env.ANTHROPIC_API_KEY?.trim() ?? '';
  const voyageKey = env.VOYAGE_API_KEY?.trim() ?? '';
  return {
    claude: claudeKey === '' ? undefined : anthropicTransport(claudeKey),
    voyage: voyageKey === '' ? undefined : voyageTransport(voyageKey),
  };
}
