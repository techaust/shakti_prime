import {
  asObject,
  asString,
  at,
  defaultHttpDeps,
  ProviderError,
  providerFetch,
  type HttpDeps,
} from '../http';
import type { ReplyModel } from './ports';

/**
 * The reply step of the latency spike: Claude's Messages API over plain HTTP with streaming
 * (server-sent events), timing the first text and the first full sentence. The voice worker will
 * use the Anthropic SDK inside the LiveKit worker (Phase 4); this harness uses fetch because the
 * spike takes no new dependency. The model is the blueprint's choice for live voice (§9.2).
 */

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  /** `low` keeps a spoken reply quick; the spike can compare levels. */
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  baseUrl: string;
}

export const CLAUDE_TIMEOUT_MS = 30_000;

export function claudeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ClaudeConfig | undefined {
  const apiKey = env.ANTHROPIC_API_KEY ?? '';
  if (apiKey === '') return undefined;
  const effort = env.VOICE_SPIKE_EFFORT;
  return {
    apiKey,
    model:
      env.VOICE_SPIKE_MODEL === undefined || env.VOICE_SPIKE_MODEL === ''
        ? 'claude-sonnet-5'
        : env.VOICE_SPIKE_MODEL,
    effort: effort === 'medium' || effort === 'high' ? effort : 'low',
    maxTokens: 400,
    baseUrl: 'https://api.anthropic.com',
  };
}

/** A sentence ends at . ? ! or the Devanagari danda, followed by a space or the end. */
const SENTENCE_END = /[.?!।](\s|$)/;

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
): ReplyModel {
  return {
    vendor: `anthropic ${config.model}`,
    async reply(system, userText) {
      const started = performance.now();
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
      for await (const sse of readSse(response.body)) {
        if (sse.event === 'error') {
          const type = asString(at(JSON.parse(sse.data) as unknown, 'error', 'type'));
          throw new ProviderError('anthropic', 'http', {
            status: 200,
            ...(type === undefined ? {} : { vendorCode: type }),
          });
        }
        if (sse.event !== 'content_block_delta') continue;
        const delta = asObject(at(JSON.parse(sse.data) as unknown, 'delta'));
        if (delta?.type !== 'text_delta') continue;
        const piece = asString(delta.text) ?? '';
        if (piece === '') continue;
        firstTokenMs ??= performance.now() - started;
        text += piece;
        if (firstSentenceMs === undefined) {
          const end = SENTENCE_END.exec(text);
          if (end !== null) {
            firstSentence = text.slice(0, end.index + 1).trim();
            firstSentenceMs = performance.now() - started;
          }
        }
      }
      const totalMs = performance.now() - started;
      if (text.trim() === '') {
        throw new ProviderError('anthropic', 'invalid_response', { status: response.status });
      }
      return {
        text: text.trim(),
        firstTokenMs: firstTokenMs ?? totalMs,
        firstSentenceMs: firstSentenceMs ?? totalMs,
        firstSentence: firstSentence === '' ? text.trim() : firstSentence,
        totalMs,
      };
    },
  };
}
