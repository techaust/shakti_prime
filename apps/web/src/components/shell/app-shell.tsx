'use client';

import type { Theme } from '@shakti/contracts';
import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetTitle,
  Toaster,
  usePaletteShortcut,
} from '@shakti/ui';
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NAV_ITEMS } from '../../nav';
import { CompanySwitcher, type CompanyOption } from './company-switcher';
import { ProfileMenu } from './profile-menu';
import { ShellPalette } from './shell-palette';
import { rememberSidebar } from './sidebar-state';
import { SidebarNav } from './sidebar-nav';

const noSubscribe = () => () => undefined;

/** ⌘K on a Mac, Ctrl K elsewhere; the server draws Ctrl K and the browser corrects it. */
function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.userAgent),
    () => false,
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  const app = useTranslations('app');
  const name = app('name');
  return (
    <Link
      href="/home"
      className={cn(
        'text-text flex h-topbar shrink-0 items-center gap-2 px-4 font-[590]',
        collapsed && 'justify-center px-0',
      )}
    >
      <span
        aria-hidden
        className="bg-accent text-accent-fg inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs"
      >
        {name.charAt(0)}
      </span>
      <span className={cn('truncate', collapsed && 'sr-only')}>{name}</span>
    </Link>
  );
}

/**
 * The BOS app shell (DESIGN.md §5): a 240 px sidebar that collapses to 56 px icons and remembers
 * the choice on this device, a 48 px top bar with the company switcher, the ⌘K palette and the
 * profile menu, and the page below. Under `md` the sidebar opens as a sheet from the top bar.
 * Everything shown is decided on the server: the screens come from the principal's grants.
 */
export function AppShell({
  user,
  companies,
  activeCompany,
  navIds,
  actionIds,
  searchable,
  theme,
  sidebarCollapsed,
  children,
}: {
  user: { name: string; role: string };
  companies: readonly CompanyOption[];
  activeCompany: number | undefined;
  /** The ids of the `nav.ts` items the principal's grants open, from `visibleNav()`. */
  navIds: readonly string[];
  /** The ids of the palette actions the principal's grants allow, from `visibleActions()`. */
  actionIds: readonly string[];
  /** Whether the palette may search leads or team members, from `canSearch()`. */
  searchable: boolean;
  theme: Theme;
  sidebarCollapsed: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('shell');
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const isMac = useIsMac();

  const items = useMemo(() => NAV_ITEMS.filter((i) => navIds.includes(i.id)), [navIds]);
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // A followed link closes the phone menu, including the browser's back and forward buttons.
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  const togglePalette = useCallback(() => {
    setPaletteOpen((open) => !open);
  }, []);
  usePaletteShortcut(togglePalette);

  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    rememberSidebar(next);
  }

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main-content"
        className="bg-surface text-text border-border-strong shadow-1 sr-only z-50 rounded-md border px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('skipToContent')}
      </a>

      <aside
        className={cn(
          'bg-surface-2 border-border sticky top-0 hidden h-dvh shrink-0 flex-col border-r md:flex',
          'transition-[width] duration-(--motion-panel) ease-out',
          collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
        )}
      >
        <Brand collapsed={collapsed} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
          <SidebarNav items={items} collapsed={collapsed} />
        </div>
        <div className={cn('border-border border-t p-2', collapsed && 'flex justify-center')}>
          <Button
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            aria-expanded={!collapsed}
            aria-label={collapsed ? t('expand') : undefined}
            title={collapsed ? t('expand') : undefined}
            onClick={toggleSidebar}
            className={cn('text-text-muted', !collapsed && 'w-full justify-start px-2')}
          >
            {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            {collapsed ? null : t('collapse')}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-bg border-border sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-2 border-b px-4 md:px-6">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('openMenu')}
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen(true);
              }}
              className="-ml-2 md:hidden"
            >
              <Menu aria-hidden />
            </Button>
            <SheetContent side="left" closeLabel={t('closeMenu')} className="w-72 gap-2 p-2">
              <SheetTitle className="sr-only">{t('mainMenu')}</SheetTitle>
              <Brand collapsed={false} />
              <SidebarNav
                items={items}
                onNavigate={() => {
                  setMenuOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>

          <CompanySwitcher companies={companies} active={activeCompany} />

          <div className="flex min-w-0 flex-1 justify-end md:justify-center">
            <Button
              variant="secondary"
              aria-label={t('search')}
              aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
              onClick={togglePalette}
              className="text-text-muted h-8 w-full max-w-72 justify-start gap-2 px-2.5 font-normal max-md:size-control-phone max-md:w-auto max-md:justify-center max-md:border-0 max-md:bg-transparent"
            >
              <Search aria-hidden />
              <span className="flex-1 text-left max-md:hidden">{t('search')}</span>
              <kbd className="border-border bg-surface-2 text-text-subtle rounded-sm border px-1.5 font-sans text-xs max-md:hidden">
                {isMac ? t('shortcutMac') : t('shortcutOther')}
              </kbd>
            </Button>
          </div>

          <ProfileMenu name={user.name} role={user.role} theme={theme} />
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 focus:outline-none md:px-6"
        >
          {children}
        </main>
      </div>

      <ShellPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        nav={items}
        actionIds={actionIds}
        searchable={searchable}
      />
      <Toaster
        label={t('notifications')}
        theme={resolvedTheme === 'dark' ? 'dark' : resolvedTheme === 'light' ? 'light' : 'system'}
      />
    </div>
  );
}
