import { createHash, randomUUID } from 'node:crypto';
import {
  AskStreamEvent,
  FilePresignResponse,
  VoiceRecordingCompleteResponse,
  VoiceTokenResponse,
  type AskSourceLabelDto,
} from '@shakti/contracts';

/**
 * The worker's only way into the BOS (docs/07-security.md §3.4): `/api/v1` with the session's
 * 5-minute token, refreshed a minute before it expires. The worker holds no database URL, signing
 * key, service role or API key of the BOS; when a refresh is refused (the session ended, its
 * person was suspended) the session ends.
 */

/** Refresh this long before the token expires. */
export const REFRESH_BEFORE_MS = 60_000;
/** After a refresh that could not reach the BOS, try again this soon, while the token lasts. */
export const REFRESH_RETRY_MS = 10_000;
/** One call to the BOS; Ask's lookups and its model take the longest. */
export const BOS_TIMEOUT_MS = 60_000;

export interface BosClientDeps {
  fetch: typeof fetch;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export const systemBosDeps: BosClientDeps = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

/** What the BOS answered a spoken question with: the answer and the records it cites. */
export interface SpokenAnswer {
  text: string;
  sources: AskSourceLabelDto[];
}

/** A refusal or failure of the BOS, by its error code; never its message, which is for people. */
export class BosError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`the BOS answered ${String(status)}${code === undefined ? '' : ` (${code})`}`);
    this.name = 'BosError';
  }
}

async function errorOf(response: Response): Promise<BosError> {
  const body: unknown = await response.json().catch(() => undefined);
  const code =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown } }).error?.code
      : undefined;
  return new BosError(response.status, typeof code === 'string' ? code : undefined);
}

export class BosClient {
  private current: { token: string; expiresAt: number };
  private timer: unknown;
  private stopped = false;

  constructor(
    private readonly apiBase: string,
    first: { token: string; expiresAt: string },
    private readonly onEnded: () => void,
    private readonly deps: BosClientDeps = systemBosDeps,
  ) {
    this.current = { token: first.token, expiresAt: Date.parse(first.expiresAt) };
  }

  /** Starts the refresh timer. */
  start(): void {
    this.schedule(this.current.expiresAt - REFRESH_BEFORE_MS - this.deps.now());
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** The token in use now; read by tests and by each call. */
  get token(): string {
    return this.current.token;
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(
      () => {
        void this.refresh();
      },
      Math.max(0, ms),
    );
  }

  private url(path: string): string {
    return `${this.apiBase.replace(/\/$/, '')}${path}`;
  }

  private call(path: string, init: RequestInit): Promise<Response> {
    return this.deps.fetch(this.url(path), {
      ...init,
      headers: {
        authorization: `Bearer ${this.current.token}`,
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: init.signal ?? AbortSignal.timeout(BOS_TIMEOUT_MS),
    });
  }

  /**
   * A new token for the session. A refusal ends the session; a failure to reach the BOS is tried
   * again while the token lasts, and ends the session once it has expired.
   */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    let response: Response;
    try {
      response = await this.call('/voice/token', { method: 'POST', body: '{}' });
    } catch {
      if (this.deps.now() + REFRESH_RETRY_MS < this.current.expiresAt) {
        this.schedule(REFRESH_RETRY_MS);
      } else {
        this.end();
      }
      return;
    }
    if (!response.ok) {
      if (response.status >= 500 && this.deps.now() + REFRESH_RETRY_MS < this.current.expiresAt) {
        this.schedule(REFRESH_RETRY_MS);
        return;
      }
      this.end();
      return;
    }
    const body = VoiceTokenResponse.safeParse(await response.json().catch(() => undefined));
    if (!body.success) {
      this.end();
      return;
    }
    this.current = { token: body.data.token, expiresAt: Date.parse(body.data.expiresAt) };
    this.schedule(this.current.expiresAt - REFRESH_BEFORE_MS - this.deps.now());
  }

  private end(): void {
    if (this.stopped) return;
    this.stop();
    this.onEnded();
  }

  /**
   * One spoken question to Ask the Business as the person (`POST /api/v1/ask`): its lookups run
   * under the person's own grants, without the cost permissions, and the answer arrives only once
   * the grounding filter passed it.
   */
  async ask(question: string, signal?: AbortSignal): Promise<SpokenAnswer> {
    const response = await this.call('/ask', {
      method: 'POST',
      headers: { 'idempotency-key': randomUUID() },
      body: JSON.stringify({ question }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) throw await errorOf(response);
    const text = await response.text();
    let answer: SpokenAnswer | undefined;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const event = AskStreamEvent.safeParse(JSON.parse(line));
      if (!event.success) continue;
      if (event.data.type === 'error') throw new BosError(200, event.data.error.code);
      if (event.data.type === 'answer') {
        answer = { text: event.data.turn.message.answer, sources: event.data.sources };
      }
    }
    if (answer === undefined) throw new BosError(200, undefined);
    return answer;
  }

  /**
   * A recorded Teach session's audio: the upload address, the bytes straight to the file store,
   * then the BOS files and links them. Answers whether the session kept them.
   */
  async uploadRecording(wav: Uint8Array): Promise<{ fileId: string; linked: boolean }> {
    const sha256 = createHash('sha256').update(wav).digest('hex');
    const asked = await this.call('/voice/recording', {
      method: 'POST',
      body: JSON.stringify({ size: wav.length, sha256 }),
    });
    if (!asked.ok) throw await errorOf(asked);
    const slot = FilePresignResponse.parse(await asked.json());
    const put = await this.deps.fetch(slot.uploadUrl, {
      method: slot.method,
      headers: slot.headers,
      body: new Blob([new Uint8Array(wav)], { type: 'audio/wav' }),
      signal: AbortSignal.timeout(BOS_TIMEOUT_MS),
    });
    if (!put.ok) throw new BosError(put.status, 'upload_failed');
    const done = await this.call('/voice/recording/complete', {
      method: 'POST',
      body: JSON.stringify({ fileId: slot.fileId }),
    });
    if (!done.ok) throw await errorOf(done);
    const filed = VoiceRecordingCompleteResponse.parse(await done.json());
    return { fileId: filed.fileId, linked: filed.linked };
  }
}
