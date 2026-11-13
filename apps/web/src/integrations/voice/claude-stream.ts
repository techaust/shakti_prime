import { AGENT_DEFAULTS } from '@shakti/domain';
import {
  asNumber,
  asObject,
  asString,
  at,
  defaultHttpDeps,
  ProviderError,
  providerFetch,
  type HttpDeps,
} from '../http';
import { keyFrom, parseVendorJson } from './vendor-json';
import { systemClock, type Clock, type ReplyModel, type ReplyUsage } from './ports';

/**
 * The reply step of the latency spike: Claude's Messages API over plain HTTP with streaming
 * (server-sent events), timing the first text and the first full sentence. The voice worker will
 * use the Anthropic SDK inside the LiveKit worker (Phase 2); this harness uses fetch because the
 * spike takes no new dependency. The model, effort and thinking come from `AGENT_DEFAULTS.voice`
 * (Sonnet 5.5, docs/03-roadmap-appendix/phase2.md §9.1); `VOICE_SPIKE_MODEL` may name another
 * priced model to compare (Haiku 5.5, §9.3). This harness calls the API directly for timing only;
 * production calls go through the provider wrapper of ADR 0011, which owns the model choice.
 */

/** The model the spike and the benchmark time unless `VOICE_SPIKE_MODEL` names another. */
export const DEFAULT_VOICE_SPIKE_MODEL: string = AGENT_DEFAULTS.voice.model;

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  /** `low` keeps a spoken reply quick; the spike can compare levels. */
  effort: 'low' | 'medium' | 'high';
  /**
   * Thinking off (`between_tools`) for the voice model, which only Sonnet 5.5 accepts; another
   * model being compared runs with its default thinking.
   */
  thinking: 'between_tools' | undefined;
  maxTokens: number;
  baseUrl: string;
}

/** A model the price table names, so a run's cost can be counted (`AGENT_DEFAULTS.modelPrices`). */
export function isPricedModel(model: string): boolean {
  return Object.hasOwn(AGENT_DEFAULTS.modelPrices, model);
}

export const CLAUDE_TIMEOUT_MS = 30_000;

export function claudeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeConfig | undefined {
  const apiKey = keyFrom(env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY');
  if (apiKey === undefined) return undefined;
  const effort = env.VOICE_SPIKE_EFFORT;
  const named = env.VOICE_SPIKE_MODEL?.trim() ?? '';
  const model = named === '' ? DEFAULT_VOICE_SPIKE_MODEL : named;
  if (!isPricedModel(model)) {
    throw new Error(`VOICE_SPIKE_MODEL names ${model}, which the price table does not list`);
  }
  return {
    apiKey,
    model,
    effort: effort === 'medium' || effort === 'high' ? effort : AGENT_DEFAULTS.voice.effort,
    thinking: model === AGENT_DEFAULTS.voice.model ? AGENT_DEFAULTS.voice.thinking : undefined,
    maxTokens: AGENT_DEFAULTS.voice.maxTokens,
    baseUrl: 'https://api.anthropic.com',
  };
}

/** A sentence ends at . ? ! or the Devanagari danda (written as an escape), then a space or the end. */
const SENTENCE_END = /[.?!\u0964](\s|$)/u;

/** Reads the token counts of `message_start` (input) and `message_delta` (output so far). */
function readUsage(usage: unknown, into: ReplyUsage): void {
  const input = asNumber(at(usage, 'input_tokens'));
  const output = asNumber(at(usage, 'output_tokens'));
  const cacheRead = asNumber(at(usage, 'cache_read_input_tokens'));
  const cacheWrite = asNumber(at(usage, 'cache_creation_input_tokens'));
  if (input !== undefined) into.inputTokens = input;
  if (output !== undefined) into.outputTokens = output;
  if (cacheRead !== undefined) into.cacheReadTokens = cacheRead;
  if (cacheWrite !== undefined) into.cacheWriteTokens = cacheWrite;
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Splits a server-sent-event stream into events, across chunk boundaries. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length > 0) yield { event, data: data.join('\n') };
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export function claudeReplyModel(
  config: ClaudeConfig,
  deps: HttpDeps = defaultHttpDeps(CLAUDE_TIMEOUT_MS),
  clock: Clock = systemClock,
): ReplyModel {
  return {
    vendor: `anthropic ${config.model}`,
    model: config.model,
    async reply(system, userText) {
      const started = clock.now();
      const response = await providerFetch('anthropic', deps, `${config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens,
          stream: true,
          system,
          ...(config.thinking === undefined ? {} : { thinking: { type: config.thinking } }),
          output_config: { effort: config.effort },
          messages: [{ role: 'user', content: userText }],
        }),
      });
      if (!response.ok || response.body === null) {
        const body: unknown = await response.json().catch(() => undefined);
        const type = asString(at(body, 'error', 'type'));
        throw new ProviderError('anthropic', 'http', {
          status: response.status,
          ...(type === undefined ? {} : { vendorCode: type }),
        });
      }

      let text = '';
      let firstTokenMs: number | undefined;
      let firstSentenceMs: number | undefined;
      let firstSentence = '';
      let stopReason: string | undefined;
      const usage: ReplyUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
      for await (const sse of readSse(response.body)) {
        if (sse.event === 'error') {
          const type = asString(at(parseVendorJson('anthropic', sse.data), 'error', 'type'));
          throw new ProviderError('anthropic', 'http', {
            status: 200,
            ...(type === undefined ? {} : { vendorCode: type }),
          });
        }
        if (sse.event === 'message_start') {
          readUsage(at(parseVendorJson('anthropic', sse.data), 'message', 'usage'), usage);
          continue;
        }
        if (sse.event === 'message_delta') {
          const body = parseVendorJson('anthropic', sse.data);
          readUsage(at(body, 'usage'), usage);
          stopReason = asString(at(body, 'delta', 'stop_reason')) ?? stopReason;
          continue;
        }
        if (sse.event !== 'content_block_delta') continue;
        const delta = asObject(at(parseVendorJson('anthropic', sse.data), 'delta'));
        if (delta?.type !== 'text_delta') continue;
        const piece = asString(delta.text) ?? '';
        if (piece === '') continue;
        firstTokenMs ??= clock.now() - started;
        text += piece;
        if (firstSentenceMs === undefined) {
          const end = SENTENCE_END.exec(text);
          if (end !== null) {
            firstSentence = text.slice(0, end.index + 1).trim();
            firstSentenceMs = clock.now() - started;
          }
        }
      }
      const totalMs = clock.now() - started;
      // A declined reply is not an answer, whatever text came before the decline.
      if (stopReason === 'refusal') {
        throw new ProviderError('anthropic', 'invalid_response', {
          status: response.status,
          vendorCode: 'refusal',
        });
      }
      if (text.trim() === '') {
        throw new ProviderError('anthropic', 'invalid_response', { status: response.status });
      }
      return {
        text: text.trim(),
        firstTokenMs: firstTokenMs ?? totalMs,
        firstSentenceMs: firstSentenceMs ?? totalMs,
        firstSentence: firstSentence === '' ? text.trim() : firstSentence,
        totalMs,
        usage,
      };
    },
  };
}
