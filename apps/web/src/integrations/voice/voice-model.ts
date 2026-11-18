import type { VoiceModelDispatch } from '@shakti/contracts';
import { AGENT_DEFAULTS, MODEL_PRICES } from '@shakti/domain';
import { claudeConfig, type ClaudeConfig, type VoiceModelSettings } from '@shakti/voice';

/**
 * The reply step's settings, from `AGENT_DEFAULTS.voice` (docs/03-roadmap-appendix/phase2.md
 * §9.1), the one source: the spike and the benchmark read them here, and the voice worker gets the
 * same values in its dispatch metadata (`voiceDispatchModel()` of the session route).
 */
export const VOICE_MODEL_SETTINGS: VoiceModelSettings = {
  model: AGENT_DEFAULTS.voice.model,
  effort: AGENT_DEFAULTS.voice.effort,
  thinking: AGENT_DEFAULTS.voice.thinking,
  maxTokens: AGENT_DEFAULTS.voice.maxTokens,
};

/** The model the spike and the benchmark time unless `VOICE_SPIKE_MODEL` names another. */
export const DEFAULT_VOICE_SPIKE_MODEL: string = AGENT_DEFAULTS.voice.model;

/** A model the price table names, so a run's cost can be counted (`AGENT_DEFAULTS.modelPrices`). */
export function isPricedModel(model: string): boolean {
  return Object.hasOwn(AGENT_DEFAULTS.modelPrices, model);
}

/** The reply step's configuration for this environment; undefined without a model key. */
export function voiceClaudeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeConfig | undefined {
  return claudeConfig(VOICE_MODEL_SETTINGS, isPricedModel, env);
}

/**
 * The reply step as the voice worker runs it, handed over when the BOS dispatches the worker
 * (`VoiceDispatchMetadata.model`): the settings above, the model's prices and the speech price, so
 * the worker counts a session's spend as the domain prices it.
 */
export function voiceDispatchModel(): VoiceModelDispatch {
  const price = MODEL_PRICES[VOICE_MODEL_SETTINGS.model];
  if (price === undefined) throw new Error('the voice model has no price');
  return {
    model: VOICE_MODEL_SETTINGS.model,
    effort: VOICE_MODEL_SETTINGS.effort,
    thinking: VOICE_MODEL_SETTINGS.thinking ?? null,
    maxTokens: VOICE_MODEL_SETTINGS.maxTokens,
    // Teach's drafts are written as the Playbook drafts a file's directives (K2).
    draftMaxTokens: AGENT_DEFAULTS.playbook.draftMaxTokens,
    prices: {
      input: price.input,
      output: price.output,
      cacheRead: price.cacheRead,
      cacheWrite: price.cacheWrite,
    },
    paisePerUsd: AGENT_DEFAULTS.paisePerUsd,
    speechPaisePerMinute: AGENT_DEFAULTS.voice.speechPaisePerMinute,
  };
}
