/**
 * The sidebar's open or collapsed state, remembered per device (DESIGN.md §5). A cookie, not
 * browser storage, so the server draws the sidebar at the right width on the first paint. It
 * holds only this preference, so the page may write it.
 */
export const SIDEBAR_COOKIE = 'sidebar';

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export function isSidebarCollapsed(value: string | undefined): boolean {
  return value === 'collapsed';
}

/** The `document.cookie` line for a choice; an open sidebar clears the cookie. */
export function sidebarCookie(collapsed: boolean, secure: boolean): string {
  const value = collapsed ? 'collapsed' : '';
  const maxAge = collapsed ? ONE_YEAR_SECONDS : 0;
  return `${SIDEBAR_COOKIE}=${value}; Path=/; Max-Age=${String(maxAge)}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * Saves the choice on this device. A browser that blocks cookies (a private window, a locked-down
 * profile) keeps the choice for this page only; the menu still works.
 */
export function rememberSidebar(collapsed: boolean): void {
  try {
    document.cookie = sidebarCookie(collapsed, window.location.protocol === 'https:');
  } catch {
    // the choice lasts until the page is reloaded
  }
}

/** The small company dot (DESIGN.md §2.4: `entity-1` … `entity-4`, never a surface). */
const ENTITY_DOTS = ['bg-entity-1', 'bg-entity-2', 'bg-entity-3', 'bg-entity-4'] as const;

export function entityDotClass(entityId: number): string {
  const index = (((entityId - 1) % ENTITY_DOTS.length) + ENTITY_DOTS.length) % ENTITY_DOTS.length;
  return ENTITY_DOTS[index] ?? 'bg-entity-1';
}
