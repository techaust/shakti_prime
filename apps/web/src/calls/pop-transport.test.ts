import type { ScreenPopDto } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  askRinging,
  BACKSTOP_MS,
  MAX_BACKOFF_MS,
  POLL_MS,
  startScreenPop,
  type PopHost,
  type RingingAnswer,
  type WakeChannel,
} from './pop-transport';

const POP: ScreenPopDto = {
  providerCallId: '01a1e99a-ac5e-7726-bde8-2fb433596282',
  entityId: 1,
  ringingAt: '2026-11-17T06:30:00.000Z',
  phoneLast4: '5678',
  customers: [],
  newLeadPhone: '+919812345678',
};

/** A page and a clock the test moves by hand. */
function fakeHost() {
  let now = Date.parse('2026-11-17T06:30:00.000Z');
  let visible = true;
  const timers = new Map<number, { at: number; run: () => void }>();
  let next = 1;
  const listeners = new Set<() => void>();
  const host: PopHost = {
    now: () => now,
    visible: () => visible,
    onVisibility: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTimer: (run, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
  };
  /** Moves the clock, running each timer that falls due, and lets each ask settle. */
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      await Promise.resolve();
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
  const setVisible = (value: boolean) => {
    visible = value;
    for (const l of listeners) l();
  };
  return { host, advance, setVisible, timers, nowMs: () => now };
}

const TICKET = { ticket: 'ticket-1', expiresAt: '2026-11-17T06:45:00.000Z' };

function start(
  answers: () => RingingAnswer,
  extra: { channel?: WakeChannel; renew?: () => Promise<typeof TICKET | undefined> } = {},
) {
  const f = fakeHost();
  const asks: { at: number; ticket: string }[] = [];
  const pops: ScreenPopDto[] = [];
  const stop = startScreenPop({
    ticket: TICKET,
    renewTicket: extra.renew ?? (() => Promise.resolve(undefined)),
    ask: (ticket) => {
      asks.push({ at: f.nowMs(), ticket });
      return Promise.resolve(answers());
    },
    onPop: (pop) => pops.push(pop),
    host: f.host,
    ...(extra.channel === undefined ? {} : { channel: extra.channel }),
  });
  return { ...f, asks, pops, stop };
}

describe('the screen-pop’s poll', () => {
  it('asks at once and then every 3 seconds, and hands on a ringing call', async () => {
    let answer: RingingAnswer = { kind: 'none' };
    const s = start(() => answer);
    await s.advance(POLL_MS * 2);
    expect(s.asks).toHaveLength(3);
    answer = { kind: 'pop', pop: POP };
    await s.advance(POLL_MS);
    expect(s.pops).toEqual([POP]);
    s.stop();
    await s.advance(POLL_MS * 5);
    expect(s.asks).toHaveLength(4);
  });

  it('stops while the page is hidden and asks at once when it is shown again', async () => {
    const s = start(() => ({ kind: 'none' }));
    await s.advance(0);
    s.setVisible(false);
    await s.advance(POLL_MS * 10);
    expect(s.asks).toHaveLength(1);
    s.setVisible(true);
    await s.advance(0);
    expect(s.asks).toHaveLength(2);
    s.stop();
  });

  it('waits longer after each failure, up to a minute, and goes back to 3 seconds after a success', async () => {
    let failing = true;
    const s = start(() => (failing ? { kind: 'failed' } : { kind: 'none' }));
    await s.advance(0);
    await s.advance(POLL_MS * 2);
    await s.advance(POLL_MS * 4);
    await s.advance(POLL_MS * 8);
    const gaps = s.asks.slice(1).map((a, i) => a.at - (s.asks[i]?.at ?? 0));
    expect(gaps).toEqual([POLL_MS * 2, POLL_MS * 4, POLL_MS * 8]);
    await s.advance(MAX_BACKOFF_MS * 3);
    const last = s.asks.slice(-2);
    expect((last[1]?.at ?? 0) - (last[0]?.at ?? 0)).toBe(MAX_BACKOFF_MS);
    failing = false;
    await s.advance(MAX_BACKOFF_MS);
    const before = s.asks.length;
    await s.advance(POLL_MS);
    expect(s.asks.length).toBe(before + 1);
    s.stop();
  });

  it('asks for a new ticket before the old one ends, and at once when the route refuses it', async () => {
    const renew = vi.fn(() =>
      Promise.resolve({ ticket: 'ticket-2', expiresAt: '2026-11-17T07:00:00.000Z' }),
    );
    let refuse = true;
    const s = start(
      () => {
        if (refuse) {
          refuse = false;
          return { kind: 'ticket' };
        }
        return { kind: 'none' };
      },
      { renew },
    );
    await s.advance(POLL_MS);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(s.asks.map((a) => a.ticket)).toEqual(['ticket-1', 'ticket-2']);
    s.stop();
  });
});

describe('the screen-pop over Realtime (a fake channel)', () => {
  function fakeChannel() {
    const events: { wake?: () => void; state?: (up: boolean) => void } = {};
    let closed = false;
    const channel: WakeChannel = (e) => {
      events.wake = e.wake;
      events.state = e.state;
      return () => {
        closed = true;
      };
    };
    return { channel, events, closed: () => closed };
  }

  it('asks at once on a wake-up, and only every 15 seconds as a backstop while the channel is up', async () => {
    const c = fakeChannel();
    let answer: RingingAnswer = { kind: 'none' };
    const s = start(() => answer, { channel: c.channel });
    await s.advance(0);
    c.events.state?.(true);
    await s.advance(POLL_MS);
    const settled = s.asks.length;
    await s.advance(BACKSTOP_MS - POLL_MS - 1);
    expect(s.asks.length).toBe(settled);
    answer = { kind: 'pop', pop: POP };
    c.events.wake?.();
    await s.advance(0);
    expect(s.pops).toEqual([POP]);
    s.stop();
    expect(c.closed()).toBe(true);
  });

  it('polls every 3 seconds again while the channel is down', async () => {
    const c = fakeChannel();
    const s = start(() => ({ kind: 'none' }), { channel: c.channel });
    await s.advance(0);
    c.events.state?.(true);
    await s.advance(BACKSTOP_MS);
    c.events.state?.(false);
    const before = s.asks.length;
    await s.advance(POLL_MS * 3);
    expect(s.asks.length).toBe(before + 3);
    s.stop();
  });

  it('wakes nothing while the page is hidden', async () => {
    const c = fakeChannel();
    const s = start(() => ({ kind: 'pop', pop: POP }), { channel: c.channel });
    await s.advance(0);
    s.setVisible(false);
    const before = s.asks.length;
    c.events.wake?.();
    await s.advance(POLL_MS);
    expect(s.asks.length).toBe(before);
    s.stop();
  });
});

describe('reading the ringing route', () => {
  it('sends the ticket in its header and reads each answer', async () => {
    const answers = [
      new Response(null, { status: 204 }),
      Response.json({ error: { code: 'unauthorized' } }, { status: 401 }),
      Response.json({}, { status: 503 }),
      Response.json(POP),
    ];
    const fetcher = vi.fn(() => Promise.resolve(answers.shift() ?? new Response(null)));
    const seen: RingingAnswer[] = [];
    for (let i = 0; i < 4; i += 1) seen.push(await askRinging('ticket-1', fetcher));
    expect(seen).toEqual([
      { kind: 'none' },
      { kind: 'ticket' },
      { kind: 'failed' },
      { kind: 'pop', pop: POP },
    ]);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/calls/ringing', {
      headers: { 'x-ringing-ticket': 'ticket-1' },
      cache: 'no-store',
    });
  });
});
