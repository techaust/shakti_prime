import type { Principal, VoiceTokenClaims } from '@shakti/contracts';
import { loadUserGrants } from '@shakti/db/grants';
import {
  executeQuery,
  liveVoiceSession,
  resolvePrincipalFromGrants,
  voiceSessionPrincipal,
} from '@shakti/domain';
import { signingKeys, type Env } from '../realtime/keys';
import { bosIssuer } from '../realtime/token';
import { verifyVoiceToken } from '../voice/token';

/** What resolving a voice token reads; tests pass their own. */
export interface VoicePrincipalDeps {
  /** The person's principal as it resolves now, or undefined when they may not act. */
  person: (userId: string) => Promise<Principal | undefined>;
  /** Whether the session is the person's own and live now, read as its voice principal. */
  live: (voice: Principal, now: Date) => Promise<boolean>;
  env?: Env;
  now?: () => Date;
}

const defaultDeps: VoicePrincipalDeps = {
  async person(userId) {
    const outcome = resolvePrincipalFromGrants(userId, await loadUserGrants(userId));
    return outcome.kind === 'principal' ? outcome.principal : undefined;
  },
  live: (voice, now) =>
    executeQuery(
      voice,
      { entityIds: voice.entityIds },
      (context) => liveVoiceSession(context, now),
      { name: 'liveVoiceSession' },
    ),
};

/**
 * The caller a voice token speaks for (docs/07-security.md §3.4, ADR 0010): the token checked
 * (this deployment's key, issuer, audience, expiry), then the person as their grants resolve now
 * (a suspended person, or one whose authenticator app is still to be set up, is no caller), then
 * the voice principal over the session's companies, without either cost permission, and only
 * while that session is the person's own and live. Undefined for anything else.
 */
export async function voicePrincipalFromToken(
  token: string,
  deps: VoicePrincipalDeps = defaultDeps,
): Promise<{ principal: Principal; claims: VoiceTokenClaims } | undefined> {
  const env = deps.env ?? process.env;
  const issuer = bosIssuer(env);
  const keys = await signingKeys(env);
  if (issuer === undefined || keys === undefined) return undefined;
  const now = (deps.now ?? (() => new Date()))();
  const claims = await verifyVoiceToken(token, keys, issuer, now);
  if (claims === undefined) return undefined;
  const person = await deps.person(claims.sub);
  if (person?.id !== claims.sub) return undefined;
  const principal = voiceSessionPrincipal(person, claims.sid, claims.entity_ids);
  if (principal === undefined) return undefined;
  if (!(await deps.live(principal, now))) return undefined;
  return { principal, claims };
}
