import { NO_USAGE, type TokenUsage } from './models';

// What the provider wrapper sends to a model and gets back, without any vendor's types, so the
// wrapper and its tests never touch a network: the Anthropic and Voyage transports implement
// these, and the fake transport stands in for both in every test.

/** One text request to a chat model. Every text here has already been masked by the wrapper. */
export interface ModelRequest {
  model: string;
  /** Our own instructions, stable across calls so the vendor can cache them. */
  system: string;
  /** The turn: the labelled data and the question. */
  user: string;
  maxTokens: number;
}

export interface ModelReply {
  text: string;
  usage: TokenUsage;
  /** The vendor stopped for its own reasons (`refusal`, `max_tokens`) rather than finishing. */
  stopped: 'finished' | 'too_long' | 'refused';
}

export interface EmbeddingRequest {
  model: string;
  texts: readonly string[];
  /** A document to store, or a question to search with. */
  inputType: 'document' | 'query';
}

export interface EmbeddingReply {
  vectors: number[][];
  tokens: number;
}

/**
 * Why a vendor call failed: `timeout` and `network` and an HTTP 429 or 5xx are worth another
 * attempt; anything else (a refused key, a bad request) is not.
 */
export class ModelCallError extends Error {
  readonly failure: 'timeout' | 'network' | 'http' | 'invalid_response';
  readonly status: number | undefined;

  constructor(
    failure: ModelCallError['failure'],
    options: { status?: number; cause?: unknown } = {},
  ) {
    const status = options.status === undefined ? '' : ` ${String(options.status)}`;
    super(`model call ${failure}${status}`, { cause: options.cause });
    this.name = 'ModelCallError';
    this.failure = failure;
    this.status = options.status;
  }

  get retryable(): boolean {
    if (this.failure === 'timeout' || this.failure === 'network') return true;
    return this.status === 429 || (this.status !== undefined && this.status >= 500);
  }
}

export interface ModelTransport {
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelReply>;
}

export interface EmbeddingTransport {
  embed(request: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingReply>;
}

/** A scripted answer of the fake transport: a reply, or a failure to throw. */
export type FakeStep = ModelReply | ModelCallError | 'hang';

export interface FakeModelTransport extends ModelTransport, EmbeddingTransport {
  /** Every request the fake received, as the wrapper sent it (masked). */
  readonly requests: ModelRequest[];
  readonly embeddings: EmbeddingRequest[];
}

/**
 * The transport every test uses: answers from a script, in order, and repeats the last step when
 * the script runs out. `'hang'` waits until the wrapper's timeout aborts the call. Embeddings are
 * vectors of 1,024 numbers made from each text's length, one token per four characters.
 */
export function fakeModelTransport(script: readonly FakeStep[] = []): FakeModelTransport {
  const requests: ModelRequest[] = [];
  const embeddings: EmbeddingRequest[] = [];
  let next = 0;
  const step = (): FakeStep => {
    const s = script[Math.min(next, script.length - 1)];
    next += 1;
    return s ?? fakeReply('');
  };
  return {
    requests,
    embeddings,
    complete(request, signal) {
      requests.push(request);
      const s = step();
      if (s === 'hang') {
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              reject(new ModelCallError('timeout'));
            },
            { once: true },
          );
        });
      }
      return s instanceof ModelCallError ? Promise.reject(s) : Promise.resolve(s);
    },
    embed(request) {
      embeddings.push(request);
      const vectors = request.texts.map((t) =>
        Array.from({ length: 1024 }, (_v, i) => ((t.length + i) % 7) / 7),
      );
      const tokens = request.texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
      return Promise.resolve({ vectors, tokens });
    },
  };
}

/** A finished reply with the given text and token counts. */
export function fakeReply(text: string, usage: Partial<TokenUsage> = {}): ModelReply {
  return {
    text,
    usage: { ...NO_USAGE, inputTokens: 100, outputTokens: 20, ...usage },
    stopped: 'finished',
  };
}
