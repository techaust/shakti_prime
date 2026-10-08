import { NO_USAGE, type TokenUsage } from './models';

// What the provider wrapper sends to a model and gets back, without any vendor's types, so the
// wrapper and its tests never touch a network: the Anthropic and Voyage transports implement
// these, and the fake transport stands in for both in every test.

/**
 * A picture a chat model reads with the question: a photo, or a PDF's page, that the file checks
 * have masked (a Knowledge Vault file, docs/03-roadmap-appendix/phase1.md §8.4). A PDF itself is never sent.
 */
export interface ModelDocument {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

/** One text request to a chat model. Every text here has already been masked by the wrapper. */
export interface ModelRequest {
  model: string;
  /** Our own instructions, stable across calls so the vendor can cache them. */
  system: string;
  /** The turn: the labelled data and the question. */
  user: string;
  /** Files read with the turn, before its text. */
  documents?: readonly ModelDocument[];
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
 * A text's stand-in embedding: each word (a run of letters or digits, in lower case) counted in
 * one of 1,024 places chosen by its hash, the counts scaled to length 1, so texts that share words
 * lie close by cosine distance. A text with no word points one way. Never a real model's vector.
 */
export function fakeEmbedding(text: string): number[] {
  const vector = Array.from({ length: 1024 }, () => 0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    // FNV-1a over the word's UTF-16 units.
    let hash = 0x811c9dc5;
    for (let i = 0; i < word.length; i += 1) {
      hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193) >>> 0;
    }
    vector[hash % 1024] = (vector[hash % 1024] ?? 0) + 1;
  }
  const length = Math.hypot(...vector);
  if (length === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((v) => v / length);
}

/**
 * The transport every test uses: answers from a script, in order, and repeats the last step when
 * the script runs out. `'hang'` waits until the wrapper's timeout aborts the call. Embeddings are
 * `fakeEmbedding()`s of the texts, one token per four characters.
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
      const vectors = request.texts.map(fakeEmbedding);
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
