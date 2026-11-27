import * as LocalAuthentication from 'expo-local-authentication';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { createApi } from './api';
import { createSession, type Biometrics, type Session, type SessionState } from './session';

const SessionContext = createContext<Session | undefined>(undefined);

/** The phone's fingerprint or face, when it has one set up (expo-local-authentication). */
export const phoneBiometrics: Biometrics = {
  async available() {
    return (await LocalAuthentication.hasHardwareAsync()) && LocalAuthentication.isEnrolledAsync();
  },
  async confirm(prompt) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      disableDeviceFallback: true,
    });
    return result.success;
  },
};

/** Holds the app's one session; `session` is for tests, which pass their own. */
export function SessionProvider({ children, session }: { children: ReactNode; session?: Session }) {
  const [value] = useState(() => session ?? createSession(createApi()));
  useEffect(() => {
    if (value.getState().status === 'loading') void value.start();
  }, [value]);
  // Back from five minutes or more in the background, the app asks for the PIN or fingerprint.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void value.cameToForeground();
      else if (next === 'background') value.wentToBackground();
    });
    return () => {
      subscription.remove();
    };
  }, [value]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === undefined) throw new Error('useSession is used outside SessionProvider');
  return session;
}

export function useSessionState(): SessionState {
  const session = useSession();
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
  );
}
