// The models the agents may call and what they cost (ADR 0011, BLUEPRINT §9.3). Costs are kept in
// whole paise, rounded up, so a daily cap is never under-counted.

/** Haiku 4.5, the default for every agent (BLUEPRINT §9.3, ADR 0011). */
export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

/** The embedding model of the Knowledge Vault: 1,024 dimensions (DATABASE §2, ADR 0011). */
export const DEFAULT_EMBEDDING_MODEL = 'voyage-3.5';

/** US dollars per million tokens, as the vendors publish them. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Input read from the prompt cache. */
  cacheRead: number;
  /** Input written to the prompt cache. */
  cacheWrite: number;
}

/**
 * The models a call may name, with their published prices. A call naming any other model is
 * refused, so no spend goes uncounted.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  [DEFAULT_CLAUDE_MODEL]: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  [DEFAULT_EMBEDDING_MODEL]: { input: 0.06, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/**
 * Paise per US dollar used to turn a vendor's dollar price into the paise the caps are kept in.
 * The vendors bill in dollars; the owner's card is charged in rupees at about this rate. A change
 * of rate changes only how fast a cap is reached.
 */
export const PAISE_PER_USD = 8_800;

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

/** What `usage` cost on `model`, in whole paise, rounded up. */
export function costInPaise(model: string, usage: TokenUsage): number {
  const price = MODEL_PRICES[model];
  if (price === undefined) throw new Error(`no price for model ${model}`);
  // Micro-dollars first, in whole numbers where the prices allow, then paise.
  const microUsd =
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    usage.cacheReadTokens * price.cacheRead +
    usage.cacheWriteTokens * price.cacheWrite;
  return Math.max(0, Math.ceil((microUsd * PAISE_PER_USD) / 1_000_000 - 1e-9));
}
