import type { ScreenPopDto } from '@shakti/contracts';

/**
 * How a caller's page learns that a call rings for them (docs/03-roadmap-appendix/phase2.md §7.4,
 * question 4): it asks `GET /api/v1/calls/ringing` with its ticket every 3 seconds while the page
 * is in view, and not at all while it is hidden; it waits longer after each failed ask (up to a
 * minute) and asks at once when the page comes back into view. With Realtime, a wake-up on the
 * person's own channel asks at once, and the asking slows to every 15 seconds as a backstop for a
 * wake-up that never arrives; while the channel is down, the 3-second poll returns. Kept free of
 * React and the browser's globals, so its timing is tested with a fake clock and channel.
 */

/** The header a screen sends its ticket in (`src/calls/ticket.ts`). */
export const RINGING_TICKET_HEADER = 'x-ringing-ticket';

export const POLL_MS = 3_000;
/** The asking while Realtime is up: only a backstop. */
export const BACKSTOP_MS = 15_000;
/** The longest wait after failed asks. */
export const MAX_BACKOFF_MS = 60_000;
/** A ticket is renewed this long before it ends. */
export const RENEW_BEFORE_MS = 60_000;

/** What one ask of the ringing route answered. */
export type RingingAnswer =
  | { kind: 'pop'; pop: ScreenPopDto }
  | { kind: 'none' }
  /** The ticket is missing, forged or past its end: a new one is asked for. */
  | { kind: 'ticket' }
  | { kind: 'failed' };

export interface Ticket {
  ticket: string;
  /** When it ends, as an ISO instant. */
  expiresAt: string;
}

/** The page and the clock the asking runs against; the component passes the browser's. */
export interface PopHost {
  now: () => number;
  visible: () => boolean;
  /** Calls `listener` whenever the page is shown or hidden; answers how to stop. */
  onVisibility: (listener: () => void) => () => void;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
}

/** A Realtime channel that wakes the page: `wake` on a ringing call, `state` as it joins or drops. */
export type WakeChannel = (events: {
  wake: () => void;
  state: (up: boolean) => void;
}) => () => void;

export interface PopOptions {
  ticket: Ticket;
  renewTicket: () => Promise<Ticket | undefined>;
  ask: (ticket: string) => Promise<RingingAnswer>;
  onPop: (pop: ScreenPopDto) => void;
  host: PopHost;
  /** The person's Realtime channel; absent while the poll is the transport. */
  channel?: WakeChannel;
}

/** Starts asking; answers how to stop (when the shell unmounts). */
export function startScreenPop(options: PopOptions): () => void {
  const { host } = options;
  let ticket = options.ticket;
  let stopped = false;
  let asking = false;
  let again = false;
  let failures = 0;
  let realtimeUp = false;
  let timer: unknown;

  const interval = () => (realtimeUp ? BACKSTOP_MS : POLL_MS);
  // Read through a function: the shell may stop the asking while an ask is on its way.
  const ended = () => stopped;

  function schedule(ms: number): void {
    if (timer !== undefined) host.clearTimer(timer);
    timer = undefined;
    if (stopped || !host.visible()) return;
    timer = host.setTimer(() => {
      timer = undefined;
      void ask();
    }, ms);
  }

  async function freshTicket(): Promise<boolean> {
    if (Date.parse(ticket.expiresAt) - host.now() > RENEW_BEFORE_MS) return true;
    const renewed = await options.renewTicket().catch(() => undefined);
    if (renewed === undefined) return false;
    ticket = renewed;
    return true;
  }

  async function ask(): Promise<void> {
    if (stopped || !host.visible()) return;
    // One ask at a time; a wake-up during an ask asks again right after it.
    if (asking) {
      again = true;
      return;
    }
    asking = true;
    let answer: RingingAnswer = { kind: 'failed' };
    try {
      answer = (await freshTicket())
        ? await options.ask(ticket.ticket).catch((): RingingAnswer => ({ kind: 'failed' }))
        : { kind: 'failed' };
      if (answer.kind === 'ticket') {
        // Asked again for a ticket at once; the next ask uses it.
        ticket = { ...ticket, expiresAt: new Date(0).toISOString() };
        answer = (await freshTicket()) ? { kind: 'none' } : { kind: 'failed' };
      }
    } finally {
      asking = false;
    }
    if (ended()) return;
    if (answer.kind === 'pop') options.onPop(answer.pop);
    failures = answer.kind === 'failed' ? failures + 1 : 0;
    if (again) {
      again = false;
      schedule(0);
      return;
    }
    schedule(failures === 0 ? interval() : Math.min(interval() * 2 ** failures, MAX_BACKOFF_MS));
  }

  // Shown again: asked at once, the waiting after failures forgotten. Hidden: the timer stops.
  const stopVisibility = host.onVisibility(() => {
    if (host.visible()) failures = 0;
    schedule(0);
  });

  const stopChannel = options.channel?.({
    wake: () => {
      schedule(0);
    },
    state: (up) => {
      realtimeUp = up;
      if (!up) schedule(POLL_MS);
    },
  });

  schedule(0);
  return () => {
    stopped = true;
    if (timer !== undefined) host.clearTimer(timer);
    stopVisibility();
    stopChannel?.();
  };
}

/** Reads one answer of the ringing route. */
export async function askRinging(
  ticket: string,
  fetcher: typeof fetch = fetch,
): Promise<RingingAnswer> {
  const response = await fetcher('/api/v1/calls/ringing', {
    headers: { [RINGING_TICKET_HEADER]: ticket },
    cache: 'no-store',
  });
  if (response.status === 204) return { kind: 'none' };
  if (response.status === 401) return { kind: 'ticket' };
  if (!response.ok) return { kind: 'failed' };
  return { kind: 'pop', pop: (await response.json()) as ScreenPopDto };
}
