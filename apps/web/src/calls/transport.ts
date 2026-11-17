/**
 * How a ringing call reaches the screen of the person it rings (docs/03-roadmap-appendix/phase2.md
 * §2 question 4): the 3-second poll of `GET /api/v1/calls/ringing` until the Realtime spike passes
 * on the production site, then Realtime's `user:{id}` channel, switched by one setting,
 * `SCREEN_POP_TRANSPORT=realtime`. Realtime also needs the project's address and publishable key
 * (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and the BOS signing key (`BOS_JWT_CURRENT_KEY`); without
 * any of them the poll stays in use. Both paths take the call from the same route.
 */

type Env = Readonly<Record<string, string | undefined>>;

export type ScreenPopTransport =
  | { kind: 'poll' }
  /** The project's address and its publishable key, which the browser opens the socket with. */
  | { kind: 'realtime'; url: string; key: string };

function set(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** An https address's origin, or undefined for anything else. */
function httpsOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The transport this deployment uses for the screen-pop. */
export function screenPopTransport(env: Env = process.env): ScreenPopTransport {
  if (env.SCREEN_POP_TRANSPORT !== 'realtime') return { kind: 'poll' };
  const url = httpsOrigin(set(env.SUPABASE_URL));
  const key = set(env.SUPABASE_ANON_KEY);
  if (url === undefined || key === undefined || set(env.BOS_JWT_CURRENT_KEY) === undefined) {
    return { kind: 'poll' };
  }
  return { kind: 'realtime', url, key };
}

/** The socket origin a page may connect to for the screen-pop, for its security policy. */
export function realtimeConnectOrigins(env: Env = process.env): string[] {
  const transport = screenPopTransport(env);
  return transport.kind === 'realtime' ? [transport.url.replace(/^https:/, 'wss:')] : [];
}
