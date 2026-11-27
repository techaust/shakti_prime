import { compareSemver, type MeResponse } from '@shakti/contracts';
import { appVersion } from '../config';
import type { MessageKey } from '../i18n';
import { errorKey } from '../i18n';
import type { Api } from './api';
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

export function createSession(api: Api, store: Store = tokenStore) {
  let state: SessionState = { status: 'loading' };
  let accessToken: string | undefined;
  let refreshing: Promise<string | undefined> | undefined;
  const listeners = new Set<() => void>();

  const setState = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  async function signOutHere(notice?: MessageKey): Promise<void> {
    accessToken = undefined;
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
        accessToken = answer.data.accessToken;
        return accessToken;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  }

  async function readMe(): Promise<MeResponse | 'offline' | 'refused'> {
    const token = accessToken ?? (await refresh());
    if (token === undefined) return state.status === 'locked' ? 'offline' : 'refused';
    const answer = await api.me(token);
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
      setState({ status: 'locked', hasPin: (await store.pin()) !== null });
    },

    async signIn(email: string, password: string, totpCode?: string): Promise<SignInOutcome> {
      const answer = await api.signIn({
        email,
        password,
        ...(totpCode === undefined || totpCode === '' ? {} : { totpCode }),
        device: { deviceId: await store.deviceId(), platform: 'android', appVersion: appVersion() },
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
      accessToken = answer.data.accessToken;
      setState({ status: 'locked', hasPin: false });
      return { ok: true };
    },

    async choosePin(pin: string): Promise<void> {
      await store.savePin(pin);
      await opened();
    },

    /** The PIN typed; answers the tries left after a wrong one, or none when it opened. */
    async unlockWithPin(pin: string): Promise<{ triesLeft: number } | undefined> {
      if (pin === (await store.pin())) {
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

    /** Signs this phone out at the server when it can, and here always. */
    async signOut(): Promise<void> {
      const token = accessToken ?? (await refresh());
      if (token !== undefined) await api.revoke(token);
      await signOutHere();
    },

    /** The access token for a call, refreshed when there is none. */
    accessToken: () => (accessToken === undefined ? refresh() : Promise.resolve(accessToken)),
  };
}

export type Session = ReturnType<typeof createSession>;
