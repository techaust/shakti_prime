import type { VoiceModelDispatch } from '@shakti/contracts';
import type { ReplyUsage } from '@shakti/voice';

/**
 * A session's spend in paise, as the domain prices it (`AGENT_DEFAULTS.modelPrices`, `paisePerUsd`
 * and `voice.speechPaisePerMinute`, handed over in the dispatch): the model's tokens of every
 * reply, and the speech by the minute. Rounded up, so a session never counts less than it cost.
 */
export class SpendMeter {
  private usd = 0;

  constructor(private readonly model: VoiceModelDispatch) {}

  addReply(usage: ReplyUsage): void {
    const p = this.model.prices;
    this.usd +=
      (usage.inputTokens * p.input +
        usage.outputTokens * p.output +
        usage.cacheReadTokens * p.cacheRead +
        usage.cacheWriteTokens * p.cacheWrite) /
      1_000_000;
  }

  /** The spend so far, with the speech of `elapsedMs` of the session. */
  paise(elapsedMs: number): number {
    const minutes = Math.ceil(Math.max(0, elapsedMs) / 60_000);
    return Math.ceil(this.usd * this.model.paisePerUsd) + minutes * this.model.speechPaisePerMinute;
  }
}
