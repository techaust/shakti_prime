import {
  compareSemver,
  TOKEN_LIFETIMES,
  type MeResponse,
  type MobileTokenResponse,
} from '@shakti/contracts';
import { appVersion, phoneDetails, type PhoneDetails } from '../config';
import type { MessageKey } from '../i18n';
import { errorKey } from '../i18n';
import type { Api, ApiResult } from './api';
import { tokenStore, type StoredPerson } from './token-store';

/**
 * Where the app stands with the person (docs/03-roadmap-appendix/phase4.md §6.4): signed out, locked
 * behind the PIN or fingerprint, ready, or held by the update gate. The controller is plain
 * TypeScript, so the screens and the tests share it; `SessionProvider` hands it to the screens.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice?: MessageKey }
  | { status: 'locked'; hasPin: boolean }
  | { status: 'ready'; person: StoredPerson | null; offline: boolean }
  | { status: 'updateRequired'; minimum?: string };

/** Wrong PINs before the phone is signed out. */
export const PIN_TRIES = 5;

/** Time in the background after which the app asks for the PIN or fingerprint again. */
export const LOCK_AFTER_BACKGROUND_MS = 5 * 60 * 1000;

/**
 * How long before its expiry the access token is replaced: a call made with a token about to end
 * would be refused on the way. The expiry is counted on the phone's own clock from when the token
 * arrived, with the lifetime the server gives every access token, since a phone's clock may be
 * minutes away from the server's.
 */
export const REFRESH_BEFORE_EXPIRY_MS = 60 * 1000;

/** Reasons that end the phone's sign-in: the person signs in again with their password. */
const SIGNED_OUT = new Set([
  'refresh_expired',
  'refresh_reused',
  'device_revoked',
  'account_suspended',
  'totp_setup_required',
  'unauthorized',
]);

export type SignInOutcome = { ok: true } | { ok: false; error: MessageKey; needsCode: boolean };

export interface Biometrics {
  available(): Promise<boolean>;
  confirm(prompt: string): Promise<boolean>;
}

type Store = typeof tokenStore;

export interface SessionOptions {
  /** The phone's clock, in milliseconds. */
  now?: () => number;
  /** The phone's model and Android version, sent with a sign-in so Team members can tell phones apart. */
  phone?: () => PhoneDetails;
}

