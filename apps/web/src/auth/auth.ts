import { createAuth, type Auth } from './create-auth';
import { defaultAuthDeps } from './deps';

let instance: Auth | undefined;

function live(): Auth {
  instance ??= createAuth(defaultAuthDeps());
  return instance;
}

/**
 * The application's Better Auth instance. Routes, actions and `currentPrincipal()` share it.
 * Created on first use, not at import: `next build` loads the route modules to collect page
 * data, and a build machine has no database or auth secrets.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get: (_target, property) => (live() as unknown as Record<PropertyKey, unknown>)[property],
  has: (_target, property) => property in live(),
});
