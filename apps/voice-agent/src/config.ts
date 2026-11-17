import type { VoiceModelDispatch } from '@shakti/contracts';
import { claudeConfig, sarvamConfig, type ClaudeConfig, type SarvamConfig } from '@shakti/voice';

/**
 * What the worker reads from its environment (SECURITY §3.4): only the vendor keys its turn needs.
 * `SARVAM_API_KEY` (speech both ways) and `ANTHROPIC_API_KEY` (Teach's interview), and LiveKit's
 * own agent credentials (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`), which the Agents
 * framework reads itself. No database URL, signing key, service role or API key of the BOS: the
 * session's 5-minute token, handed over in the dispatch, is its only way into the BOS.
 */
export interface WorkerConfig {
  sarvam: SarvamConfig | undefined;
  claude: ClaudeConfig | undefined;
  /** Teach's drafting call: the same model, with the drafts' answer length. */
  drafting: ClaudeConfig | undefined;
}

export type Env = Readonly<Record<string, string | undefined>>;

export function workerConfig(model: VoiceModelDispatch, env: Env = process.env): WorkerConfig {
  const settings = {
    model: model.model,
    effort: model.effort,
    thinking: model.thinking ?? undefined,
    maxTokens: model.maxTokens,
  };
  // Only the model the BOS priced: the worker never picks another, whatever its environment says.
  const keys = { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  const claude = claudeConfig(settings, (name) => name === model.model, keys);
  return {
    sarvam: sarvamConfig(env),
    claude,
    drafting: claude === undefined ? undefined : { ...claude, maxTokens: model.draftMaxTokens },
  };
}
