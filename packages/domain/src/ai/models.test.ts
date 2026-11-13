import { describe, expect, it } from 'vitest';
import { AGENT_DEFAULTS } from './agent-defaults';
import {
  costInPaise,
  isKnownModel,
  maxCostInPaise,
  MODEL_CONTEXT_TOKENS,
  MODEL_PRICES,
  NO_USAGE,
  PAISE_PER_USD,
} from './models';

const million = 1_000_000;

describe('the price table', () => {
  it('names a date checked for every model and a context window for every Claude model', () => {
    const checked: Readonly<Record<string, string>> = AGENT_DEFAULTS.pricesCheckedOn;
    for (const model of Object.keys(MODEL_PRICES)) {
      expect(checked[model], model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (model.startsWith('claude-'))
        expect(MODEL_CONTEXT_TOKENS[model], model).toBeGreaterThan(0);
    }
    expect(Object.keys(checked).sort()).toEqual(Object.keys(MODEL_PRICES).sort());
  });

  it('knows the Phase 2 models and the voice model (question 1 (a))', () => {
    expect(isKnownModel('claude-sonnet-5-5')).toBe(true);
    expect(isKnownModel('claude-haiku-5-5')).toBe(true);
    expect(AGENT_DEFAULTS.voice.model).toBe('claude-sonnet-5-5');
    expect(isKnownModel(AGENT_DEFAULTS.voice.model)).toBe(true);
    expect(isKnownModel('claude-opus-5-5')).toBe(false);
  });

  it('prices Sonnet 5.5 at $2 in, $10 out and $0.10 cache reads', () => {
    expect(costInPaise('claude-sonnet-5-5', { ...NO_USAGE, inputTokens: million })).toBe(
      2 * PAISE_PER_USD,
    );
    expect(costInPaise('claude-sonnet-5-5', { ...NO_USAGE, outputTokens: million })).toBe(
      10 * PAISE_PER_USD,
    );
    expect(costInPaise('claude-sonnet-5-5', { ...NO_USAGE, cacheReadTokens: million })).toBe(
      0.1 * PAISE_PER_USD,
    );
  });

  it('prices Haiku 5.5 by prompt length, the line counting cache reads and writes', () => {
    const atLine = {
      ...NO_USAGE,
      inputTokens: 60_000,
      cacheReadTokens: 40_000,
      outputTokens: 1_000,
    };
    // 60,000 × $0.10 + 40,000 × $0.01 + 1,000 × $0.50 = $0.0069 = 71.76 paise, rounded up.
    expect(costInPaise('claude-haiku-5-5', atLine)).toBe(72);
    const overLine = { ...atLine, cacheWriteTokens: 1 };
    // 60,000 × $0.50 + 40,000 × $0.05 + 1 × $0.625 + 1,000 × $2.50 = $0.0345006 = 358.81 paise.
    expect(costInPaise('claude-haiku-5-5', overLine)).toBe(359);
  });

  it('holds the most a call can cost at the dearest prices the model has', () => {
    // 1,000 bytes at Haiku 5.5's dearest input ($0.625) and 100 tokens at $2.50.
    expect(maxCostInPaise('claude-haiku-5-5', 1_000, 100)).toBe(
      Math.ceil(((1_000 * 0.625 + 100 * 2.5) * PAISE_PER_USD) / million),
    );
    expect(maxCostInPaise('claude-sonnet-5-5', 1_000, 100)).toBe(
      Math.ceil(((1_000 * 2.5 + 100 * 10) * PAISE_PER_USD) / million),
    );
  });
});
