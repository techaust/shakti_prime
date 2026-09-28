import { ThemeSchema } from '@shakti/contracts';
import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { currentSession } from '../../auth/current-principal';
import { AppShell } from '../../components/shell/app-shell';
import { isSidebarCollapsed, SIDEBAR_COOKIE } from '../../components/shell/sidebar-state';
import { ContrastSync, ThemeSync } from '../../components/theme';
import type { RoleNameKey } from '../../i18n/types';
import { canSearch, visibleActions, visibleNav } from '../../screens/menu-access';
import { CONTRAST_COOKIE, isHighContrast } from '../../theme';

/**
 * The BOS route group: nobody reaches a screen without a usable session. The proxy has already
 * sent a request without a session cookie to sign-in; this is the full check. Pages check again,
 * because a layout does not re-run on every client navigation. The shell shows only the screens
 * the principal's own grants open.
 */
export default async function BosLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect('/sign-in');
  if (session.blocked !== undefined) redirect('/sign-in?reason=no_access');
  if (!session.principal) redirect('/two-factor');
  const principal = session.principal;
  const roles = await getTranslations('roles');
  const theme = ThemeSchema.catch('system').parse(session.access.theme);
  const jar = await cookies();
  const collapsed = isSidebarCollapsed(jar.get(SIDEBAR_COOKIE)?.value);
  // The profile's contrast, and whether this device's first-paint cookie still says otherwise.
  const high = session.access.contrast === 'high';
  const contrastStale = isHighContrast(jar.get(CONTRAST_COOKIE)?.value) !== high;
  return (
    <>
      <ThemeSync saved={theme} />
      {contrastStale ? <ContrastSync saved={high} /> : null}
      <AppShell
        // A signed-in person always holds a staff role; agents never sign in here.
        user={{ name: session.access.name, role: roles(principal.roleKey as RoleNameKey) }}
        companies={session.access.entities.map((e) => ({
          entityId: e.entityId,
          label: e.entityName,
        }))}
        activeCompany={principal.entityIds.length === 1 ? principal.entityIds[0] : undefined}
        navIds={visibleNav(principal.permissions).map((item) => item.id)}
        actionIds={visibleActions(principal.permissions).map((action) => action.id)}
        searchable={canSearch(principal.permissions)}
        theme={theme}
        sidebarCollapsed={collapsed}
      >
        {children}
      </AppShell>
    </>
  );
}
