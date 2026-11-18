import { describe, expect, it, vi } from 'vitest';
import { realtimeWakeChannel, type ChannelHost, type SocketLike } from './realtime-channel';

const USER = '01a1e99a-b000-7000-8000-000000000001';
const START = Date.parse('2026-11-17T06:30:00.000Z');

class FakeSocket implements SocketLike {
  sent: Record<string, unknown>[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.closed = true;
  }
  receive(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function fakeHost(
  token = () => ({ token: 'token-1', expiresAt: new Date(START + 900_000).toISOString() }),
) {
  let now = START;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const sockets: FakeSocket[] = [];
  const fetchToken = vi.fn(() => {
    const t = token();
    return Promise.resolve({ ...t, channels: [`user:${USER}`, 'entity:1:queue'] });
  });
  const host: ChannelHost = {
    openSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    fetchToken,
    now: () => now,
    setTimer: (run, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      await new Promise((resolve) => setImmediate(resolve));
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined || due[1].at > end) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].run();
    }
    now = end;
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { host, sockets, advance, fetchToken };
}

const TOPIC = `realtime:user:${USER}`;

async function joined() {
  const f = fakeHost();
  const wake = vi.fn();
  const state = vi.fn();
  const stop = realtimeWakeChannel(
    'https://abcdefghijklmnop.supabase.co',
    'sb_publishable_key',
    f.host,
  )({
    wake,
    state,
  });
  await f.advance(0);
  const socket = f.sockets[0];
  if (socket === undefined) throw new Error('no socket');
  socket.onopen?.();
  const join = socket.sent[0] ?? {};
  socket.receive({ topic: TOPIC, event: 'phx_reply', payload: { status: 'ok' }, ref: join.ref });
  return { ...f, wake, state, stop, socket, join };
}

describe('the Realtime wake-up channel (a fake socket)', () => {
  it('joins the person’s own private channel with the BOS token and reports it up', async () => {
    const c = await joined();
    expect(c.socket.url).toBe(
      'wss://abcdefghijklmnop.supabase.co/realtime/v1/websocket?apikey=sb_publishable_key&vsn=1.0.0',
    );
    expect(c.join).toMatchObject({
      topic: TOPIC,
      event: 'phx_join',
      payload: { config: { private: true }, access_token: 'token-1' },
    });
    expect(c.state.mock.calls).toEqual([[true]]);
    c.stop();
  });

  it('wakes the page on a ringing broadcast only, on its own channel only', async () => {
    const c = await joined();
    c.socket.receive({ topic: TOPIC, event: 'broadcast', payload: { event: 'other' }, ref: null });
    c.socket.receive({
      topic: 'realtime:entity:1:queue',
      event: 'broadcast',
      payload: { event: 'ringing' },
      ref: null,
    });
    c.socket.onmessage?.({ data: 'not a frame' });
    expect(c.wake).not.toHaveBeenCalled();
    c.socket.receive({
      topic: TOPIC,
      event: 'broadcast',
      payload: { event: 'ringing', payload: {} },
      ref: null,
    });
    expect(c.wake).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('reports a refused join or a dropped socket down, and joins again later', async () => {
    const c = await joined();
    c.socket.receive({ topic: TOPIC, event: 'phx_error', payload: {}, ref: null });
    expect(c.state.mock.calls).toEqual([[true], [false]]);
    expect(c.socket.closed).toBe(true);
    await c.advance(5_000);
    const again = c.sockets[1];
    expect(again).toBeDefined();
    again?.onopen?.();
    const join = again?.sent[0] ?? {};
    again?.receive({
      topic: TOPIC,
      event: 'phx_reply',
      payload: { status: 'error' },
      ref: join.ref,
    });
    expect(c.state.mock.calls.at(-1)).toEqual([false]);
    // Waits twice as long before the next try.
    await c.advance(5_000);
    expect(c.sockets).toHaveLength(2);
    await c.advance(5_000);
    expect(c.sockets).toHaveLength(3);
    c.stop();
  });

  it('beats every 25 seconds and renews the token a minute before it ends', async () => {
    const c = await joined();
    await c.advance(25_000);
    expect(c.socket.sent.some((f) => f.event === 'heartbeat')).toBe(true);
    await c.advance(900_000 - 60_000 - 25_000);
    expect(c.socket.sent.find((f) => f.event === 'access_token')).toMatchObject({
      topic: TOPIC,
      payload: { access_token: 'token-1' },
    });
    expect(c.fetchToken).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it('closes the socket and tries nothing more once stopped', async () => {
    const c = await joined();
    c.stop();
    expect(c.socket.closed).toBe(true);
    await c.advance(600_000);
    expect(c.sockets).toHaveLength(1);
  });
});
