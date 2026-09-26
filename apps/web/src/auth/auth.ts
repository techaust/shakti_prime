import { createAuth } from './create-auth';
import { defaultAuthDeps } from './deps';

/** The application's Better Auth instance. Routes, actions and `currentPrincipal()` share it. */
export const auth = createAuth(defaultAuthDeps());
