import { AGENT_DEFAULTS, type ModelPrice } from './agent-defaults';

// The models the agents may call and what they cost (ADR 0011, BLUEPRINT §9.3). The prices and the
// rupee rate are the named defaults of `agent-defaults.ts`. Costs are kept in whole paise, rounded
// up, so a daily cap is never under-counted.

/** Haiku 4.5, the default for every agent (BLUEPRINT §9.3, ADR 0011). */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

/** The embedding model of the Knowledge Vault: 1,024 dimensions (DATABASE §2, ADR 0011). */
export const DEFAULT_EMBEDDING_MODEL = 'voyage-3.5';

export type { ModelPrice };

/**
 * The models a call may name, with their prices as checked on `AGENT_DEFAULTS.pricesCheckedOn`.
 * A call naming any other model is refused, so no spend goes uncounted.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = AGENT_DEFAULTS.modelPrices;

/** Paise a US dollar of model spend costs (`AGENT_DEFAULTS.paisePerUsd`). */
export const PAISE_PER_USD: number = AGENT_DEFAULTS.paisePerUsd;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function isKnownModel(model: string): boolean {
  return Object.hasOwn(MODEL_PRICES, model);
}

function priceOf(model: string): ModelPrice {
  const price = MODEL_PRICES[model];
  if (price === undefined) throw new Error(`no price for model ${model}`);
  return price;
}

/** Micro-dollars as whole paise, rounded up. */
const paiseOf = (microUsd: number): number =>
  Math.max(0, Math.ceil((microUsd * PAISE_PER_USD) / 1_000_000 - 1e-9));

/** What `usage` cost on `model`, in whole paise, rounded up. */
export function costInPaise(model: string, usage: TokenUsage): number {
  const price = priceOf(model);
  // Micro-dollars first, in whole numbers where the prices allow, then paise.
  return paiseOf(
    usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheWriteTokens * price.cacheWrite,
  );
}

/**
 * The most a call can cost, held against the caps before it is sent: every byte of its text in
 * UTF-8 counted as a token (a token is never shorter than one byte) at the dearest input price,
 * and every output token it may write.
 */
export function maxCostInPaise(model: string, inputBytes: number, maxOutputTokens: number): number {
  const price = priceOf(model);
  const input = Math.max(price.input, price.cacheWrite);
  return paiseOf(inputBytes * input + maxOutputTokens * price.output);
}
