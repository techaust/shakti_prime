import type { Clock } from './ports';
import type { OpenSocket, VendorSocket } from './socket';

/**
 * Recorded vendor sessions, replayed through the real adapters with a clock the replay drives, so
 * the tests and the benchmark's CI run reproduce the same numbers every time without a key
 * (docs/03-roadmap-appendix/phase2.md §5.3). A session written by hand from a vendor's documented
 * shapes says so in `fixture`; a session saved from a live run replaces it in part 2.
 *
 * Timing rule: a socket frame's `atMs` counts from the client's first frame on that socket (the
 * first audio for speech to text, the `config` for speech); a streamed HTTP chunk's `atMs` counts
 * from the request. Each frame moves the clock to its time as it is read, never backwards.
 */

export interface RecordedFrame {
  atMs: number;
  /** The frame's JSON, sent on as text; or `text` for a body that is not JSON (server-sent events). */
  data?: unknown;
  text?: string;
}

export interface RecordedSession {
  /** Where the frames came from: `written` from the vendor's documentation, or `recorded` live. */
  source: 'written' | 'recorded';
  /** What the session stands for, and for a `written` one, the documentation it follows. */
  note: string;
  frames: RecordedFrame[];
}

/** A clock that only a replay moves. */
export class ReplayClock implements Clock {
  private ms = 0;

  now(): number {
    return this.ms;
  }

  advanceTo(ms: number): void {
    if (ms > this.ms) this.ms = ms;
  }
}

function frameText(frame: RecordedFrame): string {
  if (frame.text !== undefined) return frame.text;
  return JSON.stringify(frame.data);
}

export interface SentFrames {
  url: string;
  headers: Readonly<Record<string, string>>;
  frames: unknown[];
}

/**
 * An `OpenSocket` that answers each open with the next recorded session, in order, and keeps what
 * the adapter sent for the tests to read. Opening more sockets than there are sessions fails.
 */
export function replaySockets(
  sessions: readonly RecordedSession[],
  clock: ReplayClock,
): { open: OpenSocket; sent: SentFrames[] } {
  const sent: SentFrames[] = [];
  let index = 0;
  const open: OpenSocket = (url, headers) => {
    const session = sessions[index];
    index += 1;
    if (session === undefined) return Promise.reject(new Error('no recorded session left'));
    const record: SentFrames = { url, headers, frames: [] };
    sent.push(record);
    let firstSendAt: number | undefined;
    let closed = false;

    async function* messages(): AsyncGenerator<string> {
      // A frame is read only after the client has sent something, as on a live socket.
      await Promise.resolve();
      for (const frame of session?.frames ?? []) {
        if (closed) return;
        clock.advanceTo((firstSendAt ?? clock.now()) + frame.atMs);
        yield frameText(frame);
      }
    }

    const socket: VendorSocket = {
      send(text) {
        firstSendAt ??= clock.now();
        record.frames.push(JSON.parse(text) as unknown);
      },
      close() {
        closed = true;
      },
      messages: messages(),
    };
    return Promise.resolve(socket);
  };
  return { open, sent };
}

/**
 * A `fetch` that answers each call with the next recorded session as a streamed body (server-sent
 * events for the Messages API), moving the clock as each chunk is read.
 */
export function replayFetch(
  sessions: readonly RecordedSession[],
  clock: ReplayClock,
): { fetch: typeof fetch; requests: { url: string; body: unknown }[] } {
  const requests: { url: string; body: unknown }[] = [];
  let index = 0;
  const encoder = new TextEncoder();
  const replay: typeof fetch = (input, init) => {
    const session = sessions[index];
    index += 1;
    if (session === undefined) return Promise.reject(new Error('no recorded session left'));
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ url, body });
    const startedAt = clock.now();
    const frames = [...session.frames];
    // No read-ahead (`highWaterMark: 0`): a chunk is produced, and the clock moved, only when the
    // adapter asks for it, so each chunk is read at its own time.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const frame = frames.shift();
          if (frame === undefined) {
            controller.close();
            return;
          }
          clock.advanceTo(startedAt + frame.atMs);
          controller.enqueue(encoder.encode(frameText(frame)));
        },
      },
      { highWaterMark: 0 },
    );
    return Promise.resolve(new Response(stream, { status: 200 }));
  };
  return { fetch: replay, requests };
}

/**
 * Wraps a live `OpenSocket` so each session it opens is kept as a `recorded` session in the
 * replay's format: the benchmark's `--save-replay` uses it to replace the written fixtures with
 * what the vendor really sent (part 2).
 */
export function recordingSockets(
  open: OpenSocket,
  clock: Clock,
  note: string,
): { open: OpenSocket; sessions: RecordedSession[] } {
  const sessions: RecordedSession[] = [];
  const recordingOpen: OpenSocket = async (url, headers) => {
    const inner = await open(url, headers);
    const session: RecordedSession = { source: 'recorded', note, frames: [] };
    sessions.push(session);
    let firstSendAt: number | undefined;
    async function* messages(): AsyncGenerator<string> {
      for await (const text of inner.messages) {
        session.frames.push({ atMs: clock.now() - (firstSendAt ?? clock.now()), ...asFrame(text) });
        yield text;
      }
    }
    return {
      send(text) {
        firstSendAt ??= clock.now();
        inner.send(text);
      },
      close() {
        inner.close();
      },
      messages: messages(),
    };
  };
  return { open: recordingOpen, sessions };
}

/** Wraps a live `fetch` so each streamed body is kept, chunk by chunk, as a `recorded` session. */
export function recordingFetch(
  fetchImpl: typeof fetch,
  clock: Clock,
  note: string,
): { fetch: typeof fetch; sessions: RecordedSession[] } {
  const sessions: RecordedSession[] = [];
  const decoder = new TextDecoder();
  const recording: typeof fetch = async (input, init) => {
    const startedAt = clock.now();
    const response = await fetchImpl(input, init);
    if (response.body === null) return response;
    const session: RecordedSession = { source: 'recorded', note, frames: [] };
    sessions.push(session);
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          session.frames.push({
            atMs: clock.now() - startedAt,
            text: decoder.decode(chunk, { stream: true }),
          });
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  };
  return { fetch: recording, sessions };
}

function asFrame(text: string): Pick<RecordedFrame, 'data' | 'text'> {
  try {
    return { data: JSON.parse(text) as unknown };
  } catch {
    return { text };
  }
}
