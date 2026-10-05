/**
 * The message groups the browser needs (AUDIT L12): only what client components translate. The
 * rest of the catalogue, mail and role names included, stays on the server.
 * `client-namespaces.test.ts` checks every client component against this list.
 */
export const CLIENT_NAMESPACES = [
  'app',
  'auth',
  'errors',
  'errorPage',
  'fields',
  'nav',
  'shell',
  'theme',
  'common',
  'companies',
  'priceMaster',
  'leads',
  'users',
  'roles',
  'adminRoles',
  'activity',
  'imports',
  'customers',
  'catalogue',
  'taxSettings',
  'integrations',
  'pipelineSettings',
  'sizing',
  'files',
  'quotes',
] as const;
