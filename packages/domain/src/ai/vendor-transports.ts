import Anthropic from '@anthropic-ai/sdk';
import {
  ModelCallError,
  type EmbeddingReply,
  type EmbeddingTransport,
  type ModelReply,
  type ModelTransport,
} from './transport';

// The two vendors behind the provider wrapper (ADR 0011). Each makes one attempt per call: the
// wrapper owns the timeout, the retries and the circuit breaker. Neither logs a text.

/** The vendor's failure as a `ModelCallError`, never with the vendor's message text. */
function anthropicFailure(error: unknown): ModelCallError {
  if (error instanceof Anthropic.APIUserAbortError) return new ModelCallError('timeout');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ModelCallError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new ModelCallError('network');
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    return new ModelCallError('http', { status: error.status });
  }
  return new ModelCallError('invalid_response');
}

/**
 * Claude through `@anthropic-ai/sdk`. The system text is marked for the prompt cache, since it is
 * the same on every call of an agent (ADR 0011, cost controls).
 */
export function anthropicTransport(
  apiKey: string,
  options: { fetch?: typeof fetch } = {},
): ModelTransport {
  const client = new Anthropic({
    apiKey,
    maxRetries: 0,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    async complete(request, signal): Promise<ModelReply> {
      let message: Anthropic.Message;
      try {
        message = await client.messages.create(
          {
            model: request.model,
            max_tokens: request.maxTokens,
            system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: request.user }],
          },
          { signal },
        );
      } catch (error) {
        throw anthropicFailure(error);
      }
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      return {
        text,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
        stopped:
          message.stop_reason === 'refusal'
            ? 'refused'
            : message.stop_reason === 'max_tokens'
              ? 'too_long'
              : 'finished',
      };
    },
  };
}

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

interface VoyageAnswer {
  data?: { embedding?: unknown; index?: unknown }[];
  usage?: { total_tokens?: unknown };
}

/** Voyage embeddings over plain `fetch`, 1,024 numbers per text (DATABASE §2). */
export function voyageTransport(
  apiKey: string,
  fetcher: typeof fetch = (...args) => fetch(...args),
): EmbeddingTransport {
  return {
    async embed(request, signal): Promise<EmbeddingReply> {
      let response: Response;
      try {
        response = await fetcher(VOYAGE_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            input: request.texts,
            model: request.model,
            input_type: request.inputType,
            output_dimension: 1024,
          }),
          signal,
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        throw new ModelCallError(timedOut ? 'timeout' : 'network', { cause: error });
      }
      if (!response.ok) throw new ModelCallError('http', { status: response.status });
      let body: VoyageAnswer;
      try {
        body = (await response.json()) as VoyageAnswer;
      } catch (error) {
        throw new ModelCallError('invalid_response', { cause: error });
      }
      const rows = Array.isArray(body.data) ? body.data : [];
      const vectors: number[][] = [];
      for (const [i, row] of rows.entries()) {
        const embedding = row.embedding;
        if (
          row.index !== i ||
          !Array.isArray(embedding) ||
          embedding.length !== 1024 ||
          !embedding.every((n) => typeof n === 'number')
        ) {
          throw new ModelCallError('invalid_response');
        }
        vectors.push(embedding as number[]);
      }
      const tokens = body.usage?.total_tokens;
      if (vectors.length !== request.texts.length || typeof tokens !== 'number') {
        throw new ModelCallError('invalid_response');
      }
      return { vectors, tokens };
    },
  };
}
