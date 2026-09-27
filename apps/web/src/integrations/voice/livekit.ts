import { SignJWT } from 'jose';
import { defaultHttpDeps, jsonBody, ProviderError, providerFetch, type HttpDeps } from '../http';

/**
 * LiveKit Cloud (BLUEPRINT §9.2): the access tokens LiveKit expects (HS256 over the API secret)
 * and the room service over its HTTP API, without the server SDK. The spike uses the room service
 * to time the round trip to the LiveKit region from Mumbai; the media path itself is measured with
 * the Agents worker in Phase 4.
 */

export interface LiveKitConfig {
  /** `wss://<project>.livekit.cloud`, as the dashboard shows it. */
  url: string;
  apiKey: string;
  apiSecret: string;
}

export const LIVEKIT_TIMEOUT_MS = 5_000;

export function liveKitConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): LiveKitConfig | undefined {
  const url = env.LIVEKIT_URL ?? '';
  const apiKey = env.LIVEKIT_API_KEY ?? '';
  const apiSecret = env.LIVEKIT_API_SECRET ?? '';
  if (url === '' || apiKey === '' || apiSecret === '') return undefined;
  return { url, apiKey, apiSecret };
}

export interface VideoGrant {
  roomCreate?: boolean;
  roomList?: boolean;
  roomAdmin?: boolean;
  roomJoin?: boolean;
  room?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
}

/** A LiveKit access token: `iss` is the API key, `sub` the identity, `video` the grant. */
export function liveKitToken(
  config: LiveKitConfig,
  identity: string,
  grant: VideoGrant,
  ttlSeconds = 600,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ video: grant })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(config.apiKey)
    .setSubject(identity)
    .setNotBefore(iat)
    .setIssuedAt(iat)
    .setExpirationTime(iat + ttlSeconds)
    .sign(new TextEncoder().encode(config.apiSecret));
}

/** The HTTPS base of the project for server calls. */
export function liveKitHttpBase(url: string): string {
  return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
}

export interface LiveKitRooms {
  createRoom(name: string): Promise<{ ms: number }>;
  deleteRoom(name: string): Promise<{ ms: number }>;
  listRooms(): Promise<{ ms: number; count: number }>;
}

export function liveKitRooms(
  config: LiveKitConfig,
  deps: HttpDeps = defaultHttpDeps(LIVEKIT_TIMEOUT_MS),
): LiveKitRooms {
  const base = `${liveKitHttpBase(config.url)}/twirp/livekit.RoomService`;

  async function call(method: string, body: Record<string, unknown>, grant: VideoGrant) {
    const token = await liveKitToken(config, 'bos-spike', grant, 60);
    const started = performance.now();
    const response = await providerFetch('livekit', deps, `${base}/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ms = performance.now() - started;
    if (!response.ok) throw new ProviderError('livekit', 'http', { status: response.status });
    return { ms, body: await jsonBody('livekit', response) };
  }

  return {
    async createRoom(name) {
      const { ms } = await call('CreateRoom', { name, empty_timeout: 60 }, { roomCreate: true });
      return { ms };
    },
    async deleteRoom(name) {
      const { ms } = await call('DeleteRoom', { room: name }, { roomCreate: true });
      return { ms };
    },
    async listRooms() {
      const { ms, body } = await call('ListRooms', {}, { roomList: true });
      const rooms = (body as { rooms?: unknown[] } | undefined)?.rooms;
      return { ms, count: Array.isArray(rooms) ? rooms.length : 0 };
    },
  };
}
