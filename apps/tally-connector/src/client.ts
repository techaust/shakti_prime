import {
  API_ENDPOINTS,
  API_HEADERS,
  ConnectorBatchResponse,
  ConnectorCursorResponse,
  ConnectorHeartbeatResponse,
  ConnectorSnapshotResponse,
  ErrorEnvelope,
  type ApiEndpointId,
  type ConnectorHeartbeatRequest,
} from '@shakti/contracts';
import { errorKind, logId, type Log } from './log';
import type { Settings } from './settings';
import { signedHeaders } from './signing';

/**
 * The connector's calls to the BOS (docs/06-api.md §3.5): `cursor`, `batches`, `snapshot` and
 * `heartbeat`, each signed with the connector's key. A batch and a snapshot carry the
 * `Idempotency-Key` stored with them in the outbox, so a resend after a lost answer is applied once.
 * A call that fails on the network, times out or meets a server error is retried briefly with a
 * doubling wait; after that the BOS counts as not answering until the next cycle.
 */

export type ClientSettings = Pick<
  Settings,
  'bosTimeoutMs' | 'bosRetries' | 'bosBackoffMs' | 'bosMaxRetryAfterMs'
>;

/** The BOS did not answer, or answered with a server error, after the retries. */
export class BosUnavailable extends Error {
  override name = 'BosUnavailable';
  constructor(readonly reason: 'network' | 'server' | 'rate_limited' | 'bad_answer') {
    super(reason);
  }
}

/** The BOS refused the call: retrying the same call will not help. */
export class BosRefused extends Error {
  override name = 'BosRefused';
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string | undefined,
  ) {
    super(reason ?? code);
  }
}

export interface BosClientOptions {
  /** The BOS's address, for example `https://shaktiprime.com`. */
  baseUrl: string;
  connectorId: string;
  key: string;
  settings: ClientSettings;
  log: Log;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const API_PREFIX = '/api/v1';

/** What the contracts' Zod schemas offer, named here because the connector does not depend on Zod. */
interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `Retry-After` in seconds or as a date, in milliseconds from now. */
function retryAfterMs(header: string | null, now: Date): number | undefined {
  if (header === null) return undefined;
  if (/^\d+$/.test(header.trim())) return Number(header.trim()) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now.getTime());
}

export class BosClient {
  readonly #key: string;
  private readonly origin: string;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: Omit<BosClientOptions, 'key'> & { key: string }) {
    this.#key = options.key;
    this.origin = new URL(options.baseUrl).origin;
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.now = options.now ?? (() => new Date());
  }

  /** Keeps the key out of `console.log`, `util.inspect` and `JSON.stringify`. */
  toJSON(): Record<string, string> {
    return { origin: this.origin, connectorId: this.options.connectorId };
  }

  cursor(company: string): Promise<ConnectorCursorResponse> {
    return this.call('connector.cursor', ConnectorCursorResponse, {
      query: new URLSearchParams({ company }),
    });
  }

  heartbeat(request: ConnectorHeartbeatRequest): Promise<ConnectorHeartbeatResponse> {
    return this.call('connector.heartbeat', ConnectorHeartbeatResponse, {
      body: JSON.stringify(request),
    });
  }

  /** Sends a batch from the outbox: its stored body under its stored key. */
  sendBatch(row: { body: string; idempotencyKey: string }): Promise<ConnectorBatchResponse> {
    return this.call('connector.batches', ConnectorBatchResponse, row);
  }

  sendSnapshot(row: { body: string; idempotencyKey: string }): Promise<ConnectorSnapshotResponse> {
    return this.call('connector.snapshot', ConnectorSnapshotResponse, row);
  }

  private async call<T>(
    id: ApiEndpointId,
    schema: Schema<T>,
    request: { query?: URLSearchParams; body?: string; idempotencyKey?: string },
  ): Promise<T> {
    const endpoint = API_ENDPOINTS[id];
    const url = new URL(`${API_PREFIX}${endpoint.path}`, this.origin);
    if (request.query !== undefined) url.search = request.query.toString();
    const { bosRetries, bosBackoffMs } = this.options.settings;
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.attempt(endpoint.method, url, schema, request).catch(
        (error: unknown) => ({ kind: 'failed' as const, error }),
      );
      if (outcome.kind === 'answered') return outcome.value;
      if (outcome.kind === 'refused') throw outcome.error;
      const error = new BosUnavailable(outcome.kind === 'failed' ? 'network' : outcome.reason);
      const wait = outcome.kind === 'retry' ? outcome.wait : 'backoff';
      if (attempt >= bosRetries || wait === 'stop') {
        this.options.log.warn('bos_unavailable', {
          endpoint: logId(id.replace('connector.', '')),
          kind: outcome.kind === 'failed' ? errorKind(outcome.error) : logId(error.reason),
        });
        throw error;
      }
      await this.sleep(wait === 'backoff' ? bosBackoffMs * 2 ** attempt : wait);
    }
  }

  /** One signed call. The time is signed afresh on each attempt; the body and key stay the same. */
  private async attempt<T>(
    method: 'GET' | 'POST',
    url: URL,
    schema: Schema<T>,
    request: { body?: string; idempotencyKey?: string },
  ): Promise<
    | { kind: 'answered'; value: T }
    | { kind: 'refused'; error: BosRefused }
    | { kind: 'retry'; reason: BosUnavailable['reason']; wait: number | 'backoff' | 'stop' }
  > {
    const { bosMaxRetryAfterMs, bosTimeoutMs } = this.options.settings;
    const body = request.body ?? '';
    const headers: Record<string, string> = {
      ...signedHeaders(
        this.options.connectorId,
        this.#key,
        { method, pathWithQuery: `${url.pathname}${url.search}`, body },
        this.now(),
      ),
      accept: 'application/json',
      ...(request.body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
      ...(request.idempotencyKey === undefined
        ? {}
        : { [API_HEADERS.idempotencyKey]: request.idempotencyKey }),
    };
    const response = await this.fetch(url, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body }),
      signal: AbortSignal.timeout(bosTimeoutMs),
      redirect: 'error',
    });
    const answer = safeJson(await response.text());
    if (response.ok) {
      const parsed = schema.safeParse(answer);
      // An answer the contract cannot read is not retried: the same call gets the same answer.
      return parsed.success
        ? { kind: 'answered', value: parsed.data }
        : { kind: 'retry', reason: 'bad_answer', wait: 'stop' };
    }
    if (response.status === 429) {
      const after = retryAfterMs(response.headers.get(API_HEADERS.retryAfter), this.now());
      // A long wait asked for is kept by waiting for the next cycle instead.
      const wait = after === undefined ? 'backoff' : after > bosMaxRetryAfterMs ? 'stop' : after;
      return { kind: 'retry', reason: 'rate_limited', wait };
    }
    if (response.status >= 500) return { kind: 'retry', reason: 'server', wait: 'backoff' };
    const envelope = ErrorEnvelope.safeParse(answer);
    const reason = envelope.success ? envelope.data.error.details?.reason : undefined;
    return {
      kind: 'refused',
      error: new BosRefused(
        response.status,
        envelope.success ? envelope.data.error.code : 'unknown',
        typeof reason === 'string' ? reason : undefined,
      ),
    };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
