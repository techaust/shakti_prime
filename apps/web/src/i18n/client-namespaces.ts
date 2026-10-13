import type en from '../../messages/en.json';

/** A top-level group of the message catalogue. */
export type Namespace = keyof typeof en;

/**
 * The message groups the browser gets, by where the page is (AUDIT L12, WEB-1): only what the
 * client components of that part of the app translate, and each group once. A provider adds its
 * groups to the ones above it (`ClientMessages`): the root layout's go to every page, a route
 * group's to its pages, and a `(bos)` screen's own to that screen alone. Everything else (mail,
 * print, the home page's server text, role names) stays on the server.
 * `client-namespaces.test.ts` follows each scope's imports and checks this list against them.
 */
export const CLIENT_SCOPES = {
  /** The root error screen. */
  root: ['app', 'errorPage'],
  /** Sign-in, passwords and the code screen; their errors are cut to `PUBLIC_ERROR_KEYS`. */
  public: ['auth', 'errors', 'fields'],
  /** The app shell: the menu, the top bar, the search palette and the notification centre. */
  bos: ['auth', 'errors', 'fields', 'nav', 'notifications', 'shell', 'theme'],
  '/admin': [
    'activity',
    'adminRoles',
    'agents',
    'catalogue',
    'common',
    'customers',
    'duplicates',
    'files',
    'imports',
    'integrations',
    'knowledge',
    'leads',
    'orders',
    'pipelineSettings',
    'priceMaster',
    'quotes',
    'roles',
    'sizing',
    'targets',
    'users',
  ],
  '/calling': ['activity', 'calling', 'common', 'customers', 'leads', 'pipelineSettings', 'sizing'],
  '/catalogue': ['catalogue', 'common'],
  '/converters': ['common', 'converters', 'roles', 'users'],
  '/converting': ['calling', 'common', 'converting', 'customers', 'leads', 'quotes', 'sizing'],
  '/customers': [
    'common',
    'customers',
    'duplicates',
    'files',
    'leads',
    'orders',
    'pinLookup',
    'quotes',
    'sizing',
  ],
  '/dealer-credit': ['common', 'dealerCredit'],
  '/design': ['common', 'leads'],
  '/duplicates': ['common', 'duplicates', 'leads'],
  '/home': [],
  '/imports': ['common', 'files', 'imports', 'leads'],
  '/inbox': ['activity', 'agents', 'common', 'customers'],
  '/knowledge': ['common', 'files', 'knowledge'],
  '/leads': ['common', 'leads', 'pinLookup'],
  '/orders': ['common', 'orders', 'quotes'],
  '/price-master': ['catalogue', 'common', 'priceMaster'],
  '/quotes': ['common', 'files', 'orders', 'quotes'],
  '/settings': [
    'activity',
    'common',
    'companies',
    'files',
    'pipelineSettings',
    'profile',
    'taxSettings',
  ],
  '/targets': ['targets'],
} as const satisfies Record<string, readonly Namespace[]>;

export type ClientScope = keyof typeof CLIENT_SCOPES;
