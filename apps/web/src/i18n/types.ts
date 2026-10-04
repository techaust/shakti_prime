import type en from '../../messages/en.json';

// Message keys are checked by the compiler (AUDIT M44): a key that is not in the catalogue is a
// type error, not a raw key path on someone's screen.
/** A sentence under `errors.*`; an action's error key is checked against this before display. */
export type ErrorKey = keyof (typeof en)['errors'];

/** A staff role's display name under `roles.*`. */
export type RoleNameKey = keyof (typeof en)['roles'];

/** A permission's plain name under `adminRoles.permissions.*` (`permissionMessageKey()`). */
export type PermissionNameKey = keyof (typeof en)['adminRoles']['permissions'];

/** A module's name under `adminRoles.modules.*`. */
export type ModuleNameKey = keyof (typeof en)['adminRoles']['modules'];

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof en;
  }
}
