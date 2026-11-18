import type { VoiceModelDispatch } from '@shakti/contracts';
import { claudeConfig, sarvamConfig, type ClaudeConfig, type SarvamConfig } from '@shakti/voice';

/**
 * What the worker reads from its environment (SECURITY §3.4): only the vendor keys its turn needs.
 * `SARVAM_API_KEY` (speech both ways) and `ANTHROPIC_API_KEY` (Teach's interview), and its own
 * LiveKit agent key (`agentCredentials()`). No database URL, signing key, service role or API key
 * of the BOS: the session's 5-minute token, handed over in the dispatch, is its only way into the
 * BOS.
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

/** The worker's own LiveKit agent key, which it registers with LiveKit Cloud. */
export interface AgentCredentials {
  wsURL: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * The worker's LiveKit credentials (SECURITY §3.4): `LIVEKIT_URL` and an API key of the project
 * made for the worker alone, `LIVEKIT_AGENT_API_KEY` and `LIVEKIT_AGENT_API_SECRET`. The BOS's own
 * key (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`), which signs the room service calls and checks
 * LiveKit's webhooks, never reaches the worker: with either of its names set the worker refuses to
 * start, so a leaked worker cannot forge a webhook. The Agents framework would read those names
 * itself, which this refusal also stops.
 */
export function agentCredentials(env: Env = process.env): AgentCredentials {
  for (const name of ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const) {
    if ((env[name] ?? '') !== '') {
      throw new Error(
        `${name} is the BOS's LiveKit key; the worker runs with its own (LIVEKIT_AGENT_API_KEY, LIVEKIT_AGENT_API_SECRET)`,
      );
    }
  }
  const wsURL = env.LIVEKIT_URL ?? '';
  const apiKey = env.LIVEKIT_AGENT_API_KEY ?? '';
  const apiSecret = env.LIVEKIT_AGENT_API_SECRET ?? '';
  if (wsURL === '' || apiKey === '' || apiSecret === '') {
    throw new Error('LIVEKIT_URL, LIVEKIT_AGENT_API_KEY and LIVEKIT_AGENT_API_SECRET must be set');
  }
  return { wsURL, apiKey, apiSecret };
}
