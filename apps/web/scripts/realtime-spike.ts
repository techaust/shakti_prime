// The Realtime JWT spike (docs/design/backend-weeks-3-5.md §2.5, docs/spikes/realtime.md). Against
// the hosted Supabase dev project, with tokens signed by the same key the deployed BOS publishes:
//   1. the deployed BOS publishes its discovery document and a key list naming the signing key;
//   2. user A joins user:{A}, entity:{e}:queue and entity:{e}:board for an entity in scope;
//   3. user A is refused user:{B}, entity:{other}:queue, and every channel with a token of another
//      audience, an expired token or a token signed by an unpublished key;
//   4. the Data API refuses the token;
//   5. join and broadcast latency, p50 and p95.
// It talks to real services, so it never runs in CI and needs every variable below.
// Usage: pnpm --filter web realtime-spike
import { newId, type Principal } from '@shakti/contracts';
import { SignJWT } from 'jose';
import { parseSigningKeys, type SigningKeys } from '../src/realtime/keys';
import { newSigningKeyJson } from '../src/realtime/test-keys';
import {
  bosIssuer,
  JWKS_PATH,
  mintRealtimeToken,
  OPENID_CONFIGURATION_PATH,
} from '../src/realtime/token';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'BETTER_AUTH_URL',
  'BOS_JWT_CURRENT_KEY',
  'REALTIME_SPIKE_USER_ID',
  'REALTIME_SPIKE_ENTITY_ID',
  'REALTIME_SPIKE_OTHER_ENTITY_ID',
] as const;

const JOIN_TIMEOUT_MS = 5_000;
/** A refusal can arrive just after a join reply; wait this long before counting a join as open. */
const SETTLE_MS = 1_000;

if (process.env.CI !== undefined && process.env.CI !== '') {
  console.error('the Realtime spike talks to a hosted project and never runs in CI');
  process.exit(1);
}
const missing = REQUIRED.filter((name) => (process.env[name] ?? '') === '');
if (missing.length > 0) {
  console.error(`set ${missing.join(', ')} first (docs/spikes/realtime.md)`);
  process.exit(1);
}

function env(name: (typeof REQUIRED)[number]): string {
  return process.env[name] ?? '';
}

const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
const anonKey = env('SUPABASE_ANON_KEY');
const issuer = bosIssuer();
if (issuer?.startsWith('https://') !== true) {
  console.error('BETTER_AUTH_URL must be the public https address of the deployed BOS');
  process.exit(1);
}
const rounds = Number(process.env.REALTIME_SPIKE_ROUNDS ?? '20');
const entityId = Number(env('REALTIME_SPIKE_ENTITY_ID'));
const otherEntityId = Number(env('REALTIME_SPIKE_OTHER_ENTITY_ID'));
const userA: Principal = {
  id: env('REALTIME_SPIKE_USER_ID'),
  kind: 'user',
  roleKey: 'tele_caller_cc',
  entityIds: [entityId],
  permissions: [],
};

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.error(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round((sorted[Math.max(0, index)] ?? Number.NaN) * 10) / 10;
}

// ---- A minimal Phoenix channel client for Supabase Realtime (protocol 1.0.0, JSON frames). ----

interface Frame {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
  join_ref?: string | null;
}

