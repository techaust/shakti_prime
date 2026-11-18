import type { WakeChannel } from './pop-transport';

/**
 * The person's own Realtime channel, `user:{id}` (ADR 0003, docs/04-architecture-appendix/
 * realtime.md), as the screen-pop's wake-up when `SCREEN_POP_TRANSPORT=realtime`: a minimal client
 * of Supabase Realtime's socket (protocol 1.0.0, JSON frames, as the spike's), loaded only when that
 * transport is in use. It joins the private channel with a BOS token from
 * `POST /api/v1/realtime/token`, renews the token before it ends, and on a `ringing` broadcast
 * wakes the page, which then takes the call from the ringing route. A refused join, an error or a
 * dropped socket reports the channel down (the page polls again) and tries again later.
 */

interface Frame {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
  join_ref?: string | null;
}

/** What the channel needs of the browser; tests pass a fake socket and clock. */
export interface ChannelHost {
  openSocket: (url: string) => SocketLike;
  /** `POST /api/v1/realtime/token`: the token, when it ends, and the channels it opens. */
  fetchToken: () => Promise<{ token: string; expiresAt: string; channels: string[] } | undefined>;
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

export interface SocketLike {
  send: (data: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

const HEARTBEAT_MS = 25_000;
/** The first wait before joining again after a drop; doubled each time, up to 5 minutes. */
const RETRY_MS = 5_000;
const RETRY_MAX_MS = 300_000;
/** A token is renewed this long before it ends. */
const RENEW_BEFORE_MS = 60_000;

/** The browser's own host for the channel. */
export function browserChannelHost(): ChannelHost {
  return {
    openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
    fetchToken: async () => {
      const response = await fetch('/api/v1/realtime/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store',
      });
      if (!response.ok) return undefined;
      return (await response.json()) as { token: string; expiresAt: string; channels: string[] };
    },
    now: () => Date.now(),
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (timer) => {
      window.clearTimeout(timer as number);
    },
  };
}

/** The wake-up channel of the project at `url` (https), opened with its publishable `key`. */
export function realtimeWakeChannel(url: string, key: string, host: ChannelHost): WakeChannel {
  return ({ wake, state }) => {
    let stopped = false;
    let socket: SocketLike | undefined;
    let topic = '';
    let ref = 0;
    let joinRef = '';
    let retryMs = RETRY_MS;
    let heartbeat: unknown;
    let renewal: unknown;
    let retry: unknown;
    let up = false;

    const nextRef = () => {
      ref += 1;
      return String(ref);
    };
    const send = (frame: Frame) => {
      socket?.send(JSON.stringify(frame));
    };
    const report = (now: boolean) => {
      if (up !== now) {
        up = now;
        state(now);
      }
    };
    const clearTimers = () => {
      for (const t of [heartbeat, renewal, retry]) if (t !== undefined) host.clearTimer(t);
      heartbeat = renewal = retry = undefined;
    };

    function drop(): void {
      report(false);
      clearTimers();
      const old = socket;
      socket = undefined;
      if (old !== undefined) {
        old.onclose = old.onerror = old.onmessage = old.onopen = null;
        old.close();
      }
      if (stopped) return;
      retry = host.setTimer(() => {
        retry = undefined;
        void connect();
      }, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    }

    function renewAt(expiresAt: string): void {
      const wait = Math.max(Date.parse(expiresAt) - host.now() - RENEW_BEFORE_MS, 5_000);
      renewal = host.setTimer(() => {
        renewal = undefined;
        void host
          .fetchToken()
          .catch(() => undefined)
          .then((fresh) => {
            if (stopped || socket === undefined) return;
            if (fresh === undefined) {
              drop();
              return;
            }
            send({
              topic,
              event: 'access_token',
              payload: { access_token: fresh.token },
              ref: nextRef(),
              join_ref: joinRef,
            });
            renewAt(fresh.expiresAt);
          });
      }, wait);
    }

    async function connect(): Promise<void> {
      const grant = await host.fetchToken().catch(() => undefined);
      const own = grant?.channels.find((c) => c.startsWith('user:'));
      if (stopped) return;
      if (grant === undefined || own === undefined) {
        drop();
        return;
      }
      topic = `realtime:${own}`;
      const opened = host.openSocket(
        `${url.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`,
      );
      socket = opened;
      opened.onerror = drop;
      opened.onclose = drop;
      opened.onopen = () => {
        joinRef = nextRef();
        send({
          topic,
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { ack: false, self: false },
              presence: { key: '', enabled: false },
              postgres_changes: [],
              private: true,
            },
            access_token: grant.token,
          },
          ref: joinRef,
          join_ref: joinRef,
        });
        heartbeat = host.setTimer(function beat() {
          send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
          heartbeat = host.setTimer(beat, HEARTBEAT_MS);
        }, HEARTBEAT_MS);
        renewAt(grant.expiresAt);
      };
      opened.onmessage = (event) => {
        let frame: Frame;
        try {
          frame = JSON.parse(String(event.data)) as Frame;
        } catch {
          return;
        }
        if (frame.topic !== topic) return;
        if (frame.event === 'phx_reply' && frame.ref === joinRef) {
          if (frame.payload.status === 'ok') {
            retryMs = RETRY_MS;
            report(true);
          } else {
            drop();
          }
        } else if (frame.event === 'broadcast' && frame.payload.event === 'ringing') {
          wake();
        } else if (
          frame.event === 'phx_close' ||
          frame.event === 'phx_error' ||
          (frame.event === 'system' && frame.payload.status === 'error')
        ) {
          drop();
        }
      };
    }

    void connect();
    return () => {
      stopped = true;
      drop();
    };
  };
}
