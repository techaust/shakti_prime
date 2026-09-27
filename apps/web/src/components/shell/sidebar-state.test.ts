import { describe, expect, it } from 'vitest';
import { entityDotClass, isSidebarCollapsed, SIDEBAR_COOKIE, sidebarCookie } from './sidebar-state';

describe('the sidebar cookie', () => {
  it('remembers a collapsed sidebar for a year and clears itself when opened again', () => {
    expect(sidebarCookie(true, true)).toBe(
      `${SIDEBAR_COOKIE}=collapsed; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    expect(sidebarCookie(false, false)).toBe(`${SIDEBAR_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  });

  it('reads only its own value as collapsed', () => {
    expect(isSidebarCollapsed('collapsed')).toBe(true);
    expect(isSidebarCollapsed(undefined)).toBe(false);
    expect(isSidebarCollapsed('')).toBe(false);
    expect(isSidebarCollapsed('open')).toBe(false);
  });
});

describe('entityDotClass', () => {
  it('gives the four companies their own dot and wraps after that', () => {
    expect([1, 2, 3, 4].map(entityDotClass)).toEqual([
      'bg-entity-1',
      'bg-entity-2',
      'bg-entity-3',
      'bg-entity-4',
    ]);
    expect(entityDotClass(5)).toBe('bg-entity-1');
    expect(entityDotClass(0)).toBe('bg-entity-4');
  });
});