export function createSession(api: Api, store: Store = tokenStore, options: SessionOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const phone = options.phone ?? phoneDetails;
  let state: SessionState = { status: 'loading' };
  /** The access token in memory only, with the time on this phone's clock it stops being used. */
  let access: { token: string; useUntil: number } | undefined;
  let refreshing: Promise<string | undefined> | undefined;
  let backgroundSince: number | undefined;
  const listeners = new Set<() => void>();

  const keepAccess = (pair: MobileTokenResponse) => {
    access = {
      token: pair.accessToken,
      useUntil: now() + TOKEN_LIFETIMES.mobileAccess * 1000 - REFRESH_BEFORE_EXPIRY_MS,
    };
  };

  const setState = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  async function signOutHere(notice?: MessageKey): Promise<void> {
    access = undefined;
    await store.clear();
    setState(notice === undefined ? { status: 'signedOut' } : { status: 'signedOut', notice });
  }

  /** Acts on a refusal any call can give: the update gate, or the end of the phone's sign-in. */
  async function refused(reason: string): Promise<boolean> {
    if (reason === 'app_update_required') {
      setState({ status: 'updateRequired' });
      return true;
    }
    if (SIGNED_OUT.has(reason)) {
      await signOutHere(errorKey(reason));
      return true;
    }
    return false;
  }

  /** A new access token from the refresh token; one refresh at a time, however many ask. */
  function refresh(): Promise<string | undefined> {
    refreshing ??= (async () => {
      try {
        const token = await store.refreshToken();
        if (token === null) return undefined;
        const answer = await api.refresh(token, await store.deviceId());
        if (!answer.ok) {
          await refused(answer.reason);
          return undefined;
        }
        await store.saveRefreshToken(answer.data.refreshToken);
        keepAccess(answer.data);
        return answer.data.accessToken;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  }

  /** The access token while it has more than a minute left, else a new one. */
  function currentToken(): Promise<string | undefined> {
    return access !== undefined && now() < access.useUntil
      ? Promise.resolve(access.token)
      : refresh();
  }

  /**
   * A bearer call with a token that has time left. A refusal with no reason (the token ended
   * sooner than this phone's clock said) is answered by one refresh and one more try before
   * anything else; only a second refusal signs the phone out.
   */
  async function withBearer<T>(
    send: (token: string) => Promise<ApiResult<T>>,
  ): Promise<ApiResult<T> | undefined> {
    const token = await currentToken();
    if (token === undefined) return undefined;
    const answer = await send(token);
    if (answer.ok || answer.reason !== 'unauthorized') return answer;
    access = undefined;
    const fresh = await refresh();
    return fresh === undefined ? undefined : send(fresh);
  }

  async function readMe(): Promise<MeResponse | 'offline' | 'refused'> {
    const answer = await withBearer((token) => api.me(token));
    if (answer === undefined) return state.status === 'locked' ? 'offline' : 'refused';
    if (answer.ok) return answer.data;
    if (await refused(answer.reason)) return 'refused';
    return 'offline';
  }

  /** After the PIN or fingerprint: the person and the version gate, or offline work. */
  async function opened(): Promise<void> {
    const me = await readMe();
    if (me === 'refused') return;
    if (me === 'offline') {
      setState({ status: 'ready', person: await store.person(), offline: true });
      return;
    }
    if (compareSemver(appVersion(), me.minimumAppVersion) < 0) {
      setState({ status: 'updateRequired', minimum: me.minimumAppVersion });
      return;
    }
    const person = { name: me.principal.name, email: me.principal.email ?? '' };
    await store.savePerson(person);
    setState({ status: 'ready', person, offline: false });
  }

  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(): Promise<void> {
      if ((await store.refreshToken()) === null) {
        setState({ status: 'signedOut' });
        return;
      }
      setState({ status: 'locked', hasPin: await store.hasPin() });
    },

    async signIn(email: string, password: string, totpCode?: string): Promise<SignInOutcome> {
      const answer = await api.signIn({
        email,
        password,
        ...(totpCode === undefined || totpCode === '' ? {} : { totpCode }),
        device: {
          deviceId: await store.deviceId(),
          platform: 'android',
          ...phone(),
          appVersion: appVersion(),
        },
      });
      if (!answer.ok) {
        if (answer.reason === 'app_update_required') {
          setState({ status: 'updateRequired' });
          return { ok: true };
        }
        return {
          ok: false,
          error: errorKey(answer.reason),
          needsCode: answer.reason === 'totp_required' || answer.reason === 'totp_invalid',
        };
      }
      await store.clear();
      await store.saveRefreshToken(answer.data.refreshToken);
      keepAccess(answer.data);
      setState({ status: 'locked', hasPin: false });
      return { ok: true };
    },

    async choosePin(pin: string): Promise<void> {
      await store.savePin(pin);
      await opened();
    },

    /** The PIN typed; answers the tries left after a wrong one, or none when it opened. */
    async unlockWithPin(pin: string): Promise<{ triesLeft: number } | undefined> {
      if (await store.pinMatches(pin)) {
        await store.savePinTries(0);
        await opened();
        return undefined;
      }
      const tries = (await store.pinTries()) + 1;
      if (tries >= PIN_TRIES) {
        await signOutHere('unlock.tooManyTries');
        return { triesLeft: 0 };
      }
      await store.savePinTries(tries);
      return { triesLeft: PIN_TRIES - tries };
    },

    async unlockWithBiometric(biometrics: Biometrics, prompt: string): Promise<boolean> {
      if (!(await biometrics.confirm(prompt))) return false;
      await opened();
      return true;
    },

    /**
     * Signs this phone out at the server when it can, and here always. A token with little time
     * left is refreshed first, so the server's row is ended rather than the call refused.
     */
    async signOut(): Promise<void> {
      await withBearer((token) => api.revoke(token));
      await signOutHere();
    },

    /** The access token for a call: the one in memory while it has time left, else a new one. */
    accessToken: currentToken,

    /** The app went to the background (React Native's `AppState`). */
    wentToBackground(): void {
      backgroundSince ??= now();
    },

    /** The app came back: after five minutes away, the PIN or fingerprint is asked again. */
    async cameToForeground(): Promise<void> {
      const since = backgroundSince;
      backgroundSince = undefined;
      if (since === undefined || now() - since < LOCK_AFTER_BACKGROUND_MS) return;
      if (state.status !== 'ready') return;
      setState({ status: 'locked', hasPin: await store.hasPin() });
    },
  };
}

export type Session = ReturnType<typeof createSession>;
