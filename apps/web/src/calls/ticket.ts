import { randomBytes } from 'node:crypto';
import { hmacSha256Hex, safeEqual } from '../integrations/http';

/**
 * The screen-pop's ticket (docs/03-roadmap-appendix/phase2.md §7.4): what lets a screen ask
 * `GET /api/v1/calls/ringing` every 3 seconds without a database read. A signed-in person's page
 * is handed one with the shell, signed with a key drawn from `BETTER_AUTH_SECRET`; it names the
 * person and when it ends, and nothing else. The route checks it in constant time and then reads
 * only that person's ringing call. It travels in a header, never a cookie, so another site cannot
 * make a browser send it, and it opens nothing besides the ringing route: a pop that is waiting
 * is shown only after the person's own session is read.
 */

/** A ticket lasts 15 minutes, as a Realtime token does; the screen asks for a new one before. */
export const RINGING_TICKET_SECONDS = 15 * 60;

export { RINGING_TICKET_HEADER } from './pop-transport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Without an auth secret (a developer's machine), tickets are signed with a key of this process
// alone, which is enough there.
let processSecret: string | undefined;

function signingKey(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env.BETTER_AUTH_SECRET ?? '';
  processSecret ??= randomBytes(32).toString('base64url');
  return configured === '' ? processSecret : `ringing-ticket:${configured}`;
}

/** A ticket for this person, ending `RINGING_TICKET_SECONDS` from `now`. */
export function mintRingingTicket(
  userId: string,
  now: Date = new Date(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): { ticket: string; expiresAt: string } {
  const ends = Math.floor(now.getTime() / 1000) + RINGING_TICKET_SECONDS;
  const body = `${userId}.${String(ends)}`;
  return {
    ticket: `${body}.${hmacSha256Hex(signingKey(env), body)}`,
    expiresAt: new Date(ends * 1000).toISOString(),
  };
}

/** The person a ticket names, or undefined for one that is malformed, forged or past its end. */
export function readRingingTicket(
  ticket: string | null | undefined,
  now: Date = new Date(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (ticket === null || ticket === undefined || ticket.length > 200) return undefined;
  const [userId, ends, signature, ...rest] = ticket.split('.');
  if (userId === undefined || ends === undefined || signature === undefined || rest.length > 0) {
    return undefined;
  }
  if (!UUID.test(userId) || !/^\d{1,12}$/.test(ends)) return undefined;
  if (!safeEqual(signature, hmacSha256Hex(signingKey(env), `${userId}.${ends}`))) return undefined;
  return Number(ends) * 1000 > now.getTime() ? userId : undefined;
}