class RealtimeSocket {
  private ws: WebSocket;
  private ref = 0;
  private listeners = new Set<(frame: Frame) => void>();
  private heartbeat: NodeJS.Timeout | undefined;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(String(event.data)) as Frame;
      for (const listener of this.listeners) listener(frame);
    });
    this.heartbeat = setInterval(() => {
      this.send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.nextRef() });
    }, 25_000);
  }

  static open(): Promise<RealtimeSocket> {
    const url = `${supabaseUrl.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      ws.addEventListener('open', () => {
        resolve(new RealtimeSocket(ws));
      });
      ws.addEventListener('error', () => {
        reject(new Error('the Realtime socket did not open'));
      });
    });
  }

  nextRef(): string {
    this.ref += 1;
    return String(this.ref);
  }

  send(frame: Frame): void {
    this.ws.send(JSON.stringify(frame));
  }

  on(listener: (frame: Frame) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Joins a private broadcast channel. Resolves with the outcome and the time to the reply. */
  join(
    channel: string,
    token: string,
  ): Promise<{ ok: boolean; ms: number; detail: string; joinRef: string }> {
    const topic = `realtime:${channel}`;
    const joinRef = this.nextRef();
    const started = performance.now();
    return new Promise((resolve) => {
      let replied: { ms: number } | undefined;
      const finish = (ok: boolean, detail: string) => {
        off();
        clearTimeout(timer);
        resolve({ ok, ms: replied?.ms ?? performance.now() - started, detail, joinRef });
      };
      const off = this.on((frame) => {
        if (frame.topic !== topic) return;
        const status = frame.payload.status;
        if (frame.event === 'phx_reply' && frame.ref === joinRef) {
          if (status === 'ok') {
            replied = { ms: performance.now() - started };
            setTimeout(() => {
              finish(true, 'joined');
            }, SETTLE_MS);
          } else {
            finish(false, JSON.stringify(frame.payload.response ?? frame.payload));
          }
        } else if (
          frame.event === 'phx_close' ||
          frame.event === 'phx_error' ||
          (frame.event === 'system' && status === 'error')
        ) {
          finish(false, `${frame.event} ${JSON.stringify(frame.payload)}`);
        }
      });
      const timer = setTimeout(() => {
        finish(false, 'no reply');
      }, JOIN_TIMEOUT_MS);
      this.send({
        topic,
        event: 'phx_join',
        payload: {
          config: {
            broadcast: { ack: true, self: true },
            presence: { key: '', enabled: false },
            postgres_changes: [],
            private: true,
          },
          access_token: token,
        },
        ref: joinRef,
        join_ref: joinRef,
      });
    });
  }

  leave(channel: string, joinRef: string): void {
    this.send({
      topic: `realtime:${channel}`,
      event: 'phx_leave',
      payload: {},
      ref: this.nextRef(),
      join_ref: joinRef,
    });
  }

  /** Sends a broadcast and times it until it comes back to this socket (`self: true`). */
  broadcastRoundTrip(channel: string, joinRef: string): Promise<number | undefined> {
    const topic = `realtime:${channel}`;
    const marker = newId();
    const started = performance.now();
    return new Promise((resolve) => {
      const off = this.on((frame) => {
        if (frame.topic !== topic || frame.event !== 'broadcast') return;
        const inner = frame.payload.payload as { marker?: string } | undefined;
        if (inner?.marker === marker) {
          off();
          clearTimeout(timer);
          resolve(performance.now() - started);
        }
      });
      const timer = setTimeout(() => {
        off();
        resolve(undefined);
      }, JOIN_TIMEOUT_MS);
      this.send({
        topic,
        event: 'broadcast',
        payload: { type: 'broadcast', event: 'spike', payload: { marker } },
        ref: this.nextRef(),
        join_ref: joinRef,
      });
    });
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.ws.close();
  }
}

// ---- The run. ----

async function discovery(keys: SigningKeys): Promise<void> {
  const config = await fetch(new URL(OPENID_CONFIGURATION_PATH, issuer), {
    signal: AbortSignal.timeout(5_000),
  });
  const body = (await config.json().catch(() => ({}))) as { issuer?: string; jwks_uri?: string };
  record(
    'discovery document',
    config.ok && body.issuer === issuer,
    `${String(config.status)} issuer=${String(body.issuer)}`,
  );
  const jwks = await fetch(new URL(JWKS_PATH, issuer), { signal: AbortSignal.timeout(5_000) });
  const list = (await jwks.json().catch(() => ({ keys: [] }))) as { keys?: { kid?: string }[] };
  const kids = (list.keys ?? []).map((k) => k.kid);
  record(
    'key list names the signing key',
    jwks.ok && kids.includes(keys.current.kid),
    `${String(jwks.status)} kids=${kids.join(',')} cache=${String(jwks.headers.get('cache-control'))}`,
  );
}

async function expectJoin(
  socket: RealtimeSocket,
  name: string,
  channel: string,
  token: string,
  allowed: boolean,
): Promise<void> {
  const outcome = await socket.join(channel, token);
  record(name, outcome.ok === allowed, `${outcome.detail} (${outcome.ms.toFixed(0)} ms)`);
  if (outcome.ok) socket.leave(channel, outcome.joinRef);
}

async function main(): Promise<void> {
  const keys = await parseSigningKeys();
  if (keys === undefined) throw new Error('BOS_JWT_CURRENT_KEY is empty');
  const hostIssuer = issuer ?? '';
  await discovery(keys);

  const mintStart = performance.now();
  const { token } = await mintRealtimeToken(userA, keys, { issuer: hostIssuer });
  const mintMs = performance.now() - mintStart;

  const socket = await RealtimeSocket.open();
  try {
    await expectJoin(socket, 'own user channel', `user:${userA.id}`, token, true);
    await expectJoin(
      socket,
      'entity queue in scope',
      `entity:${String(entityId)}:queue`,
      token,
      true,
    );
    await expectJoin(
      socket,
      'entity board in scope',
      `entity:${String(entityId)}:board`,
      token,
      true,
    );
    await expectJoin(socket, "another user's channel", `user:${newId()}`, token, false);
    await expectJoin(
      socket,
      "another entity's queue",
      `entity:${String(otherEntityId)}:queue`,
      token,
      false,
    );

    const now = Math.floor(Date.now() / 1000);
    const wrongAudience = await new SignJWT({
      sub: userA.id,
      role: 'authenticated',
      bos_role: userA.roleKey,
      entity_ids: userA.entityIds,
    })
      .setProtectedHeader({ alg: 'ES256', kid: keys.current.kid, typ: 'JWT' })
      .setIssuer(hostIssuer)
      .setAudience('shakti-mobile')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(keys.current.privateKey);
    await expectJoin(socket, 'token of another audience', `user:${userA.id}`, wrongAudience, false);

    const expired = await mintRealtimeToken(userA, keys, {
      issuer: hostIssuer,
      now: new Date(Date.now() - 20 * 60_000),
    });
    await expectJoin(socket, 'expired token', `user:${userA.id}`, expired.token, false);

    // A key nobody published, under the published kid: only the signature tells them apart.
    const stranger = await parseSigningKeys({
      BOS_JWT_CURRENT_KEY: await newSigningKeyJson(keys.current.kid),
    });
    if (stranger === undefined) throw new Error('the stranger key did not parse');
    const forged = await mintRealtimeToken(userA, stranger, { issuer: hostIssuer });
    await expectJoin(
      socket,
      'token signed by an unpublished key',
      `user:${userA.id}`,
      forged.token,
      false,
    );

    // Latency: a fresh join per round, then a broadcast round trip on the joined channel.
    const joins: number[] = [];
    const broadcasts: number[] = [];
    for (let i = 0; i < rounds; i += 1) {
      const channel = `user:${userA.id}`;
      const joined = await socket.join(channel, token);
      if (!joined.ok) break;
      joins.push(joined.ms);
      const trip = await socket.broadcastRoundTrip(channel, joined.joinRef);
      if (trip !== undefined) broadcasts.push(trip);
      socket.leave(channel, joined.joinRef);
    }
    record(
      'join latency',
      joins.length === rounds,
      `n=${String(joins.length)} p50=${String(percentile(joins, 50))} ms p95=${String(percentile(joins, 95))} ms`,
    );
    console.error(
      broadcasts.length > 0
        ? `INFO  broadcast round trip n=${String(broadcasts.length)} p50=${String(percentile(broadcasts, 50))} ms p95=${String(percentile(broadcasts, 95))} ms`
        : 'INFO  broadcast round trip skipped: spike-only-latency.sql is not applied',
    );
    console.error(`INFO  token signing ${mintMs.toFixed(1)} ms`);
  } finally {
    socket.close();
  }

  // The Data API must not accept the token for anything.
  for (const path of [
    '/rest/v1/',
    '/rest/v1/entities?select=id&limit=1',
    '/rest/v1/users?select=id&limit=1',
  ]) {
    const response = await fetch(`${supabaseUrl}${path}`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    record(`Data API refuses the token: ${path}`, response.status >= 400, String(response.status));
  }

  const failed = checks.filter((c) => !c.pass);
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), checks }, null, 2)}\n`);
  if (failed.length > 0) {
    console.error(`${String(failed.length)} check(s) failed`);
    process.exit(1);
  }
  console.error('all checks passed');
}

await main();
